
/** Etiqueta UI del motor de transcripción. */
export function formatStreamSttUiStatus(status = '', { listening = false } = {}) {
  if (!listening) {
    return { label: 'STT off', tone: 'fallback' }
  }
  const raw = String(status || '').trim()
  if (raw === 'error') {
    return { label: 'STT error', tone: 'error' }
  }
  return { label: 'Chrome', tone: 'ok' }
}
