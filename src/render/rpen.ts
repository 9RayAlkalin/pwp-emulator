import type { RpenData, NoiseLayer, ShaderEffect, ShaderValue } from '../chart/formats/rpen';
import type { ChartViewport } from '../chart/geometry/viewport';
import { blockingNoiseAt, projectNoise, sampleNoise, shaderValues, type NoiseSample } from '../gameplay/noise';
import { Gpu, type GpuProgram, type GpuTarget } from './gpu';
import { builtinShaders, shaderDefaults } from './shaders';

interface TargetSpec { scaleX?: number; scaleY?: number; format?: string; filter?: string; noClear?: boolean; }
interface SkinPass { shader: string; output: string; inputs?: Record<string, string>; constants?: Record<string, ShaderValue>; }
interface SkinConfig { version: number; targets: Record<string, TargetSpec>; passes: SkinPass[]; blockMask?: TargetSpec; lowPerformance?: SkinConfig; }
interface ImageSpec { name: string; path: string; wrap: string; filter: string; colorspace: string; alphaMode: string; }
interface Program { gpu: GpuProgram; defaults: Record<string, ShaderValue>; images: { name: string; target: GpuTarget }[]; }
interface Skin { config: SkinConfig; programs: Map<string, Program>; defaults: Record<string, ShaderValue>; }
interface Pair { front: GpuTarget; back: GpuTarget; }
interface Instance { width: number; height: number; resources: GpuTarget[]; targets: Map<string, Pair>; screens: Pair; fullMask: GpuTarget; mask: GpuTarget; history: Map<string,GpuTarget>; lastTime?: number; }

