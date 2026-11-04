import * as THREE from 'three'
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design'
import { LEVEL } from './level'
import {
  BOARD_GRID,
  CELL,
  BOARD_ROUGHNESS,
  FILL_COLOR,
  FLOOR_TOP,
  HEMI_GROUND,
  HEMI_SKY,
  KEY_COLOR,
  PLASTIC_METALNESS,
  PLASTIC_ROUGHNESS,
  SHADOW_OPACITY,
  SHADOW_Z,
  SKY,
  look,
} from './look'

const GAP = 4
/** How far the silhouette shell sits outside the piece, in design pixels. */
const OUTLINE = 4
const BOARD = BOARD_GRID * CELL
const ORIGIN_X = (DESIGN_WIDTH - BOARD) / 2
const ORIGIN_Y = (DESIGN_HEIGHT - BOARD) / 2

export type StagePiece = {
  /** Logical pose. Collision and release read this, never the bump. */
  anchor: THREE.Group
  mesh: THREE.Mesh
  /** Silhouette shell. Opacity follows the lift. */
  outline: THREE.Mesh
  cells: readonly (readonly [number, number])[]
  /** Cell centers relative to the mesh origin. */
  locals: { x: number; y: number }[]
  half: number
  height: number
  restZ: number
  alive: boolean
}

export type StageRig = {
  pieces: StagePiece[]
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
  setRoughness(roughness: number): void
}

/** Current level board. World x right, world y up. The size follows the drawn grid, not a fixed 5×5. */
export function boardRect(): { minX: number; maxX: number; minY: number; maxY: number } {
  return { minX: ORIGIN_X, maxX: ORIGIN_X + BOARD, minY: -(ORIGIN_Y + BOARD), maxY: -ORIGIN_Y }
}

/** Piece center is inside the current level board. */
export function centerInGrid(x: number, y: number): boolean {
  const board = boardRect()
  return x >= board.minX && x <= board.maxX && y <= board.maxY && y >= board.minY
}

/** Nearest board-lattice cell center. The lattice continues past the board. */
export function nearestCellCenter(x: number, y: number): { x: number; y: number } {
  const col = Math.round((x - ORIGIN_X) / CELL - 0.5)
  const row = Math.round((-y - ORIGIN_Y) / CELL - 0.5)
  return {
    x: ORIGIN_X + (col + 0.5) * CELL,
    y: -(ORIGIN_Y + (row + 0.5) * CELL),
  }
}

