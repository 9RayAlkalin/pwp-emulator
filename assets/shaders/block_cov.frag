// Phigros4.0.1.2 BlockCompose + SubtractBlockBlender; source manifest in gameplay-audit.
// RGB packs Active, Disabled+Ready, Ready-only coverage. Subtract count and
// green fade remain independent, then pass1 writes UNorm RG16 before compose.
precision highp float;
uniform sampler2D u_mask;
uniform sampler2D u_sub;
uniform sampler2D u_subCount;
uniform float u_strength;
uniform float u_strengthD;
uniform vec2 u_stA;
uniform float u_spA;
uniform vec2 u_stD;
uniform float u_spD;
uniform float u_tx;
varying vec2 v_uv;
#include "block_disp"

// Threshold band is [.09,.12), then the compiled smoothstep/G calculation.
float band(float value) { return step(0.09, value) - step(0.12, value); }
vec2 subtract_blend(float count, float green) {
    // APK SubtractBlockBlender pass1 -> RG16 (8 bits per channel).
    float t = clamp((0.2 - green) * 10.0, 0.0, 1.0);
    float weight = band(count) + t * t * (3.0 - 2.0 * t);
    return floor(clamp(vec2(weight, green * weight * 10.0), 0.0, 1.0) * 255.0 + 0.5) / 255.0;
}

void main() {
    vec2 offA, offD;
    // APK BlockCompose pass0 uses .83 on the perpendicular scroll direction.
    disp_avg_perp(v_uv, u_stA, u_spA, u_tx, 0.0, 0.83, offA);
    disp_avg(v_uv, u_stD, u_spD, u_tx, 0.0, offD);

    vec2 uvA = v_uv + offA * u_strength;   // active 走位移后的 uv
    vec2 uvD = v_uv + offD * u_strengthD;  // disabled/ready 不位移（u_strengthD = 0）

    vec3 raw = texture2D(u_sub, uvD).rgb;
    vec3 counts = texture2D(u_subCount, uvD).rgb;
    float subA = band(texture2D(u_subCount, uvA).r);
    vec2 subD = subtract_blend(counts.g, raw.g);
    vec2 subB = subtract_blend(counts.b, raw.b);

    vec4 mA = texture2D(u_mask, uvA);
    vec4 mD = texture2D(u_mask, uvD);

    gl_FragColor = vec4(
        clamp(abs(mA.r - subA), 0.0, 1.0),
        clamp(abs(mD.g - subD.x * subD.y), 0.0, 1.0),
        clamp(abs(mD.b - subB.y), 0.0, 1.0),
        0.0);
}
