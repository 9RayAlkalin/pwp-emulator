# Gameplay HUD

资源来自 `4.0.1/ExportedProject/Assets/`：

- `../fonts/PhiHUD.ttf`：`Font/Source Han Sans & Saira Hybrid-Regular_3.ttf`，未修改。
- `pause.png`、`progress.png`：从 `Texture2D/打歌界面与暂停 素材.png` 按 Sprite 资源的矩形裁切。
  Unity 原点在左下，裁图时转换为 PNG 左上原点；分数、Combo、曲名和难度为字体绘制。

暂停图标于2026-10-25改为从 APK 原始 Sprite.rect 裁切，尺寸为37×41。
AssetRipper 导出的 Pause.asset 将 rect 改为约34.924×40.924（接近textureRect），
旧版据此裁成35×41并铺满按钮，导致双竖条间距偏大、右条偏右。
重建脚本为工作区 `_analysis/extract_gameplay_pause.py`；保留原版双线性采样。

布局依据 `Phigros2/Level/Level.unity` 与运行时 `LevelUICont.Update`（`0x1D81B18`）。
HUD 是 World Space Canvas，局部比例 0.01，相机正交半高 5，可见高度对应 1000 个 UI 单位，
屏幕缩放比例为 `height / 1000`；CanvasScaler 配置的 1920×1080 / match=0.6 不用于这个 Canvas 的屏幕适配。

四角位置按运行时代码求值，并计入 RectTransform 的 pivot 和文字框尺寸。
宽高比小于 16:9 时，暂停图标左上角距边约 `(33.458, 36.717)`，
分数右对齐点距右边 37.39、中心距顶 54.3，底部文字左右距边 40、中心距底 49.8（均为 UI 单位）。
宽高比达到 16:9 时，运行时代码将水平半宽钳至约 888.889；这里保留该规则。

进度条复现 `ProgressControl.Update`（`0x1D8600C` 起）的平移逻辑：
顶边位于窗口 y=0，精灵大小为 1919×11 UI 单位，右端位置从水平范围的左端移向右端，超出窗口的部分被裁切。
文字和图标共用一个缩放比例。尚未复刻开场动画、特殊曲目 UI 门控。

分数和 Combo 跟随现有自动演奏：Tap / Drag / Flick 在命中后结算，Hold 在尾端前0.22秒结算
（短 Hold 最早在头部命中时结算），每个 note 计一次 Perfect 和 Combo。
普通模式计分公式来自 `ScoreControl.Update`（`0x1D87A1C`）：
`(Perfect + 0.65 × Good) / 总note数 × 900000 + 最大Combo / 总note数 × 100000`。
当前自动演奏全部为 Perfect；全曲结算完成时为 `1000000`，Combo ≥ 3 才显示数字和标签。
计分按谱面时间重算，支持向前/向后拖进度、重播和切谱，也适用于视频导出中途起始的片段。
尚未实现手动输入判定、挑战模式计分和特殊曲目分数冻结/Combo 文本覆盖。

Gameplay 右下角难度只显示整数部分（例如 `IN Lv.16.5` 显示为 `IN Lv.16`），
不四舍五入；`SP Lv.?` 等非数值标记保留，谱面库与原始定数不变。

进度条按原版 `nowTime / audioLength` 计算（音乐秒减谱面 offset），
点击左上角暂停图标切换播放/暂停；HUD 绘入前景场景后参与方块及后期效果，也会包含在视频导出帧中。

