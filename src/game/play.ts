/**
 * Screen frame, one source:
 *   world x = design x
 *   world y = -design y
 *   camera on +z, looking toward -z, up = +y
 * So row-down is world -y, and 下 slides toward -y.
 * The ortho shear in main.ts drops the -y face by 4 design pixels.
 * Piece groups stay on their cells. Drag offset and squash live on a child.
 */

import * as THREE from 'three'
import { DESIGN_HEIGHT, DESIGN_WIDTH, type StageLayout } from '../adapt/design'
import {
  DIR_STEP,
  GRID,
  WALL,
  type Dir,
  type PieceDef,
  assertLevel1,
  cellKey,
  startingOccupancy,
  sweepBlockers,
} from './level'
import { mountStage } from './stage'

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
  /** Extruded height in design pixels. Bottom stays at z = 2. Returns the top z. */
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

export function mountWoodGame(
  scene: THREE.Scene,
  stage: HTMLElement,
  getLayout: () => StageLayout | null,
): WoodGame {
  assertLevel1()
  assertFrame()

  const stageLook = mountStage(scene)

  const occ = startingOccupancy()
  const views = new Map<string, View>()

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
    setLights(keyIntensity, keyAzimuth, keyElevation, fillIntensity, fillAzimuth, fillElevation, ambientIntensity): void {
      stageLook.setLights(keyIntensity, keyAzimuth, keyElevation, fillIntensity, fillAzimuth, fillElevation, ambientIntensity)
    },
    setCube(size: number, corner: number, edge: number): void {
      stageLook.setCube(size, corner, edge)
    },
    setRoughness(roughness: number): void {
      const value = Math.min(1, Math.max(0, roughness))
      stageLook.setRoughness(value)
      for (const material of woodMaterials) material.roughness = value
    },
    setPieceHeight(height: number): number {
      const h = Math.max(1, height)
      for (const view of views.values()) {
        const mesh = view.visual.children[0] as THREE.Mesh
        mesh.scale.z = h / MESH_H
        mesh.position.z = TOP_Z - MESH_H
      }
      return TOP_Z - MESH_H + h
    },
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
  C: 0x3aa8ff,
  H: 0xff8a2a,
  A: 0xf2c14e,
  P: 0x3dcc73,
  B: 0xa86bff,
  M: 0xff564c,
}

/** Unscaled mesh height. Built at play size so the bevel is not stretched into a straight wall. */
const MESH_H = 40
const TOP_Z = MESH_H + 2
const CORNER_R = 16
const BEVEL_Z = 10
const BEVEL_XY = 7

export function makePiece(def: PieceDef): View {
  const centers = def.cells.map(([col, row]) => cellWorld(col, row))
  const home = centers
    .reduce((sum, center) => sum.add(center), new THREE.Vector3())
    .multiplyScalar(1 / centers.length)
  const group = new THREE.Group()
  group.position.copy(home)
  const visual = new THREE.Group()
  group.add(visual)

  const mesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(pieceShape(def.cells, home), {
      depth: MESH_H - BEVEL_Z * 2,
      bevelEnabled: true,
      bevelThickness: BEVEL_Z,
      bevelSize: BEVEL_XY,
      bevelSegments: 8,
      bevelOffset: 0,
    }),
    plastic(PIECE_TINT[def.id] ?? 0xff8a2a),
  )
  mesh.position.z = TOP_Z - MESH_H
  mesh.castShadow = true
  mesh.receiveShadow = true
  visual.add(mesh)
  const shadowShape = pieceShape(def.cells, home)
  const shadow = new THREE.Mesh(
    new THREE.ShapeGeometry(shadowShape),
    new THREE.MeshBasicMaterial({
      color: 0x2a140c,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  )
  shadow.position.set(2, -2.5, 0.6)
  visual.add(shadow)
  return { def, group, visual, home }
}

/** Union of the cells, inset by half the gap, convex corners filleted. Local XY, y up. */
function pieceShape(cells: readonly (readonly [number, number])[], home: THREE.Vector3): THREE.Shape {
  const set = new Set(cells.map(([c, r]) => cellKey(c, r)))
  const has = (c: number, r: number) => set.has(cellKey(c, r))
  const edges: [number, number, number, number][] = []
  for (const [c, r] of cells) {
    if (!has(c, r - 1)) edges.push([c, r, c + 1, r])
    if (!has(c + 1, r)) edges.push([c + 1, r, c + 1, r + 1])
    if (!has(c, r + 1)) edges.push([c + 1, r + 1, c, r + 1])
    if (!has(c - 1, r)) edges.push([c, r + 1, c, r])
  }
  const key = (c: number, r: number) => `${c},${r}`
  const next = new Map(edges.map(([a, b, c, d]) => [key(a, b), [c, d] as const]))
  const start = [edges[0][0], edges[0][1]] as const
  const poly: [number, number][] = [[start[0], start[1]]]
  let cur: readonly [number, number] = start
  for (let i = 0; i < edges.length; i++) {
    const n = next.get(key(cur[0], cur[1]))
    if (!n) break
    if (n[0] === start[0] && n[1] === start[1]) break
    poly.push([n[0], n[1]])
    cur = n
  }
  const welded: [number, number][] = []
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length]
    const p = poly[i]
    const nxt = poly[(i + 1) % poly.length]
    if ((prev[0] === p[0] && p[0] === nxt[0]) || (prev[1] === p[1] && p[1] === nxt[1])) continue
    welded.push(p)
  }
  const inset = GAP / 2 + BEVEL_XY
  const offset: [number, number][] = welded.map((p, i) => {
    const prev = welded[(i + welded.length - 1) % welded.length]
    const nxt = welded[(i + 1) % welded.length]
    const in1 = inward(prev, p)
    const in2 = inward(p, nxt)
    return [p[0] * CELL + (in1[0] + in2[0]) * inset, p[1] * CELL + (in1[1] + in2[1]) * inset]
  })
  const filleted = filletConvex(offset, CORNER_R)
  const shape = new THREE.Shape()
  filleted.forEach(([x, y], i) => {
    const lx = ORIGIN_X + x - home.x
    const ly = -(ORIGIN_Y + y) - home.y
    if (i === 0) shape.moveTo(lx, ly)
    else shape.lineTo(lx, ly)
  })
  shape.closePath()
  return shape
}

