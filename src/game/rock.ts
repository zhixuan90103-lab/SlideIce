/**
 * One damped rock after the anchor is on a cell.
 * The mesh stays flat while the piece is still traveling.
 * Up drops the lower edge. Right drops the left edge.
 */

/** Visible peak when the release travel is at least one cell. */
export const ROCK_DEGREES = 6
export const ROCK_SECONDS = 0.2

export type Rock = {
  axis: 'x' | 'y'
  /** Slide direction in world space. */
  sign: number
  /** Release travel divided by one cell, at most 1. */
  gain: number
  /** False until the anchor has reached the cell. */
  seated: boolean
  elapsed: number
}

export function beginRock(
  axis: 'x' | 'y',
  sign: number,
  distance: number,
  cell: number,
): Rock | null {
  if (sign === 0 || cell <= 0) return null
  const gain = Math.min(1, distance / cell)
  if (gain <= 0) return null
  return { axis, sign, gain, seated: false, elapsed: 0 }
}

/** Signed mesh tilt. Peaks at gain × ROCK_DEGREES, then returns to flat. */
export function rockAngle(rock: Rock): number {
  if (!rock.seated || rock.elapsed >= ROCK_SECONDS || rock.elapsed <= 0) return 0
  const u = rock.elapsed / ROCK_SECONDS
  const peak = (rock.gain * ROCK_DEGREES * Math.PI) / 180
  return (peak / 0.75) * Math.sin(Math.PI * 2 * u) * (1 - u)
}

/** Rotation that drops the edge facing back toward the board. */
export function rockRotation(rock: Rock): { x: number; y: number } {
  const angle = rockAngle(rock)
  if (rock.axis === 'x') return { x: 0, y: -rock.sign * angle }
  return { x: rock.sign * angle, y: 0 }
}

/** True once the seated rock has finished. */
export function stepRock(rock: Rock, dt: number): boolean {
  if (!rock.seated) return false
  rock.elapsed += dt
  return rock.elapsed >= ROCK_SECONDS
}
