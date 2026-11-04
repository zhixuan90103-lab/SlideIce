/**
 * One-axis drag in design space.
 * world x = design x, world y = -design y.
 * A press selects without moving. Past the dead zone, the longer axis locks until release.
 * Travel on that axis drops the dead zone once, so the piece does not jump. Collision stops at first contact.
 */

import { CELL } from './look'
import { boardRect, nearestCellCenter, type StagePiece } from './stage'

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

const othersScratch: StagePiece[] = []
const axisMove = { moved: 0, blocked: false }

/** Alive pieces except the one being moved. The array is reused on the next call. */
function aliveOthers(pieces: readonly StagePiece[], piece: StagePiece): readonly StagePiece[] {
  othersScratch.length = 0
  for (let i = 0; i < pieces.length; i++) {
    const item = pieces[i]
    if (item !== piece && item.alive) othersScratch.push(item)
  }
  return othersScratch
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

const TREND_SPAN = 16

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

/** First piece in front of `piece` along `side`, or null when that way is open. */
export function pieceAhead(
  piece: StagePiece,
  pieces: readonly StagePiece[],
  side: AxisLock,
): StagePiece | null {
  const ox = piece.anchor.position.x
  const oy = piece.anchor.position.y
  const reach = Math.max(exitDistance(piece, ox, oy, side), CELL * 8)
  const dx = side.axis === 'x' ? side.sign * reach : 0
  const dy = side.axis === 'y' ? side.sign * reach : 0
  let best = 1
  let hit: StagePiece | null = null
  for (const other of pieces) {
    if (other === piece || !other.alive) continue
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
        if (exit <= 0 || enter >= best) continue
        if (enter < best) {
          best = Math.max(0, enter)
          hit = other
        }
      }
    }
  }
  return hit
}

function alongScore(piece: StagePiece, side: AxisLock): number {
  const value = side.axis === 'x' ? piece.anchor.position.x : piece.anchor.position.y
  return value * side.sign
}

/**
 * Piece that should replace the held one.
 * Still on the held piece: only the piece directly ahead, once the finger touches it.
 * Finger has left the held piece and rests on another: that piece, even when the sweep missed it.
 */
export function replacementTarget(
  current: StagePiece | null,
  pieces: readonly StagePiece[],
  trend: AxisLock | null,
  x: number,
  y: number,
  skip: StagePiece | null,
): StagePiece | null {
  const hits: StagePiece[] = []
  for (const piece of pieces) {
    if (!piece.alive || piece === skip) continue
    if (coversPiece(piece, x, y)) hits.push(piece)
  }
  if (current && hits.includes(current)) {
    if (!trend) return null
    const ahead = pieceAhead(current, pieces, trend)
    if (ahead && ahead !== skip && hits.includes(ahead)) return ahead
    return null
  }
  const others = hits.filter((piece) => piece !== current)
  if (others.length === 0) return null
  if (!trend || others.length === 1) return others[0] ?? null
  let best = others[0]
  if (!best) return null
  let score = alongScore(best, trend)
  for (const piece of others) {
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
  const others = aliveOthers(pieces, piece)
  const pushX = goalX - piece.anchor.position.x
  const pushY = goalY - piece.anchor.position.y
  moveAxis(piece, 'x', pushX, others, axisMove)
  const hitX = axisMove.blocked && pushX !== 0
  moveAxis(piece, 'y', pushY, others, axisMove)
  const hitY = axisMove.blocked && pushY !== 0
  return { axis, blocked: hitX || hitY }
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
  const t = Math.max(0, stop)
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
