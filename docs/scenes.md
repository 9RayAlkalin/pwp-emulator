# Canvas 场景流程

选中谱面并点击 `加载` 时只准备音频、谱面和曲绘资源，Canvas stage 保持隐藏。点击 `开始` 后才绘制选曲 StartInfos 的 loading 场景，保持 1.5 秒，再按导出的 `StartInfoFadeOut` 曲线滑出并启动 gameplay。设置中的 `跳过加载动画` 会直接进入 gameplay。

暂停、继续、重试、返回和结算按钮都由原始 Unity 场景的 Canvas 几何命中。继续使用原始 3 秒倒计时；结算使用原始 `LevelOvarAnimation` 入场曲线。结算的同步和 collection 是本地 fake 状态，达到 A 档分数后显示本地 collection，不发起网络请求。

玩家名称、Player ID、头像、RKS、Challenge Mode 数值与颜色、名称显示开关在 HTML 设置中编辑；Result 右上角的玩家栏和所有场景画面仍由 Canvas 绘制。历史最佳分数保存在浏览器 `localStorage` 的 `pwp.records`，记录键使用谱面资源路径。
