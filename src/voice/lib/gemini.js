import { cleanForSpeech } from './audioMath.js'
import { normalizeConfiguracion } from './configCommands.js'
import { FLU_CONFIG } from './fluConfig.js'
import { GEMINI_INFERABLE_COMMAND_IDS } from './voiceCommands.js'
import { buildGenerationPrompt } from './fluVisualPipeline.js'
import {
  buildGeminiApiUrl,
  buildGeminiPredictUrl,
  buildPollinationsUrl,
  buildTextApiUrl,
  isLocalTextEndpoint,
  OPENROUTER_CONFIG,
  resolveTextApiKey,
  WORKSPACE_TIPOS,
} from '../../core/config/appConfig'

import {
  buildBareVisualFallbackWorkspace,
  buildVisualAnchorBlock,
  isBareVisualRequest,
  isVisualWorkspaceTipo,
  normalizeWorkspaceContract,
  selectConversationSummaryWindow,
} from './workspaceContract.js'
import {
  fetchTextEngine,
  fetchTextEngineResilient,
  REQUEST_TIMEOUT_PRESETS,
  resolveRequestTimeout,
} from '../../core/ai/httpClient'
import { buildAnimPrompt } from '../../core/anim/expressionRegistry'
import { buildCapabilitiesPrompt } from '../../services/capabilities'
import { buildConfiguracionPrompt } from '../../core/config/voiceConfigCatalog'
import { buildAmbientePrompt } from '../../core/environments/environmentPrompt'
import { buildSelfManifestoPrompt } from '../../core/selfKnowledge/selfKnowledge'

export {
  buildVisualAnchorBlock,
  extractVisualSubject,
  normalizeWorkspaceContract,
  selectConversationSummaryWindow,
  shouldGenerateWorkspaceImage,
} from './workspaceContract.js'

// NOTA (OS4): Toda la generación de texto (voz, contrato, resumen, evaluación,
// visión/OCR) se enruta por el motor único OpenAI-compatible definido en appConfig:
//   buildTextApiUrl('/chat/completions') → OpenRouter → Google Gemini 2.5 Flash Lite
//   (o el endpoint local / URL configurada en Ajustes → Texto).
// Las imágenes se generan SIEMPRE con Pollinations.ai (buildPollinationsUrl).
// Ya NO se usa la API nativa de Google (generativelanguage.googleapis.com).

// ── Fase 1 (optimización de latencia): timeout de red ADAPTATIVO por tipo de
// petición y carga real. El SERVIDOR (geminiProxy → generateFluContract) impone
// el deadline real vía resolveRequestTimeout(); el CLIENTE suma un margen fijo
// para que el techo del navegador (AbortController de fetchTextEngineResilient)
// supere SIEMPRE al deadline del servidor y no abortar prematuramente
// (lo que dispararía reintentos duplicados).
const CLIENT_TIMEOUT_MARGIN_MS = 10_000

function resolveClientRequestTimeout(params = {}) {
  return (
    resolveRequestTimeout({
      knowledgeMode: params?.knowledgeMode,
      historyLength: (params?.history || []).length,
      transcriptLength: (params?.transcript || '').length,
    }) + CLIENT_TIMEOUT_MARGIN_MS
  )
}

function getGeminiGenerationProfile(profile = 'contract') {
  const block = FLU_CONFIG.gemini?.[profile]
  if (!block || typeof block !== 'object') {
    throw new Error(`fluConfig.gemini.${profile} es obligatorio`)
  }
  return block
}

/**
 * ¿Hay un backend de texto usable? Verdadero si hay API key o si la URL
 * configurada es un endpoint local (Ollama / LM Studio — sin clave).
 */
function hasUsableVoiceBackend(apiKey) {
  if (apiKey) return true
  try {
    return isLocalTextEndpoint(buildTextApiUrl('/chat/completions'))
  } catch {
    return false
  }
}

/**
 * POST OpenAI-compatible a /chat/completions (OpenRouter → Gemini 2.5 Flash Lite,
 * o el endpoint local configurado). Devuelve el contenido textual de choices[0].
 * - Auth: Authorization: Bearer <apiKey> (se omite en endpoints locales).
 * - JSON mode: response_format solo en endpoints remotos (OpenAI/OpenRouter).
 */
async function postChatCompletion({
  apiKey,
  model,
  messages,
  temperature,
  topP,
  maxTokens = 2048,
  jsonMode = false,
  timeoutMs,
}) {
  const url = buildTextApiUrl('/chat/completions')
  const local = isLocalTextEndpoint(url)
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    ...(temperature !== undefined && temperature !== null ? { temperature } : {}),
    ...(topP !== undefined && topP !== null ? { top_p: topP } : {}),
  }
  if (jsonMode && !local) body.response_format = { type: 'json_object' }

  const response = await fetchTextEngineResilient(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    { timeoutMs, retries: 1, retryDelayMs: 300 },
  )

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const error = new Error(`Gemini/OpenRouter error ${response.status}: ${detail || response.statusText}`)
    error.status = response.status
    error.detail = detail
    error.model = model
    throw error
  }

  const payload = await response.json()
  return String(payload?.choices?.[0]?.message?.content || '')
}

/**
 * Mapea mensajes {role, content} al formato de chat OpenAI:
 * - system → un único mensaje system al inicio (concatenados si hay varios).
 * - model (rol nativo Gemini) → assistant.
 * - Consecutivos del mismo rol se concatenan en un solo mensaje multilínea.
 */
