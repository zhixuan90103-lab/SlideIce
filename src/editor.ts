import { PIECE_PALETTE, colorHex, parseLevel, useBoard, type LevelFile } from './game/level'
import { levelCount, readLevel } from './game/levels'
import { DIST_MAX, DIST_MIN, openDistance } from './game/look'

type Draft = {
  cols: number
  rows: number
  dist: number
  pieces: { id: string; color: number; cells: [number, number][] }[]
}

const root = document.getElementById('editor')!
let index = 1
let count = 1
let draft: Draft = { cols: 5, rows: 5, dist: 1200, pieces: [] }
let selected = 0
let erase = false
let painting = false
let strokeCell = ''
let status = ''
const cells = new Map<string, HTMLButtonElement>()

function ownerAt(col: number, row: number): number {
  return draft.pieces.findIndex((piece) => piece.cells.some((cell) => cell[0] === col && cell[1] === row))
}

function crop(): void {
  for (const piece of draft.pieces) {
    piece.cells = piece.cells.filter(([col, row]) => col < draft.cols && row < draft.rows)
  }
}

function toFile(): LevelFile {
  return {
    cols: draft.cols,
    rows: draft.rows,
    dist: draft.dist,
    pieces: draft.pieces.map((piece) => ({
      id: piece.id,
      color: piece.color,
      cells: piece.cells,
    })),
  }
}

async function save(): Promise<void> {
  const text = `${JSON.stringify(serialize(toFile()), null, 2)}\n`
  const response = await fetch(`/__levels/${index}`, { method: 'PUT', body: text })
  status = response.ok ? '已保存' : '保存失败。编辑只在 npm run dev 里写文件。'
  render()
}

function serialize(level: LevelFile): unknown {
  return {
    cols: level.cols,
    rows: level.rows,
    dist: level.dist,
    pieces: level.pieces.map((piece) => ({
      id: piece.id,
      color: colorHex(piece.color),
      cells: piece.cells,
    })),
  }
}

async function open(next: number): Promise<void> {
  count = await levelCount()
  index = Math.min(Math.max(1, next), count)
  const level = parseLevel(await readLevel(index))
  draft = {
    cols: level.cols,
    rows: level.rows,
    dist: level.dist ?? framedDist(level.cols, level.rows),
    pieces: level.pieces.map((piece) => ({ id: piece.id, color: piece.color, cells: piece.cells.map((cell) => [cell[0], cell[1]]) })),
  }
  if (draft.pieces.length === 0) draft.pieces.push(blankPiece(0))
  selected = Math.min(selected, draft.pieces.length - 1)
  status = ''
  render()
}

function framedDist(cols: number, rows: number): number {
  useBoard(cols, rows)
  return openDistance(undefined)
}

function blankPiece(n: number): Draft['pieces'][number] {
  return { id: `块${n + 1}`, color: PIECE_PALETTE[n % PIECE_PALETTE.length], cells: [] }
}

function paintCell(col: number, row: number): void {
  const key = `${col},${row}`
  if (strokeCell === key) return
  strokeCell = key
  const piece = draft.pieces[selected]
  if (!piece) return
  const own = ownerAt(col, row)
  if (erase) {
    if (own < 0) return
    const owned = draft.pieces[own].cells
    draft.pieces[own].cells = owned.filter((cell) => cell[0] !== col || cell[1] !== row)
  } else if (own === selected) {
    piece.cells = piece.cells.filter((cell) => cell[0] !== col || cell[1] !== row)
  } else {
    if (own >= 0) {
      const owned = draft.pieces[own].cells
      draft.pieces[own].cells = owned.filter((cell) => cell[0] !== col || cell[1] !== row)
    }
    piece.cells.push([col, row])
  }
  const node = cells.get(`${col},${row}`)
  const next = ownerAt(col, row)
  if (!node) return
  node.classList.toggle('is-selected', next === selected)
  node.style.background = next >= 0 ? colorHex(draft.pieces[next].color) : ''
  for (const rowNode of root.querySelectorAll<HTMLButtonElement>('.piece-row')) {
    const itemIndex = Number(rowNode.dataset.index)
    const item = draft.pieces[itemIndex]
    if (!item) continue
    rowNode.textContent = `${item.id} · ${item.cells.length} 格`
  }
}

