import { VISUAL_CONFIG } from './visualConfig.js'
import { TIMEOUT_POLICY_MS } from '../../core/config/appConfig'
import { shortText } from '../../lib/textUtils'
import { resolveOpenverseStockArtifact } from './fluVisualStockSearch.js'
import { logCaughtError } from '../../lib/caughtError';
import { AI_PROVIDER_IDS } from '../../core/config/sharedConfig'
import {
  buildVisualGenerationPrompt,
  buildPollinationsArtifact,
  getVisualPipelineConfig,
  resolveVisualBriefCore,
  shouldUseLocalSvgOnError,
} from './fluVisualPipeline.js'
import { GENERATION_FAILED_SOURCE } from '../../lib/generationTrace';
import { fetchWithDeadline } from '../../lib/fetchWithDeadline'
import { defaultLanguage } from './languageDefault.ts'

export {
  buildVisualGenerationPrompt,
  buildPollinationsArtifact,
  getVisualPipelineConfig,
  resolveVisualBriefCore,
} from './fluVisualPipeline.js'

const workspaceImageSourceCache = new Map()

/** Traza de OpenRouter para un resultado de imagen (dueño único). */
function openRouterTrace({ source, hasImage, prompt, error, language }) {
  return {
    provider: AI_PROVIDER_IDS.OPENROUTER,
    model: '',
    kind: 'images',
    source,
    hasImage,
    ...(error ? { error } : {}),
    prompt,
    ...(language ? { language } : {}),
  }
}

/**
 * Deadline UNICO de las llamadas al proxy local (`/api/*`). Antes cada funcion
 * repetia su propio `AbortController` + `setTimeout` + `clearTimeout` con el mismo
 * `timeoutMs` (3 copias medidas). Se conserva el `AbortError` a proposito: los
 * `trace` distinguen timeout (`*_timeout`) de fallo generico, y cambiar el tipo de
 * error cambiaria esa etiqueta.
 */
async function postJsonToProxy(url, body, timeoutMs) {
  // P8.46: el deadline lo pone el primitivo unico; aqui solo el POST JSON. El
  // AbortError se conserva crudo porque las trazas del proxy visual lo etiquetan
  // (`workspace_image_timeout` / `openrouter_image_timeout` / `fal_video_timeout`).
  return fetchWithDeadline(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
  )
}

/**
 * Lee el detalle del cuerpo de un proxy visual fallido. Dueno unico: imagen de
 * workspace, fallback OpenRouter y video fal comparten el manejo del error.
 * @param {Response} response respuesta HTTP no ok
 * @returns {Promise<string>} cuerpo del error, o '' si no se pudo leer
 */
async function readProxyErrorDetail(response) {
  return response.text().catch((e) => { logCaughtError('[catch] src/voice/lib/imageGeneration.js', e); return ''; })
}

/**
 * POST a un proxy visual con el idioma y la apiKey opcional. Dueno unico del
 * contrato de esas llamadas: el deadline es el configurado para imagen.
 * @param {string} url endpoint del proxy
 * @param {Record<string, unknown>} payload campos propios del proveedor
 * @param {string} apiKey clave opcional del usuario
 */
