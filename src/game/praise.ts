/**
 * Praise for a clear, matched to Ring.
 * 0 is silence. 1 Great, 2 Perfect, 3 Excellent, 4 Amazing.
 * The word stays inside the 390×844 stage, including its rise.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design'

export type PraiseCombo = {
  rank: number
  live: boolean
}

const LINES = [
  { text: 'Great!', top: '#c8ff72', bottom: '#2fbe28' },
  { text: 'Perfect', top: '#ffe56a', bottom: '#ff8a1a' },
  { text: 'Excellent!', top: '#9ad8ff', bottom: '#2b86ff' },
  { text: 'Amazing', top: '#ee9bff', bottom: '#7a34ee' },
] as const

export function freshPraise(): PraiseCombo {
  return { rank: 0, live: false }
}

export function notePraiseClear(combo: PraiseCombo, cleared: number): number {
  const steps = cleared >= 2 ? 2 : 1
  if (!combo.live) {
    combo.live = true
    combo.rank = steps >= 2 ? 2 : 0
    return combo.rank
  }
  combo.rank = Math.min(LINES.length, combo.rank + steps)
  return combo.rank
}

let serial = 0

const PRAISE_LIFT = 56
const PRAISE_RISE = 28
const PRAISE_DRIFT = 4
const PRAISE_EDGE = 8
const WORD_POP = 1.08
const WORD_SHADOW = 4

function wordLayout(text: string): { viewW: number; viewH: number; drawW: number; drawH: number } {
  const viewW = text.length * 30 + 36
  const viewH = 84
  return { viewW, viewH, drawW: viewW * 0.605, drawH: 50.82 }
}

function praiseSize(text: string): { w: number; h: number } {
  const word = wordLayout(text)
  return { w: word.drawW * WORD_POP, h: word.drawH * WORD_POP + WORD_SHADOW }
}

function placePraise(x: number, y: number, text: string): { x: number; y: number } {
  const { w, h } = praiseSize(text)
  const halfW = w / 2
  const halfH = h / 2
  const minX = PRAISE_EDGE + halfW
  const maxX = DESIGN_WIDTH - PRAISE_EDGE - halfW - PRAISE_DRIFT
  const cx = Math.min(Math.max(x, minX), maxX)
  const minY = PRAISE_EDGE + halfH
  const maxY = DESIGN_HEIGHT - PRAISE_EDGE - halfH
  const above = y - PRAISE_LIFT
  if (above - PRAISE_RISE >= minY && above <= maxY) return { x: cx, y: above }
  let below = y + PRAISE_LIFT
  if (below + PRAISE_RISE > maxY) below = maxY - PRAISE_RISE
  if (below < minY) below = minY
  return { x: cx, y: below }
}

const praiseNodes: HTMLDivElement[] = []

function takePraiseNode(host: HTMLElement): HTMLDivElement {
  const idle = praiseNodes.find((node) => !node.isConnected)
  if (idle) return idle
  const node = document.createElement('div')
  node.addEventListener('animationend', (event) => {
    if (event.target !== node) return
    if (event.animationName !== 'praise-rise') return
    node.remove()
  })
  praiseNodes.push(node)
  host.append(node)
  return node
}

export function showPraise(x: number, y: number, rank: number): void {
  const host = document.getElementById('stage')
  if (!host || rank <= 0) return
  const line = LINES[Math.min(rank, LINES.length) - 1]
  const id = `praise-fill-${serial}`
  serial += 1
  const spot = placePraise(x, y, line.text)
  const word = wordLayout(line.text)
  const node = takePraiseNode(host)
  node.className = ''
  node.style.left = `${spot.x}px`
  node.style.top = `${spot.y}px`
  node.innerHTML = `<svg viewBox="0 0 ${word.viewW} ${word.viewH}" width="${word.drawW}" height="${word.drawH}" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line.top}"/>
        <stop offset="55%" stop-color="${line.top}"/>
        <stop offset="100%" stop-color="${line.bottom}"/>
      </linearGradient>
    </defs>
    <text x="${word.viewW / 2}" y="62" text-anchor="middle"
      fill="url(#${id})" stroke="#ffffff" stroke-width="13" stroke-linejoin="round" paint-order="stroke">${line.text}</text>
  </svg>`
  if (!node.isConnected) host.append(node)
  void node.offsetWidth
  node.className = 'praise'
}
