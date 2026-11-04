/**
 * Screen frame, one source:
 *   world x = design x
 *   world y = -design y
 * A press lifts the piece at once. The piece stays put inside the design-space dead zone,
 * then moves on the one locked axis. Returning inside the home band clears that lock.
 * Release removes a piece that can finish leaving, and lands every other piece on cells.
 */

import * as THREE from 'three'
import { clientToDesign, isInDesignBounds, type StageLayout } from '../adapt/design'
import { pulseHaptic } from './hapticFeel'
import { mountHint } from './hint'
import { CELL, designToBoard, viewBottomWorld } from './look'
import { beginRock, rockRotation, stepRock, type Rock } from './rock'
import { freshPraise, notePraiseClear, showPraise } from './praise'
import { SHATTER, disposeShatter, makeShatter, stepShatters, type Shatter } from './shatter'
import {
  HOME_BAND,
  followHold,
  recentAxis,
  replacementTarget,
  gridSnap,
  planRelease,
  coversPiece,
  pieceAt,
  releaseFinger,
  rememberFinger,
  seedFinger,
  type AxisLock,
  type Finger,
  type FingerSample,
} from './slide'
import type { LevelFile } from './level'
import { mountStage, type StagePiece } from './stage'

type Gesture = {
  id: number
  piece: StagePiece | null
  finger: Finger
  pressX: number
  pressY: number
  originX: number
  originY: number
  /** Finger position when this piece was taken. Mid-stroke grabs measure travel from here. */
  grabX: number
  grabY: number
  /** Taken on the press itself, so the dead zone still applies. */
  fromPress: boolean
  samples: FingerSample[]
  trend: AxisLock | null
  /** True while this step is still against the same contact. */
  blocked: boolean
}

type Landing = {
  piece: StagePiece
  x: number
  y: number
  leave: boolean
  speed: number
  /** Set when this landing is the one that sits the piece on a cell. */
  settle: AxisLock | null
}

const LAND_SPEED = 900

export type SlideGame = {
  update(dt: number): void
  /** Draw strokes after the blocks, masked only by their own piece. */
  renderOverlay(
    renderer: { autoClear: boolean; clearDepth(): void; render(scene: THREE.Scene, camera: THREE.Camera): void },
    camera: THREE.Camera,
  ): void
  dispose(): void
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
  /** Rebuild the board from a level file and drop the previous gesture. */
  load(level: LevelFile): void
}

const CLEAR_DELAY = 1

