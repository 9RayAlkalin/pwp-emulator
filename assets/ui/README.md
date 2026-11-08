# UI 资源

`scenes.json` 保存原场景层级、绑定、动画曲线及 Sprite 裁切数据。纹理使用用途名称：

- `grade-*.png`：结算评级。
- `challenge-*.png`：Challenge Mode 段位颜色。
- `collection-*.png`：Data、头像、曲绘和收藏品档案图标。
- `gameplay-pause-atlas.png`：Gameplay 与暂停共用图集。
- `result-back.png`、`result-retry.png`：结算按钮。
- `special-*.png`：特殊曲目场景图。
- `pause-intro.png`、`score-intro.png`：原有说明图，当前场景未引用。

其余文件沿用可读资源名称。原始 Unity 路径保留在 `scenes.json` 的 `textures` 映射，Sprite 的原始 GUID、源路径和裁切数据仍保留。

工作区的 `research/reproduction/export_ui_scenes.py` 统一维护命名映射，重新生成时使用相同名称。重命名不改变图片内容。
