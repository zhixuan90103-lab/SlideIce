/**
 * Desktop-only phone / pad portrait viewport frames.
 * Native Capacitor: full-screen viewport, no switcher.
 * Design space stays 390×844; preview only changes outer logical view size.
 */

export type PreviewDeviceId = 'phone' | 'pad';

export type PreviewDevice = {
  id: PreviewDeviceId;
  label: string;
  width: number;
  height: number;
};

export const PHONE_DEVICE: PreviewDevice = {
  id: 'phone',
  label: '手机竖屏',
  width: 390,
  height: 844,
};

export const PAD_DEVICE: PreviewDevice = {
  id: 'pad',
  label: 'Pad 竖屏',
  width: 768,
  height: 1024,
};

export const PREVIEW_DEVICES: Record<PreviewDeviceId, PreviewDevice> = {
  phone: PHONE_DEVICE,
  pad: PAD_DEVICE,
};

const STORAGE_KEY = 'portrait-webgpu-base.previewDevice';

export function isNativeApp(): boolean {
  try {
    const cap = (
      window as unknown as {
        Capacitor?: { isNativePlatform?: () => boolean };
      }
    ).Capacitor;
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function shouldUseDevicePreview(): boolean {
  if (isNativeApp()) return false;
  const q = new URLSearchParams(window.location.search).get('preview');
  if (q === '0' || q === 'false') return false;
  if (q === '1' || q === 'true') return true;
  if (window.innerWidth <= 500) return false;
  return true;
}

export function loadPreviewDeviceId(): PreviewDeviceId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'phone' || raw === 'pad') return raw;
  } catch {
    /* ignore */
  }
  return 'phone';
}

export function savePreviewDeviceId(id: PreviewDeviceId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export type DevicePreviewController = {
  getDevice: () => PreviewDevice;
  setDevice: (id: PreviewDeviceId) => void;
  getViewSize: () => { width: number; height: number };
  dispose: () => void;
};

export function mountDevicePreview(
  shell: HTMLElement,
  viewport: HTMLElement,
  onViewChange: () => void,
): DevicePreviewController {
  const switcher = document.getElementById('device-switcher');
  const labelEl = document.getElementById('device-label');
  let usePreview = shouldUseDevicePreview();
  let deviceId: PreviewDeviceId = loadPreviewDeviceId();

  const notify = () => {
    queueMicrotask(onViewChange);
  };

  const applyFrame = () => {
    usePreview = shouldUseDevicePreview();

    if (!usePreview) {
      shell.classList.remove('preview');
      shell.classList.add(isNativeApp() ? 'native' : 'fill');
      viewport.style.width = '100%';
      viewport.style.height = '100%';
      viewport.style.transform = '';
      viewport.style.margin = '';
      if (switcher) switcher.classList.remove('visible');
      if (labelEl) labelEl.classList.remove('visible');
      notify();
      return;
    }

    shell.classList.add('preview');
    shell.classList.remove('native', 'fill');

    const device = PREVIEW_DEVICES[deviceId];
    const pad = 48;
    const maxW = Math.max(120, window.innerWidth - pad * 2);
    const maxH = Math.max(120, window.innerHeight - pad * 2);
    const fit = Math.min(1, maxW / device.width, maxH / device.height);

    viewport.style.width = `${device.width}px`;
    viewport.style.height = `${device.height}px`;
    viewport.style.transformOrigin = 'center center';
    viewport.style.transform = fit < 1 ? `scale(${fit})` : '';

    if (fit < 1) {
      const dw = device.width * (1 - fit);
      const dh = device.height * (1 - fit);
      viewport.style.margin = `${-dh / 2}px ${-dw / 2}px`;
    } else {
      viewport.style.margin = '0';
    }

    if (switcher) {
      switcher.classList.add('visible');
      switcher.querySelectorAll('button[data-device]').forEach((btn) => {
        const el = btn as HTMLButtonElement;
        el.classList.toggle('active', el.dataset.device === deviceId);
      });
    }
    if (labelEl) {
      labelEl.classList.add('visible');
      const showW = Math.round(device.width * fit);
      const showH = Math.round(device.height * fit);
      labelEl.textContent = `${device.label} · 逻辑 ${device.width}×${device.height} · 显示 ${showW}×${showH}`;
    }

    notify();
  };

  const onClick = (ev: Event) => {
    const t = ev.target as HTMLElement | null;
    const btn = t?.closest?.('button[data-device]') as HTMLButtonElement | null;
    if (!btn?.dataset.device) return;
    const id = btn.dataset.device as PreviewDeviceId;
    if (id !== 'phone' && id !== 'pad') return;
    deviceId = id;
    savePreviewDeviceId(id);
    applyFrame();
  };

  switcher?.addEventListener('click', onClick);
  window.addEventListener('resize', applyFrame);
  applyFrame();

  return {
    getDevice: () => PREVIEW_DEVICES[deviceId],
    setDevice: (id) => {
      deviceId = id;
      savePreviewDeviceId(id);
      applyFrame();
    },
    getViewSize: () => {
      if (!usePreview) {
        const vv = window.visualViewport;
        return {
          width: vv?.width ?? window.innerWidth,
          height: vv?.height ?? window.innerHeight,
        };
      }
      const device = PREVIEW_DEVICES[deviceId];
      return { width: device.width, height: device.height };
    },
    dispose: () => {
      switcher?.removeEventListener('click', onClick);
      window.removeEventListener('resize', applyFrame);
    },
  };
}
