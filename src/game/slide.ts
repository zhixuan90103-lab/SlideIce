/**
 * One-axis drag in design space.
 * world x = design x, world y = -design y.
 * A press selects without moving. Past the dead zone, one axis locks.
 * Travel on that axis drops the dead zone once, so the piece does not jump.
 * Block contact is one sweep. The board edge is asked through stage.ts.
 */

import { CELL } from './look'
import {
  centerPastEdge,
  exitDistance,
  nearestCellCenter,
  poseOnBoard,
  type StagePiece,
} from './stage'

/** Design-space radius. Inside it the selected piece does not move. */
export const DRAG_DEAD = 8
/** Dead zone for a fresh axis after the piece returns home without a clear cross move. */
export const RELATCH_DEAD = 4
/** Back inside half a cell of the press pose counts as home. */
export const HOME_BAND = CELL / 2
/** The longer axis must beat the other by this much before it locks. */
export const AXIS_RATIO = 1.5
/** Release still slides out only while the recent window is at least this fast. */
export const FAST_SPEED = 900
export const FAST_WINDOW = 0.08

export type Finger = { x: number; y: number }

export type FingerSample = { t: number; x: number; y: number }

export function seedFinger(x: number, y: number): Finger {
  return { x, y }
}

const samplePool: FingerSample[] = []

function takeSample(t: number, x: number, y: number): FingerSample {
  const sample = samplePool.pop()
  if (sample) {
    sample.t = t
    sample.x = x
    sample.y = y
    return sample
  }
  return { t, x, y }
}

const TREND_SPAN = 16

function polylineFrom(samples: readonly FingerSample[], start: number): number {
  let dist = 0
  for (let i = start + 1; i < samples.length; i++) {
    const here = samples[i]
    const prev = samples[i - 1]
    if (!here || !prev) break
    dist += Math.hypot(here.x - prev.x, here.y - prev.y)
  }
  return dist
}

/**
 * One buffer for the gesture.
 * Drops points only after both the 0.08s speed window and the 16px trend span still fit.
 */
export function rememberFinger(samples: FingerSample[], t: number, x: number, y: number): void {
  const prev = samples[samples.length - 1]
  if (prev && t <= prev.t) {
    prev.x = x
    prev.y = y
    return
  }
  samples.push(takeSample(t, x, y))
  while (samples.length > 2 && t - samples[0].t > FAST_WINDOW && polylineFrom(samples, 1) >= TREND_SPAN) {
    const old = samples.shift()
    if (old) samplePool.push(old)
  }
}

/** Return every sample in the gesture window to the pool. */
export function releaseFinger(samples: FingerSample[]): void {
  for (let i = 0; i < samples.length; i++) samplePool.push(samples[i])
  samples.length = 0
}

function othersOf(pieces: readonly StagePiece[], piece: StagePiece): StagePiece[] {
  const others: StagePiece[] = []
  for (let i = 0; i < pieces.length; i++) {
    const item = pieces[i]
    if (item !== piece && item.alive) others.push(item)
  }
  return others
}

export type AxisLock = { axis: 'x' | 'y'; sign: number }

/**
 * Axis from the press point. Design +x is world +x. Design +y (down) is world -y.
 * Null while the point is inside the dead zone or still too diagonal.
 */
export function lockAxis(
  designDx: number,
  worldDy: number,
  dead = DRAG_DEAD,
  ratio = AXIS_RATIO,
): AxisLock | null {
  const ax = Math.abs(designDx)
  const ay = Math.abs(worldDy)
  if (Math.hypot(ax, ay) < dead) return null
  if (ax >= ay * ratio) return { axis: 'x', sign: Math.sign(designDx) || 1 }
  if (ay >= ax * ratio) return { axis: 'y', sign: Math.sign(worldDy) || 1 }
  return null
}

/**
 * Axis of the recent finger chord, once it is longer than the locked axis
 * and past the short dead zone. Earlier motion in the stroke is not included.
 */
export function recentAxis(samples: readonly FingerSample[], locked: 'x' | 'y'): AxisLock | null {
  const last = samples[samples.length - 1]
  if (!last) return null
  let dist = 0
  let index = samples.length - 1
  while (index > 0 && dist < TREND_SPAN) {
    const here = samples[index]
    const prev = samples[index - 1]
    if (!here || !prev) break
    dist += Math.hypot(here.x - prev.x, here.y - prev.y)
    index -= 1
  }
  const from = samples[index]
  if (!from) return null
  const dx = last.x - from.x
  const dy = -(last.y - from.y)
  const along = Math.abs(locked === 'x' ? dx : dy)
  const cross = locked === 'x' ? dy : dx
  const crossAbs = Math.abs(cross)
  if (crossAbs < RELATCH_DEAD || crossAbs <= along) return null
  return { axis: locked === 'x' ? 'y' : 'x', sign: Math.sign(cross) || 1 }
}

