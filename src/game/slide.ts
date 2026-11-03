/**
 * Finger follow. The pressed point tracks a smoothed finger.
 * A real move arrives on the finger. Motion smaller than the jitter band is eased.
 * A fast swipe locks one axis for the latest segment. Collision stops at the first contact and does not tunnel.
 */

import { CELL } from './look'
import { boardRect, nearestCellCenter, type StagePiece } from './stage'

export type AxisStep = {
  axis: 'x' | 'y'
  amount: number
  moved: number
  blocked: boolean
}

/** Phone-tuning starts. A step inside this band is eased instead of copied. */
const JITTER_PX = 6
const JITTER_BLEND = 0.4
/** Speed over the recent window, after the stroke is at least this long. */
export const FAST_SPEED = 2200
export const FAST_WINDOW = 0.08
export const FAST_SPAN = 0.05
export const FAST_MIN = 28
/** Share of the stroke that must point along an open exit before that exit wins. */
const TREND = 0.6

export type Finger = { x: number; y: number }

export function seedFinger(x: number, y: number): Finger {
  return { x, y }
}

/** Design-pixel finger. A step of JITTER_PX or more is copied. A smaller step is blended. */
export function easeFinger(finger: Finger, x: number, y: number): { x: number; y: number } {
  const dx = x - finger.x
  const dy = y - finger.y
  const dist = Math.hypot(dx, dy)
  const gain = dist >= JITTER_PX ? 1 : JITTER_BLEND
  const stepX = dx * gain
  const stepY = dy * gain
  finger.x += stepX
  finger.y += stepY
  return { x: stepX, y: stepY }
}

export function followFinger(piece: StagePiece, dx: number, dy: number, pieces: readonly StagePiece[]): AxisStep[] {
  if (dx === 0 && dy === 0) return []
  const others = pieces.filter((item) => item !== piece && item.alive)
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const primaryAxis = horizontal ? 'x' : 'y'
  const secondaryAxis = horizontal ? 'y' : 'x'
  const primaryAmount = horizontal ? dx : dy
  const secondaryAmount = horizontal ? dy : dx
  const primary = moveAxis(piece, primaryAxis, primaryAmount, others)
  if (!primary.blocked) {
    return [primary, moveAxis(piece, secondaryAxis, secondaryAmount, others)]
  }
  const fraction = primary.amount === 0 ? 0 : primary.moved / primary.amount
  const approach = secondaryAmount * fraction
  const approached = moveAxis(piece, secondaryAxis, approach, others)
  const remain = secondaryAmount - approach
  if (approached.blocked || remain === 0) {
    return [primary, { axis: secondaryAxis, amount: secondaryAmount, moved: approached.moved, blocked: approached.blocked }]
  }
  const slid = moveAxis(piece, secondaryAxis, remain, others)
  return [primary, { axis: secondaryAxis, amount: secondaryAmount, moved: approached.moved + slid.moved, blocked: slid.blocked }]
}

export type AxisLock = { axis: 'x' | 'y'; sign: number }

/** Longer axis of this segment, unless the segment trends along an open exit. */
export function chooseFastAxis(piece: StagePiece, strokeX: number, strokeY: number, pieces: readonly StagePiece[]): AxisLock {
  const longer: AxisLock =
    Math.abs(strokeX) >= Math.abs(strokeY) ? { axis: 'x', sign: Math.sign(strokeX) || 1 } : { axis: 'y', sign: Math.sign(strokeY) || 1 }
  const length = Math.hypot(strokeX, strokeY)
  if (length === 0) return longer
  let best: AxisLock | null = null
  let bestAlong = 0
  for (const candidate of unlockAxes(piece, pieces)) {
    const along = candidate.axis === 'x' ? strokeX * candidate.sign : strokeY * candidate.sign
    if (along > bestAlong) {
      bestAlong = along
      best = candidate
    }
  }
  if (best && bestAlong >= length * TREND) return best
  return longer
}

/**
 * Nearest on-lattice pose that does not overlap another piece.
 * Same Manhattan distance: smaller column offset, then smaller row offset.
 * Nothing within 12 cells leaves the piece where it is.
 */
