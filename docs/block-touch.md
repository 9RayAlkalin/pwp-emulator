# Block 接触

手动游玩时，触摸到生效方块会锁定该手指直到松开；移出方块也不会恢复判定。其他手指不受影响。音乐在任一锁定手指存在时启用 1500 Hz 低通，最后一个手指松开后在 0.1 秒内恢复。触摸有独立的噪声/光晕反馈，进入与退出动画为 0.1 秒。

检测与绘制共用旋转、位移和缩放几何。正常方块每边内缩屏幕高度的 5%，减算方块外扩同样距离；原始和留边后的覆盖都成立才锁定。正常块按 OR 合并，减算块按奇偶 XOR 翻转。只在 `[enableTime, disableTime)` 产生新锁定，已有锁定持续到接触结束。键盘维持全屏判定语义；Autoplay、离线导出没有手动触摸。

实现依据为本地 Phigros 4.0.1.2 ARM64 原生代码：`JudgeControl.ProcessBlockedTouches` RVA `0x1d75a84`、`TryGetBlockingBlock` `0x1d75cc4`、`TryGetBlockTouchHalfSize` `0x1d763f4`、低通协程 `0x1d89418`、初始化 `0x1d7b76c`。image base 为 `0x0`，原生库 SHA-256 为 `0bd07ca1eb89e21ebd1f2a5758fe09c42e526fabcac5ca6a91ee67ccccedb0ae`。

显示使用原导出的 Round10_Blur4 / FD_Noise_00000 纹理。本轮从APK直接恢复了编译后的TouchEffect和ActiveBlock GLSL，替换简单红晕，核对噪声、SDF、叠色、原始覆盖闸门及Point/Mirror采样；Hover直径为屏幕高度的.506倍。方块内的触摸发亮作用于既有fill/edge，另外的自由噪声受Hover RT范围限制。

同时修正Ready仅在生效前最后.5秒、出现淡入.5游戏秒，以及减算块独立计数/渐变通道和加法遮罩。4.0.1.2只有EdgeMask描边，旧的额外GlowMask链已移除。Web Audio滤波与最终GPU画面未做原机采样/像素级等价验证；无WebGL降级保留Hover精灵范围，噪声着色简化。完整证据见工作区 `research/notes/gameplay-audit.md`。

验证覆盖几何、手指锁定、持续 Hold、多指、音频反向过渡和反馈生命周期；浏览器验证覆盖 WebGL2、WebGL1 和 Canvas 降级。运行 `pnpm test`、`pnpm typecheck`、`pnpm build` 可执行仓库检查。
