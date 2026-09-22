/**
 * Mensajes de error Gemini legibles para la UI (es/en).
 */
import { REMOTE_RESOURCE_URLS } from '../../core/config/sharedConfig'

// URL oficial para crear/gestionar la Gemini API key (Rule #1: NO HARDCODE).
const GEMINI_API_KEY_URL = REMOTE_RESOURCE_URLS.GEMINI_API_KEY_PAGE

const HINTS = {
  missing_api_key: {
    es: 'Pega tu Gemini API Key en el configurador de voz y pulsa Guardar configuración.',
    en: 'Paste your Gemini API key in Voice settings and click Save configuration.',
  },
  gemini_quota_429: {
    es: `Cuota agotada (429). La API key gratuita no tiene más cuota. Ve a ${GEMINI_API_KEY_URL}, crea una key y HABILITA FACTURACIÓN (billing) en el proyecto, o espera 1 minuto a que se resetee la cuota gratuita.`,
    en: `Quota exceeded (429). The free-tier API key has no remaining quota. Go to ${GEMINI_API_KEY_URL}, create a key and ENABLE BILLING on the project, or wait 1 minute for the free quota to reset.`,
  },
  gemini_403: {
    es: 'Acceso denegado. Verifica que la API key sea válida y tenga Gemini habilitado.',
    en: 'Access denied. Verify the API key is valid and has Gemini enabled.',
  },
  invalid_json: {
    es: 'Gemini respondió en un formato inesperado. Reintenta la pregunta.',
    en: 'Gemini returned an unexpected format. Try again.',
  },
  gemini_api_error: {
    es: 'Error de conexión con Gemini. Revisa la API key y la consola del navegador (F12).',
    en: 'Gemini connection error. Check the API key and browser console (F12).',
  },
  gemini_timeout: {
    es: 'El servicio de IA tardó demasiado en responder. Espera un momento y reintenta.',
    en: 'The AI service took too long to respond. Wait a moment and retry.',
  },
  gemini_network: {
    es: 'No se pudo conectar con el servidor de IA. Si acabas de reiniciarlo, recarga la página (F5) para reconectar; si persiste, verifica que npm run dev siga activo.',
    en: 'Could not reach the AI server. If you just restarted it, reload the page (F5) to reconnect; if it persists, check that npm run dev is still running.',
  },
}

function pickLang(language = 'es') {
  return language === 'en' ? 'en' : 'es'
}

const GENERIC_FAILURE_ES = 'Gemini no respondió.'
const GENERIC_FAILURE_EN = 'Gemini did not respond.'

/** Señal explícita de fallo — evita mensajes por defecto en estado idle. */
export function hasGeminiFailureSignal({
  error = '',
  diagnostics = null,
  lastErrorEvent = null,
  failure = null,
} = {}) {
  if (failure) {
    const code = String(failure?.code || '').trim()
    const raw = String(failure?.message || failure?.error || '').trim()
    if (code || raw) return true
  }
  const errorText = String(error || '').trim()
  const eventError = String(lastErrorEvent?.error || '').trim()
  const diagCode = String(diagnostics?.code || lastErrorEvent?.code || '').trim()
  return (
    Boolean(errorText) ||
    Boolean(eventError) ||
    Boolean(diagCode) ||
    diagnostics?.provider === 'error'
  )
}

