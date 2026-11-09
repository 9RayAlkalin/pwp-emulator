# 从 Phi-TK / Phire 迁移的优化

本次迁移适配 TypeScript + Canvas 2D 管线，实时播放和离线导出继续共用播放器。
结论来自算法检查与回归测试，未测量浏览器 FPS 或承诺固定加速比例。

## 已实现

| 思路 | PWP 实现 | 边界与收益 |
|---|---|---|
| 解析式速度积分 | [integral.ts](../src/chart/animation/integral.ts)、[compiler.ts](../src/chart/formats/compiler.ts)、[timeline.ts](../src/chart/animation/timeline.ts) | RPE 编号 1–21 的线性、正弦、幂、指数、圆形、Back 曲线使用反导数；支持 easing 裁剪、BPM 分段进度、多层相加和负时间原点。支持的曲线每个事件区间只保留一段，不再展开为 240Hz 速度片段。Bezier、Bounce、Elastic 等暂保留原有有界采样。 |
| 有界游标查找 | [timeline.ts](../src/chart/animation/timeline.ts) | 每条事件数组通过 WeakMap 保留游标，先移动最多 8 步，再二分；保持结束边界、间隙、末段和反向跳转语义。事件数组在编译/排序后视为不可变。 |
| 常量控制曲线快速路径 | [state.ts](../src/chart/animation/state.ts) | 恒定控制曲线缓存结果，含显式 identity；变化曲线由线性扫描改为二分，保留重复距离点的原始优先级。控制点导入后视为不可变。 |
| 每帧准备判定线数据 | [runtime.ts](../src/player/runtime.ts) | 每帧对所有判定线准备状态和滚动距离一次，包含 attachUI 线；逐音符共享结果。缓存记录复用，换谱时清空，不与历史打击特效时间查询混用。 |
| Hold 固定端点预计算 | [runtime.ts](../src/player/runtime.ts) | 装载时计算尾端 floor，绘制和 cover 判定复用，避免每个 Hold 每帧多次查询相同积分。 |
| 持久文本布局 | [text.ts](../src/render/text.ts) | 缓存字体和文字对应的分行、测量宽度，最多 256 项，换谱清空；仍由 Canvas 按最终变换绘字，保留现有旋转/缩放质量。 |
| 有界并发图片解码 | [textures.ts](../src/render/textures.ts) | 最多 4 个解码任务；同 Blob 的别名仍只解码一次、释放一次。失败时等待全部在途任务结束，释放成功解码的图像，避免迟到任务泄漏。 |
| Worker 池几何准备 | [prepare.ts](../src/chart/geometry/prepare.ts)、[geometry.ts](../src/render/geometry.ts)、[geometryworker.ts](../src/render/geometryworker.ts) | 1–4 个 module Worker 按连续音符索引分片，并行计算音符控制几何；谱面 DTO 每 Worker 装载一次，输出 Float64Array 通过 transfer 传递并往返复用。实时 ≥512 音符启用，较小谱面同步；导出等待精确时间帧。 |

## Worker 调度与同步

- Worker 数量为 `max(1, min(4, hardwareConcurrency - 1, ceil(noteCount / 512)))`，为主线程保留余量；无有效核心数时使用 1 个。阈值是初始策略，尚未通过设备 profile 调优。
- 整个池同时最多一帧在途，每个 Worker 处理一段连续音符；不同时间的并发调用等待前帧完成，再请求自己的时间戳，避免任务堆积或误用上一帧。
- 各分片可以乱序完成，合并时按原始音符索引写入复用的输出数组；全部分片完成后才发布，重复回复不重复计数。
- 每个 Worker 保留完整判定线数据，以保持父子线求值一致；当前每个分片会重复计算判定线状态和积分。这是避免父级跨分片依赖的取舍，多线少音符谱面不一定受益。
- 分片独立循环复用转移缓冲，主线程复用合并数组；合并有一次线性复制，尚未使用 SharedArrayBuffer。主线程仍负责判定、Canvas、纹理、HUD、粒子和后期效果。
- 实时帧捕获音乐时间，等待几何准备后按同一时间提交，下一次 rAF 在本次完成后安排，不重叠绘制。
- 换谱使用 generation/request ID 拒绝旧回复；等待期间发生 seek、播放状态/速度、尺寸、宽高比、偏移或场景变化时跳过捕获帧。
- 离线编码器先等待异步绘帧完成，再读取 Canvas；等待后再次检查取消信号。
- 不支持 Worker、池创建失败、任一 Worker 错误、结果尺寸不符或超过 2 秒未完成时，终止整个池、丢弃部分结果，使用同一个纯几何函数同步回退。
- 当前是多 Worker 准备 / 主线程顺序提交，未把 Canvas 移到 OffscreenCanvas；逐帧等待存在消息往返成本，未承诺一定提升 FPS。

## 已有机制与未直接套用的部分

- GIF 已使用累计结束时间和二分选帧；判定线已有父子状态缓存，HUD 已有字形缓存，打击特效已有时间窗查询。
- Canvas 2D 不提供合并任意 `drawImage`/`fillText` 为一次 instanced draw 的 API。Rust 顶点桶和静态 quad 索引适用于真正的 WebGL 音符渲染器，不能仅改数据结构就获得同样收益。
- 空间去重会少画叠音符/粒子，需要独立画质选项和视觉验证；本次没有改变画面数量、绘制顺序或粒子随机序列。
- 活动音符游标必须同时处理负流速、Hold、fake、手动判定、自动播放音效和任意 seek，不能把原生引擎的 NoteGroup 结构直接替换进当前播放器。
- Worker 池已支持音符分块；文本准备和 OffscreenCanvas 绘制需要继续拆分资源所有权并测量通信成本。
- FFmpeg.wasm 项目已依赖 `core-mt`。多线程不是 WASM 无法实现的能力，是否使用取决于导出加载器和跨源隔离条件；本次未改编码设置。

## 验证

```sh
pnpm typecheck
pnpm exec vitest run --maxWorkers=2
pnpm build
```

新增/扩展测试覆盖解析积分与独立数值积分的一致性、BPM 分段与负时间、
游标跨边界与反向跳转、控制点重复边界、纹理解码并发上限和失败释放、文本布局缓存。
Worker 测试还覆盖池大小限制、多分片乱序合并、重复回复、缓冲复用、部分失败、超时回退和并发时间戳串行化。
浏览器画面对比、目标设备性能采样和实际视频导出仍需单独验证。
