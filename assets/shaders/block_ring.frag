// Phigros4.0.1.2 APK Unlit/EdgeMask pass1: 3x3 maximum minus source.
precision highp float;
uniform sampler2D u_cov;
uniform vec2 u_texel;
varying vec2 v_uv;

float dil9_cov(vec2 uv) {
    vec2 d = u_texel;
    float m = texture2D(u_cov, uv).x;
    m = max(m, texture2D(u_cov, uv + vec2( d.x,  0.0)).x);
    m = max(m, texture2D(u_cov, uv + vec2(-d.x,  0.0)).x);
    m = max(m, texture2D(u_cov, uv + vec2(0.0,  d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2(0.0, -d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2( d.x,  d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2(-d.x, -d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2( d.x, -d.y)).x);
    m = max(m, texture2D(u_cov, uv + vec2(-d.x,  d.y)).x);
    return m;
}
void main() {
    float edge=clamp(dil9_cov(v_uv)-texture2D(u_cov,v_uv).r,0.0,1.0);
    gl_FragColor=vec4(edge,0.0,0.0,0.0);
}
