/**
 * WebGPU renderer sized to DESIGN_* (not the browser window).
 * No silent WebGL fallback — fail early and visibly.
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from './adapt/design';

export function showFatal(title: string, message: string): void {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
      <div style="max-width:640px;border:1px solid rgba(148,163,184,.28);border-radius:16px;padding:20px;background:rgba(15,23,42,.8);line-height:1.6;">
        <div style="font-size:20px;font-weight:700;margin-bottom:10px;">${title}</div>
        <div style="white-space:pre-wrap;opacity:.95;">${message}</div>
        <div style="margin-top:12px;font-size:12px;opacity:.7;white-space:pre-wrap;">isSecureContext: ${window.isSecureContext}\nnavigator.gpu: ${!!navigator.gpu}</div>
      </div>
    </div>
  `;
}

export type CreateRendererOptions = {
  antialias?: boolean;
  container?: HTMLElement | null;
  maxPixelRatio?: number;
};

export async function createRenderer(
  options: CreateRendererOptions = {},
): Promise<WebGPURenderer> {
  const { antialias = true, container, maxPixelRatio = 2 } = options;

  if (!navigator.gpu) {
    showFatal(
      'WebGPU 不可用',
      '当前环境没有 navigator.gpu。\n请用支持 WebGPU 的桌面 Chrome / Safari，或较新的 iOS Safari / 真机 App。',
    );
    throw new Error('WebGPU unavailable');
  }

  const host =
    container || document.getElementById('stage') || document.body;
  const renderer = new WebGPURenderer({
    antialias,
    powerPreference: 'high-performance',
  });

  try {
    await renderer.init();
  } catch (err) {
    showFatal('WebGPU 初始化失败', err instanceof Error ? err.message : String(err));
    throw err;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.setSize(DESIGN_WIDTH, DESIGN_HEIGHT, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.1;

  const canvas = renderer.domElement;
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '0';
  canvas.style.outline = 'none';
  canvas.style.pointerEvents = 'none';

  const uiRoot = document.getElementById('ui-root');
  if (uiRoot && host.contains(uiRoot)) {
    host.insertBefore(canvas, uiRoot);
  } else {
    host.appendChild(canvas);
  }

  return renderer;
}

/** Keep renderer + camera at design resolution (CSS scale handles display). */
export function resizeToDesign(
  renderer: WebGPURenderer,
  camera?: THREE.PerspectiveCamera,
): { width: number; height: number } {
  renderer.setSize(DESIGN_WIDTH, DESIGN_HEIGHT, false);
  if (camera) {
    camera.aspect = DESIGN_WIDTH / DESIGN_HEIGHT;
    camera.updateProjectionMatrix();
  }
  return { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
}
