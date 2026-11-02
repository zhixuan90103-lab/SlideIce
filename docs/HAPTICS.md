# 震动（Haptics）如何一次接对

配套：[AGENTS.md](../AGENTS.md) · [ENGINEERING.md](./ENGINEERING.md) · [AUDIO.md](./AUDIO.md)

> 本壳 **已经带原生插件 + JS 薄封装**，但只验通路，不是玩法层。  
> 以前多次「没接上」，几乎都是 **只 sync、没 bootstrap**，或 **用 `prepare()` 当验收**。  
> 正确接入按 **§0** 做；后面是差异、API、排错。

## 0. 正确接入（照这个做）

震动不是 `cap:sync` 自动带上的。Capacitor 默认 VC **不会**注册本地 `AdvancedHaptics`。必须把 Swift 拷进 `ios/App/App/`，把 storyboard **和 Capacitor 8 的 SceneDelegate** 都换成 `BridgeViewController`。这些只发生在 **`npm run ios:bootstrap`**。

### 0.1 三种场景用哪条命令

| 你刚做了什么 | 命令 | 说明 |
|--------------|------|------|
| 刚 clone / 没有 `ios/` / 第一次真机 | `npm run ios:bootstrap` 再 `cap:open` | add ios + 拷插件 + 改 storyboard / SceneDelegate / pbx + sync |
| 改了 `plugins/native-haptics/*.swift` | **再跑** `ios:bootstrap` | 真源在 plugins；`ios/App/App` 是副本 |
| 只改了 `src/`、`index.html`、CSS | `npm run cap:sync` | 够用；**不会**补注册插件 |

只跑 `npm run ios` / `cap:sync` **不会**修 storyboard 或 SceneDelegate。`ios/` 若是 `cap add ios` 的干净工程，插件一定没挂上。

### 0.2 第一次真机（复制执行）

```bash
npm install
npm run ios:bootstrap
npm run cap:open
```

Xcode：Signing → Team → 选真机 → Run。  
**不要用模拟器当震动验收**（多数无 Taptic Engine）。

### 0.3 接上的充要条件（缺一条就等于没接）

同时满足才算接入成功：

1. `plugins/native-haptics/AdvancedHapticsPlugin.swift` 已复制到 `ios/App/App/`
2. `ios/App/App/BridgeViewController.swift` 存在，且：

```swift
override func capacitorDidLoad() {
    super.capacitorDidLoad()
    bridge?.registerPluginInstance(AdvancedHapticsPlugin())
}
```

3. Capacitor 8 的 `SceneDelegate` 会**绕过 storyboard**。必须是：

```swift
window?.rootViewController = BridgeViewController()
```

不能是 `CAPBridgeViewController()`。只改 storyboard 不够。

4. `ios/App/App/Base.lproj/Main.storyboard` 里入口 VC 是：

```xml
customClass="BridgeViewController" customModule="App"
```

不是 `CAPBridgeViewController`，也不是别的 MainViewController。

5. 这两个 `.swift` 在 Xcode **Compile Sources** 里。
6. JS 只通过 `src/utils/haptics.ts` 调插件；`jsName` / `registerPlugin` / `isPluginAvailable` 三者都是字符串 **`AdvancedHaptics`**。
7. 在 **真机 App** 里点 HUD 的 **impact / transient**，马达有反馈。

### 0.4 真机上怎么确认（控制台）

Safari → 开发 → 你的 iPhone → 该 App。粘贴：

```js
({
  native: window.Capacitor?.isNativePlatform?.(),
  platform: window.Capacitor?.getPlatform?.(),
  plugin: window.Capacitor?.isPluginAvailable?.('AdvancedHaptics'),
})
```

期望：`{ native: true, platform: 'ios', plugin: true }`。

| 实际结果 | 含义 |
|----------|------|
| `native: false` | 你在浏览器里，不是 App |
| `platform: 'ios'` 但 `plugin: false` | **没注册**。先查 `SceneDelegate` 是否仍是 `CAPBridgeViewController()`，再查 storyboard / Compile Sources |
| `plugin: true` | 原生已挂上。再用 impact 验手，不要看 prepare |

Xcode 控制台应出现：`AdvancedHapticsPlugin registered`（`BridgeViewController` 打的）。没有这行 = VC 不是 Bridge，或没进 `capacitorDidLoad`。

### 0.5 玩法代码怎么调（不要重新接一层桥）

