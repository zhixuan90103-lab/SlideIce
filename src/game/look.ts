/** Settled stage defaults. The settings panel mutates this object. */

/** Visual board. Level occupancy stays on `GRID` in level.ts. */
export const BOARD_GRID = 5
export const CELL = 64

export const TRAY_BEVEL = 6
export const TRAY_BEVEL_SIZE = 5
export const TRAY_LIP = 12
export const TRAY_MARGIN = 4

/**
 * Camera distance that framed a 5×5 plate across the 390-wide stage.
 * A smaller board uses a shorter distance so that plate's screen margin stays put.
 */
export const FRAME_DIST = 1200
const FRAME_CUBE = 60

export function boardExtent(cubeSize: number): number {
  return (
    BOARD_GRID * CELL -
    (CELL - cubeSize) +
    TRAY_MARGIN * 2 +
    TRAY_BEVEL_SIZE * 4 +
    TRAY_LIP * 2
  )
}

export function frameDistance(cubeSize: number): number {
  const reference =
    5 * CELL - (CELL - FRAME_CUBE) + TRAY_MARGIN * 2 + TRAY_BEVEL_SIZE * 4 + TRAY_LIP * 2
  return (FRAME_DIST * boardExtent(cubeSize)) / reference
}

export const look = {
  topZ: 42,
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
  corner: 5,
  edge: 8,
  roughness: 0.59,
}

export const BOARD_COLOR = 0xfaf7f3
export const BOARD_ROUGHNESS = 0.62
export const PLASTIC_ROUGHNESS = 0.59
export const PLASTIC_METALNESS = 0.02

export const HEMI_SKY = 0xfff8f2
export const HEMI_GROUND = 0xf3d7be
export const KEY_COLOR = 0xffffff
export const FILL_COLOR = 0xffe4cc

export const SHADOW_OPACITY = 0.4
export const SHADOW_Z = -40
export const FLOOR_TOP = -7

export const FLOOR_BEVEL = 6
export const FLOOR_THICK = 24
