# ZEPC 曲包、ZEPC YAML 谱面与 Lua 脚本

ZEPC（.zepc）是本模拟器的实验性曲包格式（based on zip）：一个清单文件描述曲包与多个难度，每个难度可以覆盖曲绘、音频、打击音、字体和脚本。谱面本身可用 YAML 编写，也可继续使用现有的 Phigros JSON、PEC、RPE JSON、RPEN JSON 文件。曲包内的 Lua 脚本运行在受限的 Lua 5.3 虚拟机中，可以读取游戏状态、修改显示样式并触发暂停/播放/跳转。

清单与谱面都由模拟器自主识别，不依赖文件名。PEZ/ZIP、拖放文件和文件选择器均可导入。

## 曲包目录

```text
MySong.zepc/
  meta.yml
  base.ogg
  base.png
  font.ttf
  gbc.png
  ayowtf.ogg
  postfx.json
  scenecontrol/
    init.lua
    at.lua
  ez/
    ez.pec
  hd/
    hd.json
  in/
    in.yml
    in.lua
    base.png
  at/
    at.yml
    base.png
```

清单文件名任意，只要扩展名为 `.yaml` / `.yml`。习惯上使用 `meta.yaml`。一个压缩包（或一次松散文件选择）只能包含一个 PWP 清单；清单声明的谱面不会再次作为独立谱面导入。

## 曲包清单

```yaml
name: 示例曲
composer: 作曲者
charter: 谱师
illustrator: 画师
music: base.ogg
image: base.png
postfx: postfx.json
script:
  - scenecontrol/init.lua
difficulties:
  IN:
    level: "14"
    chart: charts/in.yml
  AT:
    name: AT
    level: "16"
    chart: charts/at.yml
    image: base.png
    script:
      - scenecontrol/at.lua
```

### 顶层字段

| 字段 | 说明 |
| --- | --- |
| `name` | 必填，曲名。 |
| `composer` / `charter` / `illustrator` | 默认曲师、谱师、画师。 |
| `music` | 默认音频路径；别名 `song`、`audio`。 |
| `image` | 默认曲绘路径；别名 `cover`、`illustration`。 |
| `postfx` | 默认后期特效 JSON。未填写时自动使用谱面同目录的 `postfx.json`（如果存在）。 |
| `script` | 默认 Lua 脚本列表，按顺序加载。 |
| `shaders` | RPEN 谱面的 shader 资源目录；默认谱面同目录的 `shader/`。 |
| `difficulties` | 必填，难度列表或映射；至少一项。 |

### 难度

`difficulties` 可以是数组，也可以是“难度名 → 配置”的映射。映射形式会把键作为难度名；数组形式可用 `name` 指定名称。

| 字段 | 说明 |
| --- | --- |
| `chart` | 必填。谱面路径，可用 `file` / `path`。支持 ZEPC YAML、Phigros JSON、RPE/RPEN JSON 和 PEC 文本。 |
| `name` / `difficulty` | 难度名，例如 `IN`、`AT`。 |
| `level` / `rating` | 等级标签，例如 `14` 或 `IN 14`。 |
| `music` / `image` | 覆盖默认音频/曲绘。 |
| `postfx` | 覆盖默认后期特效。 |
| `composer` / `charter` / `illustrator` | 覆盖默认元数据。 |
| `songName` | 覆盖该难度的实际曲名；`name` 仍表示难度名称。 |
| `script` | 追加到默认脚本之后。 |
| `textures` / `fonts` / `hitsounds` | 在默认映射上合并；同名键覆盖。 |
| `shaders` | 覆盖 shader 目录。 |

界面上显示的难度标签会合并名称与等级：映射键 `IN` 配 `level: "14"` 显示为 `IN 14`；若 `level` 已是 `IN 14`，不会重复添加。

### 路径解析

- 清单中的 `music`、`image`、`postfx`、`chart`、`textures`、`fonts`、`hitsounds` 以清单所在目录为根。
- 谱面内引用的 `texture`、`font`、`hitsound` 先按谱面所在目录查找，再按清单根目录查找。
- 清单和谱面的 `scripts` 先按谱面目录查找，再按清单根目录查找。
- 会先尝试完整相对路径，再尝试包内唯一的同名文件；同名文件不唯一时会报告歧义，不会随意选择。
- 支持 `..`、反斜杠和大小写差异。