function postVisualProxy(url, payload, apiKey = '') {
  return postJsonToProxy(
    url,
    { ...payload, ...(apiKey ? { apiKey } : {}) },
    Number(VISUAL_CONFIG.image?.clientFetchTimeoutMs),
  )
}

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildLocalSvgDataUrl(subject = '') {
  const label = escapeXml(shortText(subject, 120))
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 576" role="img" aria-label="${label || 'Visual generada por Flu'}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#050816"/>
      <stop offset="52%" stop-color="#081126"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  ${label ? `<text x="512" y="300" text-anchor="middle" fill="#e2e8f0" font-size="28" font-family="Segoe UI, sans-serif">${label}</text>` : ''}
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function buildNotVisualTrace() {
  const c = getVisualPipelineConfig()
  return {
    image_url: '',
    trace: {
      provider: c.pollinationsModel,
      model: c.pollinationsModel,
      kind: 'url',
      source: 'not_visual',
      hasImage: false,
    },
  }
}

export async function resolveWorkspaceAiImageSource({ workspace = {}, language = defaultLanguage() } = {}) {
  const prompt = buildVisualGenerationPrompt(workspace, language)
  const subject = resolveVisualBriefCore(workspace)
  return {
    image_url: buildLocalSvgDataUrl(subject),
    trace: {
      provider: 'local-svg',
      model: 'local-svg',
      kind: 'inline',
      source: 'local_svg_fallback',
      hasImage: true,
      prompt,
      language,
    },
  }
}

export async function buildWorkspaceImageArtifact(workspace = {}, language = defaultLanguage()) {
  const c = getVisualPipelineConfig()
  const type = String(workspace.tipo || '').trim().toLowerCase()
  const prompt = buildVisualGenerationPrompt(workspace, language)

  if (!prompt || !c.visualTypes.includes(type)) {
    return buildNotVisualTrace()
  }

  if (c.stockSearchEnabled && type === 'image_prompt') {
    const stock = await resolveOpenverseStockArtifact(workspace, language)
    if (stock?.image_url) {
      return {
        ...stock,
        trace: { ...stock.trace, prompt },
      }
    }
  }

  return buildPollinationsArtifact(prompt, { seedInput: `${language}::${prompt}` })
}

function buildWorkspaceImageRequestKey(workspace = {}, language = defaultLanguage()) {
  return `${language}::${buildVisualGenerationPrompt(workspace, language)}`
}

async function resolveErrorFallback(workspace = {}, language = defaultLanguage(), error = '') {
  if (!shouldUseLocalSvgOnError()) {
    return {
      image_url: '',
      trace: {
        provider: 'local-proxy',
        kind: 'blob',
        source: GENERATION_FAILED_SOURCE,
        hasImage: false,
        error: error || 'unknown',
        prompt: buildVisualGenerationPrompt(workspace, language),
      },
    }
  }
  const fallback = await resolveWorkspaceAiImageSource({ workspace, language })
  return {
    ...fallback,
    trace: {
      ...fallback.trace,
      error: error || 'unknown',
    },
  }
}

export async function fetchWorkspaceImageSource({ workspace = {}, language = defaultLanguage(), apiKey = '' } = {}) {
  const prompt = buildVisualGenerationPrompt(workspace, language)
  const type = String(workspace.tipo || '').trim().toLowerCase()
  const c = getVisualPipelineConfig()

  if (!prompt || !c.visualTypes.includes(type)) {
    return {
      image_url: '',
      trace: {
        provider: 'local-proxy',
        kind: 'blob',
        source: 'not_visual',
        hasImage: false,
      },
    }
  }

  const cacheKey = buildWorkspaceImageRequestKey(workspace, language)
  const cached = workspaceImageSourceCache.get(cacheKey)
  if (cached?.image_url) return cached
  if (cached?.promise) return cached.promise

  const promise = (async () => {
    try {
      const response = await postVisualProxy(
        VISUAL_CONFIG.image.proxies.workspaceImage,
        { workspace, language },
        apiKey,
      )

      if (!response.ok) {
        const detail = await readProxyErrorDetail(response)
        return resolveErrorFallback(
          workspace,
          language,
          detail || `workspace_image_http_${response.status}`,
        )
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const payload = await response.json()
        if (!payload?.image_url) {
          throw new Error('workspace_image_empty_json')
        }
        return {
          image_url: payload.image_url,
          trace: payload.trace || {
            provider: 'remote-url',
            kind: 'url',
            source: 'server_json',
            hasImage: true,
            prompt,
          },
        }
      }

      const blob = await response.blob()
      if (!blob.size) {
        throw new Error('workspace_image_empty_blob')
      }

      return {
        image_url: URL.createObjectURL(blob),
        trace: {
          provider: 'local-proxy',
          kind: 'blob',
          source: 'server_proxy',
          hasImage: true,
          prompt,
        },
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        return resolveErrorFallback(workspace, language, 'workspace_image_timeout')
      }
      throw error
    }
  })()

  workspaceImageSourceCache.set(cacheKey, { promise })

  try {
    const resolved = await promise
    if (String(resolved.image_url || '').startsWith('blob:')) {
      workspaceImageSourceCache.delete(cacheKey)
    } else {
      workspaceImageSourceCache.set(cacheKey, resolved)
    }
    return resolved
  } catch (error) {
        logCaughtError('[catch] src/voice/lib/imageGeneration.js', error);
    workspaceImageSourceCache.delete(cacheKey)
    return resolveErrorFallback(workspace, language, error?.message || 'unknown')
  }
}

/**
 * Fallback real de imagen por OpenRouter (servidor). Se invoca cuando la
 * imagen de Pollinations falla al cargar en el navegador (onError del <img>),
 * para no dejar el placeholder «chipote».
 * POST /api/openrouter-image → { imageUrl (data URL), trace }.
 * Devuelve { image_url, trace }; image_url vacío si no hay key o falla.
 */
export async function fetchOpenRouterImageFallback({
  workspace = {},
  language = defaultLanguage(),
  apiKey = '',
} = {}) {
  const prompt = buildVisualGenerationPrompt(workspace, language)
  try {
    const response = await postVisualProxy(
      VISUAL_CONFIG.image.proxies.openrouterImage,
      { prompt, language },
      apiKey,
    )

    if (!response.ok) {
      const detail = await readProxyErrorDetail(response)
      return {
        image_url: '',
        trace: openRouterTrace({
          source: 'proxy_error',
          hasImage: false,
          prompt,
          error: detail || `openrouter_image_http_${response.status}`,
        }),
      }
    }

    const payload = await response.json()
    if (!payload?.imageUrl) {
      return {
        image_url: '',
        trace:
          payload?.trace ||
          openRouterTrace({ source: 'empty_response', hasImage: false, prompt }),
      }
    }

    return {
      image_url: payload.imageUrl,
      trace:
        payload.trace ||
        openRouterTrace({
          source: 'openrouter_image_fallback',
          hasImage: true,
          prompt,
          language,
        }),
    }
  } catch (error) {
        logCaughtError('[catch] src/voice/lib/imageGeneration.js', error);
    return {
      image_url: '',
      trace: openRouterTrace({
        source:
          error?.name === 'AbortError' ? 'openrouter_image_timeout' : GENERATION_FAILED_SOURCE,
        hasImage: false,
        prompt,
        error: error?.message || 'unknown',
      }),
    }
  }
}

/**
 * Video REAL con fal.ai (text-to-video). Se invoca desde la generación de
 * video (GENERAR_VIDEO) con el tema/prompt del usuario.
 * POST /api/fal-video → { videoUrl (url del clip), trace }.
 * Devuelve { video_url, trace }; video_url vacío si no hay key o falla.
 */
export async function fetchFalVideo({ prompt = '', language = defaultLanguage(), apiKey = '', model = '' } = {}) {
  if (!prompt.trim()) {
    return {
      video_url: '',
      trace: { provider: 'falai', source: 'empty_prompt', hasVideo: false, prompt },
    }
  }
  try {
    const response = await postJsonToProxy(
      VISUAL_CONFIG.image.proxies.falVideo,
      { prompt, language, ...(apiKey ? { apiKey } : {}), ...(model ? { model } : {}) },
      TIMEOUT_POLICY_MS.falVideoFetchAbort,
    )
    if (!response.ok) {
      const detail = await readProxyErrorDetail(response)
      return {
        video_url: '',
        trace: {
          provider: 'falai',
          source: 'proxy_error',
          hasVideo: false,
          error: detail || `fal_video_http_${response.status}`,
          prompt,
        },
      }
    }
    const payload = await response.json()
    return {
      video_url: payload?.videoUrl || '',
      trace: payload?.trace || { provider: 'falai', source: 'empty_response', hasVideo: false, prompt },
    }
  } catch (error) {
        logCaughtError('[catch] src/voice/lib/imageGeneration.js', error);
    return {
      video_url: '',
      trace: {
        provider: 'falai',
        source: error?.name === 'AbortError' ? 'fal_video_timeout' : GENERATION_FAILED_SOURCE,
        hasVideo: false,
        error: error?.message || 'unknown',
        prompt,
      },
    }
  }
}
