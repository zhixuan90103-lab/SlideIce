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
import { freshContact, noteSteps, resetContact, stepContact, type Contact } from './contact'
import { filterFinger, followFinger, pieceAt, seedFinger, type FingerFilter } from './slide'
import { centerInGrid, mountStage, type StagePiece } from './stage'

type Gesture = {
  id: number
  piece: StagePiece
  filter: FingerFilter
}

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
  let ended = false
  let held: StagePiece | null = null
  const shatters: Shatter[] = []
  const praise = freshPraise()
  const hint = mountHint()
  const contact: Contact = freshContact()
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
    resetContact(contact)
    piece.mesh.position.x = 0
    piece.mesh.position.y = 0
    const { x, y } = piece.anchor.position
    if (!centerInGrid(x, y)) {
      piece.alive = false
      piece.mesh.visible = false
      const burst = makeShatter(scene, chipPoints(piece), x, y, pieceColor(piece))
      if (burst) shatters.push(burst)
      showPraise(x, -y, notePraiseClear(praise, 1))
      if (pieces.every((item) => !item.alive)) ended = true
    }
  }

  const onDown = (event: PointerEvent) => {
    if (ended) return
    if (event.button !== 0) return
    // A second finger while the first is still held does not start a gesture.
    // A new press after a missed pointerup takes over, so the next piece is not lost.
    if (gesture && gesture.id !== event.pointerId && stage.hasPointerCapture(gesture.id)) return
    if (gesture) release(gesture.piece)
    const point = designOf(event)
    if (!point || !inDesign(point.x, point.y)) return
    const hit = pieceAt(point.x, point.y, pieces)
    if (!hit) return
    stage.setPointerCapture(event.pointerId)
    held = hit
    contact.originX = hit.anchor.position.x
    contact.originY = hit.anchor.position.y
    gesture = {
      id: event.pointerId,
      piece: hit,
      filter: seedFinger(event.timeStamp, point.x, point.y),
    }
  }

  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const point = designOf(event)
    if (!point) return
    const piece = gesture.piece
    const step = filterFinger(gesture.filter, event.timeStamp, point.x, point.y)
    noteSteps(contact, followFinger(piece, step.x, -step.y, pieces))
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
      const ready = held && !centerInGrid(held.anchor.position.x, held.anchor.position.y) ? [held.mesh] : []
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
      stepContact(contact, held, dt)
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
