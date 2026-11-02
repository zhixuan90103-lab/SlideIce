# 双工程优点整理与合并决策

## 1. 来源

| 工程 | 路径 | 角色 |
|------|------|------|
| **niantu** | `Threejs_Work/niantu` | 适配算法、TS、Phone/Pad 预览 |
| **three-webgpu-cap-shell** | `Project_基础/three-webgpu-cap-shell` | 打包硬约定、安全区、bootstrap、demo |

## 2. 各家优点（保留理由）

### niantu

| 优点 | 为何稳健 |
|------|----------|
| 固定 **390×844** 设计空间 | 手游布局/触控心智统一 |
| `#stage` + contain scale | Pad letterbox 不拉满 UI |
| Phone / Pad 桌面预览 | 开发期可验双设备 |
| `clientToDesign` | 点击映射正确 |
| TypeScript strict | 中大型玩法可维护 |
| AdvancedHaptics 宽 API | impact / pattern / keepAwake 等 |

### three-webgpu-cap-shell

| 优点 | 为何稳健 |
|------|----------|
| **`base: './'`** | 避免 Capacitor 白屏 |
| `contentInset: never` + 关滚动 | 无双重 Safe Area / 橡皮筋 |
| `--safe-*` + HUD padding | 灵动岛 / Home 条 |
| `ios:bootstrap` + 插件真源 | 可重复注入原生 |
| 紫立方体 + 震动按钮 | 30 秒验收环境 |
| 分层文档 | AI/人/入口链清晰 |

## 3. 本底座采用

```
适配内核     ← niantu (design + devicePreview)
安全区/HUD   ← shell (safeArea + CSS)
打包路径     ← shell (base ./)
渲染契约     ← 两者 (WebGPU fail-fast + DESIGN size)
震动         ← niantu API + shell 真源/bootstrap 流程
语言/构建    ← TS + Vite + Cap 8 + Three 0.178
验收 demo    ← shell 风格最小场景
```

## 4. 明确放弃 / 不默认

| 项 | 说明 |
|----|------|
| shell 的 393×852 CSS 手机框量像素渲染 | 改用设计分辨率固定 setSize |
| niantu 未设 base 的默认 Vite | 已修正 |
| WebGL 静默回退 | 两边都不做 |
| 具体玩法 | 底座保持可替换 demo |
