/**
 * Screen frame, one source:
 *   world x = design x
 *   world y = -design y
 * Pieces on the stage follow the finger in that plane.
 * A press lifts the piece. Release drops it, and the center decides if it has left the grid.
 */

import * as THREE from 'three'
import { DESIGN_HEIGHT, DESIGN_WIDTH, type StageLayout } from '../adapt/design'
import { mountHint } from './hint'
import { freshPraise, notePraiseClear, showPraise } from './praise'
import { SHATTER, disposeShatter, makeShatter, stepShatters, type Shatter } from './shatter'
import { centerInGrid, hitsWall, mountStage, type StagePiece } from './stage'

type Gesture = {
  id: number
  piece: StagePiece
  x: number
  y: number
}

export type SlideGame = {
  update(dt: number): void
  dispose(): void
  /** Kept so the camera aim stays where main.ts left it. */
  setPieceHeight(height: number): number
  setRoughness(roughness: number): void
  setLights(
    keyIntensity: number,
    keyAzimuth: number,
    keyElevation: number,
    fillIntensity: number,
    fillAzimuth: number,
    fillElevation: number,
    ambient: number,
  ): void
  setCube(size: number, corner: number, edge: number): void
}

export function mountSlideGame(
  scene: THREE.Scene,
  stage: HTMLElement,
  getLayout: () => StageLayout | null,
): SlideGame {
  const stageLook = mountStage(scene)
  const pieces = stageLook.pieces
  const lifts = new Map<StagePiece, number>()
  for (const piece of pieces) lifts.set(piece, 0)

  let gesture: Gesture | null = null
  let ended = false
  let held: StagePiece | null = null
  const shatters: Shatter[] = []
  const praise = freshPraise()
  const hint = mountHint()

  const designOf = (event: PointerEvent): { x: number; y: number } | null => {
    const layout = getLayout()
    if (!layout) return null
    const rect = stage.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / layout.scale,
      y: (event.clientY - rect.top) / layout.scale,
    }
  }

  const inDesign = (x: number, y: number) =>
    x >= 0 && y >= 0 && x <= DESIGN_WIDTH && y <= DESIGN_HEIGHT

  const onDown = (event: PointerEvent) => {
    if (ended || gesture) return
    if (event.button !== 0) return
    const point = designOf(event)
    if (!point || !inDesign(point.x, point.y)) return
    const hit = pieceAt(point.x, point.y, pieces)
    if (!hit) return
    stage.setPointerCapture(event.pointerId)
    held = hit
    gesture = { id: event.pointerId, piece: hit, x: point.x, y: point.y }
  }

  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const point = designOf(event)
    if (!point) return
    const dx = point.x - gesture.x
    const dy = -(point.y - gesture.y)
    gesture.x = point.x
    gesture.y = point.y
    slide(gesture.piece, dx, dy, pieces)
  }

  const onUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const piece = gesture.piece
    gesture = null
    held = null
    const { x, y } = piece.mesh.position
    if (!centerInGrid(x, y)) {
      piece.alive = false
      piece.mesh.visible = false
      const burst = makeShatter(scene, chipPoints(piece), x, y, pieceColor(piece))
      if (burst) shatters.push(burst)
      showPraise(x, -y, notePraiseClear(praise, 1))
      if (pieces.every((item) => !item.alive)) ended = true
    }
  }

  stage.addEventListener('pointerdown', onDown)
  stage.addEventListener('pointermove', onMove)
  stage.addEventListener('pointerup', onUp)
  stage.addEventListener('pointercancel', onUp)

  return {
    setLights(keyIntensity, keyAzimuth, keyElevation, fillIntensity, fillAzimuth, fillElevation, ambientIntensity): void {
      stageLook.setLights(keyIntensity, keyAzimuth, keyElevation, fillIntensity, fillAzimuth, fillElevation, ambientIntensity)
    },
    setCube(size: number, corner: number, edge: number): void {
      stageLook.setCube(size, corner, edge)
    },
    setRoughness(roughness: number): void {
      stageLook.setRoughness(roughness)
    },
    setPieceHeight(height: number): number {
      return height
    },
    update(dt) {
      const ready = held && !centerInGrid(held.mesh.position.x, held.mesh.position.y) ? [held.mesh] : []
    hint.set(ready)
    hint.step(dt)
    stepShatters(shatters, -DESIGN_HEIGHT - SHATTER.chip, dt)
      for (let i = shatters.length - 1; i >= 0; i--) {
        if (!shatters[i].dead) continue
        disposeShatter(shatters[i])
        shatters.splice(i, 1)
      }
      const step = Math.min(1, dt * 14)
      for (const piece of pieces) {
        if (!piece.alive) continue
        const from = lifts.get(piece) ?? 0
        const to = piece === held ? 1 : 0
        const next = from + (to - from) * step
        lifts.set(piece, next)
        piece.mesh.position.z = piece.restZ + next * piece.height * 0.5
      }
    },
    dispose() {
      stage.removeEventListener('pointerdown', onDown)
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerup', onUp)
      stage.removeEventListener('pointercancel', onUp)
    },
  }
}

