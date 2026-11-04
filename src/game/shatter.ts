/**
 * Leave-board shatter, matched to Ring's unlock chips.
 * Ring's world is 10 units tall for 844px. These numbers are that look in design pixels.
 */

import * as THREE from 'three'
import { PLASTIC_METALNESS, PLASTIC_ROUGHNESS } from './look'

const UNIT = 844 / 10

export const SHATTER = {
  chip: 0.25 * UNIT,
  step: 0.16 * UNIT,
  depth: 0.22 * UNIT,
  bevel: 0.04 * UNIT,
  scaleMin: 0.55,
  scaleSpan: 0.6,
  speedMax: 1.6 * UNIT,
  lead: 0.16 * UNIT,
  gravity: -30 * UNIT,
  gravityIn: 0.12,
  shrinkSeconds: 0.75,
  shrinkFloor: 0.45,
  glow: 0.35,
} as const

/** In front of the pieces. Chips do not cast shadows. */
const FALL_Z = 80

export type Shatter = {
  mesh: THREE.InstancedMesh
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  spin: Float32Array
  pitch: Float32Array
  roll: Float32Array
  theta: Float32Array
  scale: Float32Array
  count: number
  age: number
  dead: boolean
}

const CHIP_POOL = 160
const shatterPool: Shatter[] = []
const dummy = new THREE.Object3D()
let chipGeometry: THREE.ExtrudeGeometry | null = null

function sharedChipGeometry(): THREE.ExtrudeGeometry {
  if (chipGeometry) return chipGeometry
  const half = SHATTER.chip * 0.46
  const radius = half * 0.42
  const shape = new THREE.Shape()
  shape.moveTo(-half + radius, -half)
  shape.lineTo(half - radius, -half)
  shape.absarc(half - radius, -half + radius, radius, -Math.PI / 2, 0, false)
  shape.lineTo(half, half - radius)
  shape.absarc(half - radius, half - radius, radius, 0, Math.PI / 2, false)
  shape.lineTo(-half + radius, half)
  shape.absarc(-half + radius, half - radius, radius, Math.PI / 2, Math.PI, false)
  shape.lineTo(-half, -half + radius)
  shape.absarc(-half + radius, -half + radius, radius, Math.PI, Math.PI * 1.5, false)
  const depth = SHATTER.depth
  const bevel = SHATTER.bevel
  chipGeometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  })
  chipGeometry.translate(0, 0, -(depth + bevel * 2) / 2)
  return chipGeometry
}

function takeShatter(count: number): Shatter {
  const index = shatterPool.findIndex((slot) => slot.x.length >= count)
  const ready = index >= 0 ? shatterPool.splice(index, 1)[0] : null
  if (ready) return ready
  const capacity = Math.max(CHIP_POOL, count)
  const material = new THREE.MeshStandardMaterial({ roughness: PLASTIC_ROUGHNESS, metalness: PLASTIC_METALNESS })
  const mesh = new THREE.InstancedMesh(sharedChipGeometry(), material, capacity)
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  return {
    mesh,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    spin: new Float32Array(capacity),
    pitch: new Float32Array(capacity),
    roll: new Float32Array(capacity),
    theta: new Float32Array(capacity),
    scale: new Float32Array(capacity),
    count: 0,
    age: 0,
    dead: false,
  }
}

export function makeShatter(
  parent: THREE.Object3D,
  points: { x: number; y: number }[],
  originX: number,
  originY: number,
  color: number,
): Shatter | null {
  if (points.length === 0) return null
  const count = points.length
  const shatter = takeShatter(count)
  const { mesh } = shatter
  const material = mesh.material
  if (material instanceof THREE.MeshStandardMaterial) {
    material.color.setHex(color)
    material.emissive.setHex(color)
    material.emissiveIntensity = SHATTER.glow
  }
  mesh.count = count
  mesh.visible = true
  const { x, y, vx, vy, spin, pitch, roll, theta, scale } = shatter
  for (let i = 0; i < count; i++) {
    x[i] = points[i].x
    y[i] = points[i].y
    const dx = x[i] - originX
    const dy = y[i] - originY
    const dist = Math.hypot(dx, dy) || 1
    const speed = Math.random() * SHATTER.speedMax
    const lead = (speed / SHATTER.speedMax) * SHATTER.lead
    vx[i] = (dx / dist) * speed
    vy[i] = (dy / dist) * speed
    x[i] += (dx / dist) * lead
    y[i] += (dy / dist) * lead
    spin[i] = (Math.random() - 0.5) * 4
    pitch[i] = (Math.random() - 0.5) * 5
    roll[i] = (Math.random() - 0.5) * 5
    theta[i] = Math.random() * Math.PI * 2
    scale[i] = SHATTER.scaleMin + Math.random() * SHATTER.scaleSpan
  }
  let shiftX = 0
  let shiftY = 0
  let driftX = 0
  let driftY = 0
  for (let i = 0; i < count; i++) {
    shiftX += x[i] - points[i].x
    shiftY += y[i] - points[i].y
    driftX += vx[i]
    driftY += vy[i]
  }
  shiftX /= count
  shiftY /= count
  driftX /= count
  driftY /= count
  for (let i = 0; i < count; i++) {
    x[i] -= shiftX
    y[i] -= shiftY
    vx[i] -= driftX
    vy[i] -= driftY
    dummy.position.set(x[i], y[i], FALL_Z)
    dummy.rotation.set(0, 0, theta[i])
    dummy.scale.setScalar(scale[i])
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  shatter.count = count
  shatter.age = 0
  shatter.dead = false
  parent.add(mesh)
  stepShatters([shatter], -1e9, 1 / 60)
  return shatter
}

export function shatterGravity(age: number): number {
  const u = Math.min(1, age / SHATTER.gravityIn)
  const ease = u * u * (3 - 2 * u)
  return SHATTER.gravity * (0.55 + 0.45 * ease)
}

export function shatterShrink(age: number): number {
  const fall = Math.max(0, age - SHATTER.gravityIn * 0.35)
  return Math.max(SHATTER.shrinkFloor, 1 - fall / SHATTER.shrinkSeconds)
}

export function stepShatters(shatters: Shatter[], viewBottom: number, dt: number): void {
  for (const shatter of shatters) {
    if (shatter.dead) continue
    shatter.age += dt
    const gravity = shatterGravity(shatter.age)
    const shrink = shatterShrink(shatter.age)
    let alive = 0
    for (let i = 0; i < shatter.count; i++) {
      shatter.vy[i] += gravity * dt
      shatter.x[i] += shatter.vx[i] * dt
      shatter.y[i] += shatter.vy[i] * dt
      shatter.theta[i] += shatter.spin[i] * dt
      if (shatter.y[i] > viewBottom) alive += 1
      dummy.position.set(shatter.x[i], shatter.y[i], FALL_Z)
      dummy.rotation.set(shatter.pitch[i] * shatter.age, shatter.roll[i] * shatter.age, shatter.theta[i])
      dummy.scale.setScalar(shatter.y[i] > viewBottom ? shatter.scale[i] * shrink : 0)
      dummy.updateMatrix()
      shatter.mesh.setMatrixAt(i, dummy.matrix)
    }
    shatter.mesh.instanceMatrix.needsUpdate = true
    if (alive === 0) shatter.dead = true
  }
}

export function disposeShatter(shatter: Shatter): void {
  shatter.mesh.removeFromParent()
  shatter.mesh.count = 0
  shatter.mesh.visible = false
  shatterPool.push(shatter)
}
