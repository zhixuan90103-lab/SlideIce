# 舞台

当前画面。玩法以 [GAME.md](GAME.md) 为准。改画面以本文为准。

## 模块

| 模块 | 职责 |
|------|------|
| `src/game/level.ts` | 关卡文件的形状。`cols`、`rows`、`dist` 和占格写在 `public/levels/*.json`。 |
| `src/game/levels.ts` | 读关卡。打开第几关只问 `openLevel`。开发时 `writeLevelDist` 只改当前关的 `dist`。 |
| `src/game/look.ts` | 光、相机、块尺寸，以及 `openDistance`、`designToBoard`、`boardToStage`、`viewBottomWorld`。 |
| `src/game/stage.ts` | 纯色背景、光、阴影、浅色格子、挤出体、拿起描边。格子、一格中心是否越出、轮廓偏移也在这里。没有底板，没有墙。 |
| `src/game/play.ts` | 指针、抬起、落格队列。选中后不换块。入口是 `mountSlideGame`。 |
| `src/game/slide.ts` | 一条手指缓冲、锁轴、`grabTarget`、唯一的碰撞扫描 `sweep`、松手的消除、滑出或落格。 |
| `src/game/rock.ts` | 锚点落到格子之后的一次晃动。规则见 [GAME.md](GAME.md) §2.3。 |
| `src/game/hint.ts` | 松手就会脱离时的发亮。不挡操作。 |
| `src/game/shatter.ts` | 离场碎块的尺寸和每格数量。每次 `makeShatter` 新建网格。不挡操作。规则见 [GAME.md](GAME.md) §3。 |
| `src/game/praise.ts` | 离场文字。只往上飘。不挡操作。 |
| `src/game/hapticFeel.ts` | 拿起、撞上、发亮、离场四下短震。参数见 [GAME.md](GAME.md) §2.4。 |
| `src/main.ts` | 启动、透视相机、设置按钮。 |

世界坐标：x 向右，y 向上（等于设计坐标的 −y），z 朝向镜头。棋盘中心在设计画面中心。

## 画面

- 背景是纯色 `#f6ead8`，定义在 `look.ts` 的 `STAGE_BG`。场景和画布底色都用它。
- 曝光 1.1。没有环境贴图。WebGPU 不能编 `ShaderMaterial`，所以不用 `PMREMGenerator`。
- 半球光强度 1.1，天空 `#fff8f2`，地面 `#f3d7be`。设置里的「环境」调的是这盏光。
- 主光白，强度 1.3，方位 −30°，仰角 80°。辅光 `#ffe4cc`，强度 0.28，方位 −101°，仰角 57°。方位 0° 从画面上方来，正值偏向 +x。仰角 0° 贴地，90° 从 +z 来。
- 阴影是软阴影，贴图 2048，半径 6，bias −0.0008，normalBias 0.04。背景色不接阴影。`ShadowMaterial` 比画面每边多出 400，不透明度 0.4，放在 z = −40。阴影相机各向 900，块挪出屏幕一段后影子仍完整。块的影子落在这张面上。
- 透视相机。俯仰 −5°，偏航 0°，看向画面中心，目标高度是 `look.topZ`（40）。视野固定为距离 1200 时刚好包住 844 设计高的那一档。

## 镜头

距离只由 `look.ts` 的 `openDistance` 决定。关卡文件有 `dist` 就用它，范围 400–4000。没有则用 `frameDistance`：左右留白跟 5 列棋盘贴在 390 宽上剩下的边一样，上下留白 96 设计像素。比这更大的棋盘才后退，更小的不放大，格子不超过 5 列那一档。

换关调用 `openDistance`。开发时设置里拖「距离」只改画面；松手才由 `writeLevelDist` 写回这一关。Vite 不监视 `public/levels`，写入不刷新页面。编辑器的「镜头」是同一个字段，保存后生效。

棋盘坐标和舞台像素只通过 `designToBoard` 与 `boardToStage`。碎块要落到 `viewBottomWorld` 以下才消失。表扬文字先换到舞台像素再摆放。

设置按钮在 `#ui-root` 里，默认收起。面板里是上面这些光和相机，加上块尺寸、圆角、棱、粗糙度。

## 棋盘

没有底板。格子是一块平面，铺在画面中心。宽是当前关的 `cols` 格，高是 `rows` 格。格 64、缝 4。格内是暖棕 `rgba(150, 110, 72, 0.14)`，缝是空的，透出背景。缝保持 4，不随块的尺寸拉伸。

没有墙。块只被别的块挡住，四个方向都能滑出棋盘。怎么停见 [GAME.md](GAME.md) §2。

## 方块

占格和颜色见当前关卡文件，调色板见 [GAME.md](GAME.md) §4。粗糙度 0.59，金属度 0.02。没有环境贴图。同一块内部不留缝，块与块之间的缝是 4。凸角按圆角倒，凹角保持尖。

每块是一条闭合轮廓的 `ExtrudeGeometry`。默认边长 60，圆角 16，棱 4。底面贴在 z = −7。倒角在上下两端，厚度是棱。块身和描边的偏移都走 `offsetClosed`：块身向内收，描边向外扩，凸角再倒圆，凹角保持尖。挤出后最宽处回到边长。锚点是逻辑位置。落到格子后的晃动只转这块网格，不挪锚点。规则见 [GAME.md](GAME.md) §2.3。

拿起时的外轮廓描边挂在块上，规则见 [GAME.md](GAME.md) §2.1。

设置里的「块 / 圆角 / 棱」同时改全部方块。
