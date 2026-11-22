# ZEPC v2 规范（草案）

状态：**草案**。运行时仍只认 ZEPC v1；v2 先固定规范与校验层，随后再切换运行时和编辑器。`block` 噪域仍是 TODO，暂不进入 v2 正式字段。

## 1. 目标

ZEPC v2 只服务两件事：**编辑器写入**、**播放器读取**。因此：

- 只有一个规范拼写，未知字段直接报错。
- 资源、难度、判定线、事件层和音符用稳定 ID 标识。父子关系和 Lua 引用不依赖数组下标。
- 资源只在 `meta.yaml` 登记一次，谱面只引用 asset ID。
- 时间统一使用 beat；秒只出现在设置偏移等明确标注的字段。
- 文件路径固定相对于 `.zepc` 包根目录，不做同名回退、不做自动挑选。
- RPE/旧 ZEPC 字段只在迁移工具中出现；运行时和编辑器永远看不到旧名。

## 2. 容器与根目录

- ZEPC 是一个 zip 归档，扩展名必须是 `.zepc`。
- 归档根目录必须有且只有一个 `meta.yaml`。
- 所有 `path` 都相对于归档根目录，使用 `/`，大小写敏感。
- 禁止绝对路径、`..` 路径段、反斜杠、盘符。
- 不扫描“任意 YAML”来猜清单；`meta.yaml` 是唯一入口。
- 清单里的 `assets` 必须显式列出所有被引用的文件，包括谱面文件、脚本、音频、曲绘、贴图、字体、打击音和后期特效。

## 3. ID

```text
^[a-z][a-z0-9_-]*$
```

- asset ID 在整个曲包内唯一。
- difficulty ID 在曲包内唯一。
- chart 文件里的 line ID 在谱面内唯一。
- note ID 在整个谱面内唯一（跨判定线也唯一），便于 Lua 直接 `pwp.note("n1")`。
- 事件层 ID 在所属判定线内唯一。
- 重复 ID 是校验错误；编辑器不得自动重命名已有 ID。
- 不要用数组下标作为身份，也不要因为排序/插入重新编号。

## 4. `meta.yaml`：`kind: bundle`

```yaml
zepcVersion: 2
kind: bundle
name: 示例曲
composer: 作曲者
charter: 谱师
illustrator: 画师

music: music-main
cover: cover-main
postfx: fx-main
scripts: [hud]

assets:
  - id: music-main
    type: audio
    path: assets/music.ogg
  - id: cover-main
    type: image
    path: assets/cover.png
  - id: fx-main
    type: postfx
    path: assets/postfx.json
  - id: line-main
    type: texture
    path: assets/line.png
  - id: font-main
    type: font
    path: assets/font-main.ttf
  - id: hit-main
    type: hitsound
    path: assets/hit.ogg
  - id: hud
    type: script
    path: scripts/hud.lua
  - id: chart-in
    type: chart
    path: charts/in.chart.yaml

difficulties:
  - id: in
    name: IN
    level: 14
    chart: chart-in
    music: music-main
    cover: cover-main
    scripts: [hud]
```

### 字段

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| `zepcVersion` | 是 | 固定为 `2`。 |
| `kind` | 是 | 固定为 `bundle`。 |
| `name` | 是 | 曲名。 |
| `composer` / `charter` / `illustrator` | 否 | 默认元数据。 |
| `music` / `cover` / `postfx` | 否 | 默认资源，值为 asset ID；难度可覆盖。 |
| `scripts` | 否 | 默认脚本 asset ID 数组；按顺序加载，难度脚本追加在后。 |
| `assets` | 是 | 资源登记表，至少一项。 |
| `difficulties` | 是 | 难度数组，至少一项。 |

### asset

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| `id` | 是 | 稳定 ID，符合第 3 节。 |
| `type` | 是 | `audio` / `image` / `texture` / `font` / `hitsound` / `postfx` / `script` / `chart` / `shader`。 |
| `path` | 是 | 相对包根目录的路径。 |
| `family` | 否 | 字体族名；仅 `font` 使用，默认使用 asset ID。 |

引用规则：

- `music` 必须引用 `audio`。
- `cover` 必须引用 `image`。
- `postfx` 必须引用 `postfx`。
- `scripts` 必须引用 `script`。
- `chart` 必须引用 `chart`。
- 判定线 `texture` 必须引用 `texture`。
- 文字事件 `font` 必须引用 `font`。
- 音符 `hitsound` 必须引用 `hitsound`。

