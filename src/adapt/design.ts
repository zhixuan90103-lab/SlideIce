/**
 * Fixed portrait design space (CSS logical px).
 * UI / touch logic always think in 0…DESIGN_WIDTH × 0…DESIGN_HEIGHT.
 * Display uses contain (or cover) scale + letterbox on the outer viewport.
 */

export const DESIGN_WIDTH = 390;
export const DESIGN_HEIGHT = 844;
export const DESIGN_ASPECT = DESIGN_WIDTH / DESIGN_HEIGHT;

/** Desktop-simulated safe areas (iPhone Pro-ish Dynamic Island + home indicator). */
export const DESIGN_SAFE = {
  top: 59,
  right: 0,
  bottom: 34,
  left: 0,
} as const;

export type StageLayout = {
  designWidth: number;
  designHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  viewWidth: number;
  viewHeight: number;
};

export type FitMode = 'contain' | 'cover';

export function computeStageLayout(
  viewWidth = window.innerWidth,
  viewHeight = window.innerHeight,
  mode: FitMode = 'contain',
  designWidth = DESIGN_WIDTH,
  designHeight = DESIGN_HEIGHT,
): StageLayout {
  const sx = viewWidth / designWidth;
  const sy = viewHeight / designHeight;
  const scale = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const drawnW = designWidth * scale;
  const drawnH = designHeight * scale;
  return {
    designWidth,
    designHeight,
    scale,
    offsetX: (viewWidth - drawnW) / 2,
    offsetY: (viewHeight - drawnH) / 2,
    viewWidth,
    viewHeight,
  };
}

/** Apply design size + transform scale to #stage. */
export function applyStageTransform(stage: HTMLElement, layout: StageLayout): void {
  stage.style.width = `${layout.designWidth}px`;
  stage.style.height = `${layout.designHeight}px`;
  stage.style.transformOrigin = 'top left';
  stage.style.transform = `translate(${layout.offsetX}px, ${layout.offsetY}px) scale(${layout.scale})`;
}

export type WatchStageLayoutOptions = {
  mode?: FitMode;
  getViewSize?: () => { width: number; height: number };
};

export function watchStageLayout(
  onLayout: (layout: StageLayout) => void,
  modeOrOptions: FitMode | WatchStageLayoutOptions = 'contain',
): () => void {
  const options: WatchStageLayoutOptions =
    typeof modeOrOptions === 'string' ? { mode: modeOrOptions } : modeOrOptions;
  const mode = options.mode ?? 'contain';

  const update = () => {
    let w: number;
    let h: number;
    if (options.getViewSize) {
      const size = options.getViewSize();
      w = size.width;
      h = size.height;
    } else {
      const vv = window.visualViewport;
      w = vv?.width ?? window.innerWidth;
      h = vv?.height ?? window.innerHeight;
    }
    onLayout(computeStageLayout(w, h, mode));
  };

  update();
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);

  return () => {
    window.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('scroll', update);
  };
}

/**
 * Screen client coords → design coords.
 * Points outside [0, designW]×[0, designH] are letterbox — ignore for gameplay.
 */
export function clientToDesign(
  clientX: number,
  clientY: number,
  layout: StageLayout,
  stageOriginX = 0,
  stageOriginY = 0,
): { x: number; y: number } {
  return {
    x: (clientX - stageOriginX - layout.offsetX) / layout.scale,
    y: (clientY - stageOriginY - layout.offsetY) / layout.scale,
  };
}

export function isInDesignBounds(
  x: number,
  y: number,
  designWidth = DESIGN_WIDTH,
  designHeight = DESIGN_HEIGHT,
): boolean {
  return x >= 0 && y >= 0 && x <= designWidth && y <= designHeight;
}