未指定音频时，按谱面文件名、`base.ogg`、`base.mp3`、`base.ogg` 等顺序自动匹配；找不到唯一候选会报错。未指定曲绘时按谱面文件名、`base.png`、`base.png` 等顺序尝试同目录图片，并排除已用作判定线贴图的图片；仍不唯一时使用默认曲绘。

## 原生 ZEPC 谱面

```yaml
zepcVersion: 1
timing: beats
bpm: 120
offset: 0
aspectRatio: 1.7777778
script:
  - in.lua
lines:
  - zOrder: 1
    moves:
      - beat: 0
        x: 0.5
        y: 0.5
    rotate:
      - beat: 0
        angle: 0
    alpha:
      - beat: 0
        value: 1
    speed:
      - beat: 0
        value: 1
    note:
      - type: 1
        beat: 4
        x: 0.5
      - type: 4
        beat: 8
        holdBeats: 2
        x: 0.3
```

### 谱面字段

| 字段 | 说明 |
| --- | --- |
| `zepcVersion` | 当前只支持 `1`，省略时为 1。 |
| `timing` | `beats`（默认）或 `seconds`。 |
| `bpm` | `beats` 计时下的初始 BPM，默认 120。 |
| `bpmList` | 变 BPM 列表，元素为 `{ beat, bpm }`；别名 `bpms`、`tempo`。 |
| `offset` | 谱面偏移，单位秒。正值让谱面相对音乐延后。 |
| `aspectRatio` | 谱面宽高比，例如 `1.7777778`。设置中的非零宽高比会覆盖它。 |
| `script` | 谱面级 Lua 脚本，追加在曲包难度脚本之后。 |
| `line` | 必填，判定线数组。 |
| `block` | 必填，噪域数组。 |

`timing: beats` 时，音符和文字时间通过 BPM 列表换算为秒。`timing: seconds` 时，所有时间字段直接按秒解释，`bpm` / `bpmList` 不参与换算。

判定线事件的 `beat` / `endBeat` 始终位于时间轴中；编译器再按 BPM 和该线的 `bpmFactor` 换算。`bpmFactor` 大于 1 会让该线的动画相对谱面更慢，小于 1 则更快。

### 判定线

| 字段 | 说明 |
| --- | --- |
| `father` | 父线索引，从 0 开始；`-1` 表示无父线。父子线循环会报错。 |
| `rotateWithFather` | 是否继承父线旋转，默认 `false`。 |
| `zOrder` | 绘制层级，默认 0；越小越先绘制。 |
| `cover` | 是否允许音符遮挡判定线，默认 `true`。 |
| `bpmFactor` | 该线动画的时间倍率，默认 1，必须大于 0。 |
| `texture` | 判定线贴图名称；`line.png` 视为默认线。 |
| `anchor` | 贴图/文字锚点 `[x, y]`，`0.5, 0.5` 为中心。 |
| `attachUI` | 将线绑定到 HUD：`pause`、`combo`、`combonumber`、`score`、`bar`、`name`、`level`。 |
| `move` | 移动事件；别名 `moves`、`moveEvents`。 |
| `rotate` | 旋转事件；别名 `rotates`、`rotateEvents`。 |
| `alpha` | 透明度事件；别名 `alphas`、`alphaEvents`。 |
| `speed` | 流速事件；别名 `speeds`、`speedEvents`。 |
| `scaleX` / `scaleY` | 缩放事件；`scales` 同时作用于两者。 |
| `color` | 颜色事件；别名 `colors`、`colorEvents`。 |
| `text` | 文字事件数组。 |
| `note` | 音符数组。 |

`x`、`y` 使用 0–1 的屏幕坐标：`(0, 0)` 为左上，`(1, 1)` 为右下。未写事件的属性默认值：位置为屏幕中心、旋转 0、透明度 1、流速 1、缩放 1、颜色白色。如果首个移动/旋转等事件晚于时间 0，0 到该事件之前保持默认值。

### 事件字段

所有轨道共享相同的起止时间写法：

```yaml
- beat: 0        # 也可用 startBeat / time / startTime
  endBeat: 4     # 也可用 endTime / beatEnd；省略表示瞬时
  easing: 9
```

