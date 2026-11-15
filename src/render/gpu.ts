export type Uniform = number | readonly number[] | Float32Array;
export interface GpuProgram { handle: WebGLProgram; position: number; uniforms: Map<string, { location: WebGLUniformLocation; type: number }>; }
export interface GpuTarget { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number; stencil?: WebGLRenderbuffer; }
const vertex = '#version 300 es\nin vec2 position;out highp vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0,1);}';
export const copyShader = 'precision highp float;varying highp vec2 uv;uniform sampler2D screenTexture;void main(){gl_FragColor=texture2D(screenTexture,uv);}';

// Small WebGL2 executor shared by imported RPEN passes. All shader source is
// data from the package; neither JavaScript nor chart-provided code is eval'd.
export class Gpu {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGL2RenderingContext;
  readonly copy: GpuProgram;
  private buffer: WebGLBuffer;
  private quad: WebGLBuffer;
  private programs = new Set<GpuProgram>();
  private targets = new Set<GpuTarget>();
  constructor() {
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('RPEN 特效需要 WebGL2');
    this.gl = gl;
    this.quad = gl.createBuffer()!; this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    this.copy = this.program(copyShader);
  }
  program(source: string): GpuProgram {
    const gl = this.gl;
    const compile = (type: number, text: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, text); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('RPEN GLSL 编译失败：' + log); }
      return s;
    };
    let body = source.replace(/^\s*#version[^\n]*(?:\n|$)/gm, '').replace(/\bvarying\b/g, 'in')
      .replace(/\btexture2D\b/g, 'texture').replace(/\bgl_FragColor\b/g, 'rpenOutput');
    if (!/precision\s+\w+\s+float\s*;/.test(body)) body = 'precision highp float;\n' + body;
    body = body.replace(/(precision\s+\w+\s+float\s*;)/, '$1\nout vec4 rpenOutput;');
    const shaders: WebGLShader[] = [];
    const handle = gl.createProgram()!;
    try {
      shaders.push(compile(gl.VERTEX_SHADER, vertex));
      shaders.push(compile(gl.FRAGMENT_SHADER, '#version 300 es\n' + body));
      shaders.forEach(s => gl.attachShader(handle, s)); gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error('RPEN GLSL 链接失败：' + gl.getProgramInfoLog(handle));
      const uniforms: GpuProgram['uniforms'] = new Map();
      for (let i = 0; i < gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS); i++) {
        const u = gl.getActiveUniform(handle, i)!;
        uniforms.set(u.name.replace(/\[0\]$/, ''), { location: gl.getUniformLocation(handle, u.name)!, type: u.type });
      }
      const p = { handle, uniforms, position: gl.getAttribLocation(handle, 'position') }; this.programs.add(p); return p;
    } catch (e) { gl.deleteProgram(handle); throw e; }
    finally { shaders.forEach(s => gl.deleteShader(s)); }
  }
  target(width: number, height: number, format = 'rgba8', filter = 'nearest', stencil = false): GpuTarget {
    const gl = this.gl, max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    width = Math.max(1, Math.floor(width)); height = Math.max(1, Math.floor(height));
    if (width > max || height > max) throw new Error('RPEN 纹理尺寸超出 GPU 限制');
    const texture = gl.createTexture()!, framebuffer = gl.createFramebuffer()!;
    const target: GpuTarget = { texture, framebuffer, width, height }; this.targets.add(target);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const [internal, channels] = format === 'r8' ? [gl.R8, gl.RED] : format === 'rg8' ? [gl.RG8, gl.RG] : [gl.RGBA8, gl.RGBA];
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, channels, gl.UNSIGNED_BYTE, null);
    const f = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (stencil) {
      target.stencil = gl.createRenderbuffer()!; gl.bindRenderbuffer(gl.RENDERBUFFER, target.stencil);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, target.stencil);
    }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('RPEN framebuffer 不完整：' + format);
    this.clear(target); return target;
  }
  destroy(target: GpuTarget) {
    const gl = this.gl; gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer);
    if (target.stencil) gl.deleteRenderbuffer(target.stencil); this.targets.delete(target);
  }
  clear(target: GpuTarget) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true,true,true,true); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  bind(p: GpuProgram, target: GpuTarget | null, vertices?: Float32Array) {
    const gl = this.gl; gl.useProgram(p.handle); gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, target?.width ?? this.canvas.width, target?.height ?? this.canvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices ? this.buffer : this.quad);
    if (vertices) gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    if (p.position >= 0) { gl.enableVertexAttribArray(p.position); gl.vertexAttribPointer(p.position, 2, gl.FLOAT, false, 0, 0); }
  }
  uniform(p: GpuProgram, name: string, value: Uniform) {
    const u = p.uniforms.get(name); if (!u) return;
    const gl = this.gl;
    if (u.type === gl.SAMPLER_2D || u.type === gl.INT || u.type === gl.BOOL) gl.uniform1i(u.location, value as number);
    else if (u.type === gl.FLOAT_VEC2) gl.uniform2fv(u.location, value as number[]);
    else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(u.location, value as number[]);
    else if (u.type === gl.FLOAT_VEC4) gl.uniform4fv(u.location, value as number[]);
    else gl.uniform1f(u.location, value as number);
  }
  sampler(p: GpuProgram, name: string, target: GpuTarget, unit: number): number {
    if (!p.uniforms.has(name)) return unit;
    const gl = this.gl;
    if (unit >= gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) throw new Error('RPEN shader 采样器数量超限');
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, target.texture);
    this.uniform(p, name, unit); this.uniform(p, name + 'Size', [target.width, target.height]); return unit + 1;
  }
  draw() { this.gl.drawArrays(this.gl.TRIANGLES, 0, 6); }
  blit(from: GpuTarget, to: GpuTarget | null) { this.bind(this.copy, to); this.sampler(this.copy, 'screenTexture', from, 0); this.draw(); }
  upload(target: GpuTarget, image: TexImageSource) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
  dispose() {
    for (const t of [...this.targets]) this.destroy(t);
    for (const p of this.programs) this.gl.deleteProgram(p.handle); this.programs.clear();
    this.gl.deleteBuffer(this.buffer); this.gl.deleteBuffer(this.quad);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext(); this.canvas.width = this.canvas.height = 1;
  }
}
