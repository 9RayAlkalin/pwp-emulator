# PWP Simulator

基于 **pnpm + TypeScript + Vite + Canvas 2D / WebGL** 的 Phigros 网页模拟器。参考 sim-phi 的选谱与游玩流程，保留原播放器的方块、异象、后期处理与离线视频导出。

需要 Node.js 22 或更高版本以及 pnpm 10。

```sh
pnpm install
pnpm dev
```

访问终端打印的地址（默认 `http://localhost:5173`）。`pnpm build` 会检查 TypeScript 并生成可独立部署的 `dist/`，`pnpm preview` 预览构建产物。支持部署到子路径。旧 `server.py` 仅适用于静态文件，不再用于开发 TypeScript 页面。

功能：

- 无 CSS 的单页界面，使用原生选谱下拉框、Autoplay 复选框、搜索和折叠设置；始终提供内置 True Home, True World 演示。
- 通过文件选择或拖放导入 ZIP，或同时选择 JSON 谱面、音频与可选曲绘。支持 Phigros v1/v3 JSON；暂不支持 PEC、RPE。
- 支持 `info.csv` 的 Chart、Music、Image、Name、Level、Composer、Charter 字段，或同目录的 `info.json`。一首音乐可供多张谱面共享，多首音乐时需要明确填写对应关系。
- Autoplay 与手动 Tap / Drag / Hold / Flick 判定，多点触控、鼠标、键盘输入，分数、连击、准确率与结算。
- 0.5–2 倍速、时间轴跳转、重开、偏移、音量、音符大小、背景亮度、全屏与特效开关。设置保存在浏览器；导入谱面只保留在当前页面会话。
- Canvas 2D 绘制谱面与 HUD，WebGL/WebGL2 执行后期特效；无法使用 WebGL 时降级绘制。
- WebCodecs 离线导出 WebM（VP9/VP8，音乐音轨使用 Opus，需浏览器支持）。导出使用自动演奏、原始 1× 音轨，音轨不包含打击音。

快捷键：空格播放/暂停，左右方向键跳转 2 秒，B 切换控制栏，L 定位选谱，V 打开视频导出。手动键位为 A/S/D/F 和 J/K/N/M；按键采用全屏判定，指针按判定线位置判定。Hold 需持续按住，Flick 通过滑动或按键触发。

跳转和切换模式会重置本次判定；跳过的音符按 Miss 处理。此处手动判定用于模拟器练习，不保证与游戏本体逐帧一致。

原有资源工具仍可使用：`py import_library.py` 生成 `res/library/index.json`，`extract_backgrounds.py` 和 `build_hud_font.py` 处理背景与 HUD。未生成谱面库时也可运行内置演示和导入谱面。

代码结构：

```text
src/main.ts             应用界面、谱面库与设置交互
src/types.ts            谱面、设置、判定与统计类型
src/library/importer.ts ZIP / JSON / CSV 解析、资源匹配与校验
src/engine/runtime.ts   兼容原有 Canvas / WebGL 特效及导出管线
src/engine/timeline.ts  时间轴、判定线事件与坐标计算
src/engine/judge.ts     手动判定、Hold 跟踪、计分与打击反馈
src/engine/input.ts     Pointer Events、键盘与失焦暂停
src/engine/canvas.ts    Canvas 绘制辅助方法
shader/                 GLSL 着色器
res/                    谱面与资源（构建时复制到 dist）
```

`pnpm typecheck` 检查类型，`pnpm test` 运行时间轴、判定及导入测试。GitHub Pages 工作流使用 pnpm 安装、测试并发布 `dist/`。

## License
本仓库中由我编写的代码采用 Unlicense 发布，进入公共领域。
第三方资源（如 Phigros 相关素材、音乐、谱面等）版权归各自所有者，不适用本许可。
