/** Live 5×5. Column increases right, row increases down. No preset exit direction. */

export const GRID = 5

export type Cell = readonly [col: number, row: number]

export type LevelPiece = {
  id: string
  color: number
  cells: readonly Cell[]
}

/** Piece colors on the cream stage. */
export const PIECE_COLOR = {
  红: 0xe06b66,
  蓝: 0x3d9ee6,
  绿: 0x5ec49a,
  黄: 0xf0cc62,
  紫: 0xb09ad8,
  粉: 0xf0b4a6,
} as const

export const LEVEL: readonly LevelPiece[] = [
  { id: '红', color: PIECE_COLOR.红, cells: [[0, 0], [1, 0], [2, 0], [0, 1]] },
  { id: '蓝', color: PIECE_COLOR.蓝, cells: [[3, 0], [4, 0], [4, 1], [4, 2]] },
  { id: '绿', color: PIECE_COLOR.绿, cells: [[1, 1], [2, 1], [3, 1], [2, 2]] },
  { id: '黄', color: PIECE_COLOR.黄, cells: [[0, 2], [1, 2], [0, 3], [0, 4], [1, 4]] },
  { id: '紫', color: PIECE_COLOR.紫, cells: [[1, 3], [2, 3], [2, 4], [3, 4]] },
  { id: '粉', color: PIECE_COLOR.粉, cells: [[3, 2], [3, 3], [4, 3], [4, 4]] },
]
