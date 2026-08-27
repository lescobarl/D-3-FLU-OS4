/**
 * Panel dev: log mic ingress (texto publicado completo, reciente arriba).
 */
import { FLU_CONFIG } from './fluConfig.js'

const IS_DEV = Boolean(import.meta.env?.DEV)
const PANEL_ID = 'flu-dev-mic-log'
const BODY_ID = `${PANEL_ID}-body`
const POS_KEY = 'flu-dev-mic-log-pos'

let panelReady = false

function maxLogLines() {
  const n = Number(FLU_CONFIG.debug?.micConsoleMaxLines)
  return Number.isFinite(n) && n >= 50 ? Math.floor(n) : 500
}

export function isFluDevConsolePanelEnabled() {
  if (!IS_DEV || typeof document === 'undefined') return false
  if (window.__FLU_DEV_CONSOLE_PANEL === false) return false
  if (window.__FLU_DEV_CONSOLE_PANEL === true) return true
  return FLU_CONFIG.debug?.micConsolePanel !== false
}

function loadPanelPosition(panel) {
  try {
    const raw = sessionStorage.getItem(POS_KEY)
    if (!raw) return
    const { left, top, width, height } = JSON.parse(raw)
    if (Number.isFinite(left)) {
      panel.style.left = `${left}px`
      panel.style.bottom = 'auto'
    }
    if (Number.isFinite(top)) {
      panel.style.top = `${top}px`
      panel.style.bottom = 'auto'
    }
    if (Number.isFinite(width) && width >= 240) panel.style.width = `${width}px`
    if (Number.isFinite(height) && height >= 120) panel.style.height = `${height}px`
  } catch {
    // ignore
  }
}

function savePanelPosition(panel) {
  try {
    const rect = panel.getBoundingClientRect()
    sessionStorage.setItem(
      POS_KEY,
      JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }),
    )
  } catch {
    // ignore
  }
}

function enablePanelDrag(panel, handle) {
  handle.style.cursor = 'move'
  let dragging = false
  let pointerId = null
  let startX = 0
  let startY = 0
  let startLeft = 0
  let startTop = 0

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    dragging = true
    pointerId = event.pointerId
    handle.setPointerCapture(pointerId)
    const rect = panel.getBoundingClientRect()
    panel.style.bottom = 'auto'
    panel.style.right = 'auto'
    panel.style.left = `${rect.left}px`
    panel.style.top = `${rect.top}px`
    startX = event.clientX
    startY = event.clientY
    startLeft = rect.left
    startTop = rect.top
    event.preventDefault()
  })

  handle.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== pointerId) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth - 4)
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight - 4)
    panel.style.left = `${Math.min(maxLeft, Math.max(0, startLeft + dx))}px`
    panel.style.top = `${Math.min(maxTop, Math.max(0, startTop + dy))}px`
  })

  const endDrag = (event) => {
    if (!dragging || event.pointerId !== pointerId) return
    dragging = false
    try {
      handle.releasePointerCapture(pointerId)
    } catch {
      // ignore
    }
    pointerId = null
    savePanelPosition(panel)
  }

  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => savePanelPosition(panel)).observe(panel)
  }
}

function ensurePanel() {
  if (!isFluDevConsolePanelEnabled() || panelReady) return document.getElementById(PANEL_ID)

  const panel = document.createElement('div')
  panel.id = PANEL_ID
  panel.setAttribute('aria-label', 'Flu mic log ingress')
  Object.assign(panel.style, {
    position: 'fixed',
    bottom: '12px',
    left: '12px',
    zIndex: '99998',
    width: 'min(560px, 94vw)',
    height: '300px',
    minWidth: '280px',
    minHeight: '160px',
    maxWidth: '96vw',
    maxHeight: '85vh',
    resize: 'both',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(8, 12, 20, 0.94)',
    color: '#c8e6ff',
    font: '11px/1.35 ui-monospace, Consolas, monospace',
    border: '1px solid rgba(100, 140, 200, 0.35)',
    borderRadius: '8px',
    padding: '6px 8px',
    pointerEvents: 'auto',
    boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
  })

  const title = document.createElement('div')
  title.textContent = 'Flu mic log (productor · STT crudo en tiempo real) — arrastra · redimensiona'
  Object.assign(title.style, {
    fontWeight: '600',
    marginBottom: '6px',
    color: '#8ab4f8',
    fontSize: '10px',
    flexShrink: '0',
    userSelect: 'none',
    touchAction: 'none',
  })
  panel.appendChild(title)

  const body = document.createElement('div')
  body.id = BODY_ID
  Object.assign(body.style, {
    flex: '1 1 auto',
    minHeight: '0',
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
    WebkitOverflowScrolling: 'touch',
  })
  panel.appendChild(body)

  document.body.appendChild(panel)
  loadPanelPosition(panel)
  enablePanelDrag(panel, title)
  panelReady = true
  return panel
}

/**
 * @param {{ seq: number, source: string, kind: string, published: string, raw?: string, note?: string }} entry
 */
export function appendFluMicLogLine({ seq, source, kind, published, raw = '', note = '' }) {
  if (!isFluDevConsolePanelEnabled()) return

  const panel = ensurePanel()
  const body = panel?.querySelector(`#${BODY_ID}`)
  if (!body) return

  const line = document.createElement('div')
  const clock = new Date().toLocaleTimeString('es-MX', { hour12: false })
  const head = `${clock} #${seq} [${source}] ${kind}`
  const text = published || raw || note
  line.textContent = note && published ? `${head} ${published} (${note})` : `${head} ${text}`
  Object.assign(line.style, {
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    padding: '3px 0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  })
  if (kind === 'final' || kind === 'redundant') {
    line.style.color = '#b8f5c3'
  } else if (kind === 'skip' || kind === 'blocked') {
    line.style.color = '#aab0b8'
  }

  body.insertBefore(line, body.firstChild)
  const limit = maxLogLines()
  while (body.childNodes.length > limit) {
    body.removeChild(body.lastChild)
  }
}