export function mountStage(scene: THREE.Scene): StageRig {
  const ambient = new THREE.AmbientLight(HEMI_SKY, 0)
  const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, look.ambient)
  const key = new THREE.DirectionalLight(KEY_COLOR, look.key)
  const fill = new THREE.DirectionalLight(FILL_COLOR, look.fill)
  const rim = new THREE.DirectionalLight(FILL_COLOR, 0)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0008
  key.shadow.normalBias = 0.04
  key.shadow.radius = 6
  key.shadow.intensity = 1
  if ('blurSamples' in key.shadow) key.shadow.blurSamples = 16
  key.shadow.camera.near = 100
  key.shadow.camera.far = 2000
  // Stage corners sit near ±480 in this light. Pieces can leave the screen by their own length, so the map is larger.
  const shadowReach = 900
  key.shadow.camera.left = -shadowReach
  key.shadow.camera.right = shadowReach
  key.shadow.camera.top = shadowReach
  key.shadow.camera.bottom = -shadowReach
  key.shadow.camera.updateProjectionMatrix()
  scene.add(ambient, hemi, key, fill, rim)
  scene.add(key.target)
  const aim = new THREE.Vector3(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, 0)
  key.target.position.copy(aim)
  const placeLight = (light: THREE.DirectionalLight, azimuth: number, elevation: number) => {
    const az = THREE.MathUtils.degToRad(azimuth)
    const el = THREE.MathUtils.degToRad(elevation)
    const flat = Math.cos(el) * 900
    light.position.set(aim.x + Math.sin(az) * flat, aim.y + Math.cos(az) * flat, aim.z + Math.sin(el) * 900)
  }
  placeLight(key, look.keyAz, look.keyEl)
  placeLight(fill, look.fillAz, look.fillEl)

  scene.background = softSky()
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(DESIGN_WIDTH + 800, DESIGN_HEIGHT + 800),
    new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY }),
  )
  shadowPlane.receiveShadow = true
  shadowPlane.position.set(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, SHADOW_Z)
  scene.add(shadowPlane)

  const pieceMats = LEVEL.map((piece) => piece.color).map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: PLASTIC_ROUGHNESS,
        metalness: PLASTIC_METALNESS,
        envMapIntensity: 0,
      }),
  )
  for (const material of pieceMats) material.shadowSide = THREE.BackSide

  scene.add(makeGrid())

  const pieces: StagePiece[] = LEVEL.map((piece, index) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), pieceMats[index])
    mesh.castShadow = true
    mesh.receiveShadow = true
    const anchor = new THREE.Group()
    anchor.position.z = FLOOR_TOP
    anchor.add(mesh)
    const outline = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: brighter(pieceMats[index].color),
        side: THREE.BackSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
      }),
    )
    outline.visible = false
    outline.castShadow = false
    outline.receiveShadow = false
    outline.layers.set(1)
    outline.renderOrder = 2
    mesh.add(outline)
    scene.add(anchor)
    return {
      anchor,
      mesh,
      outline,
      cells: piece.cells,
      locals: [],
      half: 0,
      height: 0,
      restZ: FLOOR_TOP,
      alive: true,
    }
  })

  const placeCube = (size: number, corner: number, edge: number) => {
    const bevel = Math.min(Math.max(1, edge), size / 2 - 1.5)
    for (const piece of pieces) {
      const next = pieceGeometry(piece.cells, size, corner, bevel)
      const first = piece.half === 0
      piece.mesh.geometry.dispose()
      piece.mesh.geometry = next.geometry
      piece.outline.geometry.dispose()
      piece.outline.geometry = silhouetteSleeve(next.outline, bevel + OUTLINE, size)
      if (first) {
        piece.anchor.position.x = next.x
        piece.anchor.position.y = next.y
      }
      piece.locals = piece.cells.map(([col, row]) => ({
        x: ORIGIN_X + (col + 0.5) * CELL - next.x,
        y: -(ORIGIN_Y + (row + 0.5) * CELL) - next.y,
      }))
      piece.half = size / 2
      piece.height = size
    }
  }
  placeCube(look.size, look.corner, look.edge)

  return {
    pieces,
    setLights(keyIntensity, keyAzimuth, keyElevation, fillIntensity, fillAzimuth, fillElevation, ambientIntensity) {
      ambient.intensity = 0
      hemi.intensity = ambientIntensity
      key.intensity = keyIntensity
      fill.intensity = fillIntensity
      rim.intensity = 0
      placeLight(key, keyAzimuth, keyElevation)
      placeLight(fill, fillAzimuth, fillElevation)
    },
    setCube(size, corner, edge) {
      placeCube(Math.max(20, size), Math.max(2, corner), Math.max(1, edge))
    },
    setRoughness(roughness) {
      const value = Math.min(1, Math.max(0, roughness))
      for (const material of pieceMats) material.roughness = value
    },
  }
}

function softSky(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
  gradient.addColorStop(0, SKY[0])
  gradient.addColorStop(0.55, SKY[1])
  gradient.addColorStop(1, SKY[2])
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makeGrid(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD, BOARD),
    new THREE.MeshStandardMaterial({
      map: gridTexture(),
      roughness: BOARD_ROUGHNESS,
      metalness: 0,
      transparent: true,
      depthWrite: false,
    }),
  )
  mesh.position.set(ORIGIN_X + BOARD / 2, -(ORIGIN_Y + BOARD / 2), FLOOR_TOP + 0.15)
  mesh.receiveShadow = true
  return mesh
}