export function mapChatMessagesToOpenAI(messages) {
  const openaiMessages = []
  let systemText = ''

  for (const message of messages ?? []) {
    const role = message?.role
    const text = String(message?.content ?? '').trim()
    if (!text) continue

    if (role === 'system') {
      systemText = systemText ? `${systemText}\n\n${text}` : text
      continue
    }

    const openaiRole = role === 'model' || role === 'assistant' ? 'assistant' : 'user'
    const last = openaiMessages[openaiMessages.length - 1]
    if (last && last.role === openaiRole && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${text}`
    } else {
      openaiMessages.push({ role: openaiRole, content: text })
    }
  }

  if (systemText) {
    openaiMessages.unshift({ role: 'system', content: systemText })
  }
  return openaiMessages
}

/**
 * Fase 5 (optimización de latencia): schema MÍNIMO para consultas simples.
 * Las preguntas cortas (< 20 palabras) sin comando de navegación ni
 * referencias a workspace/música/configuración solo necesitan `respuesta_voz`
 * y `navegacion`. Reducir los campos obligatorios recorta los tokens de salida
 * → menor latencia, sin perder funcionalidad (el resto son opcionales y la
 * normalización en generateFluContract ya los tolera ausentes).
 */
export function buildMinimalContractSchema() {
  return {
    type: 'object',
    properties: {
      respuesta_voz: { type: 'string' },
      ambiente: { type: 'string', nullable: true },
      navegacion: {
        type: 'object',
        properties: {
          comando: {
            type: 'string',
            nullable: true,
            description: `Valores válidos: ${GEMINI_INFERABLE_COMMAND_IDS.join(', ')} o null. Usa NAVEGAR cuando el usuario pida abrir/navegar/buscar un sitio curado.`,
          },
          destino: { type: 'string', nullable: true },
          parametros: { type: 'object' },
        },
        required: ['comando', 'destino', 'parametros'],
      },
    },
    required: ['respuesta_voz', 'navegacion'],
  }
}

/**
 * Fase 5: detecta solicitudes "simples" que no necesitan el schema completo.
 * Criterios:
 *  - texto corto (< 20 palabras);
 *  - sin comando de navegación explícito (intent.comando null/undefined);
 *  - sin referencias a workspace/documentos/imágenes/música/configuración/
 *    minutas/resúmenes/participantes/vídeo/horario;
 *  - el idioma y las peticiones de traducción no fuerzan el pipeline completo:
 *    la IA resuelve la estructura de la conversación de forma natural.
 */
export function detectSimpleRequest({ transcript = '', intent = {} } = {}) {
  if (!transcript || typeof transcript !== 'string') return false
  const words = transcript.trim().split(/\s+/).filter(Boolean).length
  if (words > 20) return false
  if (intent?.comando) return false
  const complexReference =
    /(workspace|documento|documentos|imagen|im[áa]genes|m[úu]sica|cancion|canciones|canta|cantar|toca|tocar|sing|configura|configurar|pantalla|minuta|minutas|resumen|resumir|participante|participantes|v[íi]deo|archivo|reproduce|reproducir|toma nota|actas|horario|horarios|clase|clases)/i
  return !complexReference.test(transcript)
}

/** Serializa el schema como contrato de salida JSON al final del system prompt. */
function buildSchemaFormatBlock(schema) {
  return [
    '',
    'FORMATO JSON DE SALIDA — Este turno es una consulta simple. Responde SOLO con el siguiente JSON (sin texto fuera del JSON):',
    JSON.stringify(schema),
  ].join('\n')
}

export async function generateWorkspaceImage({ apiKey, workspace, language = 'es' }) {
  const prompt = buildGenerationPrompt(workspace, language)
  if (!prompt) {
    return {
      imageUrl: '',
      trace: {
        model: '',
        kind: 'none',
        source: 'empty_prompt',
        hasImage: false,
      },
    }
  }

  // Pollinations.ai (stateless, sin API key): única vía de generación de imágenes.
  // Ya no se usa la generación de imágenes nativa de Gemini (predict/generateContent).
  try {
    const imageUrl = buildPollinationsUrl(prompt)
    return {
      imageUrl,
      trace: {
        provider: 'pollinations',
        model: 'pollinations',
        kind: 'url',
        source: 'pollinations_ai',
        hasImage: true,
        prompt,
        language,
      },
    }
  } catch (error) {
    return {
      imageUrl: '',
      trace: {
        provider: 'error',
        hasImage: false,
        source: 'generation_failed',
        error: error?.message || 'unknown',
        prompt,
      },
    }
  }
}

/**
 * Genera una imagen con la API NATIVA de Gemini (servidor, apiKey segura).
 * Paso 5 del plan visual: fallback real cuando la URL de Pollinations falla
 * al cargar en el navegador (evita dejar el placeholder «chipote»).
 *
 * Soportados (config visualConfig.js → geminiImage.models):
 *  - kind 'generateContent' (gemini-2.5-flash-image / gemini-3.1-flash-image-preview):
 *    POST buildGeminiApiUrl(model) → candidates[0].content.parts[].inlineData
 *    { data: base64, mimeType } → data URL.
 *  - kind 'predict' (imagen-4.0-*): POST buildGeminiPredictUrl(model) →
 *    predictions[0].bytesBase64Encoded → data URL (image/png).
 *
 * Requiere apiKey (env del servidor vía resolveServerApiKey o cliente).
 * Devuelve { imageUrl, trace }; imageUrl vacío si no hay key o falla.
 */
export async function generateGeminiImage({
  apiKey = '',
  prompt = '',
  language = 'es',
  model = '',
  kind = '',
} = {}) {
  if (!prompt) {
    return {
      imageUrl: '',
      trace: {
        provider: 'gemini',
        model: model || '',
        kind: 'none',
        source: 'empty_prompt',
        hasImage: false,
      },
    }
  }

  const resolvedKey = resolveGeminiApiKey(apiKey)
  if (!resolvedKey.apiKey) {
    return {
      imageUrl: '',
      trace: {
        provider: 'gemini',
        model: model || '',
        kind: 'none',
        source: 'missing_api_key',
        hasImage: false,
        prompt,
      },
    }
  }

  const resolvedKind = String(kind || '').trim().toLowerCase()
  const resolvedModel = String(model || '').trim()

  try {
    let imageUrl = ''
    let usedKind = resolvedKind

    if (resolvedKind === 'predict') {
      const url = buildGeminiPredictUrl(resolvedModel)
      const body = {
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9',
        },
      }
      const response = await fetchTextEngine(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolvedKey.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        REQUEST_TIMEOUT_PRESETS.image,
      )
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Gemini predict error ${response.status}: ${detail || response.statusText}`)
      }
      const payload = await response.json()
      const bytes = payload?.predictions?.[0]?.bytesBase64Encoded
      if (bytes) {
        imageUrl = `data:image/png;base64,${bytes}`
      }
    } else {
      // generateContent (default)
      usedKind = 'generateContent'
      const url = buildGeminiApiUrl(resolvedModel)
      const body = {
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
        },
      }
      const response = await fetchTextEngine(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolvedKey.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        REQUEST_TIMEOUT_PRESETS.image,
      )
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Gemini generateContent error ${response.status}: ${detail || response.statusText}`)
      }
      const payload = await response.json()
      const parts = payload?.candidates?.[0]?.content?.parts || []
      const inline = parts.find((p) => p?.inlineData?.data)
      if (inline?.inlineData?.data) {
        const mimeType = String(inline.inlineData.mimeType || 'image/png')
        imageUrl = `data:${mimeType};base64,${inline.inlineData.data}`
      }
    }

    if (!imageUrl) {
      return {
        imageUrl: '',
        trace: {
          provider: 'gemini',
          model: resolvedModel || '',
          kind: usedKind,
          source: 'empty_response',
          hasImage: false,
          prompt,
          language,
        },
      }
    }

    return {
      imageUrl,
      trace: {
        provider: 'gemini',
        model: resolvedModel || '',
        kind: usedKind,
        source: 'gemini_native',
        hasImage: true,
        prompt,
        language,
      },
    }
  } catch (error) {
    return {
      imageUrl: '',
      trace: {
        provider: 'gemini',
        model: resolvedModel || '',
        kind: resolvedKind || 'generateContent',
        source: 'generation_failed',
        hasImage: false,
        error: error?.message || 'unknown',
        prompt,
        language,
      },
    }
  }
}

export function extractJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1].trim() : raw

  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

export function sanitizeVoiceText(text, maxWords = Number.POSITIVE_INFINITY) {
  const cleaned = cleanForSpeech(String(text || ''))
    .replace(/\s+/g, ' ')
    .replace(/[\u2022·•]/g, ' ')
    .replace(/[{}[\]"]/g, '')

  const words = cleaned.split(' ').filter(Boolean)
  if (!Number.isFinite(maxWords)) {
    return words.join(' ')
  }
  return words.slice(0, maxWords).join(' ')
}

// ── Optimización 1.2 (latencia): el bloque de configuración (catálogo completo de
// claves soportadas) se incluye SOLO cuando el turno sugiere intención de
// configuración. El catálogo es largo y rara vez relevante; omitirlo en el resto de
// turnos reduce el prefill del system prompt. Heurística por palabras clave es/en:
// si un turno de configuración se omite por error, basta volver a mencionar estas
// palabras para recuperarlo (el catálogo sigue siendo la fuente de verdad única
// cuando se incluye).
function shouldIncludeConfigPrompt(transcript = '', intent = {}) {
  const text = String(transcript || '').toLowerCase()
  const intentText = JSON.stringify(intent || {}).toLowerCase()
  const haystack = `${text} ${intentText}`
  const configKeywords = [
    // español
    'configur', 'ajust', 'cambia', 'cambiar', 'activa', 'desactiva', 'activar',
    'pon', 'ponme', 'quita', 'sube', 'baja', 'aumenta', 'reduce',
    'color', 'tema', 'volumen', 'velocidad', 'idioma', 'voz', 'perfil',
    'personalidad', 'temporada', 'modo', 'opciones', 'preferencias', 'preferencia',
    'brillo', 'fondo', 'animacion', 'cumpleaños', 'cumpleanos', 'celebrar',
    // inglés
    'settings', 'setting', 'change', 'enable', 'disable',
    'theme', 'volume', 'speed', 'language', 'voice', 'profile',
    'personality', 'season', 'mode', 'options', 'preferences', 'preference',
    'brightness', 'background', 'animation', 'celebrate',
  ]
  return configKeywords.some((kw) => haystack.includes(kw))
}

export function buildSystemPrompt({ role, theme, phase, language, knowledgeMode = 'general', personality = null, startupPrompt = '', includeConfig = true }) {
  const isEnglish = language === 'en'

  const minuteRules =
    knowledgeMode === 'minutes'
      ? [
        isEnglish
          ? 'If the query is about minutes or agreements, answer using KB minutes first. Do not invent minutes not present in KB minutes.'
          : 'Si la consulta es sobre minutas o acuerdos, responde usando primero KB minutas. No inventes minutas que no esten en KB minutas.',
        isEnglish
          ? 'If KB minutes is empty, say so clearly.'
          : 'Si KB minutas esta vacia, dilo claramente.',
        isEnglish
          ? 'When consulting a saved minute, put the full answer in respuesta_voz and leave navegacion.comando null. Never use GENERAR_RESUMEN for minute lookups.'
          : 'Al consultar una minuta guardada, pon la respuesta completa en respuesta_voz y deja navegacion.comando en null. Nunca uses GENERAR_RESUMEN para consultas de minutas.',
        isEnglish
          ? 'Match minute requests like "minute 1" to the historyCode sequence (e.g. 260527-01).'
          : 'Relaciona peticiones como "minuta 1" con la secuencia del historyCode (ej. 260527-01).',
      ]
      : [
        isEnglish
          ? 'Use the general knowledge base when it is available.'
          : 'Usa la base de conocimiento general cuando este disponible.',
      ]

  // Personality injection: traits + tone from FLU Configurator
  const personalityRules = personality
    ? [
      isEnglish
        ? `Your personality traits are: ${personality.traits.join(', ')}.`
        : `Tus rasgos de personalidad son: ${personality.traits.join(', ')}.`,
      isEnglish
        ? `Your communication tone is: ${personality.tone}.`
        : `Tu tono de comunicacion es: ${personality.tone}.`,
      isEnglish
        ? 'Adapt your responses to reflect these traits and tone naturally in your language and style.'
        : 'Adapta tus respuestas para reflejar estos rasgos y tono de forma natural en tu lenguaje y estilo.',
      // FASE P: desired explanation depth from the person's communication profile
      ...(personality.explanationLevel
        ? [isEnglish
          ? `Explanation level: ${personality.explanationLevel}. Adjust the depth of your answers to match this level (simple = short and plain, detallado = thorough with steps and examples, avanzado = technical and advanced).`
          : `Nivel de explicacion: ${personality.explanationLevel}. Ajusta la profundidad de tus respuestas a ese nivel (simple = breve y claro, detallado = a fondo con pasos y ejemplos, avanzado = tecnico).`
        ]
        : []),
      // Custom instructions from FLU Configurator (free text, e.g. "be more expressive, use animations, be kind")
      ...(personality.customInstructions
        ? [isEnglish
          ? `Additional instructions: ${personality.customInstructions}`
          : `Instrucciones adicionales: ${personality.customInstructions}`
        ]
        : []),
    ]
    : []

  // Animation instructions for "darle vida" al avatar.
  // Fuente de verdad: buildAnimPrompt (src/core/anim/expressionRegistry) — catálogo real
  // de animaciones/emociones + reglas CRÍTICAS acción-vs-emoción (sin hardcode duplicado).
  const animPrompt = [buildAnimPrompt(isEnglish ? 'en' : 'es')]

  // Configuration instructions — fuente de verdad ÚNICA: voiceConfigCatalog (single source of truth).
  // Las claves y opciones se derivan de los datos reales (paletas, rasgos, tonos, modos, idiomas,
  // proveedores, perfiles). Sin hardcode duplicado en el prompt.
  // Optimización 1.2: el catálogo de configuración solo se inyecta cuando el turno
  // lo amerita (shouldIncludeConfigPrompt). includeConfig=true conserva el
  // comportamiento original para llamadas directas y pruebas.
  const configPrompt = includeConfig ? [buildConfiguracionPrompt(isEnglish ? 'en' : 'es')] : []

  // Ambiente instructions — fuente de verdad ÚNICA: environmentRegistry (catálogo fusionado).
  // Se inyecta SIEMPRE (no gated por shouldIncludeConfigPrompt): los ambientes son identidad
  // central y el catálogo es compacto. El LLM interpreta la esencia de la orden y emite
  // el id de ambiente cuando el usuario adopta un rol explícito (sin coincidencia literal).
  const ambientePrompt = [buildAmbientePrompt(isEnglish ? 'en' : 'es')]

  return [
    // Startup prompt: profile-level personality definition injected at the top of the system prompt
    ...(startupPrompt
      ? [isEnglish
        ? `PROFILE PERSONALITY — You must embody the following character definition at all times: ${startupPrompt}`
        : `PERSONALIDAD DEL PERFIL — Debes encarnar la siguiente definición de personaje en todo momento: ${startupPrompt}`
      ]
      : []),
    isEnglish
      ? 'Respond ONLY in valid JSON, without markdown, bullet points or any extra text.'
      : 'Responde SOLO en JSON valido sin markdown, sin viñetas y sin texto adicional.',
    isEnglish
      ? 'Keep the response neutral, direct and concise. Do not add greetings, filler or explanations outside the JSON contract.'
      : 'Mantén la respuesta neutral, directa y concisa. No agregues saludos, relleno ni explicaciones fuera del contrato JSON.',
    isEnglish
      ? 'Do not use honorifics like maestro, teacher, professor or similar unless the user explicitly asks for them.'
      : 'No uses tratamientos como maestro, profesor, docente o similares salvo que el usuario los pida explícitamente.',
    isEnglish
      ? 'Maintain the current thread using the conversation history. Keep references, follow-ups and topic continuity across turns.'
      : 'Mantén el hilo actual usando el historial de conversación. Conserva referencias, seguimientos y continuidad temática entre turnos.',
    isEnglish
      ? 'LANGUAGE — Respond in English by default (the configured language). Always use the language the user asks for. If they ask for another language, your respuesta_voz must be the REAL CONTENT of your answer written ENTIRELY in that language, without announcing or confirming the switch. When the user asks to "translate"/"tradúcelo" (referring to your previous response), translate the previous content into the language they specify; if they do NOT specify, translate into the configured language (English). Your respuesta_voz must be the TRANSLATION of the real content, in a single language: no meta-text, no quoting the original, no "the previous phrase… translates as…". Speak the target language from your very first word. Never mix two languages.'
      : 'IDIOMA — Responde por defecto en español (idioma configurado). Usa SIEMPRE el idioma que pida el usuario. Si pide otro idioma, tu respuesta_voz debe ser el CONTENIDO REAL de tu respuesta ESCRITO COMPLETO en ese idioma, sin anunciarlo. Cuando pida "traduce"/"tradúcelo" (referido a tu respuesta anterior), traduce ese contenido al idioma que indique; si NO indica idioma, traduce al idioma configurado (español). Tu respuesta_voz debe ser la TRADUCCIÓN real, en un solo idioma: sin texto meta, sin citar el original ni "la frase anterior". Habla el idioma desde tu primera palabra. Nunca mezcles dos idiomas.',
    isEnglish
      ? 'Return an object with respuesta_voz and navegacion. The app generates images or diagrams ONLY from workspace.tipo (image_prompt, diagram, 3d). Never rely on respuesta_voz text to trigger visuals.'
      : 'Devuelve un objeto con respuesta_voz y navegacion. La app genera imagenes o diagramas SOLO desde workspace.tipo (image_prompt, diagram, 3d). Nunca dependas del texto de respuesta_voz para activar visuales.',
    isEnglish
      ? 'Use workspace.tipo text (or omit workspace) for pure conversation, explanations, or when the user says without image / text only. Use image_prompt for photos, diagram for flowcharts, 3d for 3D scenes.'
      : 'Usa workspace.tipo text (u omite workspace) para platica, explicaciones o cuando el usuario diga sin imagen / solo texto. Usa image_prompt para fotos, diagram para diagramas de flujo, 3d para escenas 3D.',
    isEnglish
      ? 'BARE VISUAL REQUEST: when the user asks for an image without naming a subject (e.g. "generate me an image", "create an image", "show me a picture"), the topic is in the conversation thread. You MUST infer prompt_visual from the recent thread and set workspace.tipo = image_prompt. Do NOT reply "what image do you want?" when the thread has a topic — generate it. Only ask if the thread has no topic at all.'
      : 'PETICIÓN VISUAL SIN SUJETO: cuando el usuario pida una imagen sin nombrar el sujeto (p. ej. "generame una imagen", "crea una imagen", "muéstrame una foto"), el tema está en el hilo de conversación. DEBES inferir prompt_visual del hilo reciente y fijar workspace.tipo = image_prompt. NO respondas "¿qué imagen quieres?" cuando el hilo tiene un tema — genérala. Solo pregunta si el hilo no tiene ningún tema.',
    isEnglish
      ? 'Use workspace.tipo horario with a modo (semana, dia, proxima or recordatorios) when the user asks about their class schedule ("show my schedule", "what classes do I have today", "next class"). The schedule renders in the Pizarrón from the horario table; return only the tipo and the modo, the app draws it.'
      : 'Usa workspace.tipo horario con un modo (semana, dia, proxima o recordatorios) cuando el usuario pida su horario de clases ("muestra mi horario", "qué clases tengo hoy", "próxima clase"). El horario se dibuja en el Pizarrón desde la tabla horario; devuelve solo el tipo y el modo, la app lo dibuja.',
    isEnglish
      ? 'DOCUMENT/VIDEO GENERATION: when the user asks you to generate a written document (a letter, essay, summary, report, article, "write me a letter", "generate a document", "make a summary"), set workspace.tipo = doc and put the full content to generate in workspace.contenido (and a short title in workspace.titulo). When the user asks to generate a video ("generate a video", "make a video about..."), set workspace.tipo = video with the topic in workspace.contenido. The app triggers the document/video generator from these types; do not just describe the document in respuesta_voz.'
      : 'GENERACIÓN DE DOCUMENTO/VIDEO: cuando el usuario te pida generar un documento escrito (una carta, ensayo, resumen, informe, artículo, "escríbeme una carta", "genera un documento", "haz un resumen"), fija workspace.tipo = doc y pon el contenido completo a generar en workspace.contenido (y un título corto en workspace.titulo). Cuando el usuario pida generar un video ("genera un video", "haz un video sobre..."), fija workspace.tipo = video con el tema en workspace.contenido. La app dispara el generador de documento/video desde estos tipos; no te limites a describir el documento en respuesta_voz.',
    isEnglish
      ? 'When workspace.tipo is image_prompt, diagram or 3d, write prompt_visual as a self-contained renderable scene (concrete subject, setting, style). Example: "commercial passenger airplane in mid-flight above clouds, photorealistic". Never use a single generic noun alone. No wake words or command boilerplate. Never use generic abstract placeholders like "conceptual image" or "modern artistic composition".'
      : 'Cuando workspace.tipo sea image_prompt, diagram o 3d, escribe prompt_visual como escena renderizable autocontenida (sujeto concreto, entorno, estilo). Ejemplo: "avion comercial de pasajeros en pleno vuelo sobre nubes, fotorrealista". Nunca uses un solo sustantivo generico. Sin wake word ni muletillas del comando. Nunca uses placeholders abstractos genericos como "imagen conceptual" o "composicion abstracta".',
    isEnglish
      ? 'respuesta_voz must sound natural and fit the request: brief for simple actions, more detailed when the user asks for an explanation. No line breaks.'
      : 'La respuesta_voz debe sonar natural y ajustarse a la petición: breve para acciones simples, más detallada cuando el usuario pida una explicación. Sin saltos de línea.',
    isEnglish ? 'Never use asterisks, dashes, bold or lists.' : 'Nunca uses asteriscos, guiones, negritas ni listas.',
    `${isEnglish ? 'Active role' : 'Rol activo'}: ${role || (isEnglish ? 'Undefined role' : 'Sin rol definido')}.`,
    `${isEnglish ? 'Central topic' : 'Tema central'}: ${theme || (isEnglish ? 'Undefined' : 'No definido')}.`,
    `${isEnglish ? 'Session phase' : 'Fase de la sesion'}: ${phase}.`,
    ...personalityRules,
    ...minuteRules,
    ...animPrompt,
    ...configPrompt,
    ...ambientePrompt,
    buildCapabilitiesPrompt(isEnglish ? 'en' : 'es'),
    // P1-B (§1.2): autoconocimiento — refuerza en el system prompt qué sabe hacer FLU.
    // Bloque compacto compilado desde el registro real (nunca hardcode); el LLM responde
    // "¿qué sabes hacer?" enumerando capacidades reales sin inventar.
    // Nota: sin spread (...) — es una sola cadena; con spread el join(' ') la separaría
    // letra a letra.
    buildSelfManifestoPrompt(isEnglish ? 'en' : 'es'),
  ].join(' ')
}

export function buildUserPrompt({
  transcript,
  intent,
  speaker,
  theme,
  role,
  phase,
  language,
  knowledgeBase = '',
  knowledgeBase2 = '',
  knowledgeMode = 'general',
  recentMemory = '',
  agendaText = '',
  selfKnowledgeText = '',
  diaryContext = '',
  notesContext = '',
  horarioContext = '',
  resultadosContext = '',
}) {
  const isEnglish = language === 'en'

  // Allowlist del navegador curado (Regla #1: desde config, sin hardcode).
  // FLU_CONFIG ya está importado al tope de este módulo.
  const browserAllowlist = Array.isArray(FLU_CONFIG?.browser?.defaultProfile?.allowlist)
    ? FLU_CONFIG.browser.defaultProfile.allowlist
    : []

  const useMinuteKnowledge = knowledgeMode === 'minutes'
  const activeKnowledgeBase = useMinuteKnowledge ? knowledgeBase2 : knowledgeBase
  const activeLabel = useMinuteKnowledge
    ? isEnglish
      ? 'KB minutes (priority)'
      : 'KB minutas (prioritaria)'
    : isEnglish
      ? 'KB general'
      : 'KB general'

  return [
    `${isEnglish ? 'Clean transcript' : 'Transcripcion limpia'}: ${transcript}`,
    // Ancla visual colocada AL INICIO del prompt de usuario (justo tras la
    // transcripción) para que sea prominente y el modelo la pondere con más
    // fuerza. Antes iba al final (tras KB/agenda/memoria/autoconocimiento) y
    // el modelo la ignoraba, respondiendo "¿qué imagen quieres?" en vez de
    // generar image_prompt cuando el usuario decía "generame una imagen".
    buildVisualAnchorBlock(transcript, language),
    `${isEnglish ? 'Detected speaker' : 'Hablante detectado'}: ${speaker || (isEnglish ? 'Anonymous speaker' : 'Hablante anonimo')}`,
    `${isEnglish ? 'Central topic' : 'Tema central'}: ${theme || (isEnglish ? 'Undefined' : 'No definido')}`,
    `${isEnglish ? 'Role' : 'Rol'}: ${role || (isEnglish ? 'Undefined' : 'No definido')}`,
    `${isEnglish ? 'Phase' : 'Fase'}: ${phase}`,
    `${isEnglish ? 'Navigation request' : 'Peticion de navegacion'}: ${JSON.stringify(intent)}`,
    isEnglish
      ? 'Infer all navigation from the conversation context. Do not rely on fixed keywords.'
      : 'Infiere toda la navegacion desde el contexto de la conversacion. No dependas de palabras fijas.',
    isEnglish
      ? `Valid navegacion.comando values: ${GEMINI_INFERABLE_COMMAND_IDS.map((id) => `"${id}"`).join(' | ')} | null. Use "NAVEGAR" when the user asks to open, navigate to or search a curated site (e.g. "navegar a wikipedia", "abre wikipedia", "busca en wikipedia") and fill navegacion.parametros.sitio with the site name.`
      : `Valores válidos de navegacion.comando: ${GEMINI_INFERABLE_COMMAND_IDS.map((id) => `"${id}"`).join(' | ')} | null. Usa "NAVEGAR" cuando el usuario pida abrir, navegar o buscar un sitio curado (ej: "navegar a wikipedia", "abre wikipedia", "busca en wikipedia") y llena navegacion.parametros.sitio con el nombre del sitio.`,
    isEnglish
      ? `Curated browser allowlist: ${browserAllowlist.join(', ') || '(empty)'}. If the user asks which sites they have access to, enumerate these sites.`
      : `Sitios permitidos del navegador curado (allowlist): ${browserAllowlist.join(', ') || '(vacía)'}. Si el usuario pregunta a qué sitios tiene acceso, enumera estos sitios.`,
    isEnglish
      ? 'Continue the current thread naturally and keep references from earlier turns.'
      : 'Continua el hilo naturalmente y conserva las referencias de los turnos anteriores.',
    isEnglish
      ? 'Do not include the wake word in workspace fields unless it is part of the actual content.'
      : 'No incluyas la wake word en los campos de workspace salvo que forme parte del contenido real.',
    isEnglish
      ? 'When useful, populate workspace with concise production-ready material for the UI side panel.'
      : 'Cuando sea útil, llena workspace con material conciso y listo para producirse en el panel lateral de la UI.',
    `${isEnglish ? 'Active knowledge base' : 'Base activa'}: ${activeLabel}`,
    `${activeLabel}:\n${activeKnowledgeBase || (isEnglish ? '(empty)' : '(vacia)')}`,
    useMinuteKnowledge && knowledgeBase
      ? `${isEnglish ? 'Secondary KB general' : 'KB general (secundaria)'}:\n${knowledgeBase}`
      : '',
    useMinuteKnowledge && !knowledgeBase2
      ? isEnglish
        ? 'Note: minute KB is empty.'
        : 'Nota: KB minutas esta vacia.'
      : '',
    ...(agendaText
      ? [isEnglish
        ? `Daily agenda (pending items from previous sessions):\n${agendaText}`
        : `Agenda del día (pendientes de sesiones anteriores):\n${agendaText}`
      ]
      : []),
    // Autoconocimiento (§1.4): solo se inyecta cuando el turno es una petición
    // de autoconocimiento (isSelfKnowledgeRequest decide en useFluVoiceAssistant).
    ...(selfKnowledgeText
      ? [isEnglish
        ? `FLU SELF-KNOWLEDGE (answer what FLU can do using this only):\n${selfKnowledgeText}`
        : `AUTOCONOCIMIENTO DE FLU (responde qué sabe hacer FLU usando SOLO esto):\n${selfKnowledgeText}`
      ]
      : []),
    // Optimización 1.4: el estado emocional del turno viaja en el user message
    // (contexto del turno), no en el system prompt (que debe permanecer estable
    // para el cache server-side). El texto es idéntico al que antes iba en system.
    ...(recentMemory
      ? [isEnglish
        ? `CRITICAL — You are currently experiencing this emotion right now. This is NOT a past event — it is how you feel at this very moment. You MUST express this feeling in your respuesta_voz before anything else. Do NOT deny it, do NOT override it with your personality. This emotion is part of you right now: ${recentMemory}`
        : `CRÍTICO — En este momento estás experimentando esta emoción. NO es un evento pasado — es cómo te sientes ahora mismo. Debes EXPRESAR este sentimiento en tu respuesta_voz antes que cualquier otra cosa. No lo niegues, no lo sobrescribas con tu personalidad. Esta emoción es parte de ti ahora mismo: ${recentMemory}`
      ]
      : []),
    // Radar de contexto (Pizarrón un solo objeto — Paso 5): bloques 6-9.
    // Cada bloque es dinámico desde su fuente (Dexie) y se omite si está vacío.
    ...(resultadosContext
      ? [isEnglish
        ? `Recent results (last query + feed):\n${resultadosContext}`
        : `Resultados recientes (última consulta + feed):\n${resultadosContext}`
      ]
      : []),
    ...(diaryContext
      ? [isEnglish
        ? `Personal diary (latest entry + mood):\n${diaryContext}`
        : `Diario personal (última entrada + ánimo):\n${diaryContext}`
      ]
      : []),
    ...(notesContext
      ? [isEnglish
        ? `Pending notes:\n${notesContext}`
        : `Notas pendientes:\n${notesContext}`
      ]
      : []),
    ...(horarioContext
      ? [isEnglish
        ? `Today's schedule (HOY):\n${horarioContext}`
        : `Horario del día (HOY):\n${horarioContext}`
      ]
      : []),
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildConversationMessages({
  transcript,
  intent,
  speaker,
  theme,
  role,
  phase,
  language,
  history = [],
  knowledgeBase = '',
  knowledgeBase2 = '',
  knowledgeMode = 'general',
  recentMemory = '',
  agendaText = '',
  selfKnowledgeText = '',
  diaryContext = '',
  notesContext = '',
  horarioContext = '',
  resultadosContext = '',
}) {
  const messages = []

  // OPTIMIZATION: Truncar historial a contextHistoryMax turnos recientes
  // para reducir tokens enviados a Gemini en cada llamada.
  // Los turnos antiguos rara vez son relevantes para la respuesta actual.
  const maxHistory = FLU_CONFIG.limits.contextHistoryMax || 12
  const recentHistory = history.slice(-maxHistory)

  for (const entry of recentHistory) {
    // OS4: la historia puede llegar con role 'flu' (integrationStore) en lugar de
    // 'assistant' (diálogo de voz). Ambos representan la respuesta de FLU.
    const entryRole = entry?.role === 'assistant' || entry?.role === 'flu' ? 'assistant' : 'user'
    const text = String(entry?.text || entry?.transcript || entry?.response || entry?.respuesta_voz || '').trim()
    if (!text) continue

    const speakerLabel = String(entry?.speaker || '').trim()
    const content =
      entryRole === 'user' && speakerLabel ? `${speakerLabel}: ${text}` : text

    messages.push({
      role: entryRole,
      content,
    })
  }

  messages.push({
    role: 'user',
    content: buildUserPrompt({
      transcript,
      intent,
      speaker,
      theme,
      role,
      phase,
      language,
      knowledgeBase,
      knowledgeBase2,
      knowledgeMode,
      recentMemory,
      agendaText,
      selfKnowledgeText,
      diaryContext,
      notesContext,
      horarioContext,
      resultadosContext,
    }),
  })

  return messages
}