`easing` 推荐直接写 Phigros / RPE 缓动编号 `1`–`29`，也可写内置名称、`[d1, d2, x1, x2]` 四段贝塞尔控制点，或对象 `{ type, left, right, bezier, points }`。编号对应关系：`1` 线性、`2` outSine、`3` inSine、`4` outQuad、`5` inQuad、`6` inOutQuad、`7` outCubic、`8` inCubic、`9` inOutCubic、`10` outQuart、`11` inQuart、`12` inOutQuart、`13` outQuint、`14` inQuint、`15` inOutQuint、`16` outExpo、`17` inExpo、`18` outCirc、`19` inCirc、`20` outBack、`21` inBack、`22` inOutCirc、`23` inOutBack、`24` outElastic、`25` inElastic、`26` outBounce、`27` inBounce、`28` inOutBounce、`29` inOutElastic。名称只是这些编号的可读别名。

单值轨道的值字段：

| 轨道 | 起始值 | 目标值 |
| --- | --- | --- |
| 旋转 | `angle` / `degrees` / `value` / `rotate` | `to` / `toValue` / `toAngle` |
| 透明度 | `value` / `alpha` | `to` / `toValue` / `toAlpha` |
| 流速 | `value` / `speed` | `to` / `toValue` / `toSpeed` |
| 缩放 | `value` / `scale` | `to` / `toValue` / `toScale` |

移动事件：

```yaml
- beat: 0
  x: 0.5
  y: 0.5
  toX: 0.25
  toY: 0.75
  endBeat: 2
  easing: 6
```

`x` / `y` 可写作 `startX` / `startY`，目标值也可写作 `endX` / `endY`。省略 `toX` / `toY` 时保持起始值。

颜色事件：

```yaml
- beat: 0
  color: "#ff8040"
  to: [64, 128, 255]
  endBeat: 2
```

颜色可用 `#RRGGBB`、`[r, g, b]` 或 `{ r, g, b }`；每个分量为 0–255。`color` / `value` / `start` 为起始色，`to` / `end` 为目标色。

文字事件：

```yaml
- beat: 0
  endBeat: 8
  from: "Combo: "
  to: "Combo: 100"
  font: number
  easing: linear
```

文字时间直接按谱面计时换算为秒。`font` 引用清单 `fonts` 映射或谱面同目录的字体文件。`%P%123` 形式的两个纯数字文本会按缓动插值。

### 音符

| 字段 | 说明 |
| --- | --- |
| `type` | 数字 1–4。 |
| `beat` | 音符时间；别名 `time`。 |
| `holdBeats` / `durationBeats` | Hold 时长。 |
| `endBeat` / `endTime` / `end` | Hold 结束时间；与 `holdBeats` 二选一。 |
| `x` | 0–1 的横向屏幕位置，默认 0.5。 |
| `speed` | 音符流速，默认 1。 |
| `size` | 宽度倍率，默认 1。 |
| `alpha` | 透明度，限制在 0–1。 |
| `fake` / `isFake` | 假音符，不判定、不计分。 |
| `tint` / `color` | 音符染色 RGB。 |
| `tintHitEffects` | 打击特效染色 RGB。 |
| `hitsound` | 打击音名称。 |
| `visibleTime` | 提前可见的秒数。 |
| `visibleBeats` | 提前可见的拍数，按谱面计时换算。 |
| `highlight` | 高亮类型：0 / 1 / 2。 |
| `above` / `below` | `above: false` 或 `below: true` 将音符放到判定线下侧。 |

Hold 的时长和结束时间与谱面 `timing` 使用相同单位。零时长 Hold 会生成兼容提示，但不会阻止导入。

## Lua 脚本

曲包难度脚本与谱面级脚本按顺序加载到同一个 Lua 虚拟机。后加载的脚本可以调用先前脚本定义的全局函数。每个谱面独立创建虚拟机，切换谱面时销毁。

```lua
local flash = 0

local function show_hud(state)
  pwp.hud("PWP  " .. state.total .. " notes", {
    x = 0.04, y = 0.05, size = 0.04, align = "left"
  })
end

function on_load(state)
  show_hud(state)
end

function on_reset(state)
  flash = 0
  show_hud(state)
end

function on_update(dt, state)
  flash = math.max(0, flash - dt * 2)
  pwp.background({ 20, 0, 32 }, 0.25 + flash * 0.35)
end

function on_judge(note, grade, state)
  if grade == "miss" then
    pwp.note(note.id, { tint = { 255, 64, 64 } })
  elseif grade == "good" then
    flash = 0.6
  end
  return grade
end

function on_hit(note, grade, state)
  pwp.log("result", note.id, grade, state.combo)
end

function on_finish(state)
  pwp.log("finish", state.score, state.accuracy)
end
```

### 钩子