function gridTexture(): THREE.CanvasTexture {
  const size = 640
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  const cell = size / BOARD_GRID
  const gap = (GAP / CELL) * cell
  ctx.fillStyle = 'rgba(0, 56, 102, 0.25)'
  for (let row = 0; row < BOARD_GRID; row++) {
    for (let col = 0; col < BOARD_GRID; col++) {
      const x = col * cell + gap / 2
      const y = row * cell + gap / 2
      const w = cell - gap
      ctx.beginPath()
      ctx.roundRect(x, y, w, w, gap * 1.6)
      ctx.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function pieceGeometry(
  cells: readonly (readonly [number, number])[],
  size: number,
  corner: number,
  bevel: number,
): { geometry: THREE.BufferGeometry; outline: [number, number][]; x: number; y: number } {
  const home = new THREE.Vector2()
  for (const [col, row] of cells) {
    home.x += ORIGIN_X + (col + 0.5) * CELL
    home.y += -(ORIGIN_Y + (row + 0.5) * CELL)
  }
  home.multiplyScalar(1 / cells.length)
  // ExtrudeGeometry flares the outline out by bevelSize and adds a bevel on both ends.
  // The shape is the contracted cap, so the widest section lands on the cell body.
  const margin = (CELL - size) / 2 + bevel
  const outline = pieceOutline(cells, margin, Math.max(0.5, corner - bevel), home)
  const shape = new THREE.Shape()
  outline.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1, size - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 8,
    curveSegments: 1,
  })
  geometry.translate(0, 0, bevel)
  return { geometry, outline, x: home.x, y: home.y }
}

/** Same hue, lifted so the stroke reads lighter than the piece. */
function brighter(color: THREE.Color): THREE.Color {
  const next = color.clone()
  const hsl = { h: 0, s: 0, l: 0 }
  next.getHSL(hsl)
  next.setHSL(hsl.h, hsl.s, Math.min(0.92, hsl.l + 0.34))
  return next
}

/** Smooth prism just outside the piece. Its back faces are the stroke, without the bevel's jagged normals. */
function silhouetteSleeve(
  points: [number, number][],
  dist: number,
  height: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  offsetClosed(points, dist).forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1,
  })
}

/** Positive distance moves each edge outward. */
function offsetClosed(points: [number, number][], dist: number): [number, number][] {
  const src: [number, number][] = []
  for (const point of points) {
    const prev = src[src.length - 1]
    if (prev && Math.hypot(point[0] - prev[0], point[1] - prev[1]) < 0.05) continue
    src.push(point)
  }
  if (src.length > 2) {
    const first = src[0]
    const last = src[src.length - 1]
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05) src.pop()
  }
  let area = 0
  for (let i = 0; i < src.length; i++) {
    const a = src[i]
    const b = src[(i + 1) % src.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  const wind = area >= 0 ? 1 : -1
  const edges = src.map((point, i) => {
    const next = src[(i + 1) % src.length]
    const dx = next[0] - point[0]
    const dy = next[1] - point[1]
    const len = Math.hypot(dx, dy) || 1
    return { x: point[0] + (dy / len) * dist * wind, y: point[1] - (dx / len) * dist * wind, dx, dy }
  })
  const out: [number, number][] = []
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]
    const b = edges[(i + 1) % edges.length]
    const cross = a.dx * b.dy - a.dy * b.dx
    let x = b.x
    let y = b.y
    if (Math.abs(cross) > 1e-6) {
      const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / cross
      x = a.x + a.dx * t
      y = a.y + a.dy * t
    }
    if (Math.hypot(x - b.x, y - b.y) > Math.abs(dist) * 3) {
      x = b.x
      y = b.y
    }
    out.push([x, y])
  }
  return out
}