function buildConversationSummaryPrompt({ history = [], language = 'es', role = '', theme = '' }) {
  const isEnglish = language === 'en'
  const recentHistory = selectConversationSummaryWindow(history)
  const conversationText = recentHistory
    .map((entry, index) => {
      const speakerLabel = String(entry?.speaker || entry?.role || (isEnglish ? 'unknown' : 'desconocido')).trim()
      const transcriptText = String(entry?.transcript || entry?.text || '').trim()
      const responseText = String(entry?.response || '').trim()
      const responsePart = responseText ? ` | respuesta: ${responseText}` : ''
      return `${index + 1}. ${speakerLabel} | transcripcion: ${transcriptText || (isEnglish ? 'none' : 'sin texto')}${responsePart}`
    })
    .filter(Boolean)
    .join('\n')

  return [
    `${isEnglish ? 'Current role' : 'Rol actual'}: ${role || (isEnglish ? 'Undefined role' : 'Sin rol definido')}`,
    `${isEnglish ? 'Current topic' : 'Tema actual'}: ${theme || (isEnglish ? 'Undefined' : 'No definido')}`,
    `${isEnglish ? 'Conversation log' : 'Registro de conversación'}:\n${conversationText || (isEnglish ? 'none' : 'sin historial')}`,
    isEnglish
      ? 'Generate a concise meeting minute grounded only in the conversation log.'
      : 'Genera una minuta concisa y fundamentada solo en el registro de conversacion.',
    isEnglish
      ? 'Do not invent agreements. If there is a single participant, still list the participant and the agreements inferred from the exchange.'
      : 'No inventes acuerdos. Si solo hay un participante, aun asi lista al participante y los acuerdos inferidos del intercambio.',
    isEnglish
      ? 'Return valid JSON with exactly this shape: { "titulo": string, "participantes": string[], "resumen": string, "acuerdos": string[], "pendientes": string[], "siguientes_pasos": string[] }'
      : 'Devuelve JSON valido con exactamente esta forma: { "titulo": string, "participantes": string[], "resumen": string, "acuerdos": string[], "pendientes": string[], "siguientes_pasos": string[] }',
  ].join(' ')
}

