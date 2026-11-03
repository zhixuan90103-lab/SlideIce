/** Live 5×5. Column increases right, row increases down. No preset exit direction. */

export const GRID = 5

export type Cell = readonly [col: number, row: number]

export type LevelPiece = {
  id: string
  color: number
  cells: readonly Cell[]
}

/** Same saturation and lightness. Hue only. */
export const LEVEL: readonly LevelPiece[] = [
  { id: '红', color: 0xe1477f, cells: [[0, 0], [1, 0], [2, 0], [0, 1]] },
  { id: '蓝', color: 0x4775e1, cells: [[3, 0], [4, 0], [4, 1], [4, 2]] },
  { id: '绿', color: 0x47e17f, cells: [[1, 1], [2, 1], [3, 1], [2, 2]] },
  { id: '黄', color: 0xb3e147, cells: [[0, 2], [1, 2], [0, 3], [0, 4], [1, 4]] },
  { id: '紫', color: 0xbd47e1, cells: [[1, 3], [2, 3], [2, 4], [3, 4]] },
  { id: '粉', color: 0xe15b47, cells: [[3, 2], [3, 3], [4, 3], [4, 4]] },
]
