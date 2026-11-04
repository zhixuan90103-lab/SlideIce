/**
 * Boot: safe-area → device preview → WebGPU design stage.
 * Gameplay lands in src/game/ (docs/GAME.md). This file only starts the stage.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Capacitor } from '@capacitor/core';
import { FRAME_DIST, STAGE_BG, STAGE_BG_CSS, frameDistance, look } from './game/look';
import { mountSlideGame, type SlideGame } from './game/play';
import {
  DESIGN_HEIGHT,
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
import { applyNativeClass, applySafeAreaCssVars } from './adapt/safeArea';
import { createRenderer, resizeToDesign } from './create-renderer';

function mountFps(): (frame: number) => void {
  const root = document.getElementById('ui-root');
  const node = document.createElement('div');
  node.className = 'fps';
  node.textContent = 'FPS --';
  root?.appendChild(node);
  let smooth = 0;
  let shown = -1;
  return (frame: number) => {
    if (frame <= 0) return;
    const fps = 1 / frame;
    smooth = smooth === 0 ? fps : smooth * 0.9 + fps * 0.1;
    const next = Math.round(smooth);
    if (next === shown) return;
    shown = next;
    node.textContent = `FPS ${next}`;
  };
}

function mountLookTune(camera: THREE.PerspectiveCamera, game: SlideGame): void {
  const root = document.getElementById('ui-root');
  if (!root) return;
  const wrap = document.createElement('div');
  wrap.className = 'look-settings';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'settings-toggle';
  toggle.textContent = '设置';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'look-tune');
  const panel = document.createElement('div');
  panel.id = 'look-tune';
  panel.className = 'look-tune';
  panel.hidden = true;
  const rows: [string, string, number, number, number, number][] = [
    ['环境', 'ambient', look.ambient, 0, 2, 0.05],
    ['主光', 'key', look.key, 0, 6, 0.1],
    ['主方位', 'keyAz', look.keyAz, -180, 180, 1],
    ['主仰角', 'keyEl', look.keyEl, 5, 85, 1],
    ['辅光', 'fill', look.fill, 0, 4, 0.1],
    ['辅方位', 'fillAz', look.fillAz, -180, 180, 1],
    ['辅仰角', 'fillEl', look.fillEl, 5, 85, 1],
    ['俯仰', 'pitch', look.pitch, -70, 70, 1],
    ['偏航', 'yaw', look.yaw, -180, 180, 1],
    ['距离', 'dist', look.dist, 400, 2200, 20],
    ['块', 'size', look.size, 30, 90, 1],
    ['圆角', 'corner', look.corner, 2, 24, 1],
    ['棱', 'edge', look.edge, 1, 20, 1],
    ['粗糙', 'roughness', look.roughness, 0, 1, 0.01],
  ];
  for (const [label, key, value, min, max, step] of rows) {
    const field = document.createElement('label');
    const out = document.createElement('output');
    const degrees = key === 'pitch' || key.endsWith('Az') || key.endsWith('El') || key === 'yaw';
    out.textContent = degrees ? `${value}°` : String(value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.dataset.k = key;
    field.append(label, out, input);
    panel.append(field);
  }
  wrap.append(toggle, panel);
  root.appendChild(wrap);
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
  });
  panel.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const value = Number(input.value);
    const out = input.parentElement?.querySelector('output');
    const kind = input.dataset.k;
    if (kind === 'ambient') look.ambient = value;
    else if (kind === 'key') look.key = value;
    else if (kind === 'keyAz') look.keyAz = value;
    else if (kind === 'keyEl') look.keyEl = value;
    else if (kind === 'fill') look.fill = value;
    else if (kind === 'fillAz') look.fillAz = value;
    else if (kind === 'fillEl') look.fillEl = value;
    else if (kind === 'pitch') look.pitch = value;
    else if (kind === 'yaw') look.yaw = value;
    else if (kind === 'dist') look.dist = value;
    else if (kind === 'size') {
      look.size = value;
      look.dist = frameDistance(value);
      const distInput = panel.querySelector<HTMLInputElement>('input[data-k="dist"]');
      const distOut = distInput?.parentElement?.querySelector('output');
      if (distInput) distInput.value = String(look.dist);
      if (distOut) distOut.textContent = String(Math.round(look.dist));
    }
    else if (kind === 'corner') look.corner = value;
    else if (kind === 'edge') look.edge = value;
    else if (kind === 'roughness') look.roughness = value;
    const degrees = kind === 'pitch' || kind === 'yaw' || kind?.endsWith('Az') || kind?.endsWith('El');
    if (out) out.textContent = degrees ? `${value}°` : String(value);
    game.setLights(look.key, look.keyAz, look.keyEl, look.fill, look.fillAz, look.fillEl, look.ambient);
    game.setCube(look.size, look.corner, look.edge);
    game.setRoughness(look.roughness);
    applyCamera(camera);
  });
  wrap.addEventListener('pointerdown', (event) => event.stopPropagation());
}

const boardMid = new THREE.Vector3();

function applyCamera(camera: THREE.PerspectiveCamera): void {
  boardMid.set(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, (look.topZ + 2) / 2);
  const pitch = THREE.MathUtils.degToRad(look.pitch);
  const yaw = THREE.MathUtils.degToRad(look.yaw);
  const reach = Math.sin(pitch) * look.dist;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(DESIGN_HEIGHT / 2 / FRAME_DIST));
  camera.aspect = DESIGN_WIDTH / DESIGN_HEIGHT;
  camera.position.set(
    boardMid.x + Math.sin(yaw) * reach,
    boardMid.y + Math.cos(yaw) * reach,
    boardMid.z + Math.cos(pitch) * look.dist,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(boardMid);
  camera.updateProjectionMatrix();
}

const shell = document.getElementById('shell')!;
const viewportEl = document.getElementById('viewport')!;
const stage = document.getElementById('stage')!;

async function boot(): Promise<void> {
  applyNativeClass();

  const native = Capacitor.isNativePlatform();
  const renderer = await createRenderer({ container: stage });
  const scene = new THREE.Scene();
  document.documentElement.style.setProperty('--stage-bg', STAGE_BG_CSS);
  scene.background = new THREE.Color(STAGE_BG);
  const pmrem = new THREE.PMREMGenerator(renderer as unknown as THREE.WebGLRenderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0;
  pmrem.dispose();

  // Mild perspective. The vertical view at CAMERA_DIST matches the 844 design height.
  // Pitch lifts the camera toward world +y so the screen-down faces show. Hits stay on the design grid.
  const camera = new THREE.PerspectiveCamera(30, DESIGN_WIDTH / DESIGN_HEIGHT, 10, 4000);
  applyCamera(camera);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  let latestLayout: StageLayout | null = null;
  let preview: DevicePreviewController;

  const onLayout = (layout: StageLayout) => {
    latestLayout = layout;
    applyStageTransform(stage, layout);
    applySafeAreaCssVars(native);
    resizeToDesign(renderer);
  };

  let game: SlideGame | null = null;
  let last = performance.now();

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

  const fps = mountFps();
  game = mountSlideGame(scene, stage, () => latestLayout);
  look.topZ = game.setPieceHeight(40);
  look.pitch = -5;
  applyCamera(camera);
  mountLookTune(camera, game);
  game.setLights(look.key, look.keyAz, look.keyEl, look.fill, look.fillAz, look.fillEl, look.ambient);

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const frame = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.05, frame);
    last = now;
    fps(frame);
    game?.update(dt);
    renderer.render(scene, camera);
    game?.renderOverlay(renderer, camera);
  });

  window.addEventListener(
    'pagehide',
    () => {
      unwatch();
      game?.dispose();
      preview.dispose();
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
    { once: true },
  );
}

boot().catch((err) => {
  console.error(err);
});
