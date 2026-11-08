# pwp-emulator

基于 **pnpm + TypeScript + Vite + Canvas 2D / WebGL** 的 Phigros 网页模拟器。

需要 Node.js 22 或更高版本以及 pnpm 10。

```sh
pnpm install
pnpm dev
```

访问终端打印的地址（默认 `http://localhost:5173`）。`pnpm build` 会检查 TypeScript 并生成可独立部署的 `dist/`，`pnpm preview` 预览构建产物。支持部署到子路径。

功能：

- 原生控件单页界面，使用原生选谱下拉框、Autoplay 复选框、搜索和折叠设置；始终提供内置 True Home, True World 演示。
- 通过文件选择或拖放导入 PEZ / ZIP，或同时选择谱面、音频与可选曲绘。支持 Phigros v1/v3 JSON、PEC 和 RPE，按内容识别格式；支持变 BPM、分离 XY、分层事件、缓动、父子线、假音符及基本文字/颜色/缩放事件。适配范围见 [谱面导入说明](docs/chart-adapters.md)。
- 支持 `info.yml` / `info.yaml`、`info.txt`、`info.csv`、`info.json`，以及 RPE `META`；`info.txt` 支持 `Name`、`Song`、`Picture`、`Chart`、`Level`、`Composer`、`Charter`、`Illustrator`。一首音乐可供多张谱面共享，多首音乐时需要明确填写对应关系。
- RPE 自定义判定线图片/GIF、纹理与文字锚点、`gifEvents` 进度，以及七种 `attachUI` HUD 绑定；移动、旋转和缩放后的暂停按钮保留对应点击区域。GIF 逐帧解码需要支持 ImageDecoder 的浏览器。
- 设置中可调整 PEC/RPE 谱面宽高比（0 跟随 info.yml），即时生效并保存；HUD 保持原尺寸，左右定位在 cover 内侧。
- Autoplay 与手动 Tap / Drag / Hold / Flick 判定，多点触控、鼠标、键盘输入，分数、连击、准确率与结算；手动、Autoplay 和视频导出共用打击序列帧与粒子，Perfect 金色、Good 蓝色。
- 手动触摸生效方块会锁定该手指至松开，并触发触摸光晕和音乐低通；支持移动/旋转方块、减算区域及多指，暂停与跳转会清理状态。规则与还原范围见 [Block 接触说明](docs/block-touch.md)。
- 0.5–2 倍速、时间轴跳转、重开、偏移、音量、音符大小、背景亮度、全屏与特效开关。设置保存在浏览器；导入谱面只保留在当前页面会话。
- Canvas 2D 绘制谱面与 HUD，字体按最终像素栅格化并适配高 DPI；WebGL/WebGL2 执行后期特效；无法使用 WebGL 时降级绘制。
- Loading、暂停和结算使用恢复的 Unity 场景与动画；玩家资料在 HTML 设置中编辑，头像列表自动读取 `assets/avatars/`，loading 提示读取 `assets/tips.txt`。
- 浏览器离线渲染：FFmpeg.wasm 导出 H.264、HEVC、ProRes 或 FFV1；WebCodecs 可请求硬件编码。支持 MP4、MKV、MOV、WebM、Loading / Result、结算 BGM 和自定义收藏品。导出使用自动演奏、原始 1× 音轨，音轨不包含打击音。参数、静态部署多线程和限制见 [视频导出](docs/video-export.md)。

快捷键：空格播放/暂停，左右方向键跳转 2 秒，B 切换控制栏，L 定位选谱，V 打开视频导出。手动键位为 A/S/D/F 和 J/K/N/M；按键采用全屏判定，指针按判定线位置判定。Hold 需持续按住，Flick 通过滑动或按键触发。

跳转和切换模式会重置本次判定；跳过的音符按 Miss 处理。此处手动判定用于模拟器练习，不保证与游戏本体逐帧一致。

原有资源工具仍可使用：`py import_library.py` 生成 `assets/library/index.json`，`extract_backgrounds.py` 和 `build_hud_font.py` 处理背景与 HUD。未生成谱面库时也可运行内置演示和导入谱面。

代码结构：

```text
src/main.ts             应用界面、谱面库与设置交互
src/types.ts            谱面、设置、判定与统计类型
src/library/importer.ts PEZ / ZIP / 松散文件导入、资源匹配与校验
src/library/adapters/   PEC / RPE 格式适配、变 BPM 与事件换算
src/library/metadata.ts info.yml / info.txt / info.json 元数据解析
src/core/chart-state.ts 适配谱面的分层事件、父子线与文字状态
src/core/runtime.ts     Canvas / WebGL 特效、场景流程及导出管线
src/core/timeline.ts    时间轴、判定线事件与坐标计算
src/core/judge.ts       手动判定、Hold 跟踪、计分与反馈事件
src/core/hit-effects.ts 共用打击序列帧、粒子与确定性动画
src/core/input.ts       Pointer Events、键盘与失焦暂停
src/core/blocks.ts      方块几何、接触检测与触摸反馈
src/core/block-audio.ts 音乐接触低通与恢复
src/core/unity-ui.ts    原始 Unity UI 场景与曲线
assets/shaders/         GLSL 着色器
assets/                 按用途整理的资源（构建时复制到 dist）
tests/                  判定、导入及场景动画的回归测试
```

`pnpm typecheck` 检查应用与测试的类型，`pnpm test` 运行 `tests/` 下的回归测试。研究参考模型、资源恢复及浏览器复现入口集中在工作区的 `research/reproduction/`，不放在 `src/` 中。GitHub Pages 工作流使用 pnpm 安装、测试并发布 `dist/`。

资源目录说明见 [assets/README.md](assets/README.md)。背景继续统一放在 `assets/backgrounds/`；音乐和谱面仍位于 `assets/library/`。

## License
本仓库中由我编写的代码采用 Unlicense 发布，进入公共领域。
第三方资源（如 Phigros 相关素材、音乐、谱面等）版权归各自所有者，不适用本许可。
FFmpeg 依赖保留 MIT / GPL-2.0-or-later 等上游许可，声明见 [third-party/ffmpeg](third-party/ffmpeg/README.md)。
