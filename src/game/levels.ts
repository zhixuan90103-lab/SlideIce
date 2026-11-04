import { FIRST_LEVEL, parseLevel, type LevelFile } from './level'

/** JSON files under public/levels, included in the phone build. */
const packed = import.meta.glob('../../public/levels/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

function packedIndex(path: string): number {
  const match = /(\d+)\.json$/.exec(path)
  return match ? Number(match[1]) : 0
}

const packedOrder = Object.keys(packed)
  .map(packedIndex)
  .filter((index) => index > 0)
  .sort((a, b) => a - b)

export async function levelCount(): Promise<number> {
  if (!import.meta.env.DEV) return Math.max(1, packedOrder.length)
  let count = 0
  for (let index = 1; index <= 64; index++) {
    const response = await fetch(`./levels/${index}.json`, { cache: 'no-store' })
    if (!response.ok) break
    count = index
  }
  return Math.max(1, count)
}

export async function readLevel(index: number): Promise<LevelFile> {
  if (import.meta.env.DEV) {
    const response = await fetch(`./levels/${index}.json`, { cache: 'no-store' })
    if (response.ok) return parseLevel(await response.json())
  }
  const found = Object.entries(packed).find(([path]) => packedIndex(path) === index)
  if (found) return parseLevel(found[1])
  return parseLevel(FIRST_LEVEL)
}

/** Dev only. Writes `dist` on the level file without replacing the pieces. */
export async function writeLevelDist(index: number, dist: number): Promise<void> {
  if (!import.meta.env.DEV) return
  const response = await fetch(`./levels/${index}.json`, { cache: 'no-store' })
  if (!response.ok) return
  const raw = (await response.json()) as Record<string, unknown>
  raw.dist = dist
  await fetch(`/__levels/${index}`, {
    method: 'PUT',
    body: `${JSON.stringify(raw, null, 2)}\n`,
  })
}