| 钩子 | 调用时机 |
| --- | --- |
| `on_load(state)` | 判定初始化后、加载完成时调用一次。首次自动重置不会清除 `on_load` 设置的覆盖层。 |
| `on_reset(state)` | 重开、跳转或判定重置时调用。首次加载后的那次重置保留 `on_load` 覆盖层；之后每次调用前会清空背景、HUD、判定线和音符覆盖。 |
| `on_update(dt, state)` | 每个渲染帧调用；暂停时 `dt` 为 0。`dt` 最大按 0.25 秒计。 |
| `on_judge(note, grade, state)` | 音符判定产生结果前调用。返回 `perfect` / `good` / `bad` / `miss` 可覆盖结果；返回其他值则保留原结果。 |
| `on_hit(note, grade, state)` | 结果确定后调用，包括 Miss。Hold 的头部结果和最终完成可能各触发一次。 |
| `on_finish(state)` | 播放到达谱面末尾时调用一次。此钩子的暂停/播放/跳转动作会被丢弃。 |
| `on_action(name, state)` | 点击脚本元素的 `action` 区域时调用，按下即触发；该接触不会同时判定音符。Autoplay 也可操作脚本按钮。 |

`on_judge` 覆盖结果会影响计分、连击、打击特效和 `state`。例如把 `miss` 改为 `good` 会重新计入连击。

### 状态表

`state` 是普通 Lua 表：

| 字段 | 说明 |
| --- | --- |
| `time` | 当前谱面时间，秒。 |
| `duration` | 谱面总时长，秒。 |
| `playing` | 是否正在播放。 |
| `progress` | `time / duration`，限制在 0–1。 |
| `score` / `accuracy` | 当前分数与准确率。 |
| `combo` / `maxCombo` | 当前连击与最大连击。 |
| `perfect` / `good` / `bad` / `miss` | 各判定数量。 |
| `total` | 参与判定的音符总数（不含假音符）。 |
| `width` / `height` | 当前画布像素尺寸，用于脚本的比例布局。 |
| `autoplay` / `exporting` | 自动演奏（含视频导出）与导出标志。 |
| `spectrum` | 请求该字段的脚本可读音轨通道 0 的矩形 FFT 平均平方幅度。按 2.5.1 原引擎对每个频点执行 `min(2.5 * 幅度, 1)` 后平方、求均值；依谱面时间求值，可倒退重算。DSP 缓冲时序与原设备仍可能不同。 |

需要固定频谱更新频率的谱面可在 Lua 中加一行 `-- pwp:spectrum-hz=30`。同一谱面的脚本共用首个有效设置（1–240 Hz）；未设置时仍按帧求值。固定频率以谱面 0 秒为起点，两个采样点之间保持上一个值，不改变 Lua 钩子或音轨的采样率。

### 音符表

`note` 是普通 Lua 表：

| 字段 | 说明 |
| --- | --- |
| `id` | 形如 `"1:3"` 的稳定 ID：判定线序号:音符序号，均从 1 开始。 |
| `line` | 判定线序号，从 1 开始。 |
| `index` | 该线内的音符序号，从 1 开始；先上侧、后下侧，保持谱面顺序。 |
| `type` | `tap` / `drag` / `hold` / `flick`。 |
| `time` / `holdTime` | 秒。 |
| `x` | 0–1 的横向位置。 |
| `speed` | 音符流速。 |
| `above` | 是否在上侧。 |
| `fake` | 是否假音符。 |

### `pwp` API

