// Independently expressed full-playfield forms of the four legacy effects used
// by Tokonagi. Package GLSL takes precedence over these built-ins.
const header = 'precision highp float;varying highp vec2 uv;uniform sampler2D screenTexture;uniform vec2 screenSize;uniform float time;\nvec4 sampleScene(vec2 p){if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))return vec4(0);return texture2D(screenTexture,p);}\n';
export const builtinShaders: Record<string, string> = {
  grayscale: header + `uniform float factor; // %1.0%
void main(){vec4 c=texture2D(screenTexture,uv);float y=dot(c.rgb,vec3(.299,.587,.114));gl_FragColor=vec4(mix(c.rgb,vec3(y),factor),1.0);}`,
  vignette: header + `uniform vec4 color; // %0.0,0.0,0.0,1.0%
uniform float extend; // %0.25%
uniform float radius; // %15.0%
void main(){vec2 a=uv*(1.0-uv);float weight=pow(max(0.0,a.x*a.y*radius),extend);gl_FragColor=vec4(mix(color.rgb,texture2D(screenTexture,uv).rgb,weight),1.0);}`,
  glitch: header + `uniform float power; // %0.03%
uniform float rate; // %0.6%
uniform float speed; // %5.0%
uniform float blockCount; // %30.5%
uniform float colorRate; // %0.01%
float hash(float x){return fract(543.2543*sin(x*(3525.46-54.3415)));}
void main(){float tick=sign(time*speed)*floor(abs(time*speed));float gate=hash(tick)<rate?1.0:0.0;
float band=floor(uv.y*blockCount)/max(blockCount,.00001);vec2 p=uv+vec2((hash(band+time)-.5)*power*gate,0.0);
vec4 c=sampleScene(p);c.r=mix(c.r,sampleScene(p+vec2(colorRate/.7031,0)).r,gate);
c.b=mix(c.b,sampleScene(p-vec2(colorRate/.7031,0)).b,gate);gl_FragColor=vec4(c.rgb,1.0);}`,
  fisheye: header + `uniform vec2 resolution; // %1350.0,900.0%
uniform float power; // %-0.1%
void main(){float a=resolution.x/resolution.y;vec2 center=vec2(.5,.5/a);vec2 d=vec2(uv.x,uv.y/a)-center;
float r=length(d),k=3.141592/length(center)*power;vec2 p=uv;
if(abs(k)>.000001&&r>.000001){float b=k>0.0?length(center):min(center.x,center.y);
float distance=k>0.0?tan(r*k)*b/tan(b*k):atan(r*-k*10.0)*b/atan(-k*b*10.0);
vec2 q=center+d/r*distance;p=vec2(q.x,q.y*a);if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))p=uv;}
gl_FragColor=vec4(texture2D(screenTexture,p).rgb,1.0);}`,
};
export function shaderDefaults(source: string): Record<string, number | number[]> {
  const values: Record<string, number | number[]> = {};
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/^\s*uniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|int|bool|vec[234])\s+(\w+)\s*;[^\r\n]*?\/\/\s*%([^%]+)%/gm)) {
    const parts = m[3].split(',').map(Number), size = m[1].startsWith('vec') ? Number(m[1].at(-1)) : 1;
    if (parts.length !== size || !parts.every(Number.isFinite)) throw new Error('RPEN uniform 默认值无效：' + m[2]);
    values[m[2]] = size === 1 ? parts[0] : parts;
  }
  return values;
}