export function formatGeminiUserMessage(error = null, language = 'es', { fallback = false } = {}) {
  const lang = pickLang(language)
  const code = String(error?.code || '').trim()
  const raw = String(error?.message || error?.error || '').trim()

  // Timeout del motor de texto (fetchTextEngine aborta a los 45s y normaliza
  // el fallo a code 'gemini_timeout' / status 408). Ya no es un "Failed to fetch".
  if (code === 'gemini_timeout') {
    return lang === 'en'
      ? 'Gemini: the AI service took too long to respond. Wait a moment and retry.'
      : 'Gemini: el servicio de IA tardó demasiado en responder. Espera un momento y reintenta.'
  }
  // Fallo de transporte normalizado por fetchTextEngineResilient (cliente):
  // ya fue reintentado 1 vez; aquí solo se presenta el mensaje accionable.
  if (code === 'gemini_network') {
    return lang === 'en'
      ? 'Gemini: could not reach the AI server. If you just restarted it, reload the page (F5) to reconnect.'
      : 'Gemini: no se pudo conectar con el servidor de IA. Si acabas de reiniciarlo, recarga la página (F5) para reconectar.'
  }
  // Handle TypeError (network errors like "Failed to fetch") — no .code property
  // (transport error residual: el servidor real no respondió a tiempo)
  if (!code && raw === 'Failed to fetch') {
    return lang === 'en'
      ? 'Gemini: the connection to the AI service was interrupted. Check that the dev server is running (npm run dev), retry, and verify the API key in settings.'
      : 'Gemini: la conexión con el servicio de IA se interrumpió. Verifica que el servidor esté activo (npm run dev), reintenta y revisa la API key en ajustes.'
  }
  // Handle raw "missing_api_key" message (from processCapture path that uses error.message directly)
  if (raw === 'missing_api_key') {
    return lang === 'en' ? 'Gemini: missing API key.' : 'Gemini: falta la API key.'
  }

  if (code === 'missing_api_key') {
    return lang === 'en' ? 'Gemini: missing API key.' : 'Gemini: falta la API key.'
  }
  if (code === 'gemini_quota_429') {
    return lang === 'en' ? 'Gemini: quota exceeded (429).' : 'Gemini: cuota agotada (429).'
  }
  if (code === 'gemini_403') {
    return lang === 'en' ? 'Gemini: access denied (403).' : 'Gemini: acceso denegado (403).'
  }
  if (code === 'invalid_json') {
    return lang === 'en' ? 'Gemini: invalid response.' : 'Gemini: respuesta inválida.'
  }
  if (code.startsWith('gemini_http_')) {
    const status = error?.status || code.replace('gemini_http_', '')
    return lang === 'en'
      ? `Gemini HTTP error ${status}.`
      : `Error HTTP de Gemini (${status}).`
  }
  if (raw.startsWith('Gemini error')) {
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw
  }
  if (raw) {
    return raw.length > 140 ? `${raw.slice(0, 137)}…` : raw
  }
  if (!fallback) return ''
  return lang === 'en' ? GENERIC_FAILURE_EN : GENERIC_FAILURE_ES
}

export function formatGeminiErrorHint(error = null, language = 'es', { fallback = false } = {}) {
  const lang = pickLang(language)
  const code = String(error?.code || '').trim()
  const entry = HINTS[code]
  if (entry) return entry[lang]
  if (code.startsWith('gemini_http_400')) {
    return lang === 'en'
      ? 'Check that your API key is correct.'
      : 'Revisa que la API key sea correcta.'
  }
  const raw = String(error?.message || error?.error || '').trim()
  if (!fallback && !code && !raw) return ''
  if (!raw || raw === GENERIC_FAILURE_ES || raw === GENERIC_FAILURE_EN) {
    if (!fallback) return ''
    return lang === 'en'
      ? 'Voice capture still works. Check your API key, quota, and browser console (F12).'
      : 'La transcripción sigue funcionando. Revisa la API key, la cuota y la consola del navegador (F12).'
  }
  return ''
}

export function buildGeminiDiagnosticsFromError(error = null) {
  if (!error) return null
  return {
    provider: 'error',
    code: error?.code || '',
    status: error?.status || null,
    apiKeySource: error?.apiKeySource || '',
    model: error?.model || '',
    detail: String(error?.bodyPreview || error?.detail || '').slice(0, 240),
  }
}

/**
 * @param {{ error?: string, diagnostics?: object|null, lastErrorEvent?: object|null, language?: string }} input
 */
export function resolveGeminiErrorPresentation({
  error = '',
  diagnostics = null,
  lastErrorEvent = null,
  language = 'es',
} = {}) {
  const hasFailure = hasGeminiFailureSignal({ error, diagnostics, lastErrorEvent })

  if (!hasFailure) {
    return { message: '', hint: '', detail: '', code: '', show: false }
  }

  const errorText = String(error || '').trim()
  const eventError = String(lastErrorEvent?.error || '').trim()
  const diagCode = String(diagnostics?.code || lastErrorEvent?.code || '').trim()

  const syntheticError = {
    message: errorText || eventError,
    code: diagCode,
    status: diagnostics?.status,
    apiKeySource: diagnostics?.apiKeySource,
    model: diagnostics?.model,
    detail: diagnostics?.detail,
    bodyPreview: diagnostics?.detail,
  }

  const message = formatGeminiUserMessage(syntheticError, language, { fallback: true })
  const hint = formatGeminiErrorHint(syntheticError, language, { fallback: true })
  const detail = cleanDetail(
    diagnostics?.detail ||
      lastErrorEvent?.detail ||
      (diagnostics?.model ? `modelo: ${diagnostics.model}` : ''),
  )
  const displayMessage = message || errorText || eventError

  return {
    message: displayMessage,
    hint,
    detail: detail && detail !== displayMessage ? detail : '',
    code: syntheticError.code,
    show: Boolean(displayMessage || hint),
  }
}

function cleanDetail(text = '') {
  const value = String(text || '').trim()
  if (!value) return ''
  return value.length > 200 ? `${value.slice(0, 197)}…` : value
}
