/**
 * Finger follow. The pressed point tracks a smoothed finger.
 * The piece follows the straight segments between finger samples, a short time behind the latest sample.
 * A fast swipe locks one axis for the latest segment. Collision stops at the first contact and does not tunnel.
 */

import { CELL } from './look'
import { boardRect, nearestCellCenter, type StagePiece } from './stage'

/** How far the followed point stays behind the latest finger sample, so a segment can be drawn. */
const LINE_DELAY = 0.02
/** At FAST_SPEED the stroke must reach FAST_MIN. Faster swipes need less distance, down to FAST_FLOOR. */
export const FAST_SPEED = 900
export const FAST_WINDOW = 0.08
export const FAST_SPAN = 0.05
export const FAST_MIN = 28
const FAST_FLOOR = 8
/** Share of the stroke that must point along an open exit before that exit wins. */
const TREND = 0.6

export type Finger = { x: number; y: number }

/** Design finger minus the piece. Keeps the pressed point on the finger. */
export type Grab = { x: number; y: number }

export type FingerSample = { t: number; x: number; y: number }

export function seedFinger(x: number, y: number): Finger {
  return { x, y }
}

export function seedGrab(fingerX: number, fingerY: number, pieceX: number, pieceY: number): Grab {
  return { x: fingerX - pieceX, y: fingerY + pieceY }
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

/** Recent window used to judge a fast swipe. Keeps the newest two samples. */
export function rememberFinger(samples: FingerSample[], t: number, x: number, y: number): void {
  const prev = samples[samples.length - 1]
  if (prev && t <= prev.t) {
    prev.x = x
    prev.y = y
    return
  }
  samples.push(takeSample(t, x, y))
  const start = t - FAST_WINDOW
  while (samples.length > 2 && samples[0].t < start) {
    const old = samples.shift()
    if (old) samplePool.push(old)
  }
}

/** Return every sample in the gesture window to the pool. */
export function releaseFinger(samples: FingerSample[]): void {
  for (let i = 0; i < samples.length; i++) samplePool.push(samples[i])
  samples.length = 0
}

const grabStep = { x: 0, y: 0 }

/**
 * World step from the grab. The returned object is reused on the next call.
 * A fast axis rebases the other axis onto the piece first, so that sample's cross motion is dropped.
 */
export function grabDelta(
  grab: Grab,
  finger: Finger,
  pieceX: number,
  pieceY: number,
  axis: 'x' | 'y' | null,
): { x: number; y: number } {
  if (axis === 'x') grab.y = pieceY + finger.y
  if (axis === 'y') grab.x = finger.x - pieceX
  grabStep.x = finger.x - grab.x - pieceX
  grabStep.y = -finger.y + grab.y - pieceY
  return grabStep
}

const lineAt = { x: 0, y: 0 }

/** Linear point on the finger polyline, LINE_DELAY behind `now`. The object is reused. */
export function fingerOnLine(samples: readonly FingerSample[], now: number): { x: number; y: number } {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last) return lineAt
  const time = Math.min(last.t, Math.max(first.t, now - LINE_DELAY))
  if (time <= first.t) {
    lineAt.x = first.x
    lineAt.y = first.y
    return lineAt
  }
  let index = 1
  while (index < samples.length - 1 && samples[index].t < time) index += 1
  const left = samples[index - 1]
  const right = samples[index]
  const span = right.t - left.t
  const amount = span <= 0 ? 1 : (time - left.t) / span
  lineAt.x = left.x + (right.x - left.x) * amount
  lineAt.y = left.y + (right.y - left.y) * amount
  return lineAt
}

const othersScratch: StagePiece[] = []
const axisMove = { moved: 0, blocked: false }
const axisApproach = { moved: 0, blocked: false }

/** Alive pieces except the one being moved. The array is reused on the next call. */
function aliveOthers(pieces: readonly StagePiece[], piece: StagePiece): readonly StagePiece[] {
  othersScratch.length = 0
  for (let i = 0; i < pieces.length; i++) {
    const item = pieces[i]
    if (item !== piece && item.alive) othersScratch.push(item)
  }
  return othersScratch
}