/** Outer silhouette in local world XY. Convex corners are rounded; concave corners stay sharp. */
function pieceOutline(
  cells: readonly (readonly [number, number])[],
  inset: number,
  radius: number,
  home: THREE.Vector2,
): [number, number][] {
  const set = new Set(cells.map(([col, row]) => `${col},${row}`))
  const has = (col: number, row: number) => set.has(`${col},${row}`)
  const edges: [number, number, number, number][] = []
  for (const [col, row] of cells) {
    if (!has(col, row - 1)) edges.push([col, row, col + 1, row])
    if (!has(col + 1, row)) edges.push([col + 1, row, col + 1, row + 1])
    if (!has(col, row + 1)) edges.push([col + 1, row + 1, col, row + 1])
    if (!has(col - 1, row)) edges.push([col, row + 1, col, row])
  }
  const next = new Map(edges.map(([a, b, c, d]) => [`${a},${b}`, [c, d] as const]))
  const start: [number, number] = [edges[0][0], edges[0][1]]
  const poly: [number, number][] = [start]
  let cur: readonly [number, number] = start
  for (let i = 0; i < edges.length; i++) {
    const step = next.get(`${cur[0]},${cur[1]}`)
    if (!step || (step[0] === start[0] && step[1] === start[1])) break
    poly.push([step[0], step[1]])
    cur = step
  }
  const welded: [number, number][] = []
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length]
    const point = poly[i]
    const nxt = poly[(i + 1) % poly.length]
    if ((prev[0] === point[0] && point[0] === nxt[0]) || (prev[1] === point[1] && point[1] === nxt[1])) continue
    welded.push(point)
  }
  const inward = (a: readonly [number, number], b: readonly [number, number]): [number, number] => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    return [-dy / len, dx / len]
  }
  const offset: [number, number][] = welded.map((point, i) => {
    const prev = welded[(i + welded.length - 1) % welded.length]
    const nxt = welded[(i + 1) % welded.length]
    const in1 = inward(prev, point)
    const in2 = inward(point, nxt)
    return [point[0] * CELL + (in1[0] + in2[0]) * inset, point[1] * CELL + (in1[1] + in2[1]) * inset]
  })
  return filletConvex(offset, radius).map(([x, y]) => [ORIGIN_X + x - home.x, -(ORIGIN_Y + y) - home.y])
}

function filletConvex(points: [number, number][], radius: number): [number, number][] {
  const out: [number, number][] = []
  const segs = 8
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i + points.length - 1) % points.length]
    const point = points[i]
    const nxt = points[(i + 1) % points.length]
    const v1x = point[0] - prev[0]
    const v1y = point[1] - prev[1]
    const v2x = nxt[0] - point[0]
    const v2y = nxt[1] - point[1]
    const cross = v1x * v2y - v1y * v2x
    const l1 = Math.hypot(v1x, v1y) || 1
    const l2 = Math.hypot(v2x, v2y) || 1
    const rad = cross <= 0 ? 0 : Math.min(radius, l1 * 0.45, l2 * 0.45)
    const a: [number, number] = [point[0] - (v1x / l1) * rad, point[1] - (v1y / l1) * rad]
    const b: [number, number] = [point[0] + (v2x / l2) * rad, point[1] + (v2y / l2) * rad]
    const cx = a[0] + b[0] - point[0]
    const cy = a[1] + b[1] - point[1]
    const ang0 = Math.atan2(a[1] - cy, a[0] - cx)
    let sweep = Math.atan2(b[1] - cy, b[0] - cx) - ang0
    while (sweep > Math.PI) sweep -= Math.PI * 2
    while (sweep < -Math.PI) sweep += Math.PI * 2
    for (let s = 0; s <= segs; s++) {
      const ang = ang0 + sweep * (s / segs)
      out.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad])
    }
  }
  return out
}


