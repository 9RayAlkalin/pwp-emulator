# 谱面导入与适配

谱面可与音乐、可选曲绘一起选择或拖入，也可打包为 PEZ / ZIP。格式依据内容或元数据的 `format` 字段判断，不依赖谱面扩展名。支持 Phigros v1/v3、PEC、RPE；PBC 尚不支持。

## 元数据与资源

同一字段按 `info.yml / info.yaml` → `info.txt` → `info.csv` → `info.json` → RPE `META` 的顺序取首个非空值。未填写的字段继续向后查找。文件路径可相对于元数据文件或谱面文件，支持子目录、反斜杠及大小写差异。一次导入多个压缩包时，每个包独立匹配资源。

`info.txt` 示例：

```text
#
Name: 自制曲
Song: music.ogg
Picture: cover.png
Chart: chart.pec
Level: IN Lv.14
Composer: 曲师
Charter: 谱师
Illustrator: 画师
```

用独立的 `#` 行分隔多条记录；每条记录的 `Chart` 指定对应谱面。`Music` / `Image` 是 `Song` / `Picture` 的别名，兼容 CSV 的同名字段。曲名可包含冒号，路径可用引号包裹。

`info.yml` 示例：

```yaml
name: 自制曲
chart: chart.json
format: Rpe
music: music.ogg
illustration: cover.png
level: IN Lv.14
offset: 0.0
```

YAML 读取 ChartInfo 的顶层标量字段，支持单引号、双引号、注释、简单多行标量；不解析锚点、别名或自定义标签。`offset` 以秒为单位，附加到谱面自身偏移。此偏移为正时，谱面相对音乐更晚开始。

显式资源路径不存在会报错。没有指定音乐时，只在同目录或当前包内只有一首音乐的情况下自动匹配，避免多音乐时误选。没有指定曲绘且无法唯一匹配时，可使用默认曲绘。

## 适配范围

PEC 支持 `bp`、`n1`–`n4`、`#`、`&`、`cv/cp/cd/ca/cm/cr/cf`。偏移遵循本地 phira-docs 的 `(首行毫秒值 - 175) / 1000` 约定。坐标按 2048×1400 换算，流速转换为当前模拟器单位时除以 7。

RPE 支持三元分数拍、BPMList、`bpmfactor`、四类音符、正反面、假音符、宽度、透明度、可见时间、Y 偏移、判定宽度、多层事件相加、XY 分离、嵌套父线、`rotateWithFather`、遮罩、判定线 zOrder、颜色/文字/缩放。坐标按 1350×900 换算，流速除以 4.5。`size` 只改变音符宽度。父线旋转作用于子线位置；子线角度仅在明确设置 `rotateWithFather: true` 时继承。

内部适配时间统一为秒；以 `bpm = 60/32` 接入现有的 32 分拍时间轴。事件按 BPM 边界拆分且保留原曲线进度，跳转不会依赖之前播放状态。支持 1–29 号缓动、缓动裁剪和普通事件贝塞尔曲线。线性速度变化精确积分；非线性速度以 240 Hz 梯形近似积分（单段上限 65536 份）。PEC/RPE Hold 的头尾位置随积分流速变化。Hold 反馈间隔使用起始时 BPM。

RPE `META.offset` 表示音乐相对谱面的偏移，与当前模拟器的谱面偏移方向相反，因此转换为 `-META.offset / 1000`。例如 `META.offset = 250` 时，音乐第 0 秒对应谱面第 0.25 秒；PEC 首行 `275` 则对应谱面延后 0.1 秒。

假音符保留视觉，排除手动判定、自动计分、同时押高亮、打击音和打击特效。透明度为负的线会隐藏其音符；RPE `isCover: 0` 可显示线背面音符。

以下内容会显示兼容提示：自定义线纹理/GIF、打击音、音符/特效染色、距离控制器、UI 绑定、倾斜、画笔、自定义字体以及 RPE 162–169 的旧非线性流速规则。文字使用浏览器字体；未对原编辑器逐像素验证。视频、extra 着色器、解锁视频、纹理锚点和自定义宽高比尚未接入。

实现依据为工作区 `phira-docs/src/chart-standard`，文档行为未覆盖的部分与验证边界记录在 `research/notes/chart-adapters.md`。
