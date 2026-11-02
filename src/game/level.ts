/** Grid: column increases right, row increases down. Origin is the top-left cell. */

export const GRID = 5

export type Dir = '左' | '右' | '上' | '下'

export type Cell = readonly [col: number, row: number]

export type PieceDef = {
  id: string
  dir: Dir
  cells: readonly Cell[]
}

export const WALL = '#'

/** First level. See docs/GAME.md §5. */
export const PIECES: readonly PieceDef[] = [
  {
    id: 'C',
    dir: '左',
    cells: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
    ],
  },
  { id: 'H', dir: '上', cells: [[3, 0], [3, 1]] },
  { id: 'A', dir: '上', cells: [[1, 1], [2, 1]] },
  { id: 'P', dir: '上', cells: [[3, 2], [3, 3]] },
  { id: 'B', dir: '下', cells: [[1, 3], [2, 3]] },
  { id: 'M', dir: '下', cells: [[1, 2], [2, 2]] },
]

export const DIR_STEP: Record<Dir, Cell> = {
  左: [-1, 0],
  右: [1, 0],
  上: [0, -1],
  下: [0, 1],
}

export function cellKey(col: number, row: number): string {
  return `${col},${row}`
}

/** Who still occupies each cell. Wall id is `#`. */
export function startingOccupancy(): Map<string, string> {
  const occ = new Map<string, string>()
  for (let row = 0; row < GRID; row++) occ.set(cellKey(GRID - 1, row), WALL)
  for (const piece of PIECES) {
    for (const [col, row] of piece.cells) occ.set(cellKey(col, row), piece.id)
  }
  return occ
}

/** Ids on the slide-out sweep, excluding the piece itself. */
export function sweepBlockers(
  cells: readonly Cell[],
  dir: Dir,
  occ: ReadonlyMap<string, string>,
  selfId: string,
): string[] {
  const [dc, dr] = DIR_STEP[dir]
  const mine = new Set(cells.map(([col, row]) => cellKey(col, row)))
  const hit = new Set<string>()
  for (let step = 1; step <= GRID; step++) {
    let inside = false
    for (const [col, row] of cells) {
      const nc = col + dc * step
      const nr = row + dr * step
      if (nc < 0 || nr < 0 || nc >= GRID || nr >= GRID) continue
      inside = true
      const key = cellKey(nc, nr)
      if (mine.has(key)) continue
      const who = occ.get(key)
      if (who && who !== selfId) hit.add(who)
    }
    if (!inside) break
  }
  return [...hit].sort()
}

/** Throws if level 1 does not match the blocking table in GAME.md. */
export function assertLevel1(): void {
  const occ = startingOccupancy()
  const filled = occ.size
  if (filled !== GRID * GRID) {
    throw new Error(`level 1 fills ${filled} cells, expected ${GRID * GRID}`)
  }
  const expect: Record<string, string> = {
    C: '',
    H: '',
    A: 'C',
    B: 'C',
    P: 'H',
    M: 'B,C',
  }
  for (const piece of PIECES) {
    const got = sweepBlockers(piece.cells, piece.dir, occ, piece.id).join(',')
    if (got !== expect[piece.id]) {
      throw new Error(`${piece.id} blocked by "${got}", expected "${expect[piece.id]}"`)
    }
  }
}
