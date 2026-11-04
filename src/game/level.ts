/** Live 5×5. Column increases right, row increases down. No preset exit direction. */

export const GRID = 5

export type Cell = readonly [col: number, row: number]

export type LevelPiece = {
  id: string
  color: number
  cells: readonly Cell[]
}

/** Yellow is #fab500. Red, green, purple, and pink share its saturation and lightness. Blue is #0087fa. */
export const LEVEL: readonly LevelPiece[] = [
  { id: '红', color: 0xfa005b, cells: [[0, 0], [1, 0], [2, 0], [0, 1]] },
  { id: '蓝', color: 0x0087fa, cells: [[3, 0], [4, 0], [4, 1], [4, 2]] },
  { id: '绿', color: 0x00fa5b, cells: [[1, 1], [2, 1], [3, 1], [2, 2]] },
  { id: '黄', color: 0xfab500, cells: [[0, 2], [1, 2], [0, 3], [0, 4], [1, 4]] },
  { id: '紫', color: 0xc000fa, cells: [[1, 3], [2, 3], [2, 4], [3, 4]] },
  { id: '粉', color: 0xfa2000, cells: [[3, 2], [3, 3], [4, 3], [4, 4]] },
]