```ts
import { haptics } from './utils/haptics';

// 短点击 — UIKit
void haptics.impact('medium');

// 可调强弱 — Core Haptics（插件方法名 stackImpact）
void haptics.playTransient(0.5, 0.4);
void haptics.stackImpact(0.35, 0.15);

// 长震必须成对
void haptics.startContinuous({ intensity: 0.18, sharpness: 0.2 });
void haptics.stopContinuous();
```

禁止：

- 再写一遍 `registerPlugin('AdvancedHaptics')`
- 玩法里 `navigator.vibrate`
- 启动时 `await haptics.prepare()` 并把它的 `ok` 当成「接没接上」（Swift **没有** `prepare`）
- 只改 `ios/App/App/*.swift` 不改 `plugins/native-haptics/`（下次 bootstrap 会被覆盖）

### 0.6 以前没接上：对照表

| 当时的做法 | 实际结果 | 正确做法 |
|------------|----------|----------|
| `cap add ios` 后只 `cap:sync` / `npm run ios` | 默认 VC，插件未 `registerPluginInstance` | **先** `ios:bootstrap` |
| 在 Xcode 里手改 `ios/App/App` 的 Swift | 下次 bootstrap 被 plugins 覆盖；或忘加 Compile Sources | 改 `plugins/native-haptics/` 再 bootstrap |
| 看 HUD「prepare → 失败」以为没接上 | 原生无此方法，engine 其实已在 `load()` 里 | 用 **impact / transient** 验收 |
| 桌面 `npm run dev` 点按钮不震 | 不是 iOS App，`not_native_ios` | 真机 App 测 |
| 自己在业务里 `registerPlugin` | 和封装抢、绕过开关 | 只 import `haptics` |
| storyboard 仍是 `CAPBridgeViewController` | `isPluginAvailable === false` | bootstrap 改 customClass |
| **SceneDelegate 仍是 `CAPBridgeViewController()`**（Capacitor 8 默认） | 绕过 storyboard，插件未注册，HUD `plugin: false`，无震 | `rootViewController = BridgeViewController()`；`ios:bootstrap` 已打补丁 |
| 模拟器 / 静音习惯 | 部分机无震感或很弱 | 真机；系统设置未关系统触感 |

### 0.7 接入完成的定义

同时成立才算「接上」，不要用准备按钮：

- HUD / 控制台 `plugin: true` + Xcode `AdvancedHapticsPlugin registered`
- 真机点 **点我震动**（impact）有一下、点 **轻点 transient** 有一下
- 杀进程再开仍然能震（说明是 `load()` 起的引擎，不是某次侥幸 prepare）

## 1. 和完整玩法工程差在哪

两边原生插件几乎同一套：`AdvancedHaptics`、`CAPBridgedPlugin`、`load()` 里起 `CHHapticEngine`，方法是 `impact` / `playPattern` / `stackImpact` / 连续震 / `setKeepAwake`。

差的是 **JS 怎么用、引擎怎么预热、玩法怎么节流**。

| | 完整玩法工程 | 本壳 |
|--|--------------|------|
| 给玩法的 API | `gameHaptics.buttonTap()` / `pop()` / `stackImpact()` 等 **具名事件** | `haptics.impact()` / `playTransient()` 等 **插件原语** |
| 参数与节流 | `HapticsConfig`：pattern 表、cooldown、碰撞门限 | 无；HUD 按钮直接打桥 |
| 开关 | 存档为唯一真值；所有发声口顶部检查 | 模块内一个 `enabled` 布尔 |
| 插件 JS | 独立 `registerPlugin` + 桌面空实现 | 写在 `src/utils/haptics.ts` 里 |
| `prepare()` | **空操作**。引擎在 Swift `load()` 已起 | Swift **没有** `prepare`；HUD 用 impact 验收，不调 prepare |
| 插件未注册时 | iOS 上静默 return，不假装 web 震 | 走 `navigator.vibrate`，并返回 `ok: false` |
| 热路径错误 | `safelyInvoke` 吞掉，不影响帧 | 打 `[haptics]` warn，demo 还把 reason 画到 HUD |
| 连发 | 每事件 cooldown；`stackImpact` 再节流 | 无 |

本壳 demo 容易让人误判「没接上」的原因：

