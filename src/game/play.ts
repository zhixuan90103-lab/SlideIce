/**
 * Screen frame, one source:
 *   world x = design x
 *   world y = -design y
 * Pieces on the stage follow the finger in that plane.
 * A press lifts the piece. The pressed point follows the finger.
 * Release removes the piece when most of its area is outside the board, and lands it on cells otherwise.
 */

import * as THREE from 'three'
import { DESIGN_HEIGHT, DESIGN_WIDTH, type StageLayout } from '../adapt/design'
import { mountHint } from './hint'
import { freshPraise, notePraiseClear, showPraise } from './praise'
import { SHATTER, disposeShatter, makeShatter, stepShatters, type Shatter } from './shatter'
import {
  chooseFastAxis,
  easeFinger,
  FAST_MIN,
  FAST_SPAN,
  FAST_SPEED,
  FAST_WINDOW,
  followFinger,
  canLeave,
  gridSnap,
  pieceAt,
  seedFinger,
  type AxisLock,
  type Finger,
} from './slide'
import { mountStage, type StagePiece } from './stage'

type Sample = { t: number; x: number; y: number }

type Gesture = {
  id: number
  piece: StagePiece
  finger: Finger
  offsetX: number
  offsetY: number
  pressX: number
  pressY: number
  samples: Sample[]
  fast: AxisLock | null
}

type Landing = { piece: StagePiece; x: number; y: number }

const LAND_SPEED = 900