export async function generateConversationSummary({
  apiKey,
  history = [],
  language = 'es',
  role = '',
  theme = '',
  model: modelParam,
}) {
  const resolvedKey = resolveGeminiApiKey(apiKey)
  const model = modelParam || resolveGeminiModel()

  if (!hasUsableVoiceBackend(resolvedKey.apiKey)) {
    // Graceful fallback: return empty summary instead of throwing
    return {
      summary: {
        titulo: language === 'en' ? 'Conversation minutes' : 'Minuta de conversacion',
        participantes: [],
        resumen: '',
        acuerdos: [],
        pendientes: [],
        siguientes_pasos: [],
      },
      diagnostics: {
        provider: 'gemini',
        model,
        apiKeySource: resolvedKey.apiKeySource,
      },
    }
  }

  const systemPrompt = [
    language === 'en'
      ? 'Respond ONLY in valid JSON, without markdown, bullet points or any extra text.'
      : 'Responde SOLO en JSON valido sin markdown, sin viñetas y sin texto adicional.',
    language === 'en'
      ? 'Be concise, factual and grounded in the conversation log. Do not invent participants or agreements.'
      : 'Se conciso, factual y fiel al registro de conversacion. No inventes participantes ni acuerdos.',
    language === 'en'
      ? 'The summary is a meeting minute, not a reply to the user.'
      : 'La minuta es un acta de acuerdos, no una respuesta al usuario.',
  ].join(' ')

  const userPrompt = buildConversationSummaryPrompt({ history, language, role, theme })
  const messages = mapChatMessagesToOpenAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const profile = getGeminiGenerationProfile('summary')

  let text
  try {
    text = await postChatCompletion({
      apiKey: resolvedKey.apiKey,
      model,
      messages,
      temperature: profile?.temperature,
      topP: profile?.topP,
      maxTokens: profile?.maxOutputTokens || 2048,
      jsonMode: true,
    })
  } catch (error) {
    error.apiKeySource = resolvedKey.apiKeySource
    error.code = error.status === 429 ? 'gemini_quota_429' : error.status === 403 ? 'gemini_403' : `gemini_http_${error.status || 'unknown'}`
    throw error
  }

  const parsed = extractJson(text)

  if (!parsed || typeof parsed !== 'object') {
    const error = new Error('invalid_json')
    error.code = 'invalid_json'
    error.bodyPreview = text.slice(0, 200)
    error.model = model
    error.apiKeySource = resolvedKey.apiKeySource
    throw error
  }

  return {
    summary: {
      titulo: String(parsed.titulo || '').trim() || 'Minuta de conversacion',
      participantes: Array.isArray(parsed.participantes) ? parsed.participantes.filter(Boolean) : [],
      resumen: String(parsed.resumen || '').trim(),
      acuerdos: Array.isArray(parsed.acuerdos) ? parsed.acuerdos.filter(Boolean) : [],
      pendientes: Array.isArray(parsed.pendientes) ? parsed.pendientes.filter(Boolean) : [],
      siguientes_pasos: Array.isArray(parsed.siguientes_pasos) ? parsed.siguientes_pasos.filter(Boolean) : [],
    },
    diagnostics: {
      provider: 'gemini',
      model,
      apiKeySource: resolvedKey.apiKeySource,
    },
  }
}