type Sweep = { t: number; piece: StagePiece | null }

/**
 * First contact along one axis. `t` is 0 at the start pose and 1 at the end of (dx, dy).
 * The other axis must be 0. `piece` is the block that caused the earliest hit.
 */
function sweep(
  piece: StagePiece,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  others: readonly StagePiece[],
): Sweep {
  let t = 1
  let hit: StagePiece | null = null
  if (dx === 0 && dy === 0) return { t: 1, piece: null }
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
        if (exit <= 0 || enter >= t) continue
        if (enter < t) {
          t = Math.max(0, enter)
          hit = other
        }
      }
    }
  }
  return { t, piece: hit }
}

function alongScore(piece: StagePiece, side: AxisLock): number {
  const value = side.axis === 'x' ? piece.anchor.position.x : piece.anchor.position.y
  return value * side.sign
}

/**
 * Piece to take when the finger is not holding one.
 * A held piece is never replaced here; it stays until the finger lifts.
 * Several pieces under the finger: the one furthest along the trend.
 * `skip` rejects pieces that are already landing.
 */
export function grabTarget(
  pieces: readonly StagePiece[],
  trend: AxisLock | null,
  x: number,
  y: number,
  skip: (piece: StagePiece) => boolean,
): StagePiece | null {
  const hits: StagePiece[] = []
  for (const piece of pieces) {
    if (!piece.alive || skip(piece)) continue
    if (coversPiece(piece, x, y)) hits.push(piece)
  }
  if (hits.length === 0) return null
  if (!trend || hits.length === 1) return hits[0] ?? null
  let best = hits[0]
  if (!best) return null
  let score = alongScore(best, trend)
  for (const piece of hits) {
    const value = alongScore(piece, trend)
    if (value > score) {
      best = piece
      score = value
    }
  }
  return best ?? null
}

/** Distance past the dead zone. Inside it, travel is 0. */
function axisTravel(delta: number, dead: number): number {
  const sign = Math.sign(delta)
  if (sign === 0 || Math.abs(delta) <= dead) return 0
  return delta - sign * dead
}

export type HoldMove = { axis: AxisLock | null; blocked: boolean }

/**
 * Hold the press pose until one axis locks. Then slide only on that axis, from the press pose,
 * with the dead zone removed. A blocked step stops at the contact.
 * `blocked` is true only when this step tried to travel and another piece stopped it.
 */
export function followHold(
  piece: StagePiece | null,
  pieces: readonly StagePiece[],
  finger: Finger,
  pressX: number,
  pressY: number,
  originX: number,
  originY: number,
  grabX: number,
  grabY: number,
  fromPress: boolean,
  samples: readonly FingerSample[],
  trend: AxisLock | null,
): HoldMove {
  const last = samples[samples.length - 1]
  if (!last) return { axis: trend, blocked: false }
  finger.x = last.x
  finger.y = last.y
  const dx = last.x - pressX
  const dy = -(last.y - pressY)
  let axis = trend
  if (!axis) {
    axis = lockAxis(dx, dy)
    if (!axis) return { axis: null, blocked: false }
  } else if (fromPress) {
    const delta = axis.axis === 'x' ? dx : dy
    if (Math.abs(delta) > DRAG_DEAD) axis = { axis: axis.axis, sign: Math.sign(delta) || axis.sign }
  } else {
    const along = axis.axis === 'x' ? last.x - grabX : -(last.y - grabY)
    if (along !== 0) axis = { axis: axis.axis, sign: Math.sign(along) || axis.sign }
  }
  if (!piece) return { axis, blocked: false }
  const travel = fromPress
    ? axis.axis === 'x'
      ? axisTravel(dx, DRAG_DEAD)
      : axisTravel(dy, DRAG_DEAD)
    : axis.axis === 'x'
      ? last.x - grabX
      : -(last.y - grabY)
  const goalX = axis.axis === 'x' ? originX + travel : originX
  const goalY = axis.axis === 'y' ? originY + travel : originY
  const others = othersOf(pieces, piece)
  const pushX = goalX - piece.anchor.position.x
  const pushY = goalY - piece.anchor.position.y
  const hitX = moveAxis(piece, 'x', pushX, others)
  const hitY = moveAxis(piece, 'y', pushY, others)
  return { axis, blocked: hitX || hitY }
}

/** Speed along `axis` inside the recent time window. The cross-axis part is not included. */
export function windowSpeed(samples: readonly FingerSample[], axis: 'x' | 'y' | null): number {
  const last = samples[samples.length - 1]
  if (!last || !axis) return 0
  let first = last
  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i]
    if (!sample) break
    if (last.t - sample.t > FAST_WINDOW) break
    first = sample
  }
  if (last.t <= first.t) return 0
  const along = axis === 'x' ? last.x - first.x : -(last.y - first.y)
  return Math.abs(along) / (last.t - first.t)
}

