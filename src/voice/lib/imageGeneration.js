import { VISUAL_CONFIG } from './visualConfig.js'
import { resolveOpenverseStockArtifact } from './fluVisualStockSearch.js'
import {
  buildGenerationPrompt,
  buildPollinationsArtifact,
  getVisualPipelineConfig,
  resolveVisualBriefCore,
  shouldUseLocalSvgOnError,
} from './fluVisualPipeline.js'

export {
  buildGenerationPrompt,
  buildGenerationPrompt as buildWorkspaceImagePrompt,
  buildPollinationsArtifact,
  getVisualPipelineConfig,
  resolveVisualBriefCore,
} from './fluVisualPipeline.js'

const workspaceImageSourceCache = new Map()

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function shortText(value = '', max = 260) {
  const text = normalizeText(value)
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
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

export async function resolveWorkspaceAiImageSource({ workspace = {}, language = 'es' } = {}) {
  const prompt = buildGenerationPrompt(workspace, language)
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

export async function buildWorkspaceImageArtifact(workspace = {}, language = 'es') {
  const c = getVisualPipelineConfig()
  const type = String(workspace.tipo || '').trim().toLowerCase()
  const prompt = buildGenerationPrompt(workspace, language)

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

  if (c.primary === 'pollinations') {
    return buildPollinationsArtifact(prompt, { seedInput: `${language}::${prompt}` })
  }

  return buildPollinationsArtifact(prompt, { seedInput: `${language}::${prompt}` })
}

function buildWorkspaceImageRequestKey(workspace = {}, language = 'es') {
  return `${language}::${buildGenerationPrompt(workspace, language)}`
}

async function resolveErrorFallback(workspace = {}, language = 'es', error = '') {
  if (!shouldUseLocalSvgOnError()) {
    return {
      image_url: '',
      trace: {
        provider: 'local-proxy',
        kind: 'blob',
        source: 'generation_failed',
        hasImage: false,
        error: error || 'unknown',
        prompt: buildGenerationPrompt(workspace, language),
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

export async function fetchWorkspaceImageSource({ workspace = {}, language = 'es', apiKey = '' } = {}) {
  const prompt = buildGenerationPrompt(workspace, language)
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
    const timeoutMs = Number(VISUAL_CONFIG.image?.clientFetchTimeoutMs)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch('/api/workspace-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          workspace,
          language,
          ...(apiKey ? { apiKey } : {}),
        }),
      })

      if (!response.ok) {
        const detail = await response.text().catch(() => '')
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
    } finally {
      clearTimeout(timer)
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
  language = 'es',
  apiKey = '',
} = {}) {
  const prompt = buildGenerationPrompt(workspace, language)
  const timeoutMs = Number(VISUAL_CONFIG.image?.clientFetchTimeoutMs)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('/api/openrouter-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        prompt,
        language,
        ...(apiKey ? { apiKey } : {}),
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return {
        image_url: '',
        trace: {
          provider: 'openrouter',
          model: '',
          kind: 'images',
          source: 'proxy_error',
          hasImage: false,
          error: detail || `openrouter_image_http_${response.status}`,
          prompt,
        },
      }
    }

    const payload = await response.json()
    if (!payload?.imageUrl) {
      return {
        image_url: '',
        trace: payload?.trace || {
          provider: 'openrouter',
          model: '',
          kind: 'images',
          source: 'empty_response',
          hasImage: false,
          prompt,
        },
      }
    }

    return {
      image_url: payload.imageUrl,
      trace: payload.trace || {
        provider: 'openrouter',
        model: '',
        kind: 'images',
        source: 'openrouter_image_fallback',
        hasImage: true,
        prompt,
        language,
      },
    }
  } catch (error) {
    return {
      image_url: '',
      trace: {
        provider: 'openrouter',
        model: '',
        kind: 'images',
        source: error?.name === 'AbortError' ? 'openrouter_image_timeout' : 'generation_failed',
        hasImage: false,
        error: error?.message || 'unknown',
        prompt,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Video REAL con fal.ai (text-to-video). Se invoca desde la generación de
 * video (GENERAR_VIDEO) con el tema/prompt del usuario.
 * POST /api/fal-video → { videoUrl (url del clip), trace }.
 * Devuelve { video_url, trace }; video_url vacío si no hay key o falla.
 */
export async function fetchFalVideo({ prompt = '', language = 'es', apiKey = '' } = {}) {
  if (!prompt.trim()) {
    return {
      video_url: '',
      trace: { provider: 'falai', source: 'empty_prompt', hasVideo: false, prompt },
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 200000)
  try {
    const response = await fetch('/api/fal-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ prompt, language, ...(apiKey ? { apiKey } : {}) }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
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
    return {
      video_url: '',
      trace: {
        provider: 'falai',
        source: error?.name === 'AbortError' ? 'fal_video_timeout' : 'generation_failed',
        hasVideo: false,
        error: error?.message || 'unknown',
        prompt,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}
