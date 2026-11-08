precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_step;
varying vec2 v_uv;

// APK Hidden/EfficientBlur：四个对角点各占1/4，偏移为源texelSize*radius/2。
void main() {
    gl_FragColor = (texture2D(u_tex, v_uv + u_step)
                 + texture2D(u_tex, v_uv + u_step * vec2(-1.0, 1.0))
                 + texture2D(u_tex, v_uv - u_step)
                 + texture2D(u_tex, v_uv + u_step * vec2(1.0, -1.0))) * 0.25;
}