/** Move the held piece onto the finger line, then along one axis while the line is still a fast swipe. */
export function followHold(
  piece: StagePiece,
  pieces: readonly StagePiece[],
  finger: Finger,
  grab: Grab,
  pressX: number,
  pressY: number,
  samples: readonly FingerSample[],
  now: number,
): AxisLock | null {
  const fast = fastAxis(piece, pieces, pressX, pressY, samples)
  const at = fingerOnLine(samples, now)
  if (samples.length === 0 || (at.x === finger.x && at.y === finger.y)) return fast
  finger.x = at.x
  finger.y = at.y
  const step = grabDelta(grab, finger, piece.anchor.position.x, piece.anchor.position.y, fast?.axis ?? null)
  followFinger(piece, step.x, step.y, pieces)
  return fast
}

export function followFinger(piece: StagePiece, dx: number, dy: number, pieces: readonly StagePiece[]): void {
  if (dx === 0 && dy === 0) return
  const others = aliveOthers(pieces, piece)
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const primaryAxis = horizontal ? 'x' : 'y'
  const secondaryAxis = horizontal ? 'y' : 'x'
  const primaryAmount = horizontal ? dx : dy
  const secondaryAmount = horizontal ? dy : dx
  moveAxis(piece, primaryAxis, primaryAmount, others, axisMove)
  if (!axisMove.blocked) {
    moveAxis(piece, secondaryAxis, secondaryAmount, others, axisApproach)
    return
  }
  const fraction = primaryAmount === 0 ? 0 : axisMove.moved / primaryAmount
  const approach = secondaryAmount * fraction
  moveAxis(piece, secondaryAxis, approach, others, axisApproach)
  const remain = secondaryAmount - approach
  if (axisApproach.blocked || remain === 0) return
  moveAxis(piece, secondaryAxis, remain, others, axisApproach)
}

export type AxisLock = { axis: 'x' | 'y'; sign: number }

/**
 * One axis while the recent window is still a fast swipe that has travelled FAST_MIN from the press.
 * The axis comes from that window, not from the whole stroke. Null returns both axes to the grab.
 */
export function fastAxis(
  piece: StagePiece,
  pieces: readonly StagePiece[],
  pressX: number,
  pressY: number,
  samples: readonly FingerSample[],
): AxisLock | null {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last || first === last) return null
  const span = last.t - first.t
  const recent = Math.hypot(last.x - first.x, last.y - first.y)
  const stroke = Math.hypot(last.x - pressX, last.y - pressY)
  const speed = span > 0 ? recent / span : 0
  const need = Math.max(FAST_FLOOR, FAST_MIN * (FAST_SPEED / Math.max(speed, 1)))
  if (span < FAST_SPAN || speed < FAST_SPEED || stroke < need) return null
  return chooseFastAxis(piece, last.x - first.x, -(last.y - first.y), pieces)
}

/** Speed of the samples still in the recent window. */
export function windowSpeed(samples: readonly FingerSample[]): number {
  const first = samples[0]
  const last = samples[samples.length - 1]
  if (!first || !last || last.t <= first.t) return 0
  return Math.hypot(last.x - first.x, last.y - first.y) / (last.t - first.t)
}

export type ReleasePlan =
  | { kind: 'eliminate' }
  | { kind: 'slide'; x: number; y: number; clear: boolean; speed: number }
  | { kind: 'snap' }

/**
 * Already out of range eliminates at once.
 * A piece still on the board slides on only while the recent window is still fast.
 * Anything else returns to a cell.
 */
