/**
 * Pipeline visual: brief de workspace IA → prompt de generación. Sin números mágicos aquí.
 * Inventario: docs/reglas-duras-visual.md · listConfiguredVisualPipelineRules()
 */
import { VISUAL_CONFIG } from './visualConfig.js'

export const VISUAL_PIPELINE_KEYS = [
  'primary',
  'visualTypes',
  'errorFallback',
  'stockSearchEnabled',
  'stockQueryMode',
  'stockMinAcceptScore',
  'stockPageSize',
  'stockRequestTimeoutMs',
  'pollinationsBaseUrl',
  'pollinationsModel',
  'pollinationsNologo',
  'pollinationsEnhance',
  'imageWidth',
  'imageHeight',
  'openverseApiBase',
  'promptMaxSubjectChars',
  'promptMaxContextChars',
  'geminiImageModel',
  'geminiImageKind',
]

function cfg() {
  return VISUAL_CONFIG.image || {}
}

export function getVisualPipelineConfig() {
  const image = cfg()
  const pipeline = image.pipeline || {}
  const pollinations = image.pollinations || {}
  const openverse = image.openverse || {}
  const prompt = image.prompt || {}
  const geminiImage = pipeline.geminiImage || {}
  const geminiModels = Array.isArray(geminiImage.models) ? geminiImage.models : []
  const defaultModel = String(geminiImage.defaultModel || '').trim()
  const defaultKind = String(geminiImage.defaultKind || 'generateContent').trim()
  const firstModel = geminiModels[0]
  return {
    primary: String(pipeline.primary || 'pollinations').trim(),
    visualTypes: Array.isArray(pipeline.visualTypes)
      ? pipeline.visualTypes.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean)
      : ['image_prompt', 'diagram', '3d'],
    errorFallback: String(pipeline.errorFallback || 'localSvg').trim(),
    stockSearchEnabled: pipeline.stockSearch?.enabled === true,
    stockQueryMode: String(pipeline.stockSearch?.queryMode || 'fullBrief').trim(),
    stockMinAcceptScore: Number(pipeline.stockSearch?.minAcceptScore),
    stockPageSize: Number(pipeline.stockSearch?.pageSize),
    stockRequestTimeoutMs: Number(pipeline.stockSearch?.requestTimeoutMs),
    pollinationsBaseUrl: String(pollinations.baseUrl || '').trim(),
    pollinationsModel: String(pollinations.model || '').trim(),
    pollinationsNologo: pollinations.nologo === true,
    pollinationsEnhance: pollinations.enhance === true,
    imageWidth: Number(image.width),
    imageHeight: Number(image.height),
    openverseApiBase: String(openverse.apiBase || '').trim(),
    promptMaxSubjectChars: Number(prompt.maxSubjectChars),
    promptMaxContextChars: Number(prompt.maxContextChars),
    geminiImageModel: defaultModel || String(firstModel?.model || '').trim(),
    geminiImageKind: defaultKind || String(firstModel?.kind || 'generateContent').trim(),
  }
}

export function listConfiguredVisualPipelineRules() {
  const c = getVisualPipelineConfig()
  return VISUAL_PIPELINE_KEYS.map((key) => {
    const snake = key.replace(/([A-Z])/g, '_$1').toLowerCase()
    return { key, configKey: snake, value: c[key] }
  })
}

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortText(value = '', max) {
  const text = normalizeText(value)
  const limit = Number.isFinite(max) && max > 0 ? max : text.length
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

/** Núcleo del brief: solo campos del workspace (decisión IA). */
export function resolveVisualBriefCore(workspace = {}) {
  return shortText(
    normalizeText(workspace.prompt_visual || workspace.contenido || workspace.titulo || ''),
    getVisualPipelineConfig().promptMaxSubjectChars,
  )
}

function templateForType(tipo = '', language = 'es') {
  const promptCfg = cfg().prompt || {}
  if (tipo === 'diagram') {
    return language === 'en' ? promptCfg.diagram3dLead?.en : promptCfg.diagramLead?.es
  }
  if (tipo === '3d') {
    return language === 'en' ? promptCfg.diagram3dLead?.en : promptCfg.diagram3dLead?.es
  }
  return language === 'en' ? promptCfg.imagePromptLeadReal?.en : promptCfg.imagePromptLeadReal?.es
}

/**
 * Prompt de generación fiel al workspace (misma fuente para foto, diagrama y 3D).
 */
export function buildGenerationPrompt(workspace = {}, language = 'es') {
  const type = String(workspace.tipo || '').trim().toLowerCase()
  const core = resolveVisualBriefCore(workspace)
  if (!core) return ''

  if (type === 'image_prompt') {
    return core
  }

  const leadTemplate = templateForType(type, language)
  const lead = String(leadTemplate || '').replace(/\{core\}/g, core)
  const constraints =
    language === 'en'
      ? cfg().prompt?.imagePromptConstraints?.en || ''
      : cfg().prompt?.imagePromptConstraints?.es || ''

  return [lead, constraints].filter(Boolean).join(' ')
}

export function hashPromptSeed(input = '') {
  let hash = 2166136261
  const text = String(input || '')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

export function buildPollinationsArtifact(prompt = '', { seedInput = '' } = {}) {
  const c = getVisualPipelineConfig()
  const seed = hashPromptSeed(seedInput || prompt)
  const params = new URLSearchParams({
    width: String(c.imageWidth),
    height: String(c.imageHeight),
    model: c.pollinationsModel,
    seed: String(seed),
  })
  if (c.pollinationsNologo) params.set('nologo', 'true')
  if (c.pollinationsEnhance) params.set('enhance', 'true')

  const base = c.pollinationsBaseUrl.replace(/\/$/, '')
  const image_url = `${base}/prompt/${encodeURIComponent(prompt)}?${params.toString()}`

  return {
    image_url,
    trace: {
      provider: 'pollinations',
      model: c.pollinationsModel,
      kind: 'url',
      source: 'pollinations_generation',
      hasImage: true,
      seed,
      prompt,
    },
  }
}

export function shouldUseLocalSvgOnError() {
  return getVisualPipelineConfig().errorFallback === 'localSvg'
}
