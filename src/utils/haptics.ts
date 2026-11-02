/**
 * Game-facing haptics bridge (AdvancedHaptics Capacitor plugin).
 * Native iOS: Core Haptics + UIKit fallbacks.
 * Web: navigator.vibrate when available; otherwise soft no-op.
 *
 * True source: plugins/native-haptics/*.swift → npm run ios:bootstrap
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid';
type NotificationType = 'success' | 'warning' | 'error';

export type HapticEvent = {
  type: 'transient' | 'continuous';
  relativeTime?: number;
  duration?: number;
  intensity?: number;
  sharpness?: number;
  attackTime?: number;
  decayTime?: number;
  releaseTime?: number;
};

export type HapticCurve = {
  parameterID: 'hapticIntensity' | 'hapticSharpness';
  relativeTime: number;
  controlPoints: { relativeTime: number; parameterValue: number }[];
};

type AdvancedHapticsPlugin = {
  impact(opts?: { style?: ImpactStyle }): Promise<void>;
  notification(opts?: { type?: NotificationType }): Promise<void>;
  selection(): Promise<void>;
  playPattern(opts: {
    events: HapticEvent[];
    parameterCurves?: HapticCurve[];
  }): Promise<void>;
  stackImpact(opts: { intensity: number; sharpness: number }): Promise<void>;
  startContinuousHaptic(opts: {
    intensity: number;
    sharpness: number;
    duration?: number;
  }): Promise<void>;
  stopContinuousHaptic(): Promise<void>;
  setKeepAwake(opts: { enabled: boolean }): Promise<{ enabled: boolean }>;
  prepare?(): Promise<{ supported?: boolean; fallback?: boolean }>;
};

const AdvancedHaptics = registerPlugin<AdvancedHapticsPlugin>('AdvancedHaptics');

let enabled = true;
let lastError = '';

const isNativeIos = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

const pluginReady = () =>
  isNativeIos() && Capacitor.isPluginAvailable('AdvancedHaptics');

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

async function safely(fn: () => Promise<unknown>): Promise<{ ok: boolean; reason?: string }> {
  if (!enabled) {
    lastError = 'disabled';
    return { ok: false, reason: lastError };
  }
  if (!pluginReady()) {
    lastError = isNativeIos() ? 'plugin_unavailable' : 'not_native_ios';
    return { ok: false, reason: lastError };
  }
  try {
    await fn();
    lastError = '';
    return { ok: true };
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn('[haptics]', lastError);
    return { ok: false, reason: lastError };
  }
}

function vibrateWeb(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

export const haptics = {
  isEnabled: () => enabled,
  setEnabled: (v: boolean) => {
    enabled = v;
  },
  isNativeIos: () => isNativeIos(),
  isPluginAvailable: () => Capacitor.isPluginAvailable('AdvancedHaptics'),
  getLastError: () => lastError,

  async prepare(): Promise<{ ok: boolean; reason?: string; result?: unknown }> {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!pluginReady()) {
      lastError = 'not_native_ios';
      return { ok: false, reason: lastError };
    }
    if (typeof AdvancedHaptics.prepare === 'function') {
      try {
        const result = await AdvancedHaptics.prepare();
        return { ok: true, result };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        return { ok: false, reason: lastError };
      }
    }
    // Warm UIKit path via light impact without strong feedback intent
    return safely(() => AdvancedHaptics.impact({ style: 'soft' }));
  },

  async impact(style: ImpactStyle = 'medium', webMs = 10): Promise<{ ok: boolean; reason?: string }> {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!pluginReady()) {
      vibrateWeb(webMs);
      return { ok: false, reason: 'not_native_ios' };
    }
    return safely(() => AdvancedHaptics.impact({ style }));
  },

  async notification(
    type: NotificationType = 'success',
    webMs = 16,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!pluginReady()) {
      vibrateWeb(webMs);
      return { ok: false, reason: 'not_native_ios' };
    }
    return safely(() => AdvancedHaptics.notification({ type }));
  },

  async selection(webMs = 6): Promise<{ ok: boolean; reason?: string }> {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!pluginReady()) {
      vibrateWeb(webMs);
      return { ok: false, reason: 'not_native_ios' };
    }
    return safely(() => AdvancedHaptics.selection());
  },

  async playTransient(
    intensity = 0.45,
    sharpness = 0.4,
  ): Promise<{ ok: boolean; reason?: string }> {
    return this.stackImpact(intensity, sharpness);
  },

  async stackImpact(
    intensity: number,
    sharpness = 0.15,
    webMs = 8,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!pluginReady()) {
      vibrateWeb(webMs);
      return { ok: false, reason: 'not_native_ios' };
    }
    return safely(() =>
      AdvancedHaptics.stackImpact({
        intensity: clamp01(intensity),
        sharpness: clamp01(sharpness),
      }),
    );
  },

  async playPattern(
    events: HapticEvent[],
    parameterCurves?: HapticCurve[],
    webPattern: number | number[] = 12,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!pluginReady()) {
      vibrateWeb(webPattern);
      return { ok: false, reason: 'not_native_ios' };
    }
    return safely(() =>
      AdvancedHaptics.playPattern(
        parameterCurves ? { events, parameterCurves } : { events },
      ),
    );
  },

  async startContinuous(opts: {
    intensity: number;
    sharpness: number;
    duration?: number;
  }): Promise<{ ok: boolean; reason?: string }> {
    if (!enabled) return { ok: false, reason: 'disabled' };
    if (!pluginReady()) return { ok: false, reason: 'not_native_ios' };
    return safely(() =>
      AdvancedHaptics.startContinuousHaptic({
        intensity: clamp01(opts.intensity),
        sharpness: clamp01(opts.sharpness),
        duration: opts.duration,
      }),
    );
  },

  async stopContinuous(): Promise<{ ok: boolean; reason?: string }> {
    if (!pluginReady()) return { ok: false, reason: 'not_native_ios' };
    return safely(() => AdvancedHaptics.stopContinuousHaptic());
  },

  async setKeepAwake(keep: boolean): Promise<{ ok: boolean; reason?: string }> {
    if (!pluginReady()) {
      // Best-effort web Wake Lock
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
        };
        if (keep && nav.wakeLock) {
          await nav.wakeLock.request('screen');
        }
      } catch {
        /* ignore */
      }
      return { ok: false, reason: 'not_native_ios' };
    }
    return safely(() => AdvancedHaptics.setKeepAwake({ enabled: keep }));
  },
};
