# 视频渲染和导出

渲染、时间轴和编码相互独立。Loading、Gameplay、结束动画和 Result 使用现有 Canvas / WebGL 绘制函数；编码器接收固定帧率的同一组画面，保留结算 BGM、Sync、玩家档案和收藏品设置。

## 编码选项

| 路径 | 视频编码 | 容器 | 说明 |
| --- | --- | --- | --- |
| FFmpeg.wasm | H.264 | MP4、MKV | CPU；单线程可用，可选多线程 |
| FFmpeg.wasm | HEVC / H.265 | MP4、MKV | CPU；需要多线程环境；MP4 写入 `hvc1` |
| FFmpeg.wasm | ProRes 422 | MOV | Proxy、LT、Standard、HQ；10-bit 4:2:2 |
| FFmpeg.wasm | FFV1 | MKV | RGB 无损，可搭配 FLAC 或 PCM |
| WebCodecs | H.264、HEVC | MP4 | 浏览器编码；FFmpeg 只复制视频流并封装 |
| WebCodecs | VP9、VP8 | WebM | 浏览器编码，音轨为 Opus |

FFmpeg 可调 CRF 或目标码率、速度预设、8/10-bit、4:2:0/4:4:4、最大关键帧间隔及音频码率。音频支持 AAC、FLAC、PCM，界面按容器限制组合。Canvas 源是 8-bit，选择 10-bit 不会增加原始画面的细节。

当前锁定核心虽然列出了 VP9 和 Opus，但实测非静音/渐变样本会发生 Wasm 内存错误，故 FFmpeg 路径禁用这两项；可使用浏览器的 VP9 / Opus。当前核心未包含 AV1 编码器。

## 硬件与多线程

FFmpeg.wasm 的编码运行在 CPU 上，不能调用 NVENC、QSV 或 AMF。多线程也仍是 CPU 编码。

WebCodecs 提供“自动 / 优先硬件 / 优先软件”和编码支持检测。检测使用当前尺寸、帧率和硬件偏好；最终是否使用硬件由浏览器和驱动决定，`isConfigSupported` 不能证明实际运行在 GPU。没有支持的组合时会报错，不会把软件结果标成硬件编码。

HEVC 使用 `@ffmpeg/core-mt`，因为 `@ffmpeg/core` 单线程 x265 的实际编码会挂起。点击“启用多线程并刷新”可注册同目录 Service Worker，为当前应用范围的响应添加 COOP / COEP，在 HTTPS 静态站点或 localhost 上启用跨源隔离；不依赖本地 FFmpeg，也不要求托管服务自定义响应头。Worker 不缓存或转发到其他服务器。切换模式会刷新，临时导入的谱面需重新导入；同一按钮可关闭模式。

自动线程模式仅在 HEVC 上启用多线程；其余编码器默认单线程，可手动选择适用的多线程选项。编码线程可设为 1–8。

## 内存与取消

FFmpeg 每批处理最多约 32 MiB 原始 RGBA（至少一帧），编码后删除原始输入，再继续绘制。批次边界会产生额外关键帧，因此设置的是最大关键帧间隔。压缩片段、最终文件和完整离线音轨仍保存在浏览器内存中；这不代表无限时长导出，ProRes、FFV1 和高分辨率尤其需要更多内存。软件 Wasm 编码也不保证比 WebCodecs 快。

取消会终止编码 Worker，释放任务资源并恢复原场景、位置、Canvas 与音符状态。原始帧内容不会因编码器选择改变；有损格式的解码像素仍受编码和色度采样影响。

## 模块

`src/core/export/` 中：`render-job.ts` 控制固定帧循环；`audio.ts` 负责离线音轨和 PCM；`options.ts` 校验参数并生成编码命令；`ffmpeg.ts` 批次编码；`ffmpeg-runtime.ts` 管理 Wasm 生命周期；`webcodecs.ts` 管理浏览器编码；`elementary-muxer.ts` 封装浏览器生成的 H.264 / HEVC；`webm-muxer.ts` 保留 WebM 写入器；`isolation.ts` 和 Service Worker 管理多线程环境。

Wasm 核心随构建复制到 `dist/assets/ffmpeg/` 与 `dist/assets/ffmpeg-mt/`，按需加载，保留相对子路径。三项 FFmpeg 依赖固定版本，第三方许可证和源码指向见 `third-party/ffmpeg/`，构建时一并复制。