/** Move by this finger step. The larger axis goes first. If that axis cannot move, the piece stays. */
function chipPoints(piece: StagePiece): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  const step = SHATTER.step
  for (const local of piece.locals) {
    const x0 = piece.mesh.position.x + local.x - piece.half
    const y0 = piece.mesh.position.y + local.y - piece.half
    const side = piece.half * 2
    const count = Math.max(1, Math.round(side / step))
    for (let col = 0; col < count; col++) {
      for (let row = 0; row < count; row++) {
        points.push({
          x: x0 + ((col + 0.5) * side) / count,
          y: y0 + ((row + 0.5) * side) / count,
        })
      }
    }
  }
  return points
}

function pieceColor(piece: StagePiece): number {
  const material = piece.mesh.material
  return material instanceof THREE.MeshStandardMaterial ? material.color.getHex() : 0xffffff
}

function slide(piece: StagePiece, dx: number, dy: number, pieces: readonly StagePiece[]): void {
  if (dx === 0 && dy === 0) return
  const others = pieces.filter((item) => item !== piece && item.alive)
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const primary = moveAxis(piece, horizontal ? dx : 0, horizontal ? 0 : dy, others)
  if (Math.abs(primary) < 0.4) return
  moveAxis(piece, horizontal ? 0 : dx, horizontal ? dy : 0, others)
}

function moveAxis(piece: StagePiece, dx: number, dy: number, others: readonly StagePiece[]): number {
  const amount = dx !== 0 ? dx : dy
  if (amount === 0) return 0
  const ox = piece.mesh.position.x
  const oy = piece.mesh.position.y
  const overlapsAt = (t: number) =>
    overlaps(piece, ox + dx * t, oy + dy * t, others) ||
    hitsWall(piece.locals, piece.half, ox + dx * t, oy + dy * t)
  if (overlapsAt(0)) return 0
  if (!overlapsAt(1)) {
    piece.mesh.position.x = ox + dx
    piece.mesh.position.y = oy + dy
    return amount
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2
    if (overlapsAt(mid)) hi = mid
    else lo = mid
  }
  piece.mesh.position.x = ox + dx * lo
  piece.mesh.position.y = oy + dy * lo
  return amount * lo
}

function overlaps(piece: StagePiece, x: number, y: number, others: readonly StagePiece[]): boolean {
  for (const other of others) {
    for (const a of piece.locals) {
      for (const b of other.locals) {
        const cx = x + a.x - (other.mesh.position.x + b.x)
        const cy = y + a.y - (other.mesh.position.y + b.y)
        if (Math.abs(cx) < piece.half + other.half && Math.abs(cy) < piece.half + other.half) return true
      }
    }
  }
  return false
}

function pieceAt(x: number, y: number, pieces: readonly StagePiece[]): StagePiece | null {
  const wx = x
  const wy = -y
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]
    if (!piece.alive) continue
    for (const local of piece.locals) {
      const cx = piece.mesh.position.x + local.x
      const cy = piece.mesh.position.y + local.y
      if (Math.abs(wx - cx) <= piece.half && Math.abs(wy - cy) <= piece.half) return piece
    }
  }
  return null
}