不满足类型即为错误，不做跨类型兼容。

### 难度

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| `id` | 是 | 稳定 ID。 |
| `name` | 是 | 显示名，例如 `IN`。 |
| `level` | 是 | 数字或字符串，例如 `14` 或 `14+`。 |
| `chart` | 是 | chart asset ID。 |
| `music` / `cover` / `postfx` | 否 | 覆盖 bundle 默认资源。 |
| `scripts` | 否 | 追加到 bundle 默认脚本之后。 |
| `composer` / `charter` / `illustrator` | 否 | 覆盖默认元数据。 |

难度数组的顺序就是界面顺序；不要用映射对象。

## 5. 谱面文件：`kind: chart`

谱面文件本身也登记在 `assets` 中（`type: chart`）。文件内容：

```yaml
zepcVersion: 2
kind: chart
id: chart-in

timing:
  bpm: 120
  tempo:
    - { beat: 0, bpm: 120 }

offsetSeconds: 0
aspectRatio: 1.7777778
scripts: [hud]

lines:
  - id: main
    parent: null
    inheritRotation: false
    layer: 0
    clipNotes: true
    timingScale: 1
    texture: line-main
    anchor: { x: 0.5, y: 0.5 }
    hudAnchor: null

    eventLayers:
      - id: base
        events:
          positionX:
            - { startBeat: 0, endBeat: 4, from: 0, to: 0.25, easing: 1 }
          positionY:
            - { startBeat: 1, endBeat: 3, from: 0, to: -0.25, easing: 9 }
          scaleX:
            - { startBeat: 0, endBeat: 2, from: 1, to: 1.25, easing: 3 }
          scaleY:
            - { startBeat: 2, endBeat: 3, from: 1, to: 0.75, easing: 6 }
      - id: shake
        events:
          positionX:
            - { startBeat: 2, endBeat: 2.25, from: 0, to: 0.03 }
            - { startBeat: 2.25, endBeat: 2.5, from: 0.03, to: 0 }

    notes:
      - id: n1
        type: tap
        beat: 4
        x: 0.5
```

### 谱面字段

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| `zepcVersion` | 是 | 固定为 `2`。 |
| `kind` | 是 | 固定为 `chart`。 |
| `id` | 是 | 必须等于其 chart asset ID。 |
| `timing` | 是 | `{ bpm, tempo? }`，时间基准固定为 beat。 |
| `offsetSeconds` | 否 | 谱面偏移，单位秒，默认 0。 |
| `aspectRatio` | 否 | 宽高比；设置中的非零值仍可覆盖。 |
| `scripts` | 否 | 谱面级脚本 asset ID，追加在难度脚本之后。 |
| `lines` | 是 | 判定线数组。 |

### timing

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| `bpm` | 是 | 初始 BPM。 |
| `tempo` | 否 | `[{ beat, bpm }]`，`beat` 非递减；不写时等价于 `[{ beat: 0, bpm }]`。 |

`beat`、`startBeat`、`endBeat`、`duration` 和 `visibleLead` 都以拍为单位。编辑器可直接显示拍线和小节。

## 6. 判定线

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| `id` | 是 | 稳定 ID。 |
| `parent` | 否 | 父线 ID。省略或为 `null` 时是根线。 |
| `inheritRotation` | 否 | 默认 `false`。子线的位置偏移始终跟随父线旋转，设为 `true` 时子线自身的角度还会叠加父线角度。 |
| `layer` | 否 | 判定线的绘制层级，默认 0。数值较小的线先画。 |
| `clipNotes` | 否 | 默认 `true`。以判定线为界，裁掉非 Hold 音符超出所属侧的部分。尚未到达判定拍的音符完全越界时隐藏。 |
| `timingScale` | 否 | 判定线事件时间的伸缩倍率，默认 1，必须大于 0。见下方说明。 |
| `texture` | 否 | texture asset ID 或 `null`。 |
| `anchor` | 否 | `{ x, y }`，默认 `{ x: 0.5, y: 0.5 }`。 |
| `hudAnchor` | 否 | 令判定线驱动指定 HUD 元素的位移、旋转、缩放、透明度和颜色。可选 `pause` / `combo` / `comboNumber` / `score` / `progress` / `title` / `level`。省略或为 `null` 时为普通判定线。 |
| `eventLayers` | 是 | 事件层数组，可以为空。见第 7 节。 |
| `notes` | 是 | 音符数组，见第 8 节。 |

`parent` 成环、父线不存在、`parent` 指向自己都直接报错。编辑器拖动排序不改变任何引用。

