# 代码结构

目录表达领域，文件表达职责。文件名优先一个单词，例如 `phi.ts`（官谱缓动编号适配）；确需组合时用清晰的缩写，例如 `ffloader.ts`（FFmpeg 运行时加载）。不追加无意义的 `renderer`、`manager` 等后缀；测试与源码同名，保留 `.test.ts`。

## 领域边界

- `app/settings.ts`：设置类型、默认值、校验和持久化。
- `chart/types.ts`：谱面及事件类型。`import/` 负责文件、元数据与资源；`formats/` 负责输入格式转换；`animation/` 负责缓动、事件及父子线；`geometry/` 负责坐标与投影。
- `gameplay/`：判定、统计、方块接触、显示状态与反馈事件。它与 `chart/` 都不依赖播放器、UI、音频或渲染实现。
- `audio/filter.ts`：接触方块时的音乐滤波。
- `player/`：输入、播放时钟、场景流程和资源生命周期协调。`runtime.ts` 仍是现有运行入口，本次保留底层绘制实现。
- `render/`：Canvas 扩展、字体、纹理、染色缓存、粒子、打击反馈及共享画帧管线。`video/` 将同一画面送入编码器，并管理离线音轨及容器。
- `ui/`：HUD、玩家资料、Loading/Pause/Result 场景和结算动画。场景实现名为 `scenes/scene.ts`，导出 `Scene`。

类型放在所属领域，不恢复全局 `types.ts`；也不保留旧路径转发文件或集中重导出入口。`src/` 根只保留 `main.ts`。回归测试对应上述目录放在 `tests/`，研究脚本留在工作区 `research/reproduction/`。

## 实时与视频共用绘制

`player/runtime.ts` 负责时钟与判定更新，然后调用 `render/frame.ts`：背景/前景 → HUD → 方块 → 合成。实时播放与离线导出都经过这一入口，HUD、cover 和谱面效果没有独立的导出实现。

`render/video/` 内部按职责分为时间轴、音轨、任务、参数、取消控制、`encoders/` 和 `containers/`。动态加载编码器以保留按需加载；`isoworker.js` 是源文件名，对外 Service Worker URL 仍为 `isolation-service-worker.js`，避免改变部署接口。

## 统一缓动

`chart/animation/easing.ts` 的 `rpeEase` 是共用曲线实现。`chart/formats/phi.ts` 按本地 phira-docs 的 `phi/blockArea.md` 与 `rpe/extend.md` 对应曲线，而不是直接套用编号或原生枚举名称。

官谱类型 0–11 对应 RPE 编号 `[1, 5, 4, 7, 9, 8, 12, 11, 10, 13, 15, 14]`；官谱 12（InOutQuint）由 RPE 的 InQuint/OutQuint 半段组合，13/14 保留常量 Zero/One。BlockArea 和后期特效仍使用原有的 101 点 Float32 表与插值，不把原生采样行为静默替换成解析求值。

`tests/architecture.test.ts` 检查命名、本地静态/懒加载导入、Worker 构建路径、领域边界和运行时导入环。`tests/chart/formats/phi.test.ts` 用独立的旧曲线模型逐点验证映射和采样结果。