function render(): void {
  const piece = draft.pieces[selected]
  root.innerHTML = ''
  const bar = document.createElement('header')
  bar.className = 'editor-bar'
  bar.append(
    button('上一关', () => void open(index - 1)),
    label(`第 ${index} / ${count} 关`),
    button('下一关', () => void open(index + 1)),
    button('加关', async () => {
      const response = await fetch('/__levels', { method: 'POST' })
      if (!response.ok) {
        status = '加关失败'
        render()
        return
      }
      const body = (await response.json()) as { index: number }
      await open(body.index)
    }),
    button('删关', async () => {
      const response = await fetch(`/__levels/${index}`, { method: 'DELETE' })
      status = response.ok ? '' : '至少留一关'
      if (!response.ok) {
        render()
        return
      }
      await open(Math.min(index, count - 1))
    }),
    button('保存', () => void save()),
    button('试玩', () => {
      void save().then(() => window.open(`./index.html?level=${index}`, 'slideice-play'))
    }),
  )
  const size = document.createElement('div')
  size.className = 'editor-size'
  size.append(numberField('列', draft.cols, (value) => {
    draft.cols = value
    crop()
    render()
  }), numberField('行', draft.rows, (value) => {
    draft.rows = value
    crop()
    render()
  }), numberField('镜头', draft.dist, (value) => {
    draft.dist = value
    render()
  }, DIST_MIN, DIST_MAX))
  const tools = document.createElement('div')
  tools.className = 'editor-tools'
  const paint = button(erase ? '涂格子' : '正在涂', () => {
    erase = false
    render()
  })
  const eraser = button(erase ? '正在擦' : '擦除', () => {
    erase = true
    render()
  })
  paint.classList.toggle('is-on', !erase)
  eraser.classList.toggle('is-on', erase)
  tools.append(paint, eraser, button('下一块', () => {
    selected = (selected + 1) % draft.pieces.length
    render()
  }), button('新建块', () => {
    draft.pieces.push(blankPiece(draft.pieces.length))
    selected = draft.pieces.length - 1
    render()
  }), button('删除这块', () => {
    if (draft.pieces.length <= 1) return
    draft.pieces.splice(selected, 1)
    selected = Math.min(selected, draft.pieces.length - 1)
    render()
  }))
  const list = document.createElement('div')
  list.className = 'piece-list'
  draft.pieces.forEach((item, itemIndex) => {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'piece-row'
    row.dataset.index = String(itemIndex)
    row.classList.toggle('is-on', itemIndex === selected)
    row.style.background = colorHex(item.color)
    row.textContent = `${item.id} · ${item.cells.length} 格`
    row.addEventListener('click', () => {
      selected = itemIndex
      render()
    })
    list.append(row)
  })
  const colors = document.createElement('div')
  colors.className = 'color-list'
  PIECE_PALETTE.forEach((color) => {
    const swatch = document.createElement('button')
    swatch.type = 'button'
    swatch.className = 'color-swatch'
    swatch.style.background = colorHex(color)
    swatch.classList.toggle('is-on', piece?.color === color)
    swatch.addEventListener('click', () => {
      if (!piece) return
      piece.color = color
      render()
    })
    colors.append(swatch)
  })
  const name = document.createElement('label')
  name.className = 'piece-name'
  name.textContent = '名字'
  const nameInput = document.createElement('input')
  nameInput.value = piece?.id ?? ''
  nameInput.addEventListener('change', () => {
    if (!piece) return
    piece.id = nameInput.value.trim() || piece.id
    render()
  })
  name.append(nameInput)
  const board = document.createElement('div')
  board.className = 'paint-board'
  board.style.gridTemplateColumns = `repeat(${draft.cols}, 46px)`
  cells.clear()
  for (let row = 0; row < draft.rows; row++) {
    for (let col = 0; col < draft.cols; col++) {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'paint-cell'
      const own = ownerAt(col, row)
      if (own >= 0) {
        cell.style.background = colorHex(draft.pieces[own].color)
        if (own === selected) cell.classList.add('is-selected')
      }
      cells.set(`${col},${row}`, cell)
      cell.addEventListener('pointerdown', (event) => {
        painting = true
        strokeCell = ''
        board.setPointerCapture(event.pointerId)
        paintCell(col, row)
      })
      board.append(cell)
    }
  }
  board.addEventListener('pointermove', (event) => {
    if (!painting) return
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    if (!(hit instanceof HTMLButtonElement) || !hit.classList.contains('paint-cell')) return
    for (const [key, node] of cells) {
      if (node !== hit) continue
      const [col, row] = key.split(',').map(Number)
      paintCell(col, row)
      break
    }
  })
  board.addEventListener('lostpointercapture', () => {
    painting = false
    strokeCell = ''
  })
  const note = document.createElement('p')
  note.className = 'editor-status'
  note.textContent = status || '点一下涂上。拖过当前块自己的格子会擦掉。拖过别的块会把那格挪过来。擦除只清格子。'
  root.append(bar, size, tools, list, colors, name, board, note)
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = text
  node.addEventListener('click', onClick)
  return node
}

function label(text: string): HTMLElement {
  const node = document.createElement('span')
  node.textContent = text
  return node
}

function numberField(
  title: string,
  value: number,
  onChange: (value: number) => void,
  min = 1,
  max = 16,
): HTMLLabelElement {
  const field = document.createElement('label')
  field.textContent = title
  const input = document.createElement('input')
  input.type = 'number'
  input.min = String(min)
  input.max = String(max)
  input.value = String(value)
  input.addEventListener('change', () => {
    const next = Math.round(Number(input.value))
    if (!Number.isInteger(next)) return
    onChange(Math.min(max, Math.max(min, next)))
  })
  field.append(input)
  return field
}

void open(1)
