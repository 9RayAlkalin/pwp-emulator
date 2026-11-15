# RPEN 谱面

RPEN 使用独立入口 `src/chart/formats/rpen.ts`。`format: Rpen`、`useRpen: true`、`META.RPEVersion >= 200` 或 RPEN 噪域/特效字段会选中此解析器。普通 RPE 仍由 `rpe.ts` 处理；RPEN 复用其中的基础音符/判定线转换，扩展字段转换为单独的 `ChartData.rpen`，不会塞入原版 Phigros 的 `blockAreaList`。

直接导入 ZIP/PEZ，或拖入谱面和配套资源。例如：

```yaml
chart: chart.json
format: Rpen
music: song.ogg
illustration: cover.png
aspectRatio: 1.7777777777777777
backgroundDim: 0.3
```

`extra.json` 只在主谱面没有内嵌特效时作为回退，防止同一特效执行两次。其事件使用谱面的 BPM 表；事件 `line` 表示时间轴所有者，继承该线的 `bpmfactor`，不表示只给该线加滤镜。包内资源按压缩包及谱面目录隔离，切谱后释放 GPU 资源。

RPEN 的 `isCover` 按积分位置加 `yOffset` 整枚剔除音符：普通音符检查中心，Hold 检查尾端，零速音符豁免；不会沿判定线裁切音符贴图。判定线停速时贴线的音符保留完整轮廓，旋转和正反面均适用。此规则独立于普通 RPE/PEC 的现有裁剪路径。

## 噪域

支持 `bottomLeft/topRight`、出现/消失拍、多个激活区间、以秒计的 `readyFlash`、`isInvert`、独立层，以及 XY 位移、旋转、XY 缩放和锚点链。动画按绝对时间计算，可以暂停和倒退；零缩放起点不会引发除零。区域中心按舞台横纵坐标映射，尺寸先沿区域自身轴缩放再旋转，保持非 3:2 画面中的角度和触摸范围。

每层独立生成六位遮罩：激活、未激活/预备、预备三组，各自包含普通覆盖及反转覆盖。普通区域取并集，反转区域仅保留恰好一次覆盖；两块或更多反转区域重合处不贡献反转位。层之间分别合成。

支持包内 GLSL 100 皮肤和 `config.json` v1：多 pass、`r8/rg8/rgba8` 中间纹理、目标缩放、nearest/linear、通道输出（例如 `effects.r`）、命名输入、常量和低性能通道。解析 shader 中的 `%默认值%` 及 `@texture`，按声明处理镜像/重复、过滤、色彩空间和预乘 Alpha。Tokonagi 的 NoiseField 直接执行包内 shader 和贴图，不用普通红色矩形替代。

激活噪域阻挡手动触摸并触发现有音频低通；触摸位置、按下/释放阶段传入皮肤的 `touchCount/touchPoints`。触摸检测依据已投影的区域覆盖，未按 shader 的随机位移轮廓反推像素命中。无皮肤路径的区域使用简化默认材质。

## 特效与输出

顺序为场景 → 非全局 shader → 打击反馈和 HUD → 噪域层 → 全局 shader。实时播放与视频导出共用这些步骤。关闭“后期与异象特效”会关闭 RPEN shader 事件，噪域作为谱面内容继续显示。

内置支持本样本使用的 `glitch`、`vignette`、`fisheye`、`grayscale`，也可在 `shader/` 中提供自定义 GLSL 文件。参数支持常数、向量和缓动事件；未开始的参数保留 shader 默认值。未知内置效果、缺少 shader/纹理或编译失败会明确报错。

当前不覆盖 RPEN 全部扩展：`globalEvents` 摄像机/全局动画会提示；噪域和 shader 的自定义动画曲线会拒绝；高级皮肤 guard-band/padding 尚未接入。解锁视频不作为谱面播放前置流程。普通 RPE 的字体、粒子样式及导出打击音限制仍见 [谱面适配](chart-adapters.md)。

## 验证

以用户提供的 `Tokonagi_SP.zip` 和演示视频验证：39 条线、1170 枚音符、738 个噪域、2 层、29 个特效事件。研究复现脚本为工作区 `research/reproduction/browser/tokonagi-reference.mjs`，输出位于 `research/generated/tokonagi-reference/`；参考源码固定到 rpe-next 的 `1ad96d4a82e3909bcb60cc41e5a250ae08cdd676`。

该验证包含音轨相关对齐、23 组真实并排画面、噪域原始/投影几何对照、重复绘制/倒退一致性、全曲 30 FPS 检查、短视频导出、触摸和换谱资源释放。参考视频的构建版本未知；不将几何对齐或全曲无异常表述为整幅图逐像素等价。