判定线事件的 `startBeat` 和 `endBeat` 先按全局节奏表换算成秒，再乘以 `timingScale`。设为 `2` 时，原本在谱面时间 1 秒开始、3 秒结束的事件会在 2 秒开始、6 秒结束。音符仍按全局节奏表换算。

例如 `hudAnchor: score` 会用该线的动画改变分数的显示样式。绑定 HUD 的线从判定线绘制列表中移除，HUD 元素仍以自己的布局位置为基准。`combo` 对应 `COMBO` 标签，`comboNumber` 对应连击数字。

## 7. 事件层与轨道

每条判定线可以用多个事件层分别编排基础动画、抖动等效果。每层有自己的 `id` 和 `events`。`events` 只接受下表中的键，每个键对应一条轨道，值为事件数组。轨道可以分别省略或留空。

| 轨道 | 事件值 | 层间合成与默认值 |
| --- | --- | --- |
| `positionX` / `positionY` | 数字 | 各层偏移相加。横向以视口宽度、纵向以视口高度为单位，向右和向下为正。根线以视口中心为原点，子线以父线位置为原点。 |
| `rotation` | 数字（度） | 各层角度相加，默认 `0`。 |
| `opacity` | 数字 | 各层数值相加后限制在 `0–1`，默认 `1`。 |
| `scrollSpeed` | 数字 | 各层流速相加，默认 `1`。 |
| `scaleX` / `scaleY` | 数字 | 各层倍率相乘，默认 `1`。 |
| `color` | `[r,g,b]` | 各通道先除以 `255` 再按层相乘，最后还原到 `0–255`，默认白色。 |
| `text` | 字符串，事件可附加 `font` asset ID | 取数组中靠后的、已开始播放文本事件的层，文字和字体取自同一事件。默认不显示文字。 |

合成时，只计入至少有一个事件已经开始的轨道。没有任何层提供该属性时使用表中的默认值，位置偏移默认为 `0`。先合成各层，再应用父线变换。`layer` 控制判定线的绘制顺序。

例如，同一拍上 `base` 层的横向偏移为 `0.20`，`shake` 层为 `0.03`，合成后的横向偏移为 `0.23`。抖动结束时让该层回到 `0`，后续位置就由 `base` 层决定。流速和透明度要在基础值上叠加时，可先在 `base` 层写一个瞬时事件设定基础值。

### 事件

每个事件用开始拍和结束拍定义一段变化。位置和缩放的 X、Y 各有自己的时间和值。

```yaml
- startBeat: 0
  endBeat: 4
  from: 0
  to: 0.25
  easing: 9
```

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| `startBeat` | 是 | 事件开始拍。 |
| `endBeat` | 是 | 事件结束拍，必须大于或等于 `startBeat`。两者相等时立即取 `to`。 |
| `easing` | 否 | Phigros/RPE 缓动编号 1–29，默认 1。 |
| `from` / `to` | 是 | 起始值/目标值，形状由轨道决定。 |

同一轨道取当前拍已开始的最新事件。两个事件同拍开始时取数组中靠后的那个。数值与 RGB 通道按拍进度应用缓动，结束后保持 `to`，直到下一个事件开始。文本中一个端点是另一个的前缀时，按缓动进度插值长度并取最近整数，增减末尾的字符。其他文本在结束拍切换到 `to`。

## 8. 音符

| 字段 | 必有 | 说明 |
| --- | --- | --- |
| `id` | 是 | 谱面内唯一稳定 ID。 |
| `type` | 是 | `tap` / `drag` / `hold` / `flick`。 |
| `beat` | 是 | 音符时间，单位 beat。 |
| `x` | 是 | 0–1 的横向位置。 |
| `duration` | Hold 必填 | Hold 持续拍数，必须大于 0；非 Hold 不写。 |
| `speed` | 否 | 音符流速，默认 1。 |
| `width` | 否 | 宽度倍率，默认 1。 |
| `opacity` | 否 | 0–1，默认 1。 |
| `fake` | 否 | 假音符，默认 `false`。 |
| `side` | 否 | `above` / `below`，默认 `above`。 |
| `color` | 否 | 音符颜色 RGB。 |
| `hitEffectTint` | 否 | 打击特效颜色 RGB。 |
| `hitsound` | 否 | hitsound asset ID。 |
| `visibleLead` | 否 | 提前可见拍数，默认不限制。 |
| `highlightMode` | 否 | 0 / 1 / 2。 |

