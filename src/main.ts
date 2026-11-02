/**
 * Boot: safe-area → device preview → WebGPU design stage → minimal demo.
 * Replace this file (or add src/game/*) for real gameplay.
 * Keep: adapt/*, create-renderer, utils/haptics, DOM contract.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Capacitor } from '@capacitor/core';
import {
  DESIGN_HEIGHT,
  DESIGN_SAFE,
  DESIGN_WIDTH,
  applyStageTransform,
  computeStageLayout,
  watchStageLayout,
  type StageLayout,
} from './adapt/design';
import {
  mountDevicePreview,
  type DevicePreviewController,
} from './adapt/devicePreview';
import { applyNativeClass, applySafeAreaCssVars, readSafeAreaInsets } from './adapt/safeArea';
import { createRenderer, resizeToDesign } from './create-renderer';
import { haptics } from './utils/haptics';

const shell = document.getElementById('shell')!;
const viewportEl = document.getElementById('viewport')!;
const stage = document.getElementById('stage')!;
const statusEl = document.getElementById('status');
const logEl = document.getElementById('haptic-log');

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function setLog(text: string): void {
  if (logEl) logEl.textContent = text;
}

async function boot(): Promise<void> {
  applyNativeClass();

  const platform = Capacitor.getPlatform();
  const native = Capacitor.isNativePlatform();

  setStatus(
    `platform: ${platform} | native: ${native}\n` +
      `design: ${DESIGN_WIDTH}×${DESIGN_HEIGHT}\n` +
      `creating WebGPU…`,
  );

  const renderer = await createRenderer({ container: stage });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);

  const camera = new THREE.PerspectiveCamera(
    45,
    DESIGN_WIDTH / DESIGN_HEIGHT,
    0.1,
    100,
  );
  camera.position.set(2.2, 1.6, 2.8);

  scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 2);
  scene.add(key);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x7c3aed,
      metalness: 0.15,
      roughness: 0.35,
    }),
  );
  scene.add(mesh);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 64),
    new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.05,
      roughness: 0.9,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  scene.add(floor);

  const controls = new OrbitControls(camera, renderer.domElement);
  // Canvas is pointer-events:none so HUD stays clickable; enable on stage for orbit
  renderer.domElement.style.pointerEvents = 'auto';
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  let latestLayout: StageLayout | null = null;
  let preview: DevicePreviewController;

  const onLayout = (layout: StageLayout) => {
    latestLayout = layout;
    applyStageTransform(stage, layout);
    applySafeAreaCssVars(native);
    resizeToDesign(renderer, camera);

    const safe = readSafeAreaInsets();
    setStatus(
      `WebGPU OK\n` +
        `platform: ${platform} | native: ${native}\n` +
        `haptics ios: ${haptics.isNativeIos()} · plugin: ${haptics.isPluginAvailable()}\n` +
        `design: ${DESIGN_WIDTH}×${DESIGN_HEIGHT} · scale ${layout.scale.toFixed(3)}\n` +
        `view: ${Math.round(layout.viewWidth)}×${Math.round(layout.viewHeight)}\n` +
        `safe: T${Math.round(safe.top)} R${Math.round(safe.right)} B${Math.round(safe.bottom)} L${Math.round(safe.left)}` +
        (native ? '' : ` · desktop sim (${DESIGN_SAFE.top}/${DESIGN_SAFE.bottom})`),
    );
  };

  preview = mountDevicePreview(shell, viewportEl, () => {
    const size = preview.getViewSize();
    onLayout(computeStageLayout(size.width, size.height, 'contain'));
  });

  const unwatch = watchStageLayout(onLayout, {
    mode: 'contain',
    getViewSize: () => preview.getViewSize(),
  });

  if (new URLSearchParams(window.location.search).has('debugFit')) {
    const log = () => {
      if (latestLayout) {
        console.info('[debugFit]', latestLayout, preview.getDevice());
      }
    };
    window.addEventListener('resize', log);
    log();
  }

  // Optional: document.body.classList.add('debug-safe-area')

  renderer.setAnimationLoop(() => {
    mesh.rotation.y += 0.01;
    mesh.rotation.x += 0.004;
    controls.update();
    renderer.render(scene, camera);
  });

  if (haptics.isNativeIos()) {
    setLog(
      `native iOS · plugin=${haptics.isPluginAvailable()}\n` +
        (haptics.isPluginAvailable()
          ? '点「点我震动」应有马达反馈。'
          : '插件未注册：SceneDelegate 必须用 BridgeViewController。'),
    );
  } else {
    setLog(
      '当前不是 iOS App，点按钮不会有原生震动。\n' +
        '请 npm run ios:bootstrap → Xcode 选真机 Run。',
    );
  }

  document.querySelectorAll<HTMLElement>('[data-haptic]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-haptic');
      let result: unknown;
      switch (action) {
        case 'prepare':
          result = await haptics.prepare();
          break;
        case 'tap':
          result = await haptics.playTransient(0.55, 0.5);
          break;
        case 'impact':
          result = await haptics.impact('medium');
          break;
        case 'start':
          result = await haptics.startContinuous({
            intensity: 0.18,
            sharpness: 0.22,
          });
          break;
        case 'stop':
          result = await haptics.stopContinuous();
          break;
        default:
          result = { ok: false, reason: 'unknown' };
      }
      setLog(`${action} → ${JSON.stringify(result)}`);
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && haptics.isNativeIos()) {
      void haptics.prepare();
    }
  });

  window.addEventListener(
    'pagehide',
    () => {
      unwatch();
      preview.dispose();
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
    { once: true },
  );
}

boot().catch((err) => {
  console.error(err);
  setStatus(`boot failed: ${err instanceof Error ? err.message : String(err)}`);
});