export function gridSnap(piece: StagePiece, pieces: readonly StagePiece[]): { x: number; y: number } {
  const local = piece.locals[0]
  const ax = piece.anchor.position.x
  const ay = piece.anchor.position.y
  if (!local) return { x: ax, y: ay }
  const cell = nearestCellCenter(ax + local.x, ay + local.y)
  const baseX = cell.x - local.x
  const baseY = cell.y - local.y
  const others = pieces.filter((item) => item !== piece && item.alive)
  for (let distance = 0; distance <= 12; distance++) {
    for (let dc = -distance; dc <= distance; dc++) {
      for (let dr = -distance; dr <= distance; dr++) {
        if (Math.abs(dc) + Math.abs(dr) !== distance) continue
        const x = baseX + dc * CELL
        const y = baseY - dr * CELL
        if (!cellsOnBoard(piece, x, y) || overlaps(piece, x, y, others)) continue
        return { x, y }
      }
    }
  }
  return { x: ax, y: ay }
}

/**
 * The piece is already past the board edge, and the rest of that exit is clear.
 * A piece still fully on the board cannot leave yet. One that would stop half out cannot either.
 */
export function canLeave(piece: StagePiece, pieces: readonly StagePiece[], x = piece.anchor.position.x, y = piece.anchor.position.y): boolean {
  if (outsideFraction(piece, x, y) <= 0) return false
  const others = pieces.filter((item) => item !== piece && item.alive)
  for (const side of crossedSides(piece, x, y)) {
    const dist = exitDistance(piece, x, y, side)
    if (dist <= 0.01) return true
    const dx = side.axis === 'x' ? side.sign * dist : 0
    const dy = side.axis === 'y' ? side.sign * dist : 0
    if (sweepStop(piece, x, y, dx, dy, others) >= 1) return true
  }
  return false
}

/** Share of the visible cubes that lies outside the current board. Gaps are not area. */
export function outsideFraction(piece: StagePiece, x = piece.anchor.position.x, y = piece.anchor.position.y): number {
  const board = boardRect()
  const side = piece.half * 2
  if (side <= 0 || piece.locals.length === 0) return 0
  let outside = 0
  for (const local of piece.locals) {
    const left = x + local.x - piece.half
    const right = x + local.x + piece.half
    const bottom = y + local.y - piece.half
    const top = y + local.y + piece.half
    const width = overlap(left, right, board.minX, board.maxX)
    const height = overlap(bottom, top, board.minY, board.maxY)
    outside += side * side - width * height
  }
  return outside / (piece.locals.length * side * side)
}

function unlockAxes(piece: StagePiece, pieces: readonly StagePiece[]): AxisLock[] {
  const others = pieces.filter((item) => item !== piece && item.alive)
  const found: AxisLock[] = []
  for (const candidate of [
    { axis: 'x' as const, sign: 1 },
    { axis: 'x' as const, sign: -1 },
    { axis: 'y' as const, sign: 1 },
    { axis: 'y' as const, sign: -1 },
  ]) {
    const ox = piece.anchor.position.x
    const oy = piece.anchor.position.y
    const dist = exitDistance(piece, ox, oy, candidate)
    const dx = candidate.axis === 'x' ? candidate.sign * dist : 0
    const dy = candidate.axis === 'y' ? candidate.sign * dist : 0
    if (dist <= 0.01 || sweepStop(piece, ox, oy, dx, dy, others) >= 1) found.push(candidate)
  }
  return found
}

function moveAxis(piece: StagePiece, axis: 'x' | 'y', amount: number, others: readonly StagePiece[]): AxisStep {
  if (amount === 0) return { axis, amount: 0, moved: 0, blocked: false }
  const dx = axis === 'x' ? amount : 0
  const dy = axis === 'y' ? amount : 0
  const ox = piece.anchor.position.x
  const oy = piece.anchor.position.y
  if (overlaps(piece, ox, oy, others)) return { axis, amount, moved: 0, blocked: false }
  const stop = sweepStop(piece, ox, oy, dx, dy, others)
  if (stop >= 1) {
    piece.anchor.position.x = ox + dx
    piece.anchor.position.y = oy + dy
    return { axis, amount, moved: amount, blocked: false }
  }
  const t = Math.max(0, stop - 1e-4)
  piece.anchor.position.x = ox + dx * t
  piece.anchor.position.y = oy + dy * t
  return { axis, amount, moved: amount * t, blocked: true }
}