1. 用 `prepare()` 当验收：原生没有这个方法。引擎在 `plugin.load()` 里已经起来。
2. 只 `cap:sync`、没 `ios:bootstrap`，或 **只改了 storyboard、SceneDelegate 仍是默认 VC** → `plugin: false`。
3. 在桌面点按钮：`not_native_ios` 是正常的，不是接错。
4. 玩法里直接 `registerPlugin` / 自己 `impact`，绕过开关和节流，手感会乱。

## 2. 一次接对：五条硬约定

1. **改 Swift 只改** `plugins/native-haptics/`，然后 **`npm run ios:bootstrap`**。不要只改 `ios/App/App/` 里的副本。
2. **玩法禁止** `registerPlugin('AdvancedHaptics')` 和 `navigator.vibrate`。只走 `src/utils/haptics.ts`（或再包一层 `gameHaptics`）。
3. **不要依赖 JS `prepare()` 当初始化。** 原生 `load()` 已 `initEngine()`。回前台最多再点一次轻 `impact('soft')` 预热 UIKit，不是必须。
4. **先确认插件已注册，再谈手感。** 真机状态应看到 `haptics ios: true`，且 `isPluginAvailable('AdvancedHaptics') === true`。
5. **节奏在游戏层。** 插件只负责「震一下」。cooldown、具名 pattern、开关，仿音效 Catalog，不要塞进 Swift。

## 3. 接线清单（按顺序）

### 3.1 原生（只做一次 / 改插件后重做）

```bash
npm install
npm run ios:bootstrap   # add ios + 拷 Swift + 改 storyboard + 改 pbxproj + cap sync
npm run cap:open
# Xcode：Team → 真机 → Run
```

日常改 TS/CSS 用 `npm run cap:sync` 即可。  
**改了 `plugins/native-haptics/*.swift` 必须再 bootstrap。**

验收原生是否挂上：

| 检查 | 期望 |
|------|------|
| `ios/App/App/AdvancedHapticsPlugin.swift` | 存在，且与 `plugins/native-haptics/` 一致 |
| `ios/App/App/BridgeViewController.swift` | `capacitorDidLoad` 里 `registerPluginInstance(AdvancedHapticsPlugin())` |
| `Main.storyboard` | `customClass="BridgeViewController"`（不是 `CAPBridgeViewController`） |
| Xcode 工程 | 上述两个 `.swift` 在 Compile Sources |
| 真机控制台 | `AdvancedHapticsPlugin registered` |

缺任何一项，JS 里 `Capacitor.isPluginAvailable('AdvancedHaptics')` 都是 `false`。  
`cap add ios` 之后若只 sync、不 bootstrap，**每次都是这个坑。**

### 3.2 JS 通路（本壳已有）

```
玩法 / HUD
    → src/utils/haptics.ts
         registerPlugin('AdvancedHaptics')   // jsName 必须与 Swift 一致
         pluginReady = native iOS && isPluginAvailable
    → Capacitor 桥
    → AdvancedHapticsPlugin
         load() → CHHapticEngine
         impact / notification / selection     → UIKit generator
         stackImpact / playPattern / 连续震    → Core Haptics
```

`jsName` 必须是 **`AdvancedHaptics`**，和 `isPluginAvailable('AdvancedHaptics')` 同一字符串。

### 3.3 玩法层（本壳没有，自己加）

不要在 `main.ts` 里到处 `haptics.impact`。加一层具名事件：

```ts
// 示例：只允许从这里发震
export const gameHaptics = {
  buttonTap() {
    if (!enabled || onCooldown('button', 60)) return;
    void haptics.impact('light');           // 短点击：UIKit
  },
  popSmall() {
    if (!enabled || onCooldown('popSmall', 90)) return;
    void haptics.playPattern([{ type: 'transient', intensity: 0.4, sharpness: 0.3 }]);
  },
  stackImpact(intensity: number) {
    if (!enabled || onCooldown('stack', 90)) return;
    void haptics.stackImpact(intensity, 0.15);
  },
};
```

规则：

- 所有出口先查 **开关**，再查 **cooldown**
- 短系统感：`impact` / `selection`（UIKit）
- 可调强弱、碰撞 patter：`stackImpact` / `playPattern`（Core Haptics）
- 长摩擦：`startContinuous` + `stopContinuous`，离开关卡必须 stop
- 调用 **fire-and-forget**（`void`），不要 `await` 堵逻辑帧
- 与音效并列：`gameHaptics.x()` 旁一行 `audio.playSfx('x')`

