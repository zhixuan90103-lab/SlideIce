/**
 * Ready glow from Ring. Own color stays. Emissive is that same color.
 * Callers pass the meshes a release would remove. The light eases in and out.
 */

import * as THREE from 'three'

const HINT_GLOW = 0.22
const HINT_SCALE = 0.02
const HINT_SECONDS = 0.08

type Hint = { mesh: THREE.Object3D; level: number; target: number }

export function mountHint() {
  const hints: Hint[] = []
  const baseColors = new WeakMap<THREE.MeshStandardMaterial, THREE.Color>()

  function paint(mesh: THREE.Object3D, level: number): void {
    mesh.traverse((node) => {
      const material = (node as THREE.Mesh).material
      if (!(material instanceof THREE.MeshStandardMaterial)) return
      let base = baseColors.get(material)
      if (!base) {
        base = material.color.clone()
        baseColors.set(material, base)
      }
      material.color.copy(base)
      material.emissive.copy(base)
      material.emissiveIntensity = level <= 0 ? 0 : HINT_GLOW * level
    })
    mesh.scale.setScalar(level <= 0 ? 1 : 1 + HINT_SCALE * level)
  }

  function compact(): void {
    let alive = 0
    for (const item of hints) {
      if (item.target <= 0 && item.level <= 0) continue
      hints[alive] = item
      alive += 1
    }
    hints.length = alive
  }

  return {
    /** Meshes a release would remove. Empty clears the glow. */
    set(meshes: THREE.Object3D[]): void {
      for (const item of hints) item.target = meshes.includes(item.mesh) ? 1 : 0
      for (const mesh of meshes) {
        if (!hints.some((item) => item.mesh === mesh)) hints.push({ mesh, level: 0, target: 1 })
      }
      compact()
    },
    step(dt: number): void {
      const hintStep = dt / HINT_SECONDS
      for (const item of hints) {
        if (item.level < item.target) item.level = Math.min(item.target, item.level + hintStep)
        else if (item.level > item.target) item.level = Math.max(item.target, item.level - hintStep)
        paint(item.mesh, item.level)
      }
      compact()
    },
  }
}
