/**
 * Move a piece by this event's finger step. Collision reads anchors only.
 * Both axes follow. A corner stops the blocked axis at contact and keeps
 * only the rest of this step on the open axis.
 */

import type { StagePiece } from './stage'

export type AxisStep = {
  axis: 'x' | 'y'
  amount: number
  moved: number
  blocked: boolean
}

/** 1€ filter: slow motion stays smooth, fast motion stays with the finger. */
const MIN_CUTOFF = 1.5
const BETA = 0.8
const D_CUTOFF = 1

export type FingerFilter = {
  t: number
  x: number
  y: number
  dx: number
  dy: number
}

export function seedFinger(t: number, x: number, y: number): FingerFilter {
  return { t, x, y, dx: 0, dy: 0 }
}

function smoothAlpha(dt: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * dt
  return r / (r + 1)
}

/** Smoothed step, in design pixels. `t` is `event.timeStamp` in milliseconds. */
export function filterFinger(filter: FingerFilter, t: number, x: number, y: number): { x: number; y: number } {
  const dt = (t - filter.t) / 1000
  if (!(dt > 0)) return { x: 0, y: 0 }
  const derivative = smoothAlpha(dt, D_CUTOFF)
  const dx = (x - filter.x) / dt
  const dy = (y - filter.y) / dt
  const dxHat = derivative * dx + (1 - derivative) * filter.dx
  const dyHat = derivative * dy + (1 - derivative) * filter.dy
  const ax = smoothAlpha(dt, MIN_CUTOFF + BETA * Math.abs(dxHat))
  const ay = smoothAlpha(dt, MIN_CUTOFF + BETA * Math.abs(dyHat))
  const xHat = ax * x + (1 - ax) * filter.x
  const yHat = ay * y + (1 - ay) * filter.y
  const stepX = xHat - filter.x
  const stepY = yHat - filter.y
  filter.t = t
  filter.x = xHat
  filter.y = yHat
  filter.dx = dxHat
  filter.dy = dyHat
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

/** First fraction of the move that touches another piece. 1 means the whole move is clear. */
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
