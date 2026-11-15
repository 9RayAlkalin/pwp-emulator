import { expect, it } from 'vitest';
import { builtinShaders, shaderDefaults } from '../../src/render/shaders';

it('reads scalar/vector shader defaults, preserving signed values and ignoring commented declarations',()=>{
  expect(shaderDefaults('uniform float power; // %-0.1%\nuniform highp vec4 color; // %1,.25,0,1%\n// uniform float bad; // %5%\n/* uniform float nope; // %6% */'))
    .toEqual({power:-.1,color:[1,.25,0,1]});
  expect(()=>shaderDefaults('uniform vec2 center; // %0.5%')).toThrow();
});
it('keeps effect-specific defaults from the source instead of sharing a power value across effects',()=>{
  expect(shaderDefaults(builtinShaders.glitch)).toMatchObject({power:.03,speed:5,rate:.6,colorRate:.01});
  expect(shaderDefaults(builtinShaders.fisheye).power).toBe(-.1);
  expect(shaderDefaults(builtinShaders.vignette)).toMatchObject({extend:.25,radius:15,color:[0,0,0,1]});
});
