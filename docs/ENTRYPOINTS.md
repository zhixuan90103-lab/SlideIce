# 入口与调用链

## 1. 命令

| 命令 | 结果 |
|------|------|
| `npm run dev` | http://127.0.0.1:5193/ |
| `npm run build` | `tsc` 检查 + `dist/`（相对路径） |
| `npm run cap:sync` | build + cap sync ios |
| `npm run ios:bootstrap` | add ios + 拷插件 + 改 storyboard **和 SceneDelegate** + pbx + sync |
| `npm run ios` | sync + open Xcode |

## 2. Web 启动链

```
index.html
  → style.css
  → main.ts
       → applyNativeClass / safeArea
       → createRenderer(#stage)
       → 透视相机（俯仰 −5°，距离见 STAGE.md）
       → mountDevicePreview → computeStageLayout → applyStageTransform
       → watchStageLayout
       → mountSlideGame（src/game/，规则见 GAME.md）
       → #ui-root：FPS、收起的设置
```

第一关在拿起、撞上、发亮和离场时调用 `pulseHaptic`，参数见 [GAME.md §2.4](./GAME.md)。页面上没有震动按钮。插件注册见 [HAPTICS.md](./HAPTICS.md)。

## 3. DOM

```
#shell
  #viewport
    #app
      #stage
        canvas
        #ui-root
#device-switcher / #device-label   (web only)
```

## 4. iOS

震动插件 **不会**随 `cap:sync` 自动注册。第一次 / 改插件必须 `ios:bootstrap`。步骤见 [HAPTICS.md §0](./HAPTICS.md)。

```
ios:bootstrap
  → 拷 plugins/native-haptics → ios/App/App
  → Main.storyboard customClass = BridgeViewController
  → SceneDelegate.rootViewController = BridgeViewController()   ← Capacitor 8 必改
Xcode Run 真机
  → SceneDelegate 创建 BridgeViewController
  → capacitorDidLoad → registerPluginInstance(AdvancedHapticsPlugin)
  → load App/public (= dist)
  → 同上 Web 链
```

插件是否进 JS，以 [HAPTICS.md §0](./HAPTICS.md) 的控制台检查为准。玩法验收是真机上拿起一块有一下短震。`SceneDelegate` 仍是默认 `CAPBridgeViewController` 时，插件不会注册。

## 5. 改配置找谁

| 要改 | 文件 |
|------|------|
| base / 端口 | `vite.config.ts` |
| appId | `capacitor.config.ts` |
| 设计分辨率 | `design.ts` + `style.css` |
| 震动原生 | `plugins/native-haptics/*.swift` + bootstrap |
| 玩法 | `src/game/`，规则 [GAME.md](./GAME.md) |
| 设置面板、FPS | `src/main.ts` 挂到 `#ui-root` |
| 音效（规划） | [AUDIO.md](./AUDIO.md) |
| 震动接线 | [HAPTICS.md](./HAPTICS.md) |
