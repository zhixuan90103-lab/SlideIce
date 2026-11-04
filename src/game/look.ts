/** Settled stage defaults. The settings panel mutates this object. */

import { GRID } from './level'

/** One board size. Occupancy in `level.ts` and the drawn grid both use `GRID`. */
export const CELL = 64

/**
 * Camera distance that framed the board across the 390-wide stage.
 * A larger block uses a longer distance so the board's screen margin stays put.
 */
export const FRAME_DIST = 1200
const FRAME_CUBE = 60

/** Width of the board when each block face is `cubeSize` design pixels. */
export function boardExtent(cubeSize: number): number {
  return GRID * CELL - (CELL - cubeSize)
}

export function frameDistance(cubeSize: number): number {
  return (FRAME_DIST * boardExtent(cubeSize)) / boardExtent(FRAME_CUBE)
}

export const look = {
  topZ: 40,
  pitch: -5,
  yaw: 0,
  dist: frameDistance(60),
  key: 1.3,
  keyAz: -30,
  keyEl: 80,
  fill: 0.28,
  fillAz: -101,
  fillEl: 57,
  ambient: 1.1,
  size: 60,
  corner: 16,
  edge: 4,
  roughness: 0.59,
}

export const BOARD_COLOR = 0xfaf7f3
export const BOARD_ROUGHNESS = 0.62
export const PLASTIC_METALNESS = 0.02

/** Stage fill. CSS `--stage-bg` is set from this at boot. */
export const STAGE_BG = 0xf6ead8
export const STAGE_BG_CSS = '#f6ead8'

export const HEMI_SKY = 0xfff8f2
export const HEMI_GROUND = 0xf3d7be
export const KEY_COLOR = 0xffffff
export const FILL_COLOR = 0xffe4cc

export const SHADOW_OPACITY = 0.4
export const SHADOW_Z = -40
export const FLOOR_TOP = -7