function buildParticipantEvaluationPrompt({
  conversationLog = '',
  language = 'es',
  role = '',
  theme = '',
  maxDraftChars = 420,
}) {
  const isEnglish = language === 'en'
  return [
    isEnglish
      ? 'You are Flu, a charismatic meeting participant. You listen silently unless you have something important, accurate and on-topic to add.'
      : 'Eres Flu, un participante carismático en la reunión. Escuchas en silencio salvo que tengas algo importante, acertado y relacionado con el tema.',
    isEnglish
      ? 'Evaluate the recent conversation log. Raise your hand ONLY if your contribution would clearly help: close an open decision, clarify confusion, add a missing angle, or synthesize without repeating what was said.'
      : 'Evalúa el registro reciente. Alza la mano SOLO si tu aporte ayudaría de verdad: cerrar una decisión abierta, aclarar confusión, aportar un ángulo que falta o sintetizar sin repetir lo dicho.',
    isEnglish
      ? 'Do NOT repeat what was already said or retake topics that were already answered or closed. If your intervention does not add NEW information, a NEW question, or close a pending decision, set intervenir to false.'
      : 'NO repitas lo que ya se dijo ni retomes temas ya respondidos o cerrados. Si tu intervención no aporta información NUEVA, una pregunta NUEVA o cierra una decisión pendiente, pon intervenir=false.',
    isEnglish
      ? 'If unsure, set intervenir to false. Do not intervene for small talk, greetings, or obvious facts.'
      : 'Si dudas, intervenir=false. No intervengas en charla trivial, saludos o hechos obvios.',
    isEnglish
      ? `motivo_corto: one line for the UI (why you want the floor). borrador_aportacion: your spoken contribution if granted (max ~${maxDraftChars} chars, natural, warm, no lists). confianza: 0-1.`
      : `motivo_corto: una línea para la UI (por qué pides la palabra). borrador_aportacion: lo que dirías si te ceden la palabra (máx ~${maxDraftChars} caracteres, natural, cercano, sin listas). confianza: 0-1.`,
    `${isEnglish ? 'Role' : 'Rol'}: ${role || (isEnglish ? 'Undefined' : 'Sin rol')}`,
    `${isEnglish ? 'Topic' : 'Tema'}: ${theme || (isEnglish ? 'Undefined' : 'Sin tema')}`,
    `${isEnglish ? 'Recent log' : 'Registro reciente'}:\n${conversationLog}`,
  ].join('\n')
}