export function mountSlideGame(
  scene: THREE.Scene,
  stage: HTMLElement,
  getLayout: () => StageLayout | null,
  onCleared?: () => void,
): SlideGame {
  const stageLook = mountStage(scene)
  const pieces = stageLook.pieces
  const lifts = new Map<StagePiece, number>()
  for (const piece of pieces) lifts.set(piece, 0)

  const hintTargets: THREE.Object3D[] = []
  const outlined: StagePiece[] = []
  const maskMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthTest: true })
  const maskRestore: THREE.Material[] = []
  let gesture: Gesture | null = null
  const landings: Landing[] = []
  const rocks = new Map<StagePiece, Rock>()
  let ended = false
  let clearWait = 0
  let toldClear = false
  let readyLit = false
  let held: StagePiece | null = null
  const shatters: Shatter[] = []
  const praise = freshPraise()
  const hint = mountHint()
  const pointer = { x: 0, y: 0 }
  let pointerInside = false
  const designOf = (event: PointerEvent): { x: number; y: number } | null => {
    const layout = getLayout()
    if (!layout) return null
    const point = clientToDesign(event.clientX, event.clientY, stage.getBoundingClientRect(), layout.scale)
    const board = designToBoard(point.x, point.y)
    pointer.x = board.x
    pointer.y = board.y
    pointerInside = inDesign(point.x, point.y)
    return pointer
  }

  const inDesign = (x: number, y: number) => isInDesignBounds(x, y)

  const isLanding = (piece: StagePiece) => landings.some((item) => item.piece === piece)

  const dropLanding = (piece: StagePiece) => {
    const index = landings.findIndex((item) => item.piece === piece)
    if (index >= 0) landings.splice(index, 1)
  }

  const setLanding = (next: Landing) => {
    const index = landings.findIndex((item) => item.piece === next.piece)
    if (index >= 0) landings[index] = next
    else landings.push(next)
  }

  const eliminate = (piece: StagePiece) => {
    dropLanding(piece)
    const { x, y } = piece.anchor.position
    piece.alive = false
    piece.mesh.visible = false
    pulseHaptic('clear')
    const burst = makeShatter(scene, chipPoints(piece), x, y, pieceColor(piece))
    if (burst) shatters.push(burst)
    showPraise(x, -y, notePraiseClear(praise, 1))
    if (pieces.length > 0 && pieces.every((item) => !item.alive)) ended = true
  }

  const endGesture = () => {
    if (gesture) releaseFinger(gesture.samples)
    gesture = null
    held = null
  }

  const takePiece = (piece: StagePiece, fingerX: number, fingerY: number, fromPress: boolean) => {
    if (!gesture) return
    gesture.piece = piece
    gesture.originX = piece.anchor.position.x
    gesture.originY = piece.anchor.position.y
    gesture.grabX = fingerX
    gesture.grabY = fingerY
    gesture.fromPress = fromPress
    held = piece
    dropLanding(piece)
    flatten(piece)
    gesture.blocked = false
    pulseHaptic('grab')
  }

  /** Recent trend turned. Later travel starts at this finger, so the old cross slack is not applied. */
  const turnAxis = (piece: StagePiece, next: AxisLock) => {
    if (!gesture) return
    gesture.trend = next
    gesture.fromPress = false
    gesture.originX = piece.anchor.position.x
    gesture.originY = piece.anchor.position.y
    gesture.grabX = gesture.finger.x
    gesture.grabY = gesture.finger.y
  }

  /** Pushing into a stop keeps the grab. Only a finger behind the piece lets go. */
  const stillHeld = (piece: StagePiece, finger: Finger, axis: AxisLock) => {
    if (coversPiece(piece, finger.x, finger.y)) return true
    const pieceAlong = axis.axis === 'x' ? piece.anchor.position.x : piece.anchor.position.y
    const fingerAlong = axis.axis === 'x' ? finger.x : -finger.y
    return (fingerAlong - pieceAlong) * axis.sign >= 0
  }

  const flatten = (piece: StagePiece) => {
    rocks.delete(piece)
    piece.mesh.rotation.x = 0
    piece.mesh.rotation.y = 0
  }

  /** Remember the slide. The rock itself waits until the anchor is on the cell. */
  const armRock = (piece: StagePiece, dx: number, dy: number, force: AxisLock | null) => {
    let axis: 'x' | 'y' | null = null
    let sign = 0
    if (force && force.sign !== 0) {
      axis = force.axis
      sign = force.sign
    } else if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 0.5) {
      axis = 'x'
      sign = Math.sign(dx)
    } else if (Math.abs(dy) > 0.5) {
      axis = 'y'
      sign = Math.sign(dy)
    }
    const rock = axis ? beginRock(axis, sign, Math.hypot(dx, dy), CELL) : null
    if (!rock) flatten(piece)
    else rocks.set(piece, rock)
  }

  const sit = (piece: StagePiece, force: AxisLock | null) => {
    const home = gridSnap(piece, pieces)
    setLanding({ piece, x: home.x, y: home.y, leave: false, speed: LAND_SPEED, settle: force })
    armRock(piece, home.x - piece.anchor.position.x, home.y - piece.anchor.position.y, force)
  }

  const release = (piece: StagePiece) => {
    const plan = planRelease(piece, pieces, gesture?.trend ?? null, gesture?.samples ?? [])
    const trend = gesture?.trend ?? null
    endGesture()
    if (plan.kind === 'eliminate') {
      flatten(piece)
      eliminate(piece)
      return
    }
    if (plan.kind === 'slide') {
      const next: Landing = { piece, x: plan.x, y: plan.y, leave: plan.clear, speed: plan.speed, settle: null }
      if (!plan.clear) {
        next.settle = trend
        armRock(piece, plan.x - piece.anchor.position.x, plan.y - piece.anchor.position.y, trend)
      }
      setLanding(next)
      return
    }
    sit(piece, trend)
  }

  const onDown = (event: PointerEvent) => {
    if (ended) return
    if (event.button !== 0) return
    // A second finger while the first is still held does not start a gesture.
    // A new press after a missed pointerup takes over, so the next piece is not lost.
    if (gesture && gesture.id !== event.pointerId && stage.hasPointerCapture(gesture.id)) return
    for (const item of landings) flatten(item.piece)
    landings.length = 0
    if (gesture?.piece) release(gesture.piece)
    else if (gesture) endGesture()
    const point = designOf(event)
    if (!point || !pointerInside) return
    const hit = pieceAt(point.x, point.y, pieces)
    stage.setPointerCapture(event.pointerId)
    gesture = {
      id: event.pointerId,
      piece: null,
      finger: seedFinger(point.x, point.y),
      pressX: point.x,
      pressY: point.y,
      originX: 0,
      originY: 0,
      grabX: point.x,
      grabY: point.y,
      fromPress: false,
      samples: [],
      trend: null,
      blocked: false,
    }
    if (hit) takePiece(hit, point.x, point.y, true)
    rememberFinger(gesture.samples, event.timeStamp / 1000, point.x, point.y)
  }

  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const readings = event.getCoalescedEvents?.() ?? [event]
    for (const reading of readings) {
      const point = designOf(reading)
      if (!point) continue
      rememberFinger(gesture.samples, reading.timeStamp / 1000, point.x, point.y)
    }
  }

  const onUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const piece = gesture.piece
    if (piece) release(piece)
    else endGesture()
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
  }

  const onLostCapture = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    if (gesture.piece) release(gesture.piece)
    else endGesture()
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
    update(dt) {
      if (gesture) {
        const moved = followHold(
          gesture.piece,
          pieces,
          gesture.finger,
          gesture.pressX,
          gesture.pressY,
          gesture.originX,
          gesture.originY,
          gesture.grabX,
          gesture.grabY,
          gesture.fromPress,
          gesture.samples,
          gesture.trend,
        )
        if (moved.axis) gesture.trend = moved.axis
        if (moved.blocked && !gesture.blocked) pulseHaptic('hit')
        gesture.blocked = moved.blocked
        const piece = gesture.piece
        if (piece && gesture.trend) {
          const turned = recentAxis(gesture.samples, gesture.trend.axis)
          const along =
            gesture.trend.axis === 'x'
              ? piece.anchor.position.x - gesture.originX
              : piece.anchor.position.y - gesture.originY
          if (turned && (Math.abs(along) <= HOME_BAND || moved.blocked)) turnAxis(piece, turned)
        }
        const next = replacementTarget(
          piece,
          pieces,
          gesture.trend,
          gesture.finger.x,
          gesture.finger.y,
          isLanding,
        )
        if (piece && next && next !== piece) {
          const dropped = piece
          const force = gesture.trend
          gesture.piece = null
          held = null
          sit(dropped, force)
          takePiece(next, gesture.finger.x, gesture.finger.y, false)
        } else if (piece && moved.blocked && moved.axis && !stillHeld(piece, gesture.finger, moved.axis)) {
          const dropped = piece
          const force = gesture.trend
          gesture.piece = null
          held = null
          sit(dropped, force)
        } else if (!gesture.piece && next) {
          takePiece(next, gesture.finger.x, gesture.finger.y, false)
        }
      }
      for (let i = landings.length - 1; i >= 0; i--) {
        const landing = landings[i]
        if (!landing || landing.piece === held || !landing.piece.alive) {
          landings.splice(i, 1)
          continue
        }
        const dx = landing.x - landing.piece.anchor.position.x
        const dy = landing.y - landing.piece.anchor.position.y
        const dist = Math.hypot(dx, dy)
        const step = landing.speed * dt
        if (dist <= step || dist < 0.01) {
          landing.piece.anchor.position.x = landing.x
          landing.piece.anchor.position.y = landing.y
          landings.splice(i, 1)
          if (landing.leave) eliminate(landing.piece)
          else {
            const home = gridSnap(landing.piece, pieces)
            if (Math.hypot(home.x - landing.piece.anchor.position.x, home.y - landing.piece.anchor.position.y) > 0.01) {
              setLanding({
                piece: landing.piece,
                x: home.x,
                y: home.y,
                leave: false,
                speed: LAND_SPEED,
                settle: landing.settle,
              })
            } else {
              const rock = rocks.get(landing.piece)
              if (rock) rock.seated = true
            }
          }
        } else {
          landing.piece.anchor.position.x += (dx / dist) * step
          landing.piece.anchor.position.y += (dy / dist) * step
        }
      }
      hintTargets.length = 0
      if (held && gesture) {
        const plan = planRelease(held, pieces, gesture.trend, gesture.samples)
        if (plan.kind === 'eliminate' || (plan.kind === 'slide' && plan.clear)) hintTargets.push(held.mesh)
      }
      const ready = hintTargets.length > 0
      if (ready && !readyLit) pulseHaptic('ready')
      readyLit = ready
      hint.set(hintTargets)
      hint.step(dt)
      for (const [piece, rock] of rocks) {
        if (!piece.alive || stepRock(rock, dt)) {
          flatten(piece)
          continue
        }
        const tilt = rockRotation(rock)
        piece.mesh.rotation.x = tilt.x
        piece.mesh.rotation.y = tilt.y
      }
      if (ended && !toldClear) {
        clearWait += dt
        if (clearWait >= CLEAR_DELAY) {
          toldClear = true
          onCleared?.()
        }
      }
      stepShatters(shatters, viewBottomWorld() - SHATTER.chip, dt)
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
        const tilt = Math.abs(piece.mesh.rotation.x) + Math.abs(piece.mesh.rotation.y)
        const dip = tilt > 0 ? piece.half * Math.sin(tilt) : 0
        piece.anchor.position.z = piece.restZ + next * piece.height * 0.5 + dip
        const stroke = piece.outline.material
        if (stroke instanceof THREE.MeshBasicMaterial) stroke.opacity = next
        piece.outline.visible = next > 0.02
      }
    },
    renderOverlay(renderer, camera) {
      outlined.length = 0
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i]
        if (piece.alive && piece.outline.visible) outlined.push(piece)
      }
      const active = outlined
      if (active.length === 0) return
      maskRestore.length = 0
      for (const piece of active) {
        piece.mesh.layers.enable(1)
        const material = piece.mesh.material
        maskRestore.push(material instanceof THREE.Material ? material : maskMaterial)
        piece.mesh.material = maskMaterial
      }
      const autoClear = renderer.autoClear
      const background = scene.background
      try {
        scene.background = null
        renderer.autoClear = false
        renderer.clearDepth()
        camera.layers.set(1)
        renderer.render(scene, camera)
      } finally {
        camera.layers.set(0)
        renderer.autoClear = autoClear
        scene.background = background
        for (let i = 0; i < active.length; i++) {
          active[i].mesh.layers.disable(1)
          active[i].mesh.material = maskRestore[i]
        }
      }
    },
    load(level) {
      if (gesture) releaseFinger(gesture.samples)
      gesture = null
      held = null
      landings.length = 0
      rocks.clear()
      for (const burst of shatters) disposeShatter(burst)
      shatters.length = 0
      praise.rank = 0
      praise.live = false
      ended = false
      clearWait = 0
      toldClear = false
      readyLit = false
      hintTargets.length = 0
      hint.set(hintTargets)
      stageLook.load(level)
      lifts.clear()
      for (const piece of pieces) lifts.set(piece, 0)
    },
    dispose() {
      if (gesture) releaseFinger(gesture.samples)
      stageLook.dispose()
      stage.removeEventListener('pointerdown', onDown)
      stage.removeEventListener('lostpointercapture', onLostCapture)
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerup', onUp)
      stage.removeEventListener('pointercancel', onUp)
    },
  }
}

const chipPool: { x: number; y: number }[] = []
const chips: { x: number; y: number }[] = []

function chipPoints(piece: StagePiece): { x: number; y: number }[] {
  for (let i = 0; i < chips.length; i++) chipPool.push(chips[i])
  chips.length = 0
  for (const local of piece.locals) {
    const x0 = piece.anchor.position.x + local.x - piece.half
    const y0 = piece.anchor.position.y + local.y - piece.half
    const side = piece.half * 2
    for (let col = 0; col < SHATTER.cols; col++) {
      for (let row = 0; row < SHATTER.rows; row++) {
        const point = chipPool.pop() ?? { x: 0, y: 0 }
        point.x = x0 + ((col + 0.5) * side) / SHATTER.cols
        point.y = y0 + ((row + 0.5) * side) / SHATTER.rows
        chips.push(point)
      }
    }
  }
  return chips
}

function pieceColor(piece: StagePiece): number {
  const material = piece.mesh.material
  return material instanceof THREE.MeshStandardMaterial ? material.color.getHex() : 0xffffff
}
