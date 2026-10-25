# Gameplay HUD

资源来自 `4.0.1/ExportedProject/Assets/`：

- `PhiHUD.ttf`：`Font/Source Han Sans & Saira Hybrid-Regular_3.ttf`，未修改。
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
点击左上角暂停图标切换播放/暂停；HUD 绘于后期特效之后，也会包含在视频导出帧中。

超宽屏 Cover 按 `Level.unity` 的 `RawBackground` 实现：左右各有一个 1000×1000 的遮罩，
内边界固定为画面中心 ±888.8889 UI 单位。16:9 及更窄窗口中它们位于屏幕外；
超宽窗口中覆盖越出中央 16:9 的游玩内容及进度条，其他 HUD 绘制在 Cover 上方。
它们使用静态模糊曲绘，黑色 Image 的原版 `UI/TranslucentImage` shader 可简化为
`RGB = 0.5 × clamp(blurredBackground + 0.02, 0, 1)`，不采样当前帧的 note 或后期特效。
2026-10-25 背景链路已改为 APK 原始 `IllustrationBlur` → 屏幕居中等比裁切 →
`LeTai.Asset.TranslucentImage.ScalableBlur`，替换原来的 Canvas 高斯模糊。
`shader/backgroundblur.frag` 复现四对角点各1/4采样，半径为
`7.1875 × clamp(min(width,height)/1080, .5, 2)`，依次输出到
`/2,/4,/8,/16,/8,/4,/2,全尺寸`，共8趟。
主背景也使用上述 TranslucentImage 颜色公式，并额外叠加正常游玩的黑色背景遮罩：
默认亮度.75、开场动画末尾CanvasGroup.alpha=.7，因此遮罩alpha=.175；侧边Cover不叠此遮罩。
结果按背景图片、WebGL实例和输出尺寸缓存，正常帧不做模糊或GPU回读；换分辨率时重建。
`res/background/` 内10张图覆盖28个导入谱，共约630KiB；Happy ending四个难度各取对应图。
重建：`py extract_backgrounds.py <APK路径>`，需要UnityPy及现有谱面库清单。
内置旧s6缺少此版本的对应资源，使用高清曲绘加同一屏幕模糊作为兜底。
2800×1840的Petrichor原版截图背景1986点对照：平均通道误差1.67/255，95%≤3/255，最大5/255。
当前依据单张JPG对照，仍有压缩、采样及亮度差，不能声明逐像素一致。

2026-10-24 复核底部文字：SongNameCanvas 与子 Text 都是底边 pivot=(0,0)，
子 Text 的 anchoredPosition=(0,0)，没有额外坐标偏移；SongsLevel 是 Canvas 的直接子节点，
pivot=(1,0)。保留现有运行时坐标。

2026-10-25 字体改为固定字号灰度字形图集：`glyphs.png` + `glyphs.json`，
覆盖HUD使用的24/36/50/70四个字号、ASCII和当前谱面库曲名。
通过 `py build_hud_font.py` 重建，需要Pillow（本轮FreeType 2.14.3）；生成物直接随网站部署，
浏览器无需Python或FreeType。重建时有本地谱面库则追加其曲名字符。
图集按原字体生成整像素advance与字形bearing，逐字绘制并随HUD等比缩放，
避免浏览器 `fillText` 在最终屏幕像素下重新hint导致的字高、笔画和字距差异。
基线使用原字体ascent=.88em，即Middle框中心下方(.88-.5)×字号。
字形外圈留透明采样边，使用双线性过滤。图集共约143KiB，启动加载一次。

2800×1840对照中，分数可见范围从旧版(2318,73)～(2726,134)修正为
原版截图的(2312,71)～(2723,135)；Petrichor可见字宽从265修正为268px，与原版一致。
部分字形边缘仍有约1px差异；当前FreeType版本、JPEG压缩和采样差异未完全消除，
不能声明与Unity逐像素等价。长文本沿用按宽度缩小策略，并未完整复刻Unity BestFit。
遇到图集未覆盖字符或图集加载失败时，整行回退原字体 `fillText`，避免缺字。
谱面库仍使用原来的文字渲染；视频导出使用与Gameplay相同的图集绘制路径。