不再使用 `above: false` + `below: true` 两个布尔，也不再把 `type` 写成数字或字符串两套。

## 9. Lua 与资源

- 脚本也必须是 `assets` 中的 `type: script`。
- Lua 引用稳定 ID，不引用数组下标：
  - `pwp.line("main", { ... })`
  - `pwp.note("n1", { ... })`
  - `pwp.texture("main", "line-main")`
  - `pwp.clear_texture("main")`
- 资源登记在 `meta.yaml`；谱面负责静态绑定；Lua 只负责运行时覆盖。三者职责不要混。
- 编辑器不执行 Lua 也能静态预览谱面；Lua 只影响运行期。

## 10. 校验与错误

- 结构校验使用 `schema/zepc-v2.schema.json` + Ajv。
- 语义校验在 CLI 中完成，覆盖 ID 唯一性、资源引用、父线关系、事件起止拍、Hold 时长和 tempo 顺序。
- 所有对象 `additionalProperties: false`：未知字段直接报错。
- 错误使用稳定错误码，至少包括：

| 错误码 | 含义 |
| --- | --- |
| `ZEPC_SCHEMA_INVALID` | JSON Schema 结构错误。 |
| `ZEPC_DUPLICATE_ID` | 同作用域 ID 重复。 |
| `ZEPC_ASSET_MISSING` | `assets.path` 指向的文件不存在。 |
| `ZEPC_REF_MISSING` | 引用的 asset/difficulty/chart 不存在。 |
| `ZEPC_REF_TYPE` | 引用类型不匹配。 |
| `ZEPC_CHART_INVALID` | chart 文件不是 v2 chart。 |
| `ZEPC_PARENT_MISSING` | 父线 ID 不存在。 |
| `ZEPC_PARENT_CYCLE` | 父线成环。 |
| `ZEPC_EVENT_TIME` | 事件结束拍早于开始拍。 |
| `ZEPC_NOTE_DURATION` | Hold 时长非法。 |
| `ZEPC_TEMPO` | tempo 顺序/BPM 非法。 |
| `ZEPC_BLOCK_UNSUPPORTED` | 使用了尚未定义的 `block`。 |

CLI：

```sh
pnpm validate:zepc path/to/song.zepc
pnpm validate:zepc path/to/bundle-directory
```

## 11. v1 迁移

运行时只认 v2；v1 必须经过迁移工具：

- `lines` / `line` → `lines`，为每条线生成 `line-1` 这类 ID。
- `notes` / `note` → `notes`，生成全谱唯一 ID；`father` 索引转成父线 ID。
- `holdBeats` / `endBeat` → `duration`。
- `visibleBeats` → `visibleLead`。
- `tint` → `color`；`tintHitEffects` → `hitEffectTint`；`isFake` → `fake`；`highlight` → `highlightMode`。
- `above: false` / `below: true` → `side: below`。
- v1 的判定线事件放入一个 `base` 层，转换为 `startBeat` / `endBeat`。`move` 拆到 `events.positionX` 和 `events.positionY`，每轴保留时间和缓动，坐标值减去 `0.5` 得到偏移。
- `scaleX` / `scaleY` 分别转换到 `events.scaleX` / `events.scaleY`。共用的 `scales` 事件在迁移时复制到两轴，轴专用轨道优先。
- `rotate` / `alpha` / `speed` / `color` / `text` → `events.rotation` / `events.opacity` / `events.scrollSpeed` / `events.color` / `events.text`。
- RPE 导入时逐层生成稳定 ID。`moveXEvents` / `moveYEvents` 分别转换到对应轴，保留各自的时间和缓动。扩展外观事件可集中放在独立一层。
- `father` → `parent`；`rotateWithFather` → `inheritRotation`；`bpmFactor` → `timingScale`；`cover` → `clipNotes`；`zOrder` → `layer`；`attachUI` → `hudAnchor`。
- `timing: seconds` 的 v1 谱面使用 60 BPM 迁移为 beat，保证原时间点不变。
- `textures/fonts/hitsounds` 映射转成 asset 条目并生成 ID。
- `block` 暂不迁移，报告 `ZEPC_BLOCK_UNSUPPORTED`。

## 12. TODO

- `block` 噪域：当前 v1 文档写了必填但运行时没有读取；v2 暂不接收，等 RPEN 噪域字段定稿后再加完整 schema。
- RPEN shader / postfx JSON 的 v2 资源类型与字段。
- 编辑器侧 ID 生成、重命名和引用更新规则。
- Lua v2 API 与运行时实现。
