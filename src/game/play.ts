/**
 * Screen frame, one source:
 *   world x = design x
 *   world y = -design y
 *   camera on +z, looking toward -z, up = +y
 * So row-down is world -y, and 下 slides toward -y.
 * Piece groups stay on their cells. Drag offset and squash live on a child.
 */

import * as THREE from 'three'
import { DESIGN_HEIGHT, DESIGN_WIDTH, type StageLayout } from '../adapt/design'
import {
  DIR_STEP,
  GRID,
  PIECES,
  WALL,
  type Dir,
  type PieceDef,
  assertLevel1,
  cellKey,
  startingOccupancy,
  sweepBlockers,
} from './level'

const CELL = 64
const GAP = 4
const BODY = CELL - GAP
const BOARD = GRID * CELL
const ORIGIN_X = (DESIGN_WIDTH - BOARD) / 2
const ORIGIN_Y = (DESIGN_HEIGHT - BOARD) / 2
const DEAD = 6
const BLOCKED_SLIDE = 0.15 * CELL
const COMMIT = 0.55 * CELL
const SQUASH_S = 0.15
const EXIT_TRAVEL = (GRID + 1) * CELL

type View = {
  def: PieceDef
  group: THREE.Group
  visual: THREE.Group
  home: THREE.Vector3
}

type Gesture = {
  id: number
  piece: View
  x0: number
  y0: number
  judged: boolean
  wrong: boolean
  squashed: boolean
}

export type WoodGame = {
  update(dt: number): void
  dispose(): void
}

