/**
 * Visual-only response when a drag is blocked.
 * The mesh shifts locally. The anchor, which collision reads, stays put.
 */

import type { StagePiece } from './stage'
import type { AxisStep } from './slide'

const RECOIL_SEC = 0.22
const RECOIL_PX = 16
/** This step's unused push below this is a graze: block, but do not bump. */
const GRAZE_PX = 8

type Shake = {
  age: number
  recX: number
  recY: number
}

export type Contact = {
  pushX: number
  pushY: number
  latchedX: boolean
  latchedY: boolean
  fresh: boolean
  originX: number
  originY: number
  shake: Shake | null
}

export function freshContact(): Contact {
  return { pushX: 0, pushY: 0, latchedX: false, latchedY: false, fresh: false, originX: 0, originY: 0, shake: null }
}

export function resetContact(contact: Contact): void {
  contact.pushX = 0
  contact.pushY = 0
  contact.latchedX = false
  contact.latchedY = false
  contact.fresh = false
  contact.shake = null
}

export function noteSteps(contact: Contact, steps: readonly AxisStep[]): void {
  for (const step of steps) noteAxis(contact, step)
  settle(contact)
}

export function stepContact(contact: Contact, held: StagePiece | null, dt: number): void {
  if (!held) return
  const shake = contact.shake
  if (!shake) {
    held.mesh.position.x = 0
    held.mesh.position.y = 0
    return
  }
  shake.age += dt
  if (shake.age >= RECOIL_SEC) {
    contact.shake = null
    held.mesh.position.x = 0
    held.mesh.position.y = 0
    return
  }
  const dirX = shake.recX
  const dirY = shake.recY
  let along = -RECOIL_PX * Math.exp(-shake.age * 11) * Math.sin(shake.age * 34)
  const travel = (held.anchor.position.x - contact.originX) * dirX + (held.anchor.position.y - contact.originY) * dirY
  if (along < 0) along = Math.max(along, -Math.max(0, travel))
  held.mesh.position.x = dirX * along
  held.mesh.position.y = dirY * along
}

function noteAxis(contact: Contact, step: AxisStep): void {
  const past = step.blocked ? step.amount - step.moved : 0
  const latched = step.axis === 'x' ? contact.latchedX : contact.latchedY
  if (step.amount === 0) return
  if (!step.blocked) {
    if (step.axis === 'x') contact.latchedX = false
    else contact.latchedY = false
    return
  }
  if (latched || Math.abs(past) < GRAZE_PX) return
  if (step.axis === 'x') {
    contact.latchedX = true
    contact.pushX = past
  } else {
    contact.latchedY = true
    contact.pushY = past
  }
  contact.fresh = true
}

function settle(contact: Contact): void {
  if (!contact.fresh) return
  contact.fresh = false
  const len = Math.hypot(contact.pushX, contact.pushY) || 1
  contact.shake = { age: 0, recX: contact.pushX / len, recY: contact.pushY / len }
}
