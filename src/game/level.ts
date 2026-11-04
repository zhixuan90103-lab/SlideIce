/** One level file. Column increases right, row increases down. No preset exit direction. */

export type Cell = readonly [col: number, row: number]

export type LevelPiece = {
  id: string
  color: number
  cells: readonly Cell[]
}

export type LevelFile = {
  cols: number
  rows: number
  /** Camera distance. Missing files fall back to `frameDistance`. */
  dist?: number
  pieces: LevelPiece[]
}

/** Piece colors on the cream stage. */
export const PIECE_COLOR = {
  红: 0xe06b66,
  蓝: 0x3d9ee6,
  绿: 0x5ec49a,
  黄: 0xf0cc62,
  紫: 0xb09ad8,
  粉: 0xf0b4a6,
  橙: 0xf0943a,
  青: 0x2aabb8,
  靛: 0x6a6fd8,
  玫: 0xe06b9a,
  棕: 0xc47a4a,
  橄榄: 0x8aaa45,
} as const

export const PIECE_PALETTE = Object.values(PIECE_COLOR)

/** The drawn board. `stage.ts` reads this. A level load sets it before rebuilding pieces. */
const board = { cols: 5, rows: 5 }

export function boardSize(): { cols: number; rows: number } {
  return board
}

export function useBoard(cols: number, rows: number): void {
  board.cols = Math.max(1, Math.round(cols))
  board.rows = Math.max(1, Math.round(rows))
}

export const FIRST_LEVEL: LevelFile = {
  cols: 5,
  rows: 5,
  pieces: [
    { id: '红', color: PIECE_COLOR.红, cells: [[0, 0], [1, 0], [2, 0], [0, 1]] },
    { id: '蓝', color: PIECE_COLOR.蓝, cells: [[3, 0], [4, 0], [4, 1], [4, 2]] },
    { id: '绿', color: PIECE_COLOR.绿, cells: [[1, 1], [2, 1], [3, 1], [2, 2]] },
    { id: '黄', color: PIECE_COLOR.黄, cells: [[0, 2], [1, 2], [0, 3], [0, 4], [1, 4]] },
    { id: '紫', color: PIECE_COLOR.紫, cells: [[1, 3], [2, 3], [2, 4], [3, 4]] },
    { id: '粉', color: PIECE_COLOR.粉, cells: [[3, 2], [3, 3], [4, 3], [4, 4]] },
  ],
}

export function parseLevel(raw: unknown): LevelFile {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const cols = clampCount(source.cols)
  const rows = clampCount(source.rows)
  const dist = parseDist(source.dist)
  const taken = new Set<string>()
  const pieces: LevelPiece[] = []
  if (Array.isArray(source.pieces)) {
    for (const item of source.pieces) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const cells: Cell[] = []
      if (Array.isArray(record.cells)) {
        for (const cell of record.cells) {
          if (!Array.isArray(cell) || cell.length < 2) continue
          const col = Math.round(Number(cell[0]))
          const row = Math.round(Number(cell[1]))
          if (!Number.isInteger(col) || !Number.isInteger(row)) continue
          if (col < 0 || row < 0 || col >= cols || row >= rows) continue
          const key = `${col},${row}`
          if (taken.has(key)) continue
          taken.add(key)
          cells.push([col, row])
        }
      }
      const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `块${pieces.length + 1}`
      pieces.push({ id, color: parseColor(record.color, pieces.length), cells })
    }
  }
  return { cols, rows, dist, pieces }
}

function parseDist(value: unknown): number | undefined {
  const next = Math.round(Number(value))
  if (!Number.isFinite(next)) return undefined
  return next
}

function clampCount(value: unknown): number {
  const count = Math.round(Number(value))
  if (!Number.isInteger(count)) return 5
  return Math.min(16, Math.max(1, count))
}

function parseColor(value: unknown, index: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const hex = /^#?([0-9a-fA-F]{6})$/.exec(value.trim())
    if (hex) return Number.parseInt(hex[1], 16)
  }
  return PIECE_PALETTE[index % PIECE_PALETTE.length]
}

export function colorHex(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`
}