export type SlideGame = {
  update(dt: number): void
  /** Draw strokes after the blocks, masked only by their own piece. */
  renderOverlay(
    renderer: { autoClear: boolean; clearDepth(): void; render(scene: THREE.Scene, camera: THREE.Camera): void },
    camera: THREE.Camera,
  ): void
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
  let landing: Landing | null = null
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

  const release = (piece: StagePiece) => {
    gesture = null
    held = null
    piece.mesh.position.x = 0
    piece.mesh.position.y = 0
    const { x, y } = piece.anchor.position
    if (canLeave(piece, pieces)) {
      if (landing?.piece === piece) landing = null
      piece.alive = false
      piece.mesh.visible = false
      const burst = makeShatter(scene, chipPoints(piece), x, y, pieceColor(piece))
      if (burst) shatters.push(burst)
      showPraise(x, -y, notePraiseClear(praise, 1))
      if (pieces.every((item) => !item.alive)) ended = true
      return
    }
    landing = { piece, ...gridSnap(piece, pieces) }
  }

  const onDown = (event: PointerEvent) => {
    if (ended) return
    if (event.button !== 0) return
    // A second finger while the first is still held does not start a gesture.
    // A new press after a missed pointerup takes over, so the next piece is not lost.
    if (gesture && gesture.id !== event.pointerId && stage.hasPointerCapture(gesture.id)) return
    if (landing) landing = null
    if (gesture) release(gesture.piece)
    const point = designOf(event)
    if (!point || !inDesign(point.x, point.y)) return
    const hit = pieceAt(point.x, point.y, pieces)
    if (!hit) return
    stage.setPointerCapture(event.pointerId)
    held = hit
    gesture = {
      id: event.pointerId,
      piece: hit,
      finger: seedFinger(point.x, point.y),
      offsetX: point.x - hit.anchor.position.x,
      offsetY: point.y + hit.anchor.position.y,
      pressX: point.x,
      pressY: point.y,
      samples: [{ t: event.timeStamp / 1000, x: point.x, y: point.y }],
      fast: null,
    }
  }

  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const point = designOf(event)
    if (!point) return
    const piece = gesture.piece
    easeFinger(gesture.finger, point.x, point.y)
    const now = event.timeStamp / 1000
    gesture.samples.push({ t: now, x: gesture.finger.x, y: gesture.finger.y })
    const windowStart = now - FAST_WINDOW
    while (gesture.samples.length > 2 && gesture.samples[0].t < windowStart) gesture.samples.shift()
    const first = gesture.samples[0]
    const last = gesture.samples[gesture.samples.length - 1]
    const span = last.t - first.t
    const recent = Math.hypot(last.x - first.x, last.y - first.y)
    const stroke = Math.hypot(gesture.finger.x - gesture.pressX, gesture.finger.y - gesture.pressY)
    const fastNow = span >= FAST_SPAN && recent / span >= FAST_SPEED && stroke >= FAST_MIN
    if (fastNow) {
      gesture.fast = chooseFastAxis(piece, last.x - first.x, -(last.y - first.y), pieces)
      // The ignored axis is rebased to the piece, so this sample's cross motion is not owed.
      if (gesture.fast.axis === 'x') gesture.offsetY = piece.anchor.position.y + gesture.finger.y
      else gesture.offsetX = gesture.finger.x - piece.anchor.position.x
    } else {
      gesture.fast = null
    }
    const desiredX = gesture.finger.x - gesture.offsetX
    const desiredY = -gesture.finger.y + gesture.offsetY
    let dx = desiredX - piece.anchor.position.x
    let dy = desiredY - piece.anchor.position.y
    if (gesture.fast?.axis === 'x') dy = 0
    if (gesture.fast?.axis === 'y') dx = 0
    followFinger(piece, dx, dy, pieces)
  }

  const onUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const piece = gesture.piece
    release(piece)
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
  }

  const onLostCapture = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    release(gesture.piece)
  }

  stage.addEventListener('pointerdown', onDown)
  stage.addEventListener('pointermove', onMove)
  stage.addEventListener('pointerup', onUp)
  stage.addEventListener('pointercancel', onUp)
  stage.addEventListener('lostpointercapture', onLostCapture)

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
      if (landing && landing.piece !== held && landing.piece.alive) {
        const dx = landing.x - landing.piece.anchor.position.x
        const dy = landing.y - landing.piece.anchor.position.y
        const dist = Math.hypot(dx, dy)
        const step = LAND_SPEED * dt
        if (dist <= step || dist < 0.01) {
          landing.piece.anchor.position.x = landing.x
          landing.piece.anchor.position.y = landing.y
          landing = null
        } else {
          landing.piece.anchor.position.x += (dx / dist) * step
          landing.piece.anchor.position.y += (dy / dist) * step
        }
      }
      const ready = held && canLeave(held, pieces) ? [held.mesh] : []
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
        const next = to === 1 ? 1 : from + (to - from) * step
        lifts.set(piece, next)
        piece.anchor.position.z = piece.restZ + next * piece.height * 0.5
        const stroke = piece.outline.material
        if (stroke instanceof THREE.MeshBasicMaterial) stroke.opacity = next
        piece.outline.visible = next > 0.02
      }
    },
    renderOverlay(renderer, camera) {
      const active = pieces.filter((piece) => piece.alive && piece.outline.visible)
      if (active.length === 0) return
      for (const piece of active) {
        piece.mesh.layers.enable(1)
        const material = piece.mesh.material
        if (material instanceof THREE.Material) material.colorWrite = false
      }
      const autoClear = renderer.autoClear
      const background = scene.background
      scene.background = null
      renderer.autoClear = false
      renderer.clearDepth()
      camera.layers.set(1)
      renderer.render(scene, camera)
      camera.layers.set(0)
      renderer.autoClear = autoClear
      scene.background = background
      for (const piece of active) {
        piece.mesh.layers.disable(1)
        const material = piece.mesh.material
        if (material instanceof THREE.Material) material.colorWrite = true
      }
    },
    dispose() {
      stage.removeEventListener('pointerdown', onDown)
      stage.removeEventListener('lostpointercapture', onLostCapture)
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerup', onUp)
      stage.removeEventListener('pointercancel', onUp)
    },
  }
}

function chipPoints(piece: StagePiece): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  const step = SHATTER.step
  for (const local of piece.locals) {
    const x0 = piece.anchor.position.x + local.x - piece.half
    const y0 = piece.anchor.position.y + local.y - piece.half
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
