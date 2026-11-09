import { expect, it, vi } from 'vitest';
import { renderGameplayFrame, type FrameTargets, type FramePasses } from '../../src/render/frame';

const canvas = (name: string) => ({ name, getContext: () => ({ name }) }) as unknown as HTMLCanvasElement;
const targets: FrameTargets = { output: canvas('output'), foreground: canvas('foreground'), background: canvas('background') };

it.each([false, true])('keeps one drawing order for playback/export with split=%s', split => {
  const calls: unknown[] = [];
  const passes: FramePasses = {
    drawScene: (ctx,time,layer) => calls.push(['scene',(ctx as any).name,time,layer]),
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
