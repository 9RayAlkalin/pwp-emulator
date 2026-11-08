# 资源目录

| 目录 | 内容 |
| --- | --- |
| `audio/` | Tap、Drag、Flick 打击音 |
| `avatars/` | Resource_Auto 导出的完整头像，保留原文件名；开发启动和构建时自动生成 `index.json` |
| `backgrounds/` | 原版预模糊背景和谱面映射 |
| `builtin/s6/` | 随项目提供的 True Home, True World 谱面 |
| `effects/` | 异象轨道与专用贴图 |
| `fonts/` | HUD 和场景字体 |
| `gameplay/notes/` | 普通、多押、Bad 音符贴图 |
| `gameplay/hit-effects/` | 打击序列图与资源包参数 |
| `gameplay/blocks/` | 方块、噪声与接触反馈贴图 |
| `hud/` | 暂停/进度图标和字距数据 |
| `library/` | 导入谱面、音乐和曲绘；About The Universe 保留在这里 |
| `shaders/` | WebGL 着色器 |
| `ui/` | 原始 Unity UI 层级、曲线及引用的 Sprite 纹理 |

`tips.txt` 每个非空行是一条 loading 提示，按原文绘制到 Canvas。每次开始随机选择一条。

补充头像时直接加入 `avatars/`，无需修改 HTML 下拉框；设置按文件名保存头像。第三方图片、音乐、谱面和字体版权归各自所有者。