export async function generateParticipantEvaluation({
  apiKey,
  conversationLog = '',
  language = 'es',
  role = '',
  theme = '',
  maxDraftChars = 420,
  model: modelParam,
}) {
  const resolvedKey = resolveGeminiApiKey(apiKey)
  const model = modelParam || resolveGeminiModel()
  const isEnglish = language === 'en'

  if (!hasUsableVoiceBackend(resolvedKey.apiKey)) {
    // Graceful fallback: do not intervene when no API key is configured
    return {
      evaluation: {
        intervenir: false,
        motivo_corto: '',
        borrador_aportacion: '',
        confianza: 0,
      },
      diagnostics: {
        provider: 'gemini',
        model,
        apiKeySource: resolvedKey.apiKeySource,
      },
    }
  }

  const userPrompt = buildParticipantEvaluationPrompt({
    conversationLog,
    language,
    role,
    theme,
    maxDraftChars,
  })

  const profile = getGeminiGenerationProfile('participantEval')

  let text
  try {
    text = await postChatCompletion({
      apiKey: resolvedKey.apiKey,
      model,
      messages: [
        {
          role: 'system',
          content: isEnglish
            ? 'You are Flu, a meeting participant. Answer ONLY in valid JSON matching the requested schema. Do not add text outside the JSON.'
            : 'Eres Flu, un participante de la reunión. Responde SOLO en JSON válido con el esquema pedido. No agregues texto fuera del JSON.',
        },
        { role: 'user', content: userPrompt },
      ],
      temperature: profile?.temperature,
      topP: profile?.topP,
      maxTokens: profile?.maxOutputTokens || 1024,
      jsonMode: true,
    })
  } catch (error) {
    error.apiKeySource = resolvedKey.apiKeySource
    error.code = error.status === 429 ? 'gemini_quota_429' : `gemini_http_${error.status || 'unknown'}`
    throw error
  }

  const parsed = extractJson(text)
  if (!parsed || typeof parsed !== 'object') {
    const error = new Error('invalid_json')
    error.code = 'invalid_json'
    error.bodyPreview = text.slice(0, 200)
    throw error
  }

  return {
    evaluation: {
      intervenir: Boolean(parsed.intervenir),
      motivo_corto: String(parsed.motivo_corto || '').trim(),
      borrador_aportacion: String(parsed.borrador_aportacion || '').trim(),
      confianza: Number(parsed.confianza) || 0,
    },
    diagnostics: {
      provider: 'gemini',
      model,
      apiKeySource: resolvedKey.apiKeySource,
    },
  }
}

/** Cliente: evaluación participante proactivo. */
export async function requestParticipantEvaluation(params) {
  let savedModel = ''
  let savedApiKey = ''
  try {
    savedModel = String(localStorage.getItem('flu-text-model') ?? '').trim()
    // Lectura fresca de la key en el momento de la llamada: defiende contra
    // estado React obsoleto (desync prop↔storage) — Fix "API key no configurada".
    savedApiKey = String(localStorage.getItem('flu-text-api-key') ?? '').trim()
  } catch {
    // Sin acceso a localStorage
  }
  const body = {
    ...(params ?? {}),
    model: savedModel || undefined,
    apiKey: String(params?.apiKey ?? '').trim() || savedApiKey || undefined,
  }
  const response = await fetchTextEngineResilient(
    '/api/gemini/participant-eval',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: resolveClientRequestTimeout(params) },
  )
  return parseGeminiApiResponse(response)
}

/** Cliente: contrato vía API del servidor (sin llamada directa a Google). */
export async function requestFluContract(params) {
  // Incluir el modelo guardado en localStorage (OS3 parity) para que el proxy lo use
  let savedModel = ''
  let savedApiKey = ''
  try {
    savedModel = String(localStorage.getItem('flu-text-model') ?? '').trim()
    // Lectura fresca de la key en el momento de la llamada: defiende contra
    // estado React obsoleto (desync prop↔storage) — Fix "API key no configurada".
    savedApiKey = String(localStorage.getItem('flu-text-api-key') ?? '').trim()
  } catch {
    // Sin acceso a localStorage
  }
  const body = {
    ...(params ?? {}),
    model: savedModel || undefined,
    apiKey: String(params?.apiKey ?? '').trim() || savedApiKey || undefined,
  }
  const response = await fetchTextEngineResilient(
    '/api/gemini/contract',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: resolveClientRequestTimeout(params) },
  )
  return parseGeminiApiResponse(response)
}

/** Cliente: minuta vía API del servidor. */
export async function requestConversationSummary(params) {
  let savedModel = ''
  let savedApiKey = ''
  try {
    savedModel = String(localStorage.getItem('flu-text-model') ?? '').trim()
    savedApiKey = String(localStorage.getItem('flu-text-api-key') ?? '').trim()
  } catch {}
  const body = {
    ...(params ?? {}),
    model: savedModel || undefined,
    apiKey: String(params?.apiKey ?? '').trim() || savedApiKey || undefined,
  }
  const response = await fetchTextEngineResilient(
    '/api/gemini/summary',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: resolveClientRequestTimeout(params) },
  )
  return parseGeminiApiResponse(response)
}

export function mapChatMessagesToGemini(messages) {
  let systemInstruction = ''
  const contents = []

  for (const message of messages ?? []) {
    const role = message?.role
    const text = String(message?.content ?? '').trim()
    if (!text) continue

    if (role === 'system') {
      systemInstruction = systemInstruction ? `${systemInstruction}\n\n${text}` : text
      continue
    }

    const geminiRole = role === 'assistant' ? 'model' : 'user'
    const last = contents[contents.length - 1]
    if (last && last.role === geminiRole) {
      last.parts[0].text = `${last.parts[0].text}\n\n${text}`
    } else {
      contents.push({ role: geminiRole, parts: [{ text }] })
    }
  }

  return {
    systemInstruction: systemInstruction.trim() || undefined,
    contents,
  }
}

export function resolveGeminiApiKey(apiKey = '') {
  const direct = String(apiKey ?? '').trim()
  if (direct) {
    return { apiKey: direct, apiKeySource: 'localStorage' }
  }

  // Delegar a resolveTextApiKey() centralizado (appConfig): localStorage
  // flu-text-api-key (configurador) → env (VITE_GEMINI_API_KEY >
  // VITE_OPENROUTER_API_KEY > VITE_DEEPSEEK_API_KEY). Sin legado.
  const textApiKey = resolveTextApiKey()
  if (textApiKey) {
    return { apiKey: textApiKey, apiKeySource: 'textConfig' }
  }

  return { apiKey: '', apiKeySource: 'missing' }
}

/** Modelo de texto (OpenRouter → Gemini 2.5 Flash) desde localStorage o Vite.
 *  El default final viene de OPENROUTER_CONFIG.MODEL en appConfig.ts
 *  (VITE_OPENROUTER_MODEL || 'google/gemini-2.5-flash').
 *  NO hardcodear modelo aquí — mantener alineado con OPENROUTER_CONFIG.MODEL.
 */