export type ReleasePlan =
  | { kind: 'eliminate' }
  | { kind: 'slide'; x: number; y: number; clear: boolean; speed: number }
  | { kind: 'snap' }

/**
 * A cube center past the board on the locked axis eliminates when that exit is clear.
 * Still on the board: slide out only while the recent window is fast on that axis.
 * Anything else returns to a cell.
 */
export function planRelease(
  piece: StagePiece,
  pieces: readonly StagePiece[],
  trend: AxisLock | null,
  samples: readonly FingerSample[],
): ReleasePlan {
  if (trend && canLeave(piece, pieces, trend)) return { kind: 'eliminate' }
  const speed = windowSpeed(samples, trend?.axis ?? null)
  if (!trend || speed < FAST_SPEED) return { kind: 'snap' }
  const slide = slideAlong(piece, pieces, trend)
  const dist = Math.hypot(slide.x - piece.anchor.position.x, slide.y - piece.anchor.position.y)
  if (dist <= 0.01) return { kind: 'snap' }
  return { kind: 'slide', x: slide.x, y: slide.y, clear: slide.clear, speed }
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
  const others = othersOf(pieces, piece)
  for (let distance = 0; distance <= 12; distance++) {
    for (let dc = -distance; dc <= distance; dc++) {
      for (let dr = -distance; dr <= distance; dr++) {
        if (Math.abs(dc) + Math.abs(dr) !== distance) continue
        const x = baseX + dc * CELL
        const y = baseY - dr * CELL
        if (!poseOnBoard(piece, x, y) || overlaps(piece, x, y, others)) continue
        return { x, y }
      }
    }
  }
  return { x: ax, y: ay }
}

/**
 * A cube center is past the board on `side`, and the rest of that exit is clear.
 * A piece still short of that center can return.
 */
export function canLeave(
  piece: StagePiece,
  pieces: readonly StagePiece[],
  side: AxisLock,
  x = piece.anchor.position.x,
  y = piece.anchor.position.y,
): boolean {
  if (!centerPastEdge(piece, x, y, side.axis, side.sign)) return false
  const dist = exitDistance(piece, x, y, side.axis, side.sign)
  if (dist <= 0.01) return true
  const dx = side.axis === 'x' ? side.sign * dist : 0
  const dy = side.axis === 'y' ? side.sign * dist : 0
  return sweep(piece, x, y, dx, dy, othersOf(pieces, piece)).t >= 1
}

function moveAxis(
  piece: StagePiece,
  axis: 'x' | 'y',
  amount: number,
  others: readonly StagePiece[],
): boolean {
  if (amount === 0) return false
  const dx = axis === 'x' ? amount : 0
  const dy = axis === 'y' ? amount : 0
  const ox = piece.anchor.position.x
  const oy = piece.anchor.position.y
  if (overlaps(piece, ox, oy, others)) return false
  const hit = sweep(piece, ox, oy, dx, dy, others)
  if (hit.t >= 1) {
    piece.anchor.position.x = ox + dx
    piece.anchor.position.y = oy + dy
    return false
  }
  const t = Math.max(0, hit.t)
  piece.anchor.position.x = ox + dx * t
  piece.anchor.position.y = oy + dy * t
  return true
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

/**
 * Where a formed trend ends. `clear` means every cube can pass the board edge
 * without touching another piece. Otherwise the point is the first contact.
 */
export function slideAlong(
  piece: StagePiece,
  pieces: readonly StagePiece[],
  side: AxisLock,
): { x: number; y: number; clear: boolean } {
  const ox = piece.anchor.position.x
  const oy = piece.anchor.position.y
  const dist = exitDistance(piece, ox, oy, side.axis, side.sign)
  const dx = side.axis === 'x' ? side.sign * dist : 0
  const dy = side.axis === 'y' ? side.sign * dist : 0
  if (dist <= 0.01) return { x: ox, y: oy, clear: true }
  const hit = sweep(piece, ox, oy, dx, dy, othersOf(pieces, piece))
  const scale = hit.t >= 1 ? 1 : Math.max(0, hit.t - 1e-4)
  return { x: ox + dx * scale, y: oy + dy * scale, clear: hit.t >= 1 }
}

export function coversPiece(piece: StagePiece, x: number, y: number): boolean {
  if (!piece.alive) return false
  const wy = -y
  for (const local of piece.locals) {
    const cx = piece.anchor.position.x + local.x
    const cy = piece.anchor.position.y + local.y
    if (Math.abs(x - cx) <= piece.half && Math.abs(wy - cy) <= piece.half) return true
  }
  return false
}

export function pieceAt(x: number, y: number, pieces: readonly StagePiece[]): StagePiece | null {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]
    if (coversPiece(piece, x, y)) return piece
  }
  return null
}
