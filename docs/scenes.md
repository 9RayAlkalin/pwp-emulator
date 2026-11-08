# Canvas 场景流程

选中谱面并点击 `加载` 时只准备音频、谱面和曲绘资源，Canvas stage 保持隐藏。点击 `开始` 后才绘制选曲 StartInfos 的 loading 场景，从首帧绘制完成起保持 1.5 秒，按导出的 `StartInfoFadeOut` 曲线滑出，再播放 gameplay 判定线展开及 HUD 开场，随后启动音乐。设置中的 `跳过加载动画` 只跳过 loading 界面及其离场，仍播放 gameplay 的判定线展开、HUD 进场，并在 1.5 秒后启动音乐。暂停和结算的重试也保留 gameplay 进场。

暂停、继续、重试、返回和结算按钮都由原始 Unity 场景的 Canvas 几何命中。继续使用原始 3 秒倒计时；结算使用原始 `LevelOvarAnimation` 入场曲线。结算的同步和 collection 是本地 fake 状态，达到 A 档分数后显示本地 collection，不发起网络请求。

Fake sync 在结算后 2 秒展开同步条，播放原始 `SyncShow` 和三枚斜块的 `Sync` 闪动。原生 0.5 秒准备等待后，本地模拟响应再保持一个闪动周期，随后播放 `SyncSuccess`：闪白、显示“已同步”、收拢并消失。每次结算重新计时，动画不依赖网络或残留定时器。

曲绘裁切使用原始平行四边形路径；图片覆盖遮罩时不重复填充白色遮罩底色，避免抗锯齿边缘露出白线。

暂停按钮的阴影按各自图标的透明轮廓生成和挖空，保留柔和光晕；阴影缓存按 Sprite 区分，避免产生矩形方框。

曲终先播放 gameplay HUD 退场，保留背景并等待原生 3.5 秒结束门槛，再进入结算。半透明面板的阴影使用原始 TrueShadow 参数及四角采样模糊。原机资源加载时间和浏览器字体栅格化仍可能产生差异；当前 99.9% 整图 RGB 验收尚未通过。

玩家名称、Player ID、头像、RKS、Challenge Mode 数值与颜色、名称显示开关在 HTML 设置中编辑；Result 右上角的玩家栏和所有场景画面仍由 Canvas 绘制。历史最佳分数保存在浏览器 `localStorage` 的 `pwp.records`，记录键使用谱面资源路径。

头像列表自动读取 `assets/avatars/index.json`，开发启动和构建会从头像文件生成索引。Loading 从 `assets/tips.txt` 每个非空行中随机选一条提示；更新文件后刷新页面即可生效。