export function mountWoodGame(
  scene: THREE.Scene,
  stage: HTMLElement,
  getLayout: () => StageLayout | null,
): WoodGame {
  assertLevel1()
  assertFrame()

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2a1c, 1.15))
  const key = new THREE.DirectionalLight(0xfff7ee, 1.25)
  key.position.set(80, 220, 300)
  scene.add(key)

  scene.background = new THREE.Color(0x6a3b22)
  const trayMat = woodMaterial(0x8a5a32, 1.4)
  const floorMat = woodMaterial(0x6e4428, 1.1)

  scene.add(makeBackdrop())
  scene.add(makeTray(trayMat))
  scene.add(makeFloor(floorMat))
  scene.add(makeWall(trayMat))

  const occ = startingOccupancy()
  const views = new Map<string, View>()
  for (const def of PIECES) {
    const view = makePiece(def)
    views.set(def.id, view)
    scene.add(view.group)
  }

  let gesture: Gesture | null = null
  let ended = false
  const springs: View[] = []
  let exiting: { view: View; gone: number } | null = null

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
    if (ended || gesture || exiting) return
    if (event.button !== 0) return
    const point = designOf(event)
    if (!point || !inDesign(point.x, point.y)) return
    const hit = pieceAt(point.x, point.y, occ, views)
    if (!hit) return
    stage.setPointerCapture(event.pointerId)
    gesture = {
      id: event.pointerId,
      piece: hit,
      x0: point.x,
      y0: point.y,
      judged: false,
      wrong: false,
      squashed: false,
    }
  }

  const onMove = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id || exiting) return
    const point = designOf(event)
    if (!point) return
    applyDrag(gesture, point.x - gesture.x0, point.y - gesture.y0, occ)
  }

  const onUp = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const point = designOf(event)
    const dragX = point ? point.x - gesture.x0 : 0
    const dragY = point ? point.y - gesture.y0 : 0
    const piece = gesture.piece
    const along = gesture.wrong ? 0 : alongExit(piece.def.dir, dragX, dragY)
    const free = sweepBlockers(piece.def.cells, piece.def.dir, occ, piece.def.id).length === 0
    const commit = gesture.judged && !gesture.wrong && free && along >= COMMIT
    gesture = null
    if (commit) {
      for (const [col, row] of piece.def.cells) occ.delete(cellKey(col, row))
      exiting = { view: piece, gone: 0 }
      return
    }
    if (!springs.includes(piece)) springs.push(piece)
    if ([...views.values()].every((view) => !occHas(occ, view.def.id))) {
      ended = true
    }
  }

  stage.addEventListener('pointerdown', onDown)
  stage.addEventListener('pointermove', onMove)
  stage.addEventListener('pointerup', onUp)
  stage.addEventListener('pointercancel', onUp)

  return {
    update(dt) {
      for (const view of views.values()) easeScale(view, dt)
      for (const view of springs) {
        view.visual.position.multiplyScalar(Math.max(0, 1 - dt * 14))
        if (view.visual.position.lengthSq() < 0.2 && scaleDone(view)) {
          view.visual.position.set(0, 0, 0)
          view.visual.scale.set(1, 1, 1)
          springs.splice(springs.indexOf(view), 1)
        }
      }
      if (!exiting) return
      const step = Math.min(dt * 900, EXIT_TRAVEL - exiting.gone)
      exiting.gone += step
      const [dx, dy] = exitWorld(exiting.view.def.dir, step)
      exiting.view.visual.position.x += dx
      exiting.view.visual.position.y += dy
      if (exiting.gone >= EXIT_TRAVEL) {
        exiting.view.group.visible = false
        views.delete(exiting.view.def.id)
        exiting = null
        if (views.size === 0) ended = true
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

function applyDrag(
  gesture: Gesture,
  dragX: number,
  dragY: number,
  occ: ReadonlyMap<string, string>,
): void {
  const dir = gesture.piece.def.dir
  const along = alongExit(dir, dragX, dragY)
  // 左/右 step is (±1, 0), so the perpendicular axis is design y.
  const perpAbs = DIR_STEP[dir][0] !== 0 ? Math.abs(dragY) : Math.abs(dragX)
  if (!gesture.judged) {
    if (Math.hypot(dragX, dragY) < DEAD) return
    gesture.judged = true
    gesture.wrong = !(Math.abs(along) >= perpAbs && along > 0)
  }
  if (gesture.wrong) {
    gesture.piece.visual.position.set(0, 0, 0)
    if (!gesture.squashed) {
      gesture.squashed = true
      squash(gesture.piece)
    }
    return
  }
  const blocked =
    sweepBlockers(gesture.piece.def.cells, dir, occ, gesture.piece.def.id).length > 0
  const slide = blocked ? Math.min(Math.max(along, 0), BLOCKED_SLIDE) : Math.max(along, 0)
  const [wx, wy] = exitWorld(dir, slide)
  gesture.piece.visual.position.set(wx, wy, 0)
}

function alongExit(dir: Dir, dragX: number, dragY: number): number {
  const [dc, dr] = DIR_STEP[dir]
  return dragX * dc + dragY * dr
}

/** Design-pixel slide → world. 下 (0,+1 row) is world -y. */
function exitWorld(dir: Dir, pixels: number): [number, number] {
  const [dc, dr] = DIR_STEP[dir]
  return [dc * pixels, -dr * pixels]
}

function pieceAt(
  x: number,
  y: number,
  occ: ReadonlyMap<string, string>,
  views: ReadonlyMap<string, View>,
): View | null {
  const col = Math.floor((x - ORIGIN_X) / CELL)
  const row = Math.floor((y - ORIGIN_Y) / CELL)
  if (col < 0 || row < 0 || col >= GRID || row >= GRID) return null
  const id = occ.get(cellKey(col, row))
  if (!id || id === WALL) return null
  return views.get(id) ?? null
}

function occHas(occ: ReadonlyMap<string, string>, id: string): boolean {
  for (const who of occ.values()) if (who === id) return true
  return false
}

function cellWorld(col: number, row: number): THREE.Vector3 {
  return new THREE.Vector3(
    ORIGIN_X + (col + 0.5) * CELL,
    -(ORIGIN_Y + (row + 0.5) * CELL),
    0,
  )
}

const PIECE_TINT: Record<string, number> = {
  C: 0x3d74d6,
  H: 0xf0b02a,
  A: 0xf2c14b,
  P: 0x2f9a4a,
  B: 0x7d4eb8,
  M: 0xef7d32,
}

function makePiece(def: PieceDef): View {
  const centers = def.cells.map(([col, row]) => cellWorld(col, row))
  const home = centers
    .reduce((sum, center) => sum.add(center), new THREE.Vector3())
    .multiplyScalar(1 / centers.length)
  const group = new THREE.Group()
  group.position.copy(home)
  const visual = new THREE.Group()
  group.add(visual)

  const occupied = new Set(def.cells.map(([col, row]) => cellKey(col, row)))
  const has = (col: number, row: number) => occupied.has(cellKey(col, row))
  const material = woodMaterial(PIECE_TINT[def.id] ?? 0xe0b56a, 0.85)
  for (const [col, row] of def.cells) {
    const growL = has(col - 1, row) ? GAP / 2 : 0
    const growR = has(col + 1, row) ? GAP / 2 : 0
    const growD = has(col, row + 1) ? GAP / 2 : 0
    const growU = has(col, row - 1) ? GAP / 2 : 0
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(BODY + growL + growR, BODY + growU + growD, 16),
      material,
    )
    const center = cellWorld(col, row)
    box.position.set(
      center.x - home.x + (growR - growL) / 2,
      center.y - home.y + (growU - growD) / 2,
      8,
    )
    visual.add(box)
  }
  visual.add(makeArrow(def, home))
  return { def, group, visual, home }
}

function makeArrow(def: PieceDef, home: THREE.Vector3): THREE.Mesh {
  const [dc, dr] = DIR_STEP[def.dir]
  const front = extreme(def.cells, dc, dr)
  const at = new THREE.Vector3()
  let n = 0
  for (const [col, row] of def.cells) {
    if (!front.has(cellKey(col, row))) continue
    at.add(cellWorld(col, row))
    n += 1
  }
  at.multiplyScalar(1 / n)
  at.x += dc * CELL * 0.28
  at.y += -dr * CELL * 0.28
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(7, 12, 3),
    new THREE.MeshStandardMaterial({ color: 0xfff6e8, roughness: 0.45 }),
  )
  arrow.position.set(at.x - home.x, at.y - home.y, 18)
  arrow.rotation.z = Math.atan2(-dr, dc) - Math.PI / 2
  return arrow
}

function woodMaterial(tint: number, repeat: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: tint,
    map: woodMap(repeat),
    roughness: 0.62,
    metalness: 0.02,
  })
}

