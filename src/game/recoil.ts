/** A short settle after a piece lands on a cell. The anchor stays on that cell. */

/** One nudge along the force, in design pixels. */
export const SETTLE_RECOIL = 1.2
export const SETTLE_SECONDS = 0.22

export type Recoil = {
  sign: number
  axis: 'x' | 'y'
  max: number
  elapsed: number
}

export function beginRecoil(axis: 'x' | 'y', sign: number): Recoil | null {
  if (sign === 0) return null
  return { axis, sign, max: SETTLE_RECOIL, elapsed: 0 }
}

/** Out along the force and back to the cell. No opposite swing. */
export function wobbleOffset(recoil: Recoil): number {
  const t = recoil.elapsed / SETTLE_SECONDS
  if (t <= 0 || t >= 1) return 0
  return recoil.sign * recoil.max * Math.sin(Math.PI * t)
}

export function stepRecoil(recoil: Recoil, dt: number): boolean {
  recoil.elapsed += dt
  return recoil.elapsed >= SETTLE_SECONDS
}