function localPath(path: string): string {
  const p = path.replaceAll('\\', '/');
  if (!p || p.startsWith('/') || /[:?#\x00-\x1f]/.test(p) || p.split('/').some(v => !v || v === '.' || v === '..')) throw new Error('RPEN 资源路径无效：' + path);
  return p;
}
function images(source: string, file: string): ImageSpec[] {
  const directory = file.slice(0, file.lastIndexOf('/') + 1);
  return [...source.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler2D\s+(\w+)\s*;\s*\/\/\s*@texture\s+(\S+)([^\r\n]*)/g)].map(m => {
    const options = Object.fromEntries(m[3].trim().split(/\s+/).filter(Boolean).map(v => v.split('=')));
    return { name: m[1], path: localPath(directory + m[2]), wrap: options.wrap || 'clamp', filter: options.filter || 'linear',
      colorspace: options.colorspace || 'linear', alphaMode: options.alphaMode || 'straight' };
  });
}
const fallbackSkin = `precision highp float;varying highp vec2 uv;uniform sampler2D screenTexture;uniform sampler2D blockMask;uniform vec2 blockMaskSize;uniform vec2 screenSize;uniform float time;
float bit(vec2 p,float n){return mod(floor(texture2D(blockMask,p).r*255.0/exp2(n)+.001),2.0);}
float active(vec2 p){return abs(bit(p,0.0)-bit(p,1.0));}
void main(){vec4 c=texture2D(screenTexture,uv);float a=active(uv),d=abs(bit(uv,2.0)-bit(uv,3.0));
vec2 e=1.0/blockMaskSize;float edge=max(max(active(uv+vec2(e.x,0)),active(uv-vec2(e.x,0))),max(active(uv+vec2(0,e.y)),active(uv-vec2(0,e.y))))-a;
float grain=fract(sin(dot(floor(uv*screenSize/6.0)+floor(time*20.0),vec2(12.9898,78.233)))*43758.5453);
c.rgb=mix(c.rgb,vec3(.497,.138,.138)*.4,d*.4);c.rgb=mix(c.rgb,c.rgb*vec3(1.0,.33,.33)+vec3(.12,.02,.02)*grain,a*.667);
gl_FragColor=vec4(c.rgb+vec3(1,.33,.33)*max(edge,0.0)*.8,1);}`;

// Owns only RPEN GPU resources. The existing Phigros effect stack keeps its
// own inputs and materials; playback and video export both call these stages.
export class RpenRenderer {
  private gpu = new Gpu();
  private capture = document.createElement('canvas');
  private assets: Map<string, { path: string; blob: Blob }>;
  private skins = new Map<string, Skin>();
  private effects = new Map<string, Program>();
  private instances = new Map<string, Instance>();
  private effectScreens?: Pair;
  private maskProgram: GpuProgram;
  private downsample: GpuProgram;
  private contacts = new Map<string, { x: number; y: number; since: number; active: boolean; layers: Set<string> }>();
  private touchPoints = new Float32Array(128);
  private touchCount = 0;
  private constructor(readonly data: RpenData, assets: Record<string, Blob> = {}) {
    this.assets = new Map(Object.entries(assets).map(([path, blob]) => [localPath(path).toLowerCase(), { path, blob }]));
    this.maskProgram = this.gpu.program('precision highp float;uniform float maskBit;void main(){gl_FragColor=vec4(maskBit,0,0,1);}');
    this.downsample = this.gpu.program('precision highp float;varying highp vec2 uv;uniform sampler2D screenTexture;uniform vec2 sourceSize;void main(){gl_FragColor=texelFetch(screenTexture,ivec2(floor(uv*sourceSize)),0);}');
  }
  static async load(data?: RpenData, assets?: Record<string, Blob>): Promise<RpenRenderer | undefined> {
    if (!data || !data.areas.length && !data.effects.length) return undefined;
    const renderer = new RpenRenderer(data, assets);
    try { await renderer.prepare(); return renderer; } catch (e) { renderer.dispose(); throw e; }
  }
  private asset(path: string): { path: string; blob: Blob } {
    const file = this.assets.get(localPath(path).toLowerCase());
    if (!file) throw new Error('RPEN 缺少资源：' + path); return file;
  }
  private async image(spec: ImageSpec): Promise<GpuTarget> {
    const gpu = this.gpu, gl = gpu.gl;
    const bitmap = await createImageBitmap(this.asset(spec.path).blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const target = gpu.target(bitmap.width, bitmap.height, 'rgba8', spec.filter);
    try {
      // ImageBitmap orientation is fixed by createImageBitmap; GL's unpack flip
      // is ignored for ImageBitmaps. Color conversion is explicit below.
      gpu.upload(target, bitmap);
      if (spec.colorspace === 'srgb' || spec.alphaMode === 'premult') {
        const converted = gpu.target(bitmap.width, bitmap.height, 'rgba8', spec.filter);
        const p = gpu.program('precision highp float;varying highp vec2 uv;uniform sampler2D screenTexture;uniform float srgb;uniform float premult;void main(){vec4 c=texture2D(screenTexture,uv);if(srgb>.5)c.rgb=mix(c.rgb/12.92,pow((c.rgb+.055)/1.055,vec3(2.4)),step(vec3(.04045),c.rgb));if(premult>.5)c.rgb*=c.a;gl_FragColor=c;}');
        gpu.bind(p, converted); gpu.sampler(p, 'screenTexture', target, 0); gpu.uniform(p, 'srgb', +(spec.colorspace === 'srgb')); gpu.uniform(p, 'premult', +(spec.alphaMode === 'premult')); gpu.draw();
        gpu.blit(converted, target); gpu.destroy(converted);
      }
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      const wrap = spec.wrap === 'mirror' ? gl.MIRRORED_REPEAT : spec.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return target;
    } finally { bitmap.close(); }
  }
  private async program(source: string, path: string): Promise<Program> {
    return { gpu: this.gpu.program(source), defaults: shaderDefaults(source),
      images: await Promise.all(images(source, path).map(async spec => ({ name: spec.name, target: await this.image(spec) }))) };
  }
  private async prepare() {
    for (const layer of this.data.layers) {
      if (!this.data.areas.some(a => a.layer === layer.id) || this.skins.has(layer.skin)) continue;
      if (!layer.skin) {
        this.skins.set('', { config: { version: 1, targets: {}, passes: [{ shader: 'main.glsl', output: '$screen' }] },
          programs: new Map([['main.glsl', await this.program(fallbackSkin, 'main.glsl')]]), defaults: {} }); continue;
      }
      const root = localPath(layer.skin), configFile = this.assets.get((root + '/config.json').toLowerCase());
      const config: SkinConfig = configFile ? JSON.parse(await configFile.blob.text()) : { version: 1, targets: {}, passes: [{ shader: 'main.glsl', output: '$screen' }] };
      if (config.version !== 1) throw new Error('RPEN 噪域皮肤版本不支持：' + root);
      const programs = new Map<string, Program>();
      for (const channel of [config, config.lowPerformance].filter(Boolean) as SkinConfig[]) {
        if (!Array.isArray(channel.passes) || !channel.passes.length) throw new Error('RPEN 皮肤缺少 passes：' + root);
        channel.targets ??= {};
        for (const [name, spec] of Object.entries(channel.targets)) {
          if (!name || name.includes('.') || name === '$screen' || !['rgba8','r8','rg8'].includes(spec.format ?? 'rgba8') ||
            !['nearest','linear'].includes(spec.filter ?? 'nearest')) throw new Error('RPEN 皮肤 target 无效：' + name);
        }
        for (const pass of channel.passes) {
          const path = root + '/' + localPath(pass.shader), [target, component] = pass.output.split('.');
          if (target !== '$screen' && !Object.hasOwn(channel.targets, target) || component && !'rgba'.includes(component)) throw new Error('RPEN 皮肤输出无效：' + pass.output);
          for (const input of Object.values(pass.inputs ?? {})) if (input !== '$screen' && !Object.hasOwn(channel.targets, input)) throw new Error('RPEN 皮肤输入无效：' + input);
          if (!programs.has(pass.shader)) programs.set(pass.shader, await this.program(await this.asset(path).blob.text(), path));
        }
      }
      const main = programs.get('main.glsl') ?? await this.program(await this.asset(root + '/main.glsl').blob.text(), root + '/main.glsl');
      this.skins.set(layer.skin, { config, programs, defaults: main.defaults });
    }
    for (const e of this.data.effects) {
      if (this.effects.has(e.shader)) continue;
      const path = e.shader.replaceAll('\\','/').replace(/^\//,'');
      const file = this.assets.get(path.toLowerCase()) ?? this.assets.get(('shader/' + path).toLowerCase());
      const source = file ? await file.blob.text() : builtinShaders[path.replace(/\.glsl$/i, '').toLowerCase()];
      if (!source) throw new Error('RPEN shader 暂不支持或缺少文件：' + e.shader);
      this.effects.set(e.shader, await this.program(source, file?.path ?? path));
    }
  }
  private size(width: number, height: number, spec: TargetSpec = {}): [number, number] {
    const scale = [spec.scaleX ?? 1, spec.scaleY ?? 1];
    if (scale.some(v => !Number.isFinite(v) || v <= 0)) throw new Error('RPEN target scale 必须大于零');
    return [Math.max(1, Math.floor(width*scale[0])), Math.max(1, Math.floor(height*scale[1]))];
  }
  private instance(layer: NoiseLayer, width: number, height: number): Instance {
    let instance = this.instances.get(layer.id);
    if (instance?.width === width && instance.height === height) return instance;
    if (instance) instance.resources.forEach(t => this.gpu.destroy(t));
    const skin = this.skins.get(layer.skin)!, config = layer.channel === 'low' && skin.config.lowPerformance || skin.config;
    const resources: GpuTarget[] = [];
    const allocate = (spec: TargetSpec = {}, stencil = false) => { const t = this.gpu.target(...this.size(width,height,spec), spec.format, spec.filter, stencil); resources.push(t); return t; };
    const pair = (spec: TargetSpec = {}): Pair => ({ front: allocate(spec), back: allocate(spec) });
    instance = { width, height, resources, screens: pair({filter:'linear'}), fullMask: allocate({format:'r8'}, true),
      mask: allocate({ ...config.blockMask, format:'r8' }), targets: new Map(Object.entries(config.targets).map(([k,v])=>[k,pair(v)])),
      history: new Map(Object.entries(config.targets).filter(([,v])=>v.noClear).map(([k,v])=>[k,allocate(v)])) };
    this.instances.set(layer.id, instance); return instance;
  }
  private captureScene(context: CanvasRenderingContext2D, viewport: ChartViewport, target: GpuTarget) {
    const width = Math.max(1, Math.round(viewport.width)), height = context.canvas.height;
    if (this.capture.width !== width || this.capture.height !== height) { this.capture.width = width; this.capture.height = height; }
    const ctx = this.capture.getContext('2d')!; ctx.clearRect(0,0,width,height);
    ctx.drawImage(context.canvas, viewport.left, 0, viewport.width, height, 0, 0, width, height); this.gpu.upload(target, this.capture);
  }
  private present(context: CanvasRenderingContext2D, viewport: ChartViewport, target: GpuTarget) {
    const gpu = this.gpu;
    if (gpu.canvas.width !== target.width || gpu.canvas.height !== target.height) { gpu.canvas.width = target.width; gpu.canvas.height = target.height; }
    gpu.blit(target, null);
    context.save(); context.setTransform(1,0,0,1,0,0); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    context.clearRect(viewport.left,0,viewport.width,context.canvas.height);
    context.drawImage(gpu.canvas,viewport.left,0,viewport.width,context.canvas.height); context.restore();
  }
  private drawPass(program: Program, output: GpuTarget, scene: GpuTarget, values: Record<string, ShaderValue>, time: number,
                   samplers: Record<string, GpuTarget> = {}) {
    const gpu = this.gpu; gpu.bind(program.gpu, output);
    let unit = gpu.sampler(program.gpu,'screenTexture',scene,0);
    for (const [name,target] of Object.entries(samplers)) unit = gpu.sampler(program.gpu,name,target,unit);
    for (const image of program.images) unit = gpu.sampler(program.gpu,image.name,image.target,unit);
    for (const [k,v] of Object.entries({...program.defaults,...values})) gpu.uniform(program.gpu,k,v);
    gpu.uniform(program.gpu,'screenSize',[scene.width,scene.height]);
    gpu.uniform(program.gpu,'resolution',values.resolution??program.defaults.resolution??[1350,900]);
    gpu.uniform(program.gpu,'targetSize',[output.width,output.height]); gpu.uniform(program.gpu,'targetTexelSize',[1/output.width,1/output.height]);
    gpu.uniform(program.gpu,'time',time); gpu.uniform(program.gpu,'u_time',time);
    gpu.uniform(program.gpu,'touchCount',this.touchCount); gpu.uniform(program.gpu,'touchPoints',this.touchPoints);
    gpu.draw();
  }
  effectsStage(context: CanvasRenderingContext2D, viewport: ChartViewport, chartTime: number, global: boolean, enabled: boolean) {
    if (!enabled) return;
    const active = this.data.effects.filter(e => e.global === global && e.start <= chartTime && chartTime < e.end);
    if (!active.length) return;
    const width = Math.max(1,Math.round(viewport.width)), height = context.canvas.height, gpu = this.gpu;
    if (this.effectScreens?.front.width !== width || this.effectScreens.front.height !== height) {
      if (this.effectScreens) { gpu.destroy(this.effectScreens.front); gpu.destroy(this.effectScreens.back); }
      this.effectScreens = {front:gpu.target(width,height,'rgba8','linear'),back:gpu.target(width,height,'rgba8','linear')};
    }
    const pair = this.effectScreens; gpu.gl.disable(gpu.gl.BLEND); gpu.gl.disable(gpu.gl.STENCIL_TEST); gpu.gl.colorMask(true,true,true,true);
    this.captureScene(context,viewport,pair.front);
    for (const effect of active) {
      this.drawPass(this.effects.get(effect.shader)!,pair.back,pair.front,shaderValues(effect,chartTime),chartTime);
      [pair.front,pair.back]=[pair.back,pair.front];
    }
    this.present(context,viewport,pair.front);
  }
  private mask(instance: Instance, entries: NoiseSample[]) {
    const gpu = this.gpu, gl = gpu.gl; gpu.clear(instance.fullMask);
    for (let bit=0;bit<6;bit++) {
      const group=Math.floor(bit/2), inverted=!!(bit%2), vertices:number[]=[];
      for (const entry of entries) {
        if (entry.area.invert!==inverted || !(group===0?entry.state==='active':group===1?entry.state!=='active':entry.state==='ready')) continue;
        const p=projectNoise(entry,instance.width,instance.height).points.map(p=>[p.x*2/instance.width,p.y*2/instance.height]);
        for(const index of [0,1,2,0,2,3])vertices.push(...p[index]);
      }
      if(!vertices.length)continue;
      gl.enable(gl.STENCIL_TEST); gl.stencilMask(255); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.stencilFunc(gl.ALWAYS,0,255); gl.stencilOp(gl.KEEP,gl.KEEP,gl.INCR); gl.colorMask(false,false,false,false);
      gpu.bind(this.maskProgram,instance.fullMask,new Float32Array(vertices)); gl.drawArrays(gl.TRIANGLES,0,vertices.length/2);
      // RPEN invert coverage is exactly one subtract area. Two overlapping
      // inverted regions cancel their coverage even without a normal region.
      gl.stencilMask(0); gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP); gl.stencilFunc(inverted?gl.EQUAL:gl.LEQUAL,1,255);
      gl.colorMask(true,true,true,true); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE);
      gpu.bind(this.maskProgram,instance.fullMask); gpu.uniform(this.maskProgram,'maskBit',(1<<bit)/255); gpu.draw();
      gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    }
    gpu.bind(this.downsample,instance.mask); gpu.sampler(this.downsample,'screenTexture',instance.fullMask,0);
    gpu.uniform(this.downsample,'sourceSize',[instance.fullMask.width,instance.fullMask.height]); gpu.draw();
  }
  noiseStage(context: CanvasRenderingContext2D, viewport: ChartViewport, chartTime: number, musicTime: number,
             touches: readonly {id:string;x:number;y:number}[] = [], touchTime = 0) {
    const width=Math.max(1,Math.round(viewport.width)),height=context.canvas.height,gpu=this.gpu,gl=gpu.gl;
    const samples=this.data.areas.filter(a=>chartTime+1e-9>=a.appear&&chartTime+1e-9<a.disappear).map(a=>sampleNoise(a,chartTime));
    for (const [id,contact] of this.contacts) {
      const touch=touches.find(t=>t.id===id);
      if (!touch && contact.active) { contact.active=false; contact.since=touchTime; }
      else if (touch && contact.active) { contact.x=(touch.x-viewport.left)/viewport.width;contact.y=1-touch.y/height; }
    }
    for (const touch of touches) if (!this.contacts.get(touch.id)?.active) {
      const x=(touch.x-viewport.left)/viewport.width,y=1-touch.y/height;
      const layers=new Set(this.data.layers.filter(l=>!!blockingNoiseAt(this.data.areas.filter(a=>a.layer===l.id),chartTime,(x-.5)*width,(y-.5)*height,width,height)).map(l=>l.id));
      this.contacts.set(touch.id,{x,y,since:touchTime,active:true,layers});
    }
    for(const layer of this.data.layers) {
      const entries=samples.filter(s=>s.area.layer===layer.id);
      if(!entries.length&&!this.contacts.size)continue;
      gl.disable(gl.BLEND);gl.disable(gl.STENCIL_TEST);gl.colorMask(true,true,true,true);
      const skin=this.skins.get(layer.skin);
      if (!skin) continue;
      const config=layer.channel==='low'&&skin.config.lowPerformance||skin.config;
      const duration=Number(layer.parameters.touchReleaseDuration??skin.defaults.touchReleaseDuration??.1);
      this.touchPoints.fill(0);this.touchCount=0;
      for (const [id,contact] of this.contacts) {
        const elapsed=Math.max(0,touchTime-contact.since);
        if (!contact.active && elapsed>=Math.max(0,duration)) continue;
        if (!contact.layers.has(layer.id)||this.touchCount>=32) continue;
        this.touchPoints.set([contact.x,contact.y,elapsed,+contact.active],4*this.touchCount++);
      }
      const instance=this.instance(layer,width,height),screens=instance.screens;
      this.captureScene(context,viewport,screens.front);this.mask(instance,entries);
      for(const [name,pair] of instance.targets) {
        if(!config.targets[name].noClear)gpu.clear(pair.front);
        else {
          const history=instance.history.get(name)!;
          if(instance.lastTime===chartTime)gpu.blit(history,pair.front);
          else if(instance.lastTime!==undefined&&(chartTime<instance.lastTime||chartTime-instance.lastTime>.25)) {gpu.clear(history);gpu.clear(pair.front);}
          else gpu.blit(pair.front,history);
        }
      }
      for(const pass of config.passes) {
        const [target,component]=pass.output.split('.'), pair=target==='$screen'?screens:instance.targets.get(target)!;
        if(component)gpu.blit(pair.front,pair.back);
        const samplers:Record<string,GpuTarget>={blockMask:instance.mask};
        for(const [name,input]of Object.entries(pass.inputs??{}))samplers[name]=input==='$screen'?screens.front:instance.targets.get(input)!.front;
        if(component)gl.colorMask(...['r','g','b','a'].map(c=>c===component) as [boolean,boolean,boolean,boolean]);
        this.drawPass(skin.programs.get(pass.shader)!,pair.back,screens.front,{...skin.defaults,...layer.parameters,...pass.constants},musicTime,samplers);
        gl.colorMask(true,true,true,true);[pair.front,pair.back]=[pair.back,pair.front];
      }
      this.present(context,viewport,screens.front);
      instance.lastTime=chartTime;
    }
    const maxRelease=Math.max(.1,...this.data.layers.map(l=>Number(l.parameters.touchReleaseDuration??this.skins.get(l.skin)?.defaults.touchReleaseDuration??.1)));
    for (const [id,contact] of this.contacts) if (!contact.active&&touchTime-contact.since>=maxRelease)this.contacts.delete(id);
    this.touchCount=0;
  }
  reset() { for(const i of this.instances.values()){for(const t of i.resources)this.gpu.clear(t);i.lastTime=undefined;} this.contacts.clear(); }
  dispose() { this.gpu.dispose(); this.instances.clear(); this.effects.clear(); this.skins.clear(); }
}