强度映射、pattern 表放到 `src/config/HapticsConfig.ts`（或和 Audio Catalog 同级），不要写死在物理循环里。

### 3.4 桌面 vs 真机

| 环境 | 期望 |
|------|------|
| `npm run dev` 桌面 | 无震或仅 `navigator.vibrate`（多数桌面 Chrome 无马达）。日志 `not_native_ios` **正常** |
| 窄窗 / 手机浏览器 | 同上；不要当成插件失败 |
| Capacitor iOS 真机 | 必须走原生；插件不可用时 **不要** 用 web vibrate 假装成功 |

## 4. 原生方法对照（能调什么）

Swift `pluginMethods` **只有这些**。JS 多调一个就会 UNIMPLEMENTED。

| 方法 | 实现 | 用途 |
|------|------|------|
| `impact({ style })` | UIKit `UIImpactFeedbackGenerator` | 按钮、轻点。style: light/medium/heavy/soft/rigid |
| `notification({ type })` | UIKit | success/warning/error |
| `selection()` | UIKit | 选择条 |
| `stackImpact({ intensity, sharpness })` | Core Haptics transient | 碰撞等高频可调强弱 |
| `playPattern({ events, parameterCurves? })` | Core Haptics | 具名复杂节奏 |
| `startContinuousHaptic` / `stopContinuousHaptic` | Core Haptics | 长按 / 摩擦底；stop 会淡出约 50ms |
| `setKeepAwake({ enabled })` | `isIdleTimerDisabled` | **不是震动**，是防锁屏 |

**没有 `prepare`。** 本壳 `haptics.prepare()` 若走到 `AdvancedHaptics.prepare()`，第一次接插件就会在日志里「失败」，引擎其实是好的。

接玩法时：

- 删掉启动时的 `await haptics.prepare()`，或改成仅 `isNativeIos()` 时打一条「engine 由 load() 负责」
- 不要把 `prepare` 的返回值当成「接没接上」

## 5. 常见一次没接上

| 现象 | 原因 | 处理 |
|------|------|------|
| 真机完全不震，`plugin_unavailable` | 没 bootstrap / storyboard 不是 `BridgeViewController` | `npm run ios:bootstrap`，Xcode 确认 customClass |
| 只改了 `ios/App/App/*.swift`，再 bootstrap 被覆盖 | 真源在 `plugins/native-haptics/` | 改真源再 bootstrap |
| HUD 显示 prepare 失败，但 impact 能震 | 原生无 `prepare` | 忽略 prepare；用 impact 验通路 |
| 桌面按钮不震 | 不是 iOS App | 正常 |
| 第一次轻、后面才正常 | UIKit generator 未 prepare；或 engine 刚 start | 可接受；`load()` 已 start engine。不要为此再发明 JS prepare 桥方法，除非 Swift 真加了 |
| 连打卡顿 / 震成一片 | 每事件一次桥且无 cooldown | 玩法层节流，参考音效 Batcher 思路（震动通常不必批桥，但必须 cooldown） |
| 设置关了还在震 | 业务直接调了插件 | 只保留 haptics.ts / gameHaptics 四个出口 |
| 横屏或旋转后丢震 | 本壳锁竖屏；VC 必须是 Bridge | 不要换回默认 VC |

## 6. 和音效一起接

| | 震动 | 音效 |
|--|------|------|
| 热路径 | 一次桥可接受（比音频轻） | **每帧最多一次桥** |
| 必须原生 | iOS 上 Web vibrate 很弱 | iOS **禁止** WebAudio |
| 预热 | Swift `load()` | Loading `preload()` 解码 |
| 配置 | 具名 pattern + cooldown | Catalog：volume / cooldown / priority / maxVoices |

不要把震动和音效塞进同一个 Capacitor 方法。插件分开，玩法并列调用。

## 7. 验收

桌面：

- 点 HUD 不报崩；日志可以是 `not_native_ios`

真机（`ios:bootstrap` 后第一次 Run）：

- 控制台有 `AdvancedHapticsPlugin registered`
- **不要**用 prepare 按钮当验收
- `impact` / `transient`（`stackImpact`）立刻有震感
- 关 App 再开仍能震（engine 随 plugin load）
- 切后台再回前台仍能震（`resetHandler` 会再 start）
- 连续点不会卡帧；加上 cooldown 后不会震糊