| 调用 | 说明 |
| --- | --- |
| `pwp.log(...)` | 将参数以制表符连接后写入控制台，最多保留 200 条。全局 `print` 也指向这里。 |
| `pwp.line(index, props)` | 覆盖判定线样式。`index` 从 1 开始。`props.color` 为 RGB 或 `#RRGGBB`；`alpha` 为透明度倍率；`scale` 为缩放倍率；`visible` 为布尔值。按属性合并到该线现有覆盖。调用 `pwp.line(index)` 移除整条覆盖。 |
| `pwp.note(id, props)` | 覆盖音符样式。`tint` / `color` 为染色 RGB；`alpha` 为透明度倍率；`width` / `size` 为宽度倍率；`visible` 为布尔值。按属性合并。调用 `pwp.note(id)` 移除覆盖。 |
| `pwp.background(color, alpha)` | 设置背景染色，`alpha` 默认 1。传 `nil` 或 `"none"` 清除。 |
| `pwp.hud(text, opts)` | 绘制一行 HUD。`opts.x` / `opts.y` 为 0–1 屏幕位置，`size` 为相对字号，`align` 为 `left` / `center` / `right`，`color` 为 RGB，`alpha` 为透明度。传 `nil` 或空字符串清除。 |
| `pwp.clear_hud()` | 清除 HUD。 |
| `pwp.clear()` | 清除背景、HUD、判定线和音符覆盖。 |
| `pwp.pause()` / `pwp.play()` | 请求暂停或继续播放。 |
| `pwp.seek(seconds)` | 请求跳转到指定秒数。视频导出和曲包加载期间忽略。跳转会重置判定并再次触发 `on_reset`。 |
| `pwp.display(props)` | 覆盖 HUD 的 `score`（数字）、`combo`（字符串）、`level`（字符串）、`progress`（0–1）。按字段合并，`combo=""` 恢复真实连击。传 `nil` 清除。覆盖不会改写真实统计和结算。 |
| `pwp.screen(color, alpha)` | 在谱面和 HUD 上方叠加颜色；在脚本元素下方。传 `nil` 清除。 |
| `pwp.element(id, props)` | 添加/合并画面元素。`x/y/width/height` 为画布归一化坐标，位置表示中心；`rotation` 为顺时针度数。`texture` 引用清单的贴图，`text` 为文本，`size` 为相对画布高度的字号，`color` 为矩形填色，`alpha` 为透明度，`action` 为点击回调名。省略贴图/填色可建立透明点击区。传 `nil` 移除。最多 256 个；按插入顺序绘制，后绘制的按钮优先命中。 |
| `pwp.volume(gain)` | 音乐相对设置音量的倍率，0–1。 |
| `pwp.sound(name, gain)` | 播放清单 `hitsounds` 注册的音频，`gain` 默认 1。 |
| `pwp.loop(name, gain, rate)` | 播放注册音频的循环，倍率默认 1。最多 16 路；音量 0 或 `nil` 停止，暂停/重开/换谱释放音频节点。 |
| `pwp.chart(name)` | 请求切换到同一 ZEPC 包内唯一命名的难度，重新加载后播放。不接受文件路径或 URL；导出期间忽略。 |
| `pwp.finish()` | 请求提前结束游玩并进入现有结束/结算流程；导出期间忽略。 |

暂停、播放和跳转不会在 Lua 执行期间立即发生，而是排队到当前钩子结束后由播放器处理，避免重入。

包内切谱等当前帧画完后执行。脚本屏幕层、显示覆盖、元素、循环音效和音量倍率会在重开/跳转时清理。脚本循环音效与实时点击不会录入离线导出音轨，导出也不会重放先前的交互切谱。

### 沙箱与限制

- 虚拟机为 Fengari 提供的 Lua 5.3，仅开放 `base`、`string`、`table`、`math`、`utf8`、`coroutine`。
- 不提供 `io`、`os`、`package`、`debug`、`require`、`load`、`loadfile`、`dofile`；脚本不能访问文件系统、网络或 DOM。
- 单个脚本最大 256 KiB。加载、重置、更新、判定和结束钩子分别有指令预算；死循环会被中止并在界面中报告，不会冻结播放器。
- 错误会去重后写入谱面兼容提示和控制台；脚本出错不会阻止谱面播放。
- 覆盖层是表现层效果，不改变判定位置、音符时间或谱面数据。

## 独立导入

也可以不写曲包清单，直接导入一个 `format: zepc` 的 `.yaml` / `.yml` 谱面，并同时选择音频、曲绘和脚本。独立谱面会读取谱面目录中的 `info.yml`/`info.txt` 等元数据；未指定音频时需保证候选项唯一。谱面 `scripts` 中的路径先按谱面目录匹配，再按唯一文件名匹配。

## 常见错误

- 清单缺少 `format: pwp`、`name`、`difficulties` 或难度 `chart`。
- 同一压缩包内出现多个 PWP 清单。
- 谱面 `timing` 不是 `beats` / `seconds`，版本不是 1。
- 判定线父索引越界或形成循环；音符/移动坐标超出 0–1。
- 显式声明的音频、曲绘、脚本、贴图或打击音找不到，或同名资源不唯一。
- Hold 结束时间早于开始时间；零时长 Hold 只产生提示。
- 未知缓动名称、非法颜色分量或未知音符类型。

导入失败会保留具体文件名和原因；已成功导入的其它谱面不会受影响。
