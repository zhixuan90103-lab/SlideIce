/**
 * Play haptics, same four events and pairs as Ring.
 * Grab on take, hit on the first contact, ready when the clear glow starts, clear on leave.
 */

import { haptics } from '../utils/haptics'

export type HapticKind = 'grab' | 'hit' | 'ready' | 'clear'

const FEEL = {
  grab: { intensity: 0.3, sharpness: 0.3 },
  hit: { intensity: 0.3, sharpness: 1 },
  ready: { intensity: 0.25, sharpness: 0.3 },
  clear: { intensity: 0.45, sharpness: 0.33 },
} as const

export function pulseHaptic(kind: HapticKind): void {
  const pair = FEEL[kind]
  void haptics.playTransient(pair.intensity, pair.sharpness)
}