function inward(a: readonly [number, number], b: readonly [number, number]): [number, number] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  return [-dy / len, dx / len]
}

function filletConvex(points: [number, number][], radius: number): [number, number][] {
  const out: [number, number][] = []
  const segs = 10
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i + points.length - 1) % points.length]
    const p = points[i]
    const nxt = points[(i + 1) % points.length]
    const v1x = p[0] - prev[0]
    const v1y = p[1] - prev[1]
    const v2x = nxt[0] - p[0]
    const v2y = nxt[1] - p[1]
    const cross = v1x * v2y - v1y * v2x
    if (cross <= 0) {
      out.push(p)
      continue
    }
    const l1 = Math.hypot(v1x, v1y) || 1
    const l2 = Math.hypot(v2x, v2y) || 1
    const a: [number, number] = [p[0] - (v1x / l1) * radius, p[1] - (v1y / l1) * radius]
    const b: [number, number] = [p[0] + (v2x / l2) * radius, p[1] + (v2y / l2) * radius]
    const cx = a[0] + b[0] - p[0]
    const cy = a[1] + b[1] - p[1]
    const ang0 = Math.atan2(a[1] - cy, a[0] - cx)
    let d = Math.atan2(b[1] - cy, b[0] - cx) - ang0
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    for (let s = 0; s <= segs; s++) {
      const ang = ang0 + d * (s / segs)
      out.push([cx + Math.cos(ang) * radius, cy + Math.sin(ang) * radius])
    }
  }
  return out
}

const woodMaterials: THREE.MeshStandardMaterial[] = []

/** Candy plastic, same roughness and metal as Ring. */
function plastic(tint: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: tint,
    roughness: 0.42,
    metalness: 0.02,
    envMapIntensity: 0,
  })
  material.shadowSide = THREE.BackSide
  woodMaterials.push(material)
  return material
}

export function woodMaterial(tint: number, repeat: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: tint,
    map: woodMap(repeat),
    roughness: 0.42,
    metalness: 0.02,
    envMapIntensity: 0,
  })
  material.shadowSide = THREE.BackSide
  woodMaterials.push(material)
  return material
}

function woodMap(repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = '#f4d7a8'
  ctx.fillRect(0, 0, 128, 256)
  for (let i = 0; i < 22; i++) {
    const x = (i * 6) % 128
    ctx.strokeStyle = `rgba(120, 64, 24, ${0.08 + (i % 4) * 0.03})`
    ctx.lineWidth = i % 3 === 0 ? 2.4 : 1.1
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.bezierCurveTo(x + 8, 70, x - 6, 150, x + 2, 256)
    ctx.stroke()
  }
  const map = new THREE.CanvasTexture(canvas)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.repeat.set(repeat, repeat)
  map.colorSpace = THREE.SRGBColorSpace
  return map
}

function roundLoop(path: THREE.Path | THREE.Shape, x: number, y: number, w: number, h: number, r: number): void {
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y)
  path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  path.lineTo(x + w, y + h - r)
  path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  path.lineTo(x + r, y + h)
  path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  path.lineTo(x, y + r)
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
}

export function makeWall(material: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const shape = new THREE.Shape()
  roundLoop(shape, -BODY / 2, -BODY / 2, BODY, BODY, 14)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 8,
    bevelEnabled: true,
    bevelThickness: 5,
    bevelSize: 5,
    bevelSegments: 8,
  })
  for (let row = 0; row < GRID; row++) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(cellWorld(GRID - 1, row))
    mesh.position.z = -6
    mesh.castShadow = true
    mesh.receiveShadow = true
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
