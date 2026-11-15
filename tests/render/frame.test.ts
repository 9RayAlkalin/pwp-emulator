import { expect, it, vi } from 'vitest';
import { renderGameplayFrame, type FrameTargets, type FramePasses } from '../../src/render/frame';

const canvas = (name: string) => ({ name, getContext: () => ({ name }) }) as unknown as HTMLCanvasElement;
const targets: FrameTargets = { output: canvas('output'), foreground: canvas('foreground'), background: canvas('background') };

it('waits for worker drawing before HUD and final compositing', async () => {
  let done!: () => void;
  const draw = new Promise<void>(resolve => { done = resolve; }), hud = vi.fn(), composite = vi.fn();
  const pending = renderGameplayFrame(targets, 0, 0, false, { drawScene: () => draw, drawHud: hud, drawBlocks: vi.fn(), composite });
  expect(hud).not.toHaveBeenCalled(); done(); await pending;
  expect(hud).toHaveBeenCalledOnce(); expect(composite).toHaveBeenCalledOnce();
});

it.each([false, true])('keeps one drawing order for playback/export with split=%s', split => {
  const calls: unknown[] = [];
  const passes: FramePasses = {
    drawScene: (ctx,time,layer) => { calls.push(['scene',(ctx as any).name,time,layer]); },
    drawHud: (ctx,time) => calls.push(['hud',(ctx as any).name,time]),
    drawBlocks: (ctx,time) => calls.push(['blocks',(ctx as any).name,time]),
    composite: (scene,output,time,bg) => calls.push(['composite',scene,output,time,bg]),
  };
  renderGameplayFrame(targets, 10, 11.315, split, passes);
  expect(calls).toEqual([
    ...(split ? [['scene','background',10,'bg'],['scene','foreground',10,'fg']] : [['scene','foreground',10,undefined]]),
    ['hud','foreground',11.315], ['blocks','foreground',10], ['composite',targets.foreground,targets.output,10,split ? targets.background : null],
  ]);
});
it('does not continue to HUD or compositing after a scene drawing error',()=>{
  const hud=vi.fn(),blocks=vi.fn(),composite=vi.fn();
  expect(()=>renderGameplayFrame(targets,0,0,false,{drawScene:()=>{throw new Error('draw failed');},drawHud:hud,drawBlocks:blocks,composite})).toThrow('draw failed');
  expect(hud).not.toHaveBeenCalled();expect(blocks).not.toHaveBeenCalled();expect(composite).not.toHaveBeenCalled();
});

it('places RPEN local effects before HUD and keeps the final noise/global stages after it',()=>{
  const calls:string[]=[];
  renderGameplayFrame(targets,2,3,false,{drawScene:()=>{calls.push('scene');},beforeHud:()=>{calls.push('local');},
    drawHud:()=>{calls.push('hud');},drawBlocks:()=>{calls.push('native-blocks');},composite:()=>{calls.push('noise/global');}});
  expect(calls).toEqual(['scene','local','hud','native-blocks','noise/global']);
});
