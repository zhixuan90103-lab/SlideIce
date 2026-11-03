import * as THREE from 'three'
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design'
import { GRID } from './level'
import {
  BOARD_COLOR,
  BOARD_ROUGHNESS,
  CUBE_BEVEL_SEG,
  CUBE_COLOR,
  CUBE_DIV,
  FILL_COLOR,
  FLOOR_BEVEL,
  FLOOR_THICK,
  FLOOR_TOP,
  HEMI_GROUND,
  HEMI_SKY,
  KEY_COLOR,
  PLASTIC_METALNESS,
  PLASTIC_ROUGHNESS,
  SHADOW_OPACITY,
  SHADOW_Z,
  SKY,
  TRAY_BEVEL,
  TRAY_BEVEL_SIZE,
  TRAY_LIP,
  TRAY_MARGIN,
  look,
} from './look'

const CELL = 64
const GAP = 4
const BOARD = GRID * CELL
const ORIGIN_X = (DESIGN_WIDTH - BOARD) / 2
const ORIGIN_Y = (DESIGN_HEIGHT - BOARD) / 2

export type StageRig = {
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
  key.shadow.camera.left = -280
  key.shadow.camera.right = 280
  key.shadow.camera.top = 280
  key.shadow.camera.bottom = -280
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
    new THREE.PlaneGeometry(DESIGN_WIDTH, DESIGN_HEIGHT),
    new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY }),
  )
  shadowPlane.receiveShadow = true
  shadowPlane.position.set(DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, SHADOW_Z)
  scene.add(shadowPlane)

  const boardMat = new THREE.MeshStandardMaterial({
    color: BOARD_COLOR,
    roughness: BOARD_ROUGHNESS,
    metalness: 0,
  })
  boardMat.shadowSide = THREE.BackSide
  const cubeMat = new THREE.MeshStandardMaterial({
    color: CUBE_COLOR,
    roughness: PLASTIC_ROUGHNESS,
    metalness: PLASTIC_METALNESS,
    envMapIntensity: 0,
  })
  cubeMat.shadowSide = THREE.BackSide

  const tray = new THREE.Mesh(new THREE.BufferGeometry(), boardMat)
  tray.castShadow = true
  tray.receiveShadow = true
  tray.position.set(ORIGIN_X + BOARD / 2, -(ORIGIN_Y + BOARD / 2), FLOOR_TOP)
  const floor = new THREE.Mesh(new THREE.BufferGeometry(), boardMat)
  floor.receiveShadow = true
  floor.position.set(ORIGIN_X + BOARD / 2, -(ORIGIN_Y + BOARD / 2), floorZ())
  scene.add(tray, floor, makeGrid())

  let cubeGeometry: THREE.BufferGeometry = new THREE.BufferGeometry()
  const cubes: THREE.Mesh[] = []
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const cube = new THREE.Mesh(cubeGeometry, cubeMat)
      cube.castShadow = true
      cube.receiveShadow = true
      cube.position.set(ORIGIN_X + (col + 0.5) * CELL, -(ORIGIN_Y + (row + 0.5) * CELL), FLOOR_TOP)
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
    tray.position.z = FLOOR_TOP + TRAY_BEVEL
    floor.geometry.dispose()
    floor.geometry = floorGeometry(size, corner, edge)
  }
  placeCube(look.size, look.corner, look.edge)

  return {
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
      cubeMat.roughness = Math.min(1, Math.max(0, roughness))
    },
  }
}

function floorZ(): number {
  const depth = FLOOR_THICK - FLOOR_BEVEL * 2
  return FLOOR_TOP - depth - FLOOR_BEVEL
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
    new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: BOARD_ROUGHNESS, metalness: 0 }),
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
  ctx.fillStyle = '#faf7f3'
  ctx.fillRect(0, 0, size, size)
  const cell = size / GRID
  const gap = (GAP / CELL) * cell
  ctx.fillStyle = '#f3efe9'
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
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

function traySpans(size: number, corner: number, edge: number) {
  const opening = BOARD - (CELL - size) + TRAY_MARGIN * 2
  const hole = opening + TRAY_BEVEL_SIZE * 2
  const outer = hole + TRAY_LIP * 2
  const holeRadius = Math.max(corner, edge) + TRAY_MARGIN + TRAY_BEVEL_SIZE
  return {
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
  return new THREE.ExtrudeGeometry(frame, {
    depth: Math.max(1, size - TRAY_BEVEL),
    bevelEnabled: true,
    bevelThickness: TRAY_BEVEL,
    bevelSize: TRAY_BEVEL_SIZE,
    bevelSegments: 8,
  })
}

function floorGeometry(size: number, corner: number, edge: number): THREE.ExtrudeGeometry {
  const span = traySpans(size, corner, edge)
  const shape = new THREE.Shape()
  roundLoop(shape, -span.floorSpan / 2, -span.floorSpan / 2, span.floorSpan, span.floorSpan, span.floorRadius)
  return new THREE.ExtrudeGeometry(shape, {
    depth: FLOOR_THICK - FLOOR_BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: FLOOR_BEVEL,
    bevelSize: 2,
    bevelSegments: 6,
  })
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

function evenCubeGeometry(size: number, corner: number, bevel: number): THREE.BufferGeometry {
  const div = CUBE_DIV
  const bevelSeg = CUBE_BEVEL_SEG
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
        row.push(snapRounded(-half + (2 * half * i) / div, y, half, rad))
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