export function planRelease(
  piece: StagePiece,
  pieces: readonly StagePiece[],
  trend: AxisLock | null,
  samples: readonly FingerSample[],
): ReleasePlan {
  if (canLeave(piece, pieces)) return { kind: 'eliminate' }
  const speed = windowSpeed(samples)
  if (!trend || speed < FAST_SPEED) return { kind: 'snap' }
  const slide = slideAlong(piece, pieces, trend)
  const dist = Math.hypot(slide.x - piece.anchor.position.x, slide.y - piece.anchor.position.y)
  if (dist <= 0.01) return { kind: 'snap' }
  return { kind: 'slide', x: slide.x, y: slide.y, clear: slide.clear, speed }
}

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
  const others = aliveOthers(pieces, piece)
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
 * The piece is at least one cell away from the nearest on-board landing,
 * already past the board edge, and the rest of that exit is clear.
 * A shorter nudge can still return to the board.
 */
export function canLeave(piece: StagePiece, pieces: readonly StagePiece[], x = piece.anchor.position.x, y = piece.anchor.position.y): boolean {
  if (outsideFraction(piece, x, y) <= 0) return false
  const home = gridSnap(piece, pieces)
  if (Math.hypot(home.x - x, home.y - y) < CELL) return false
  const others = aliveOthers(pieces, piece)
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

const unlockWays: AxisLock[] = [
  { axis: 'x', sign: 1 },
  { axis: 'x', sign: -1 },
  { axis: 'y', sign: 1 },
  { axis: 'y', sign: -1 },
]
const unlockFound: AxisLock[] = []

function unlockAxes(piece: StagePiece, pieces: readonly StagePiece[]): readonly AxisLock[] {
  const others = aliveOthers(pieces, piece)
  unlockFound.length = 0
  for (const candidate of unlockWays) {
    const ox = piece.anchor.position.x
    const oy = piece.anchor.position.y
    const dist = exitDistance(piece, ox, oy, candidate)
    const dx = candidate.axis === 'x' ? candidate.sign * dist : 0
    const dy = candidate.axis === 'y' ? candidate.sign * dist : 0
    if (dist <= 0.01 || sweepStop(piece, ox, oy, dx, dy, others) >= 1) unlockFound.push(candidate)
  }
  return unlockFound
}

function moveAxis(
  piece: StagePiece,
  axis: 'x' | 'y',
  amount: number,
  others: readonly StagePiece[],
  out: { moved: number; blocked: boolean },
): void {
  if (amount === 0) {
    out.moved = 0
    out.blocked = false
    return
  }
  const dx = axis === 'x' ? amount : 0
  const dy = axis === 'y' ? amount : 0
  const ox = piece.anchor.position.x
  const oy = piece.anchor.position.y
  if (overlaps(piece, ox, oy, others)) {
    out.moved = 0
    out.blocked = false
    return
  }
  const stop = sweepStop(piece, ox, oy, dx, dy, others)
  if (stop >= 1) {
    piece.anchor.position.x = ox + dx
    piece.anchor.position.y = oy + dy
    out.moved = amount
    out.blocked = false
    return
  }
  const t = Math.max(0, stop - 1e-4)
  piece.anchor.position.x = ox + dx * t
  piece.anchor.position.y = oy + dy * t
  out.moved = amount * t
  out.blocked = true
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

const crossed: AxisLock[] = []

function crossedSides(piece: StagePiece, x: number, y: number): readonly AxisLock[] {
  const board = boardRect()
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
  crossed.length = 0
  if (east) crossed.push(unlockWays[0])
  if (west) crossed.push(unlockWays[1])
  if (north) crossed.push(unlockWays[2])
  if (south) crossed.push(unlockWays[3])
  return crossed
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
  const dist = exitDistance(piece, ox, oy, side)
  const dx = side.axis === 'x' ? side.sign * dist : 0
  const dy = side.axis === 'y' ? side.sign * dist : 0
  if (dist <= 0.01) return { x: ox, y: oy, clear: true }
  const stop = sweepStop(piece, ox, oy, dx, dy, aliveOthers(pieces, piece))
  const scale = stop >= 1 ? 1 : Math.max(0, stop - 1e-4)
  return { x: ox + dx * scale, y: oy + dy * scale, clear: stop >= 1 }
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