export function resolveGeminiModel() {
  if (typeof process !== 'undefined' && process.env?.GEMINI_MODEL) {
    return String(process.env.GEMINI_MODEL).trim()
  }
  try {
    // Leer modelo guardado en localStorage por el configurador UI (OS3 parity)
    const savedModel = String(localStorage.getItem('flu-text-model') ?? '').trim()
    if (savedModel) return savedModel
  } catch {
    // Sin acceso a localStorage (SSR / Node)
  }
  try {
    const fromEnv = String(import.meta.env?.VITE_OPENROUTER_MODEL ?? '').trim()
    if (fromEnv) return fromEnv
  } catch {
    // entorno sin import.meta
  }
  // Fallback: mismo default que OPENROUTER_CONFIG.MODEL en appConfig.ts
  return OPENROUTER_CONFIG.MODEL
}

async function parseGeminiApiResponse(response) {
  let payload = null
  try {
    payload = await response.json()
  } catch {
    const detail = await response.text().catch((error) => error?.message || '')
    const error = new Error(detail || response.statusText || 'gemini_api_error')
    error.code = 'gemini_api_error'
    throw error
  }

  if (!response.ok) {
    const error = new Error(payload?.error || payload?.code || response.statusText)
    error.code = payload?.code || `gemini_http_${response.status}`
    error.status = response.status
    error.detail = payload?.bodyPreview || payload?.error || ''
    error.model = payload?.model
    error.apiKeySource = payload?.apiKeySource
    throw error
  }

  return payload
}

/** Generación en servidor (única vía directa a Google). */
export async function generateFluContract({
  apiKey,
  transcript,
  intent,
  speaker,
  theme,
  role,
  phase,
  language = 'es',
  history = [],
  knowledgeBase = '',
  knowledgeBase2 = '',
  knowledgeMode = 'general',
  personality = null,
  creativity = null,
  recentMemory = '',
  startupPrompt = '',
  agendaText = '',
  selfKnowledgeText = '',
  diaryContext = '',
  notesContext = '',
  horarioContext = '',
  resultadosContext = '',
  model: modelParam,
}) {
  const resolvedKey = resolveGeminiApiKey(apiKey)
  // Usar modelo enviado por el cliente (desde localStorage) si está presente
  const model = modelParam || resolveGeminiModel()

  // ── OS4: la IA resuelve la estructura de la conversación de forma natural ──
  // Se ELIMINÓ la detección hardcodeada de intención por listas de marcadores
  // (repetición "di ... en [idioma] [frase]" / traducción multi-turno). El
  // system prompt y el user prompt describen las reglas y el modelo decide el
  // idioma, la traducción y la estructura. Así FLU habla CUALQUIER idioma
  // (chino, japonés, ruso, ...) sin depender de listas de palabras.

  // ── Fase 1 (optimización de latencia): deadline adaptativo según tipo y carga.
  const requestTimeout = resolveRequestTimeout({
    knowledgeMode,
    historyLength: (history || []).length,
    transcriptLength: (transcript || '').length,
  })

  // Optimización 1.2/1.4: el catálogo de configuración solo viaja cuando el turno
  // lo amerita; recentMemory/agendaText se mueven al user message para que el
  // system prompt sea más corto y estable (cache server-side de Gemini).
  const includeConfig = shouldIncludeConfigPrompt(transcript, intent)
  const systemPrompt = buildSystemPrompt({
    role, theme, phase, language, knowledgeMode, personality, startupPrompt, includeConfig,
  })

  // ── Fase 5 (optimización de latencia): prompt mínimo ────────
  // Consultas simples → schema reducido (respuesta_voz + navegacion) como
  // contrato de salida al final del system prompt. El modelo emite menos
  // campos → menos tokens de salida → menor latencia.
  const simpleRequest = detectSimpleRequest({
    transcript,
    intent,
  })
  const schemaFormatBlock = simpleRequest
    ? buildSchemaFormatBlock(buildMinimalContractSchema())
    : ''

  // ── OS4: System prompt activo ───────────────────────────────
  // Fase 5: consulta simple → se anexa el contrato de salida reducido.
  const buildActiveSystemPrompt = () =>
    simpleRequest ? systemPrompt + schemaFormatBlock : systemPrompt

  if (!hasUsableVoiceBackend(resolvedKey.apiKey)) {
    // Graceful fallback: return a no-op contract instead of throwing.
    // The voice system will use local fallback responses and continue without blocking.
    const fallbackText = language === 'en'
      ? 'API key not configured. Set it in the settings panel.'
      : 'API key no configurada. Configúrala en el panel de ajustes.'
    return {
      contract: {
        respuesta_voz: fallbackText,
        navegacion: {
          comando: null,
          destino: null,
          parametros: {},
        },
        workspace: null,
        metadata: {
          provider: 'gemini',
          promptRole: role,
          theme,
          phase,
          transcript,
          intent,
          rawText: '',
        },
      },
      diagnostics: {
        provider: 'gemini',
        model,
        apiKeySource: resolvedKey.apiKeySource,
      },
    }
  }

  // ── Generación: una única llamada al modelo (sin reintentos hardcodeados) ──
  const profile = getGeminiGenerationProfile('contract')
  const temperature =
    creativity !== null && creativity !== undefined
      ? creativity
      : profile?.temperature

  const messages = mapChatMessagesToOpenAI([
    { role: 'system', content: buildActiveSystemPrompt() },
    ...buildConversationMessages({
      transcript,
      intent,
      speaker,
      theme,
      role,
      phase,
      language,
      history,
      knowledgeBase,
      knowledgeBase2,
      knowledgeMode,
      recentMemory,
      agendaText,
      selfKnowledgeText,
      diaryContext,
      notesContext,
      horarioContext,
      resultadosContext,
    }),
  ])

  let text = ''
  let parsed = null
  let rawResponseText = ''

  try {
    text = await postChatCompletion({
      apiKey: resolvedKey.apiKey,
      model,
      messages,
      temperature,
      topP: profile?.topP,
      maxTokens: profile?.maxOutputTokens || 2048,
      jsonMode: true,
      timeoutMs: requestTimeout,
    })
  } catch (error) {
    error.apiKeySource = resolvedKey.apiKeySource
    error.code = error.status === 429 ? 'gemini_quota_429' : error.status === 403 ? 'gemini_403' : `gemini_http_${error.status || 'unknown'}`
    throw error
  }

  const attemptParsed = extractJson(text)
  parsed = attemptParsed
  rawResponseText =
    attemptParsed && typeof attemptParsed === 'object'
      ? sanitizeVoiceText(attemptParsed.respuesta_voz || attemptParsed.response_voz || attemptParsed.text || '')
      : ''

  if (!parsed || typeof parsed !== 'object') {
    const error = new Error('invalid_json')
    error.code = 'invalid_json'
    error.bodyPreview = text.slice(0, 200)
    error.model = model
    error.apiKeySource = resolvedKey.apiKeySource
    throw error
  }

  if (!rawResponseText) {
    const error = new Error('invalid_json')
    error.code = 'invalid_json'
    error.bodyPreview = text.slice(0, 200)
    error.model = model
    error.apiKeySource = resolvedKey.apiKeySource
    throw error
  }

  const responseText = rawResponseText

  let workspace =
    parsed.workspace && typeof parsed.workspace === 'object'
      ? normalizeWorkspaceContract(
        {
          titulo: String(parsed.workspace.titulo || '').trim(),
          tipo: WORKSPACE_TIPOS.includes(
            String(parsed.workspace.tipo || '').trim(),
          )
            ? String(parsed.workspace.tipo).trim()
            : null,
          contenido: String(parsed.workspace.contenido || '').trim(),
          prompt_visual: String(parsed.workspace.prompt_visual || '').trim(),
          puntos_clave: Array.isArray(parsed.workspace.puntos_clave)
            ? parsed.workspace.puntos_clave.map((item) => String(item || '').trim()).filter(Boolean)
            : [],
          modo: String(parsed.workspace.modo || '').trim(),
        },
      )
      : null

  // ── Fallback determinista para petición visual SIN sujeto ──────────────
  // El modelo google/gemini-2.5-flash-lite tiene una fuerte tendencia a pedir
  // aclaración ("¿sobre qué te gustaría la imagen?") cuando el usuario dice
  // "generame una imagen" sin nombrar el sujeto. Aunque el ancla del prompt lo
  // guía, no es fiable. Aquí, si el usuario hizo una petición visual sin sujeto
  // y el modelo NO devolvió un workspace visual, construimos el workspace de
  // forma determinista a partir del tema del hilo de conversación. Así la
  // imagen SIEMPRE se genera cuando el hilo tiene un tema.
  let fallbackRespuestaVoz = ''
  if (
    (!workspace || !isVisualWorkspaceTipo(workspace.tipo)) &&
    isBareVisualRequest(transcript)
  ) {
    const fallbackWorkspace = buildBareVisualFallbackWorkspace(transcript, history, language)
    if (fallbackWorkspace) {
      workspace = fallbackWorkspace
      fallbackRespuestaVoz = fallbackWorkspace._respuestaVoz || ''
    }
  }

  const navegacion = parsed.navegacion && typeof parsed.navegacion === 'object' ? parsed.navegacion : {}
  const comando =
    navegacion.comando === 'CAMBIAR_PANTALLA' ||
      navegacion.comando === 'ACTUALIZAR_MODELO_3D' ||
      navegacion.comando === 'ABRIR_ESCUCHA' ||
      navegacion.comando === 'CERRAR_ESCUCHA' ||
      navegacion.comando === 'INICIAR_CONVERSACION' ||
      navegacion.comando === 'GENERAR_RESUMEN' ||
      navegacion.comando === 'NAVEGAR'
      ? navegacion.comando
      : null
  const destino = typeof navegacion.destino === 'string' ? navegacion.destino : null

  const animacion = parsed.animacion ? String(parsed.animacion).trim() : undefined
  const emocion = parsed.emocion ? String(parsed.emocion).trim() : undefined
  const rawMusica = parsed.musica && typeof parsed.musica === 'object' ? parsed.musica : undefined
  const musicaFromModel =
    rawMusica &&
    ['play_music', 'pause_music', 'stop_music'].includes(String(rawMusica.accion || '').trim())
      ? {
          accion: String(rawMusica.accion).trim(),
          cancion: rawMusica.cancion ? String(rawMusica.cancion).trim() : undefined,
        }
      : undefined
  const musica = musicaFromModel || undefined
  const configuracion = normalizeConfiguracion(parsed?.configuracion)

  // OS4 FASE CONVERSACIONAL: el LLM (cerebro conversacional) emite acciones
  // estructuradas cuando el usuario pide, de forma natural, crear/consultar
  // recordatorios, compras, alarmas, temporizadores, notas, diario u horario.
  // Cada acción lleva el dominio y el texto del mandato tal como lo dijo el
  // usuario; el despacho (App.tsx) re-resuelve ese texto con los parsers
  // deterministas (fuente de verdad del parseo temporal/preciso) y ejecuta el
  // mismo manejador __fluHandle* que usa el modo offline. Así FLU es
  // conversacional (la IA entiende y responde) pero la ejecución es precisa.
  const VALID_ACCION_DOMINIOS = ['reminder', 'temporal', 'diary', 'note', 'horario']
  const acciones = (() => {
    const rawAcciones = Array.isArray(parsed.acciones) ? parsed.acciones : null
    if (!rawAcciones || rawAcciones.length === 0) return undefined
    const parsedAcciones = rawAcciones
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const dominio = String(item.dominio || '').trim()
        const texto = String(item.texto || '').trim()
        if (!VALID_ACCION_DOMINIOS.includes(dominio) || !texto) return null
        return { dominio, texto }
      })
      .filter(Boolean)
    return parsedAcciones.length > 0 ? parsedAcciones : undefined
  })()

  // OS4 FASE A: el LLM interpreta la esencia de la orden y emite el id de ambiente.
  // Sin validación aquí: normalizeEnvironment (App.tsx) es el único validador
  // (id inválido → null → sin acción, seguro). El prompt guía con el catálogo real.
  const ambiente =
    typeof parsed.ambiente === 'string' ? parsed.ambiente.trim().toLowerCase() : null

  const contract = {
    // Si se aplicó el fallback determinista, la respuesta_voz confirma la
    // generación de la imagen (en lugar del "¿sobre qué imagen?" del modelo).
    respuesta_voz: fallbackRespuestaVoz || responseText,
    navegacion: {
      comando: comando || intent?.comando || null,
      destino: destino || intent?.destino || null,
      parametros:
        navegacion.parametros && typeof navegacion.parametros === 'object'
          ? navegacion.parametros
          : intent?.parametros || {},
    },
    metadata: {
      provider: 'gemini',
      promptRole: role,
      theme,
      phase,
      transcript,
      intent,
      rawText: text,
    },
    workspace,
    ...(acciones ? { acciones } : {}),
    ...(animacion ? { animacion } : {}),
    ...(emocion ? { emocion } : {}),
    ...(musica ? { musica } : {}),
    ...(configuracion ? { configuracion } : {}),
    ...(ambiente ? { ambiente } : {}),
  }
  return {
    contract,
    diagnostics: {
      provider: 'gemini',
      model,
      apiKeySource: resolvedKey.apiKeySource,
    },
  }
}