function sweepStop(
  piece: StagePiece,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  others: readonly StagePiece[],
): number {
  let stop = 1
  for (const other of others) {
    const limit = piece.half + other.half
    for (const a of piece.locals) {
      const ax = ox + a.x
      const ay = oy + a.y
      for (const b of other.locals) {
        const bx = other.anchor.position.x + b.x
        const by = other.anchor.position.y + b.y
        const rel = dx !== 0 ? ax - bx : ay - by
        const delta = dx !== 0 ? dx : dy
        const perp = dx !== 0 ? ay - by : ax - bx
        if (delta === 0 || Math.abs(perp) >= limit) continue
        const enter = Math.min((-limit - rel) / delta, (limit - rel) / delta)
        const exit = Math.max((-limit - rel) / delta, (limit - rel) / delta)
        if (exit <= 0 || enter >= stop) continue
        if (enter < stop) stop = Math.max(0, enter)
      }
    }
  }
  return stop
}

function overlaps(piece: StagePiece, x: number, y: number, others: readonly StagePiece[]): boolean {
  for (const other of others) {
    const limit = piece.half + other.half
    for (const a of piece.locals) {
      for (const b of other.locals) {
        const cx = x + a.x - (other.anchor.position.x + b.x)
        const cy = y + a.y - (other.anchor.position.y + b.y)
        if (Math.abs(cx) < limit && Math.abs(cy) < limit) return true
      }
    }
  }
  return false
}

function cellsOnBoard(piece: StagePiece, x: number, y: number): boolean {
  const board = boardRect()
  const count = Math.round((board.maxX - board.minX) / CELL)
  for (const local of piece.locals) {
    const col = Math.round((x + local.x - board.minX) / CELL - 0.5)
    const row = Math.round((board.maxY - (y + local.y)) / CELL - 0.5)
    if (col < 0 || row < 0 || col >= count || row >= count) return false
  }
  return true
}

function crossedSides(piece: StagePiece, x: number, y: number): AxisLock[] {
  const board = boardRect()
  const sides: AxisLock[] = []
  let east = false
  let west = false
  let north = false
  let south = false
  for (const local of piece.locals) {
    const left = x + local.x - piece.half
    const right = x + local.x + piece.half
    const bottom = y + local.y - piece.half
    const top = y + local.y + piece.half
    if (right > board.maxX) east = true
    if (left < board.minX) west = true
    if (top > board.maxY) north = true
    if (bottom < board.minY) south = true
  }
  if (east) sides.push({ axis: 'x', sign: 1 })
  if (west) sides.push({ axis: 'x', sign: -1 })
  if (north) sides.push({ axis: 'y', sign: 1 })
  if (south) sides.push({ axis: 'y', sign: -1 })
  return sides
}

/** Distance along a signed axis until every visible cube is past that edge. */
function exitDistance(piece: StagePiece, x: number, y: number, side: AxisLock): number {
  const board = boardRect()
  let need = 0
  for (const local of piece.locals) {
    const cx = x + local.x
    const cy = y + local.y
    if (side.axis === 'x' && side.sign > 0) need = Math.max(need, board.maxX - (cx - piece.half))
    if (side.axis === 'x' && side.sign < 0) need = Math.max(need, cx + piece.half - board.minX)
    if (side.axis === 'y' && side.sign > 0) need = Math.max(need, board.maxY - (cy - piece.half))
    if (side.axis === 'y' && side.sign < 0) need = Math.max(need, cy + piece.half - board.minY)
  }
  return need
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

export function pieceAt(x: number, y: number, pieces: readonly StagePiece[]): StagePiece | null {
  const wy = -y
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]
    if (!piece.alive) continue
    for (const local of piece.locals) {
      const cx = piece.anchor.position.x + local.x
      const cy = piece.anchor.position.y + local.y
      if (Math.abs(x - cx) <= piece.half && Math.abs(wy - cy) <= piece.half) return piece
    }
  }
  return null
}
