export const STREAM_STT_MSG = Object.freeze({
  CONFIG: 'config',
  TRANSCRIPT: 'transcript',
  STATUS: 'status',
  ERROR: 'error',
  SIMULATE: 'simulate',
})

export function parseStreamSttMessage(raw = '') {
  try {
    const data = JSON.parse(raw)
    if (!data?.type) return null
    return data
  } catch {
    return null
  }
}

export function buildTranscriptMessage({ text = '', final = false, partial = true } = {}) {
  return {
    type: STREAM_STT_MSG.TRANSCRIPT,
    text: String(text ?? ''),
    final: Boolean(final),
    partial: partial !== false && !final,
  }
}

export function buildStatusMessage({ state = '', provider = '', detail = '' } = {}) {
  return {
    type: STREAM_STT_MSG.STATUS,
    state: String(state || ''),
    provider: String(provider || ''),
    detail: String(detail || ''),
  }
}