function woodMap(repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = '#f3d7a2'
  ctx.fillRect(0, 0, 128, 256)
  for (let i = 0; i < 48; i++) {
    const x = Math.random() * 128
    ctx.strokeStyle = `rgba(90, 52, 18, ${0.08 + Math.random() * 0.14})`
    ctx.lineWidth = 1 + Math.random() * 2
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.bezierCurveTo(x + 12, 70, x - 10, 150, x + 6, 256)
    ctx.stroke()
  }
  const map = new THREE.CanvasTexture(canvas)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.repeat.set(repeat, repeat)
  map.colorSpace = THREE.SRGBColorSpace
  return map
}

function makeBackdrop(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(DESIGN_WIDTH, DESIGN_HEIGHT),
    woodMaterial(0x7a4524, 2.2),
  )
  mesh.position.set(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, -40)
  return mesh
}

/** Front cells: maximum of col*dc + row*dr. 左 is dc=-1, so the max is the leftmost column. */
function extreme(cells: readonly (readonly [number, number])[], dc: number, dr: number): Set<string> {
  let best = -Infinity
  for (const [col, row] of cells) best = Math.max(best, col * dc + row * dr)
  const out = new Set<string>()
  for (const [col, row] of cells) {
    if (col * dc + row * dr === best) out.add(cellKey(col, row))
  }
  return out
}

function makeTray(material: THREE.Material): THREE.Mesh {
  const lip = 28
  const outer = BOARD + lip * 2
  const hole = new THREE.Path()
  hole.moveTo(-BOARD / 2, -BOARD / 2)
  hole.lineTo(-BOARD / 2, BOARD / 2)
  hole.lineTo(BOARD / 2, BOARD / 2)
  hole.lineTo(BOARD / 2, -BOARD / 2)
  hole.closePath()
  const frame = new THREE.Shape()
  frame.moveTo(-outer / 2, -outer / 2)
  frame.lineTo(outer / 2, -outer / 2)
  frame.lineTo(outer / 2, outer / 2)
  frame.lineTo(-outer / 2, outer / 2)
  frame.closePath()
  frame.holes.push(hole)
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(frame, { depth: 16, bevelEnabled: false }), material)
  const cx = ORIGIN_X + BOARD / 2
  const cy = -(ORIGIN_Y + BOARD / 2)
  mesh.position.set(cx, cy, -10)
  return mesh
}

function makeFloor(material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(BOARD, BOARD, 4), material)
  mesh.position.set(ORIGIN_X + BOARD / 2, -(ORIGIN_Y + BOARD / 2), -8)
  return mesh
}

function makeWall(material: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  for (let row = 0; row < GRID; row++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BODY, BODY, 16), material)
    mesh.position.copy(cellWorld(GRID - 1, row))
    mesh.position.z = -2
    group.add(mesh)
  }
  return group
}

function squash(view: View): void {
  const horizontal = DIR_STEP[view.def.dir][0] !== 0
  view.visual.scale.set(horizontal ? 0.82 : 1.08, horizontal ? 1.08 : 0.82, 1)
  view.visual.userData.squash = SQUASH_S
}

function easeScale(view: View, dt: number): void {
  const left = Number(view.visual.userData.squash ?? 0)
  if (left <= 0) {
    view.visual.scale.set(1, 1, 1)
    return
  }
  const next = Math.max(0, left - dt)
  view.visual.userData.squash = next
  const t = next / SQUASH_S
  const horizontal = DIR_STEP[view.def.dir][0] !== 0
  const sx = 1 + (horizontal ? -0.18 : 0.08) * t
  const sy = 1 + (horizontal ? 0.08 : -0.18) * t
  view.visual.scale.set(sx, sy, 1)
}

function scaleDone(view: View): boolean {
  return Number(view.visual.userData.squash ?? 0) <= 0
}

function assertFrame(): void {
  const top = cellWorld(0, 0)
  const below = cellWorld(0, 1)
  if (!(top.y > below.y)) throw new Error('row down must be world -y')
  const [dx, dy] = exitWorld('下', CELL)
  if (!(dx === 0 && dy < 0)) throw new Error('下 must slide toward -y')
  const [lx, ly] = exitWorld('左', CELL)
  if (!(lx < 0 && ly === 0)) throw new Error('左 must slide toward -x')
}
