/** Settled stage defaults. The settings panel mutates this object. */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design'
import { boardSize } from './level'

/** Cell pitch. The live column and row counts come from the open level. */
export const CELL = 64

/**
 * Camera distance that frames a 5-wide board across the 390-wide stage.
 * Smaller boards keep this cell size. Larger boards move back.
 */
export const FRAME_DIST = 1200
/** Saved per level as `dist`. The settings slider uses the same range. */
export const DIST_MIN = 400
export const DIST_MAX = 4000

function clampDist(value: number): number {
  const next = Math.round(value)
  if (!Number.isFinite(next)) return FRAME_DIST
  return Math.min(DIST_MAX, Math.max(DIST_MIN, next))
}
const FRAME_CUBE = 60
const FRAME_SPAN = 5
/**
 * Top and bottom reserve, design px. The side reserve is the leftover of a
 * 5-wide board on the 390 stage (~37). Reusing that band vertically lets a
 * 12-row board fill the screen, so its cells jump back to the 5-column size.
 */
const FRAME_MARGIN_Y = 96

/** Face-to-face size of one side of the board, in design pixels. */
function faceSpan(cells: number, cubeSize: number): number {
  return cells * CELL - (CELL - cubeSize)
}

export function frameDistance(cubeSize: number): number {
  const { cols, rows } = boardSize()
  const marginX = (DESIGN_WIDTH - faceSpan(FRAME_SPAN, FRAME_CUBE)) / 2
  const fitW = DESIGN_WIDTH - marginX * 2
  const fitH = DESIGN_HEIGHT - FRAME_MARGIN_Y * 2
  const fit = Math.min(fitW / faceSpan(cols, cubeSize), fitH / faceSpan(rows, cubeSize))
  const scale = Math.min(1, fit)
  return FRAME_DIST / scale
}

/**
 * Stage point → board point. The camera pulls back for a larger board, so a finger
 * on the picture is farther from the stage center than the raw design coordinate.
 */
export function designToBoard(x: number, y: number): { x: number; y: number } {
  const zoom = look.dist / FRAME_DIST
  return {
    x: DESIGN_WIDTH / 2 + (x - DESIGN_WIDTH / 2) * zoom,
    y: DESIGN_HEIGHT / 2 + (y - DESIGN_HEIGHT / 2) * zoom,
  }
}

/** Board point → stage pixel. Inverse of `designToBoard`. */
export function boardToStage(x: number, y: number): { x: number; y: number } {
  const zoom = FRAME_DIST / look.dist
  return {
    x: DESIGN_WIDTH / 2 + (x - DESIGN_WIDTH / 2) * zoom,
    y: DESIGN_HEIGHT / 2 + (y - DESIGN_HEIGHT / 2) * zoom,
  }
}

/** World y of the bottom edge of the picture at the board plane. */
export function viewBottomWorld(): number {
  return -designToBoard(DESIGN_WIDTH / 2, DESIGN_HEIGHT).y
}

/**
 * The open level's camera distance. A saved `dist` wins. Otherwise the board
 * is framed at `FRAME_DIST`, pulled back only enough to keep the side margin
 * and `FRAME_MARGIN_Y`. Call after `useBoard`.
 */
export function openDistance(dist: number | undefined): number {
  look.dist = clampDist(dist ?? frameDistance(look.size))
  return look.dist
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
