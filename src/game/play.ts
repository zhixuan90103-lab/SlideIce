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

  const ambient = new THREE.AmbientLight(0xfff8f2, 0)
  const hemi = new THREE.HemisphereLight(0xfff8f2, 0xf3d7be, 1.55)
  const key = new THREE.DirectionalLight(0xffffff, 0.85)
  const fill = new THREE.DirectionalLight(0xffe4cc, 0.28)
  const rim = new THREE.DirectionalLight(0xffe4cc, 0)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0008
  key.shadow.normalBias = 0.04
  key.shadow.radius = 6
  key.shadow.intensity = 1
  if ('blurSamples' in key.shadow) key.shadow.blurSamples = 16
  key.shadow.camera.near = 100
  key.shadow.camera.far = 2000
  key.shadow.camera.left = -280
  key.shadow.camera.right = 280
  key.shadow.camera.top = 280
  key.shadow.camera.bottom = -280
  scene.add(ambient, hemi, key, fill, rim)
  scene.add(key.target)
  const lightAim = new THREE.Vector3(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, 0)
  key.target.position.copy(lightAim)
  const placeLight = (light: THREE.DirectionalLight, azimuth: number, elevation: number) => {
    const az = THREE.MathUtils.degToRad(azimuth)
    const el = THREE.MathUtils.degToRad(elevation)
    const flat = Math.cos(el) * 900
    light.position.set(
      lightAim.x + Math.sin(az) * flat,
      lightAim.y + Math.cos(az) * flat,
      lightAim.z + Math.sin(el) * 900,
    )
  }
  placeLight(key, -30, 80)
  placeLight(fill, -101, 57)
  placeLight(rim, 149, 42)

  scene.background = softSky()
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(DESIGN_WIDTH, DESIGN_HEIGHT),
    new THREE.ShadowMaterial({ opacity: 0.4 }),
  )
  shadowPlane.receiveShadow = true
  shadowPlane.position.set(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, -40)
  scene.add(shadowPlane)

  const boardMat = new THREE.MeshStandardMaterial({
    color: 0xfaf7f3,
    roughness: 0.62,
    metalness: 0,
  })
  boardMat.shadowSide = THREE.BackSide
  const floorTop = -7
  const tray = makeTray(boardMat, 60)
  const floor = makeFloor(boardMat)
  scene.add(tray)
  scene.add(floor)
  scene.add(makeGrid())
  const cubeMat = plastic(0xf27b4e)
  let cubeGeometry: THREE.BufferGeometry = new THREE.BufferGeometry()
  const cubes: THREE.Mesh[] = []
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const cube = new THREE.Mesh(cubeGeometry, cubeMat)
      cube.castShadow = true
      cube.receiveShadow = true
      cube.position.set(
        ORIGIN_X + (col + 0.5) * CELL,
        -(ORIGIN_Y + (row + 0.5) * CELL),
        floorTop,
      )
      scene.add(cube)
      cubes.push(cube)
    }
  }
  const placeCube = (size: number, corner: number, edge: number) => {
    const bevel = Math.min(Math.max(1, edge), size / 2 - 1.5)
    const next = evenCubeGeometry(size, corner, bevel)
    cubeGeometry.dispose()
    cubeGeometry = next
    for (const cube of cubes) cube.geometry = cubeGeometry
    tray.geometry.dispose()
    tray.geometry = trayGeometry(size, corner, edge)
    tray.position.z = floorTop + TRAY_BEVEL
    floor.geometry.dispose()
    floor.geometry = floorGeometry(size, corner, edge)
  }
  placeCube(BODY, 5, 8)

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
      ambient.intensity = 0
      hemi.intensity = ambientIntensity
      key.intensity = keyIntensity
      fill.intensity = fillIntensity
      rim.intensity = 0
      placeLight(key, keyAzimuth, keyElevation)
      placeLight(fill, fillAzimuth, fillElevation)
    },
    setCube(size: number, corner: number, edge: number): void {
      placeCube(Math.max(20, size), Math.max(2, corner), Math.max(1, edge))
    },
    setRoughness(roughness: number): void {
      const value = Math.min(1, Math.max(0, roughness))
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

function snapRounded(x: number, y: number, half: number, radius: number): [number, number] {
  const r = Math.min(Math.max(radius, 0), half - 0.001)
  const lim = half - r
  const sx = Math.sign(x) || 1
  const sy = Math.sign(y) || 1
  let ax = Math.min(Math.abs(x), half)
  let ay = Math.min(Math.abs(y), half)
  if (ax > lim && ay > lim) {
    const dx = ax - lim
    const dy = ay - lim
    const len = Math.hypot(dx, dy)
    if (len > r) {
      ax = lim + (dx / len) * r
      ay = lim + (dy / len) * r
    }
  }
  return [sx * ax, sy * ay]
}

/** Top is an even grid. The bevel rings share that grid's outer loop, so the cap is not one flat fan. */
function evenCubeGeometry(size: number, corner: number, bevel: number): THREE.BufferGeometry {
  const div = 12
  const bevelSeg = 24
  const halfIn = size / 2 - bevel
  const radIn = Math.min(halfIn - 0.25, Math.max(0.5, corner - bevel))
  const halfOut = size / 2
  const radOut = Math.min(halfOut - 0.25, radIn + bevel)
  const positions: number[] = []
  const indices: number[] = []
  const add = (x: number, y: number, z: number) => {
    positions.push(x, y, z)
    return positions.length / 3 - 1
  }
  const grid = (half: number, rad: number) => {
    const rows: [number, number][][] = []
    for (let j = 0; j <= div; j++) {
      const y = -half + (2 * half * j) / div
      const row: [number, number][] = []
      for (let i = 0; i <= div; i++) {
        const x = -half + (2 * half * i) / div
        row.push(snapRounded(x, y, half, rad))
      }
      rows.push(row)
    }
    return rows
  }
  const top = grid(halfIn, radIn)
  const topId = top.map((row) => row.map(([x, y]) => add(x, y, size)))
  for (let j = 0; j < div; j++) {
    for (let i = 0; i < div; i++) {
      const a = topId[j][i]
      const b = topId[j][i + 1]
      const c = topId[j + 1][i + 1]
      const d = topId[j + 1][i]
      indices.push(a, b, c, a, c, d)
    }
  }
  const ringOf = (half: number, rad: number, z: number) => {
    const g = grid(half, rad)
    const ids: number[] = []
    for (let i = 0; i < div; i++) ids.push(add(g[0][i][0], g[0][i][1], z))
    for (let j = 0; j < div; j++) ids.push(add(g[j][div][0], g[j][div][1], z))
    for (let i = div; i > 0; i--) ids.push(add(g[div][i][0], g[div][i][1], z))
    for (let j = div; j > 0; j--) ids.push(add(g[j][0][0], g[j][0][1], z))
    return ids
  }
  const topRing: number[] = []
  for (let i = 0; i < div; i++) topRing.push(topId[0][i])
  for (let j = 0; j < div; j++) topRing.push(topId[j][div])
  for (let i = div; i > 0; i--) topRing.push(topId[div][i])
  for (let j = div; j > 0; j--) topRing.push(topId[j][0])
  const bridge = (upper: number[], lower: number[]) => {
    for (let i = 0; i < upper.length; i++) {
      const i1 = (i + 1) % upper.length
      indices.push(upper[i], lower[i], lower[i1], upper[i], lower[i1], upper[i1])
    }
  }
  const bottom = grid(halfOut, radOut)
  const bottomId = bottom.map((row) => row.map(([x, y]) => add(x, y, 0)))
  for (let j = 0; j < div; j++) {
    for (let i = 0; i < div; i++) {
      const a = bottomId[j][i]
      const b = bottomId[j][i + 1]
      const c = bottomId[j + 1][i + 1]
      const d = bottomId[j + 1][i]
      indices.push(a, c, b, a, d, c)
    }
  }
  const bottomRing: number[] = []
  for (let i = 0; i < div; i++) bottomRing.push(bottomId[0][i])
  for (let j = 0; j < div; j++) bottomRing.push(bottomId[j][div])
  for (let i = div; i > 0; i--) bottomRing.push(bottomId[div][i])
  for (let j = div; j > 0; j--) bottomRing.push(bottomId[j][0])

  let prev = topRing
  for (let s = 1; s <= bevelSeg; s++) {
    const t = s / bevelSeg
    const k = Math.sin((t * Math.PI) / 2)
    const ring = ringOf(
      halfIn + (halfOut - halfIn) * k,
      radIn + (radOut - radIn) * k,
      size - bevel * (1 - Math.cos((t * Math.PI) / 2)),
    )
    bridge(prev, ring)
    prev = ring
  }
  bridge(prev, bottomRing)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
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

const TRAY_BEVEL = 6
const TRAY_BEVEL_SIZE = 5
const TRAY_LIP = 12
const TRAY_MARGIN = 4

/** The bevel pulls the inner wall inward, so the hole path is larger than the opening. */
function traySpans(size: number, corner: number, edge: number) {
  const opening = BOARD - (CELL - size) + TRAY_MARGIN * 2
  const hole = opening + TRAY_BEVEL_SIZE * 2
  const outer = hole + TRAY_LIP * 2
  const holeRadius = Math.max(corner, edge) + TRAY_MARGIN + TRAY_BEVEL_SIZE
  return {
    opening,
    hole,
    outer,
    holeRadius,
    outerRadius: holeRadius + TRAY_LIP,
    floorSpan: outer - TRAY_BEVEL_SIZE * 2,
    floorRadius: Math.max(corner, edge) + TRAY_MARGIN + TRAY_LIP,
  }
}

function trayGeometry(size: number, corner: number, edge: number): THREE.ExtrudeGeometry {
  const span = traySpans(size, corner, edge)
  const frame = new THREE.Shape()
  roundLoop(frame, -span.outer / 2, -span.outer / 2, span.outer, span.outer, span.outerRadius)
  const hole = new THREE.Path()
  roundLoop(hole, -span.hole / 2, -span.hole / 2, span.hole, span.hole, span.holeRadius)
  frame.holes.push(hole)
  const depth = Math.max(1, size - TRAY_BEVEL)
  return new THREE.ExtrudeGeometry(frame, {
    depth,
    bevelEnabled: true,
    bevelThickness: TRAY_BEVEL,
    bevelSize: TRAY_BEVEL_SIZE,
    bevelSegments: 8,
  })
}

export function makeTray(material: THREE.Material, height = 60): THREE.Mesh {
  const mesh = new THREE.Mesh(trayGeometry(height, 5, 8), material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const cx = ORIGIN_X + BOARD / 2
  const cy = -(ORIGIN_Y + BOARD / 2)
  mesh.position.set(cx, cy, -7)
  return mesh
}

const FLOOR_BEVEL = 6
const FLOOR_THICK = 24

function floorGeometry(size: number, corner: number, edge: number): THREE.ExtrudeGeometry {
  const span = traySpans(size, corner, edge)
  const shape = new THREE.Shape()
  roundLoop(shape, -span.floorSpan / 2, -span.floorSpan / 2, span.floorSpan, span.floorSpan, span.floorRadius)
  const depth = FLOOR_THICK - FLOOR_BEVEL * 2
  return new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: FLOOR_BEVEL,
      bevelSize: 2,
      bevelSegments: 6,
    })
}

export function makeFloor(material: THREE.Material): THREE.Mesh {
  const depth = FLOOR_THICK - FLOOR_BEVEL * 2
  const mesh = new THREE.Mesh(floorGeometry(60, 5, 8), material)
  mesh.position.set(ORIGIN_X + BOARD / 2, -(ORIGIN_Y + BOARD / 2), -7 - depth - FLOOR_BEVEL)
  mesh.castShadow = false
  mesh.receiveShadow = true
  return mesh
}

function gridTexture(): THREE.CanvasTexture {
  const size = 640
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#faf7f3'
  ctx.fillRect(0, 0, size, size)
  const cell = size / GRID
  const gap = (GAP / CELL) * cell
  const radius = gap * 1.6
  ctx.fillStyle = '#f3efe9'
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const x = col * cell + gap / 2
      const y = row * cell + gap / 2
      const w = cell - gap
      ctx.beginPath()
      ctx.roundRect(x, y, w, w, radius)
      ctx.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function makeGrid(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD, BOARD),
    new THREE.MeshStandardMaterial({
      map: gridTexture(),
      roughness: 0.62,
      metalness: 0,
    }),
  )
  mesh.position.set(ORIGIN_X + BOARD / 2, -(ORIGIN_Y + BOARD / 2), -6.85)
  mesh.receiveShadow = true
  return mesh
}

function softSky(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
  gradient.addColorStop(0, '#4aa8ee')
  gradient.addColorStop(0.55, '#79c6f8')
  gradient.addColorStop(1, '#9ed8fb')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
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