超宽屏 Cover 按 `Level.unity` 的 `RawBackground` 实现：左右各有一个 1000×1000 的遮罩，
内边界固定为画面中心 ±888.8889 UI 单位。16:9 及更窄窗口中它们位于屏幕外；
超宽窗口中覆盖越出中央 16:9 的游玩内容及进度条，其他 HUD 绘制在 Cover 上方。
它们使用静态模糊曲绘，黑色 Image 的原版 `UI/TranslucentImage` shader 可简化为
`RGB = 0.5 × clamp(blurredBackground + 0.02, 0, 1)`，不采样当前帧的 note 或后期特效。
2026-10-25 背景链路已改为 APK 原始 `IllustrationBlur` → 屏幕居中等比裁切 →
`LeTai.Asset.TranslucentImage.ScalableBlur`，替换原来的 Canvas 高斯模糊。
`assets/shaders/backgroundblur.frag` 复现四对角点各1/4采样，半径为
`7.1875 × clamp(min(width,height)/1080, .5, 2)`，依次输出到
`/2,/4,/8,/16,/8,/4,/2,全尺寸`，共8趟。
主背景也使用上述 TranslucentImage 颜色公式，并额外叠加正常游玩的黑色背景遮罩：
默认亮度.75、开场动画末尾CanvasGroup.alpha=.7，因此遮罩alpha=.175；侧边Cover不叠此遮罩。
结果按背景图片、WebGL实例和输出尺寸缓存，正常帧不做模糊或GPU回读；换分辨率时重建。
`assets/backgrounds/` 内10张图覆盖28个导入谱，共约630KiB；Happy ending四个难度各取对应图。
重建：`py extract_backgrounds.py <APK路径>`，需要UnityPy及现有谱面库清单。
内置旧s6缺少此版本的对应资源，使用高清曲绘加同一屏幕模糊作为兜底。
2800×1840的Petrichor原版截图背景1986点对照：平均通道误差1.67/255，95%≤3/255，最大5/255。
当前依据单张JPG对照，仍有压缩、采样及亮度差，不能声明逐像素一致。

2026-10-24 复核底部文字：SongNameCanvas 与子 Text 都是底边 pivot=(0,0)，
子 Text 的 anchoredPosition=(0,0)，没有额外坐标偏移；SongsLevel 是 Canvas 的直接子节点，
pivot=(1,0)。保留现有运行时坐标。

2026-11-07 字体清晰度修复：HUD 使用现有 `PhiHUD.ttf`，先按目标物理像素的 4 倍栅格化文字，再高质量缩回目标尺寸并缓存；避免小字号 hinting 使笔画显粗。24/36/50/70 字号沿用 `glyphs.json` 中的原有 advance、宽度缩放和 ascent=.88em 基线；字符位置和基线对齐到最终像素网格。外部谱面含未记录字符时仍使用整行浏览器字体绘制，以保留复杂文字的连接和塑形。

此前的灰度字形图集按固定字号生成后再随 World Space Canvas 缩放，会引入插值软边；高 DPI 屏幕又会把 CSS 像素大小的画布放大。现在将 CSS 显示尺寸与物理像素画布分开：例如 2× 屏幕下，960×540 的显示区域对应 1920×1080 的画布。窗口缩放、浏览器缩放及跨屏切换会更新像素密度；触摸坐标仍通过显示矩形映射到画布。

视频导出直接使用用户指定的像素尺寸绘制文字，结束后恢复窗口的像素密度。字体继续随前景参与方块材质及后期效果；Bloom、Glitch 等刻意产生的视觉变化也会作用于文字。

`glyphs.png` 保留为旧版参考图集，当前启动不再加载它。`py build_hud_font.py` 仍可用 Pillow 重建 `glyphs.json` 的字距指标和参考图集；无需为本次显示修复重新生成资源。字形以 4 倍目标尺寸生成后缩回，缓存上限为 256 项；未知脚本仍整行塑形。此流程减少小字号 hinting 对笔画粗细的改变，保留原字距和高 DPI 清晰度。

验证覆盖 1×/1.25×/2× 像素密度、动态密度变化、外部新字符、短视频导出与尺寸恢复，以及 2× 下的 block 触摸和滤波行为。24 个测试、类型检查及生产构建通过。前后截图与验证记录见工作区 `research/generated/hud-sharpness/`，说明见 `research/notes/hud-sharpness.md`。

2026-11-07 字重回归修正：浏览器直接在目标字号绘字曾增加笔画覆盖量，已改为上述 4× 栅格化缓存。同一分数截图在 DPR=2 下，原始版本覆盖量约739.44、直接绘字约817.66、当前约739.15（归一到 CSS 像素面积，特定样例）。对应截图见工作区 `research/generated/hud-weight/comparison.png`。
