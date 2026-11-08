// Phigros 4.0.1.2 Hidden/EfficientBlur: four diagonal bilinear taps per pass.
// LeTai.Effects.ScalableBlurConfig.SetAdvancedFieldFromSimple RVA 0x32bbef4.
export function shadowBlurConfig(strength: number): { radius: number; iteration: number } {
  if (strength < .01) return { radius: 0, iteration: 0 };
  const scaled = Math.fround(strength * Math.fround(1.7071068));
  const iteration = Math.ceil(Math.log2((Math.sqrt(scaled * 12 + 1) + 5) / 6));
  return { radius: scaled / ((3 << iteration) - 2), iteration };
}

let gpu: { canvas: HTMLCanvasElement; gl: WebGLRenderingContext; program: WebGLProgram; step: WebGLUniformLocation } | null | undefined;

function blurGPU(source: HTMLCanvasElement, radius: number, iteration: number): HTMLCanvasElement | undefined {
  if (gpu === undefined) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    gpu = null;
    if (gl) {
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'EfficientBlur shader');
        return shader;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D tex;uniform vec2 stepSize;varying vec2 uv;void main(){gl_FragColor=(texture2D(tex,uv+stepSize)+texture2D(tex,uv-stepSize)+texture2D(tex,uv+vec2(stepSize.x,-stepSize.y))+texture2D(tex,uv+vec2(-stepSize.x,stepSize.y)))*.25;}'));
      gl.linkProgram(program); gl.useProgram(program);
      const buffer = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gpu = { canvas, gl, program, step: gl.getUniformLocation(program, 'stepSize')! };
    }
  }
  if (!gpu) return;
  const { canvas, gl, program, step } = gpu;
  canvas.width = source.width; canvas.height = source.height; gl.useProgram(program);
  const textures = [gl.createTexture()!, gl.createTexture()!], framebuffer = gl.createFramebuffer()!;
  for (const texture of textures) {
    gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  gl.bindTexture(gl.TEXTURE_2D, textures[0]); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  let current = 0, width = source.width, height = source.height;
  const depths = [...Array.from({ length: iteration }, (_, i) => i + 1), ...Array.from({ length: iteration }, (_, i) => iteration - i - 1)];
  for (const depth of depths) {
    const w = Math.max(1, source.width >> depth), h = Math.max(1, source.height >> depth), next = 1 - current;
    if (depth) {
      gl.bindTexture(gl.TEXTURE_2D, textures[next]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[next], 0);
    } else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, textures[current]); gl.uniform2f(step, radius / (2 * width), radius / (2 * height));
    gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    current = next; width = w; height = h;
  }
  const output = document.createElement('canvas'); output.width = source.width; output.height = source.height;
  output.getContext('2d')!.drawImage(canvas, 0, 0);
  textures.forEach(texture => gl.deleteTexture(texture)); gl.deleteFramebuffer(framebuffer);
  return output;
}

export function efficientBlur(source: HTMLCanvasElement, radius: number, iteration: number): HTMLCanvasElement {
  if (!iteration) return source;
  const result = blurGPU(source, radius, iteration);
  if (result) return result;
  let current = source;
  const pass = (width: number, height: number) => {
    const output = document.createElement('canvas'); output.width = width; output.height = height;
    const ctx = output.getContext('2d')!;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .25;
    const dx = radius * .5 * width / current.width, dy = radius * .5 * height / current.height;
    for (const x of [-dx, dx]) for (const y of [-dy, dy]) ctx.drawImage(current, x, y, width, height);
    current = output;
  };
  const widths = [source.width], heights = [source.height];
  for (let depth = 1; depth <= iteration; depth++) {
    widths.push(Math.max(1, source.width >> depth)); heights.push(Math.max(1, source.height >> depth));
    pass(widths[depth], heights[depth]);
  }
  for (let depth = iteration - 1; depth >= 0; depth--) pass(widths[depth], heights[depth]);
  return current;
}
