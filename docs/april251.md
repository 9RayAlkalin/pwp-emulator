# 2.5.1 愚人节研究曲包

本地 APK 提取完成后，曲库会自动列出 25 张可玩谱面：Random 的 7 版本 × EZ/HD/IN，以及雪降 EZ/HD/IN 和隐藏 SP。曲包位于 `assets/builtin/april251/`，也可以直接导入其中的 `.zepc` 文件。

雪降 EZ/HD/IN 游玩时，点击右下角难度/温度文字显示遥控器；按电源开机，再按 MODE 切换到雪花图标的 Cooling 模式。减温键有 1/3 概率反向变化，操作间隔 0.3 秒。Cooling 可降至 0°C，蓝色转场 7 秒后自动载入隐藏 SP；40°C 会触发红色过热结束。其余模式最低 16°C。自动演奏时也能操作遥控器。

隐藏 SP 会伪装计分总数、切换难度标签与音频频谱进度，并在后段显示判定颜文字。实际判定统计继续保留，伪装仅覆盖游玩显示。

Yukifuri 的频谱进度已补齐 APK 原引擎的 2.5 倍幅度和逐频点钳制，修正此前 SP 演出进度条偏短的问题。刷新页面后重新加载即可生效，已有曲包无需重新导入或打包。

可修改的 Lua 在 `assets/scripts/april251/`：`superhot.lua`、`yukifuri.lua`、`particles.lua`。工作区的 `research/reproduction/april_fools_251.py package` 会将修改后的脚本重新打入本地曲包；刷新页面后加载即可。

完整提取命令、APK 指纹、原生 RVA 和证据见工作区 `research/reproduction/README.md`、`research/notes/april-fools-2.5.1.md`。原 APK、导出大资源和生成曲包不提交版本控制。原机的帧调度、频谱幅度和三维粒子仍需校准；离线视频不会重放遥控器交互或混入循环音效。
