/**
 * Safe-area CSS variables for #hud.
 * Desktop: DESIGN_SAFE simulation (Dynamic Island / home indicator).
 * Native: clear inline overrides so CSS env(safe-area-inset-*) wins.
 */

import { DESIGN_SAFE } from './design';
import { isNativeApp } from './devicePreview';

export type SafeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function applyNativeClass(): boolean {
  const native = isNativeApp();
  document.documentElement.classList.toggle('native-app', native);
  document.body.classList.toggle('native-app', native);
  applySafeAreaCssVars(native);
  return native;
}

export function applySafeAreaCssVars(native = isNativeApp()): SafeInsets {
  const root = document.documentElement;
  if (!native) {
    root.style.setProperty('--safe-top', `${DESIGN_SAFE.top}px`);
    root.style.setProperty('--safe-right', `${DESIGN_SAFE.right}px`);
    root.style.setProperty('--safe-bottom', `${DESIGN_SAFE.bottom}px`);
    root.style.setProperty('--safe-left', `${DESIGN_SAFE.left}px`);
    return { ...DESIGN_SAFE };
  }

  root.style.removeProperty('--safe-top');
  root.style.removeProperty('--safe-right');
  root.style.removeProperty('--safe-bottom');
  root.style.removeProperty('--safe-left');
  return readSafeAreaInsets();
}

export function readSafeAreaInsets(): SafeInsets {
  const cs = getComputedStyle(document.documentElement);
  const parse = (name: string, fallback: number) => {
    const raw = cs.getPropertyValue(name).trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    top: parse('--safe-top', DESIGN_SAFE.top),
    right: parse('--safe-right', DESIGN_SAFE.right),
    bottom: parse('--safe-bottom', DESIGN_SAFE.bottom),
    left: parse('--safe-left', DESIGN_SAFE.left),
  };
}
