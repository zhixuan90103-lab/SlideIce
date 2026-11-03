/**
 * Boot: safe-area → device preview → WebGPU design stage.
 * Gameplay lands in src/game/ (docs/GAME.md). This file only starts the stage.
 */

import * as THREE from 'three';
import { Capacitor } from '@capacitor/core';
import { mountWoodGame, type WoodGame } from './game/play';
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

const BASE_H = 14;
const SIDE_PX = 4;
const TE9 = SIDE_PX / (BASE_H * (DESIGN_HEIGHT / 2));

const look = {
  topZ: 42,
  pitch: 15,
};

/** Shear stays fixed, so a taller block shows a longer side. Pitch is extra. */
function installSideShear(camera: THREE.OrthographicCamera): void {
  const update = camera.updateProjectionMatrix.bind(camera);
  const center = new THREE.Vector3(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, 0);
  camera.updateProjectionMatrix = () => {
    update();
    center.z = look.topZ;
    camera.updateMatrixWorld();
    const zView = center.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const e = camera.projectionMatrix.elements;
    e[9] = TE9;
    e[13] -= TE9 * zView;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
}

function mountLookTune(camera: THREE.OrthographicCamera, game: WoodGame): void {
  const root = document.getElementById('ui-root');
  if (!root) return;
  const panel = document.createElement('div');
  panel.className = 'look-tune';
  panel.innerHTML =
    '<label>块高 <output>40</output><input type="range" min="4" max="48" step="1" value="40" data-k="h" /></label>' +
    '<label>俯仰 <output>15°</output><input type="range" min="-30" max="30" step="1" value="15" data-k="p" /></label>';
  root.appendChild(panel);
  const outs = panel.querySelectorAll('output');
  const heightOut = outs[0];
  const pitchOut = outs[1];
  panel.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const value = Number(input.value);
    if (input.dataset.k === 'h') {
      look.topZ = game.setPieceHeight(value);
      if (heightOut) heightOut.textContent = String(value);
    } else {
      look.pitch = value;
      if (pitchOut) pitchOut.textContent = `${value}°`;
    }
    applyCamera(camera);
  });
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
}

const boardMid = new THREE.Vector3();

function applyCamera(camera: THREE.OrthographicCamera): void {
  camera.position.set(0, 0, 800);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.rotateX(THREE.MathUtils.degToRad(look.pitch));
  camera.updateProjectionMatrix();
  boardMid.set(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, (look.topZ + 2) / 2);
  const ndc = boardMid.clone().applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  camera.translateY(ndc.y * (DESIGN_HEIGHT / 2));
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
  scene.background = new THREE.Color(0x0b1020);

  // Frustum is design space: x 0…390, y 0…-844. See docs/GAME.md §4.
  // Shear drops the piece side 4px and keeps the top plane z=16 on the design grid.
  const camera = new THREE.OrthographicCamera(0, DESIGN_WIDTH, 0, -DESIGN_HEIGHT, 0.1, 2000);
  camera.position.set(0, 0, 800);
  camera.lookAt(0, 0, 0);
  installSideShear(camera);
  applyCamera(camera);

  let latestLayout: StageLayout | null = null;
  let preview: DevicePreviewController;

  const onLayout = (layout: StageLayout) => {
    latestLayout = layout;
    applyStageTransform(stage, layout);
    applySafeAreaCssVars(native);
    resizeToDesign(renderer);
  };

  let game: WoodGame | null = null;
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

  game = mountWoodGame(scene, stage, () => latestLayout);
  look.topZ = game.setPieceHeight(40);
  look.pitch = 15;
  applyCamera(camera);
  mountLookTune(camera, game);

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game?.update(dt);
    renderer.render(scene, camera);
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
