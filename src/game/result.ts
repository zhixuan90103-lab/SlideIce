/** Clear screen over `#ui-root`. Play only reports that the level is clear. */
export function mountResult(actions: { replay: () => void; next: () => void }): { show: () => void; hide: () => void } {
  const host = document.getElementById('stage')
  const root = document.createElement('div')
  root.id = 'result'
  root.className = 'result'
  root.hidden = true
  root.innerHTML = `
    <div class="result-card" role="dialog" aria-labelledby="result-title">
      <p id="result-title" class="result-title">恭喜过关</p>
      <div class="result-actions">
        <button type="button" id="result-replay">重玩</button>
        <button type="button" id="result-next">下一关</button>
      </div>
    </div>`
  host?.append(root)
  const hide = (): void => {
    root.hidden = true
  }
  root.addEventListener('pointerdown', (event) => event.stopPropagation())
  root.querySelector('#result-replay')?.addEventListener('click', () => {
    hide()
    actions.replay()
  })
  root.querySelector('#result-next')?.addEventListener('click', () => {
    hide()
    actions.next()
  })
  return {
    hide,
    show: () => {
      root.hidden = false
    },
  }
}
