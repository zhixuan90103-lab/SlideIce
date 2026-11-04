/** Visual refusal only. The anchor stays on the contact. */

/** First peak, in design pixels. Matches a Ring bar's invalid wobble. */
export const HIT_RECOIL = 3

/** Three trips. Each later peak is about 60% of the previous one. */
export const WOBBLE_CYCLES = 3
export const WOBBLE_SECONDS = 0.42

export type Recoil = {
  sign: number
  /** 1 along world x, or world y. */
  axis: 'x' | 'y'
  max: number
  elapsed: number
}

export function beginRecoil(axis: 'x' | 'y', sign: number): Recoil | null {
  if (sign === 0) return null
  return { axis, sign, max: HIT_RECOIL, elapsed: 0 }
}

/** Each later peak is smaller. The first peak stays at `max`. */
export function wobbleOffset(recoil: Recoil): number {
  const t = recoil.elapsed
  if (t <= 0 || t >= WOBBLE_SECONDS) return 0
  const period = WOBBLE_SECONDS / WOBBLE_CYCLES
  const firstCrest = period / 4
  const decay = Math.exp(-3.6 * (t - firstCrest))
  return recoil.sign * recoil.max * Math.sin((Math.PI * 2 * t) / period) * decay
}

export function stepRecoil(recoil: Recoil, dt: number): boolean {
  recoil.elapsed += dt
  return recoil.elapsed >= WOBBLE_SECONDS
}
