# 打击特效

手动、Autoplay 和离线视频导出共用 `src/render/hits.ts` 的渲染器。`src/gameplay/hits.ts` 只定义事件与调度，不依赖 Canvas 或 UI；`src/render/particles.ts` 负责粒子采样。命中只决定事件的时间、位置和判定颜色，切换模式不会替换成另一种特效。Perfect 使用金色序列帧和粒子，Good 使用蓝色；Bad/Miss 不产生成功命中的粒子。

散射粒子使用 Phigros 4.0.1.2 的 `perfect.prefab` / `good.prefab` 参数和 ARM64 `libunity.so` 中恢复的算法：最多4/3颗、100颗/秒、单颗寿命0.5秒、初速度15–35、圆环半径0.16–0.2、基础尺寸0.3。四路xorshift随机数按批次推进，初速度从粒子ID派生；按旧年龄计算阻力，显式扣减速度并钳零，再用新速度更新位置。运行缩放为 `1.35*noteScale`。粒子是居中的正方形，不附加旋转。

当前使用固定60Hz参考时间表预计算粒子，再插值显示，保证重复跳转及导出稳定。原版受实际帧时间、发射批次和全局随机种子影响，因此仍不能声明原生逐帧或逐像素等价。参数按每次命中固定，Hold的每个脉冲使用独立种子；命中位置取触发时刻，已发射粒子不跟随判定线。

Hold手动路径现按实际帧累加游戏时间，达到 `30/bpm-0.00001` 发一次并清零，不补历史脉冲；尾前0.22秒完成判分后，反馈仍持续到真实尾端。离手保留原生按帧容错。Autoplay/导出使用显式60Hz参考帧表，随音乐速率重建。

手动成功反馈和Bad残影以独立游玩时钟计龄，暂停时冻结。主反馈sprite尺寸按 `2.56*1.35/10*viewportHeight*noteScale` 换算，窄于16:9时使用原生屏幕适配比例。Bad使用原旧Tap素材、红色残影和25/60秒Hermite淡出；Miss普通头部越线淡出，Miss Hold保留alpha=.45的体/尾。

参考实现为工作区 `research/reproduction/particle_reference.py`（仅Python标准库），完整原生地址和限制见 `research/notes/original-particle-algorithm.md`。TypeScript与独立参考的随机数、速度和运动采样有回归对照，测试位于 `tests/gameplay/` 和 `tests/render/`。浏览器的模式像素一致性只证明本端路径统一；不作为原机一致性证据。
