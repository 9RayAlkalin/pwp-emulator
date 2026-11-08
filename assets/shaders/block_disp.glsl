/* 位移场。两次采样分别沿 _DisplaceDirection 和它的垂直方向滚 _Time.x*_DisplaceSpeed，
   采样 uv 是 _DisplaceMap_ST 缩放过（Active 0.8/0.3、Disabled 0.5/0.2）再叠位移。

   量化网格只发生在全屏那一步（Unlit/ActiveBlock），而且同时量化「位移图采样点」
   和「背景基准 uv」；BlockCompose 里没有这一手，mask 的位移是连续的 ——
   所以这里用 snap 参数区分两条路径。

   格子尺寸就是 _BackgroundPixelScale 个屏幕像素：floor(uv * _ScreenParams / ps) * ps + ps/2
   再除回 _ScreenParams，等价于「按 ps 像素切格、取格心」。格数随分辨率走，
   1080p 下横向 320 格 —— 与原版一致。

   由 block_cov.frag 与 block_apply.frag 共用（各自的 include 指令展开）。 */
uniform sampler2D u_disp;
uniform vec2 u_res;
uniform vec2 u_dir;
uniform float u_ps;

vec2 disp_snap(vec2 uv) {
    float ps = max(u_ps, 1.0);
    return (floor(uv * u_res / ps) * ps + ps * 0.5) / u_res;
}

float disp_avg_perp(vec2 uv, vec2 st, float sp, float tx, float snap, float perpendicularSpeed, out vec2 off) {
    vec2 base = uv * st;
    float s = tx * sp;
    vec2 q1 = base + u_dir * s;
    vec2 q2 = base + vec2(-u_dir.y, u_dir.x) * s * perpendicularSpeed;
    if (snap > 0.5) { q1 = disp_snap(q1); q2 = disp_snap(q2); }
    float first = texture2D(u_disp, q1).r, second = texture2D(u_disp, q2).r;
    float avg = (first + second) * 0.5;
    // APK GLES3: the two samples displace along perpendicular basis vectors.
    off = u_dir * (first - 0.5) + vec2(-u_dir.y, u_dir.x) * (second - 0.5);
    return avg;
}
float disp_avg(vec2 uv, vec2 st, float sp, float tx, float snap, out vec2 off) {
    return disp_avg_perp(uv,st,sp,tx,snap,1.0,off);
}
