# AdvancedHaptics（iOS）

本底座震动插件真源。运行时副本在 `ios/App/App/`。

改插件后执行：

```bash
npm run ios:bootstrap
```

## 注册

Capacitor 8：**SceneDelegate** 创建 `BridgeViewController()`（不能是默认 `CAPBridgeViewController()`，否则绕过 storyboard）。

`BridgeViewController.capacitorDidLoad` → `registerPluginInstance(AdvancedHapticsPlugin)`。

`ios:bootstrap` 会同时改 storyboard 和 SceneDelegate。

正确接入步骤：[docs/HAPTICS.md §0](../../docs/HAPTICS.md)。  
Swift **没有** `prepare`；`load()` 已起引擎。首次 / 改 Swift 必须 `ios:bootstrap`，只 `cap:sync` 不会注册插件。

## JS

请用 `src/utils/haptics.ts`：

```ts
import { haptics } from '../../src/utils/haptics';

await haptics.impact('medium');
await haptics.playTransient(0.5, 0.4);
await haptics.startContinuous({ intensity: 0.15, sharpness: 0.2 });
await haptics.stopContinuous();
await haptics.setKeepAwake(true);
```
