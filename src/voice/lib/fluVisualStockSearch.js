/**
 * Búsqueda stock opcional (Openverse). Solo si pipeline.stockSearch.enabled === true.
 */
import { VISUAL_CONFIG } from './visualConfig.js'
import { getVisualPipelineConfig, resolveVisualBriefCore } from './fluVisualPipeline.js'

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function scoreOpenverseResult(result = {}, brief = '') {
  const title = normalizeText(result.title || '').toLowerCase()
  const creator = normalizeText(result.creator || '').toLowerCase()
  const haystack = `${title} ${creator}`
  const briefNorm = normalizeText(brief).toLowerCase()
  const briefTokens = briefNorm.split(/\s+/).filter((token) => token.length > 2)

  let score = 0
  for (const token of briefTokens) {
    if (haystack.includes(token)) score += 4
    if (title.includes(token)) score += 4
  }

  const penalties = VISUAL_CONFIG.image?.pipeline?.stockSearch?.titlePenalties || []
  for (const penalty of penalties) {
    if (title.includes(String(penalty).toLowerCase())) score -= 8
  }

  return score
}

/**
 * @param {object} workspace
 * @param {string} language
 */
export async function resolveOpenverseStockArtifact(workspace = {}, language = 'es') {
  const c = getVisualPipelineConfig()
  if (!c.stockSearchEnabled) return null

  const brief = resolveVisualBriefCore(workspace)
  if (!brief) return null

  const apiBase = c.openverseApiBase.replace(/\/$/, '')
  const searchUrl = `${apiBase}/?q=${encodeURIComponent(brief)}&page_size=${c.stockPageSize}&filter_dead=true`
  const payload = await fetchJsonWithTimeout(searchUrl, c.stockRequestTimeoutMs)
  const results = Array.isArray(payload?.results) ? payload.results : []

  let best = null
  let bestScore = -Infinity
  for (const result of results) {
    const score = scoreOpenverseResult(result, brief)
    if (score > bestScore) {
      bestScore = score
      best = result
    }
  }

  if (!best || bestScore < c.stockMinAcceptScore) return null

  const candidate = best?.thumbnail || best?.url || ''
  if (!candidate) return null

  return {
    image_url: candidate,
    trace: {
      provider: 'openverse',
      model: 'openverse',
      kind: 'url',
      source: 'openverse_full_brief',
      hasImage: true,
      query: brief,
      title: String(best?.title || '').trim(),
      score: bestScore,
      language,
    },
  }
}