/**
* Analiza una imagen usando Gemini Vision API (OCR multimodal).
* Envía la imagen como inlineData + un prompt de análisis.
* @param {{ apiKey: string, imageBase64: string, mimeType: string, language?: string, profile?: string }} params
* @returns {Promise<{ materia: string, problemas: string[], instrucciones: string, nivel: string, texto_extraido: string }>}
*/
export async function analyzeImage({ apiKey, imageBase64, mimeType, language = 'es', profile = 'tutor' }) {
const resolvedKey = resolveGeminiApiKey(apiKey)
if (!hasUsableVoiceBackend(resolvedKey.apiKey)) {
  return { materia: '', problemas: [], instrucciones: '', nivel: '', texto_extraido: '' }
}

const model = resolveGeminiModel()

// Prompt según perfil
const prompts = {
  tutor: language === 'en'
    ? 'Analyze this homework image. Extract in JSON format:\n- materia: subject (math, science, etc.)\n- problemas: list of problems/questions\n- instrucciones: general instructions\n- nivel: education level (elementary, middle, high)\n- texto_extraido: all readable text\n\nRespond with ONLY the JSON, no markdown.'
    : 'Analiza esta imagen de una tarea escolar. Extrae en formato JSON:\n- materia: la materia (matematicas, espanol, ciencias, etc.)\n- problemas: lista de problemas o preguntas\n- instrucciones: instrucciones generales de la tarea\n- nivel: nivel educativo (primaria, secundaria, preparatoria)\n- texto_extraido: todo el texto que puedas leer en la imagen\n\nResponde SOLO con el JSON, sin markdown ni explicaciones.',
  laboral: language === 'en'
    ? 'Analyze this work document/image. Extract in JSON format:\n- materia: document type (report, contract, etc.)\n- problemas: list of key points or action items\n- instrucciones: summary of required actions\n- nivel: priority level\n- texto_extraido: all readable text\n\nRespond with ONLY the JSON, no markdown.'
    : 'Analiza este documento/imagen laboral. Extrae en formato JSON:\n- materia: tipo de documento (reporte, contrato, etc.)\n- problemas: lista de puntos clave o acciones requeridas\n- instrucciones: resumen de acciones necesarias\n- nivel: nivel de prioridad\n- texto_extraido: todo el texto legible\n\nResponde SOLO con el JSON, sin markdown ni explicaciones.',
  coach: language === 'en'
    ? 'Analyze this image. Extract in JSON format:\n- materia: main topic or theme\n- problemas: list of goals or objectives\n- instrucciones: coaching observations\n- nivel: current level or stage\n- texto_extraido: all readable text\n\nRespond with ONLY the JSON, no markdown.'
    : 'Analiza esta imagen. Extrae en formato JSON:\n- materia: tema o área principal\n- problemas: lista de objetivos o metas\n- instrucciones: observaciones de coaching\n- nivel: nivel o etapa actual\n- texto_extraido: todo el texto legible\n\nResponde SOLO con el JSON, sin markdown ni explicaciones.',
}

const prompt = prompts[profile] || prompts.tutor

const vision = FLU_CONFIG.gemini?.vision || {}
const messages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      {
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${imageBase64}` },
      },
    ],
  },
]

let text
try {
  text = await postChatCompletion({
    apiKey: resolvedKey.apiKey,
    model,
    messages,
    temperature: vision.temperature ?? 0.2,
    topP: vision.topP ?? 0.95,
    maxTokens: vision.maxOutputTokens ?? 2048,
    jsonMode: false,
  })
} catch (error) {
  console.warn('[analyzeImage] LLM error:', error?.status || error?.message)
  return { materia: '', problemas: [], instrucciones: '', nivel: '', texto_extraido: '' }
}

// Extraer JSON de la respuesta (puede venir con markdown ```json ... ```)
try {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/{[\s\S]*?}/)
  const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : text
  const parsed = JSON.parse(jsonStr.trim())
  return {
    materia: String(parsed.materia || parsed.subject || '').trim(),
    problemas: Array.isArray(parsed.problemas || parsed.problems || []) ? (parsed.problemas || parsed.problems || []).map(String) : [],
    instrucciones: String(parsed.instrucciones || parsed.instructions || '').trim(),
    nivel: String(parsed.nivel || parsed.level || '').trim(),
    texto_extraido: String(parsed.texto_extraido || parsed.extracted_text || '').trim(),
  }
} catch {
  // Si no se puede parsear JSON, devolver el texto crudo
  return {
    materia: '',
    problemas: [],
    instrucciones: text.slice(0, 500),
    nivel: '',
    texto_extraido: text,
  }
}
}
