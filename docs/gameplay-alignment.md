# Gameplay 对齐范围

本轮以Phigros4.0.1.2 ARM64原生代码、实际资源绑定和APK编译后GLSL为依据。

- 新增FC/AP指示器开关：AP浅黄、FC蓝、断连白；关闭时白色。判定线为有限57.6世界单位，完整长度5.76倍视口高度。
- 全局先画判定线，再画音符；Hold深度更远，位于普通头部之下。成功反馈、HUD、Disabled背景层与ActiveBlock相机合成分开处理。
- 补上越线淡出、Tap Bad红色残影、Miss Hold灰色体/尾。普通模式窗口修正为Perfect .08、Good .18、提前Bad .22秒，Drag/Flick用各自Miss截止和提前锁定。
- Hold反馈按帧达到半拍阈值后发一次并清零；判分在尾前.22秒，反馈到真尾，短暂离手有帧容错。动画寿命与音乐倍速分开。
- Block使用本APK的遮罩通道、描边和触摸着色计算；去掉旧自由红圆盘和额外GlowMask，修正Ready阶段及贴图采样。

普通音符在相同层/顺序/深度下的Unity最终平局排序仍使用稳定回退；Autoplay/导出采用可重放的60Hz参考时间表，粒子种子也继续由命中事件确定。未宣称全部曲目、协程相位或最终像素与原机等价。详见工作区 `research/notes/gameplay-audit.md`。
