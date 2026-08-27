// ============================================================
// 🧪 Translation/Language Integration — pipeline completo (OS4)
// ============================================================
// Arquitectura OS4: YA NO existe detección hardcodeada de intención de
// traducción/repetición (detectTranslationIntent/detectRepetitionIntent y sus
// overrides "CRÍTICO" fueron eliminados). La estructura de la conversación la
// resuelve la IA de forma natural a través de la directiva IDIOMA/LANGUAGE del
// system prompt.
//
// Esta prueba NO simula piezas unitarias: recorre el pipeline REAL
// generateFluContract() → buildSystemPrompt → buildConversationMessages
// → mapChatMessagesToOpenAI → postChatCompletion, mockeando únicamente la
// llamada de red (fetch global). Verifica que:
//   1) NO hay override "CRÍTICO" ni neutralización de la directiva IDIOMA
//      (el viejo machinery de traducción/repetición fue eliminado),
//   2) la directiva 'IDIOMA — Responde por defecto en español' está SIEMPRE
//      activa y le dice a la IA cómo responder ante "di ... en [idioma]",
//   3) el HISTORIAL COMPLETO se reenvía (role assistant) — la IA decide la
//      estructura; nada se vacía ni se incrusta por hardcode,
//   4) el resultado final es lo que la IA devuelve (passthrough).
// ============================================================
import { describe, test, expect, vi, afterEach } from 'vitest'
import { generateFluContract } from '../src/voice/lib/gemini'

// ── Datos del escenario: FLU respondió antes en chino ────────
const ZH_PREV = '好的，我们开始用中文交流吧，请问你今天过得怎么样？'
const ZH_REPLY = '你好！很高兴见到你。' // respuesta del modelo ante "di en chino hola"
const ES_TRANSLATION = 'Bien, empecemos a hablar en chino. ¿Cómo estás hoy?'

// Detección de caracteres CJK (Han).
const hasHan = (s: string) => /[\u4e00-\u9fff]/.test(s)

// ── Mock de la respuesta HTTP del endpoint OpenAI-compatible ─
// postChatCompletion consulta response.ok / response.text() / response.json(),
// así que el mock debe exponer esos miembros (no depende de la Response real).
function okResponse(content: string) {
  const body = JSON.stringify({
    choices: [{ message: { role: 'assistant', content } }],
  })
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    async text() {
      return body
    },
    async json() {
      return JSON.parse(body)
    },
  }
}

type SentMessage = { role: string; content: unknown }
type LastRequest = { url: string; headers: unknown; body: { messages: SentMessage[] } | null } | null

// Captura la última petición enviada al "modelo" para poder inspeccionar
// los mensajes (system + historial) que el pipeline realmente construye.
let lastRequest: LastRequest = null

function stubFetchWith(content: string) {
  lastRequest = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      lastRequest = {
        url: _url,
        headers: init?.headers,
        body: init?.body ? (JSON.parse(init.body) as { messages: SentMessage[] }) : null,
      }
      return okResponse(content)
    }),
  )
}

function lastSentMessages(): SentMessage[] {
  return lastRequest?.body?.messages ?? []
}

afterEach(() => {
  vi.unstubAllGlobals()
  lastRequest = null
})

describe('generateFluContract — idioma / estructura de conversación (pipeline real, OS4)', () => {
  test('"di en chino hola" → SIN override hardcodeado, IDIOMA activa, historial completo, passthrough', async () => {
    stubFetchWith(JSON.stringify({ respuesta_voz: ZH_REPLY, navegacion: { comando: null, destino: null }, workspace: null }))

    const result = await generateFluContract({
      apiKey: 'test-key-12345',
      transcript: 'di en chino hola',
      language: 'es',
      history: [
        { role: 'user', transcript: 'habla en chino' },
        { role: 'assistant', response: ZH_PREV },
      ],
    } as any)

    // ── 1) System prompt: NO override de repetición/traducción ──
    const systemMessage = lastSentMessages().find((m) => m.role === 'system')
    expect(systemMessage).toBeTruthy()
    const sys = String(systemMessage?.content)

    // El viejo machinery (CRÍTICO / INSTRUCCIÓN DE TRADUCCIÓN / SUSPENDIDA)
    // ya no existe: la IA resuelve la estructura de forma natural.
    expect(sys.startsWith('CRÍTICO')).toBe(false)
    expect(sys).not.toContain('INSTRUCCIÓN DE TRADUCCIÓN')
    expect(sys).not.toContain('SUSPENDIDA')

    // La directiva IDIOMA está SIEMPRE activa (español) y ordena responder
    // en el idioma que pida el usuario.
    expect(sys).toContain('IDIOMA — Responde por defecto en español')

    // ── 2) Historial COMPLETO reenviado (nada se vacía) ──
    const assistantMessages = lastSentMessages().filter((m) => m.role === 'assistant')
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1)
    expect(String(assistantMessages[0].content)).toContain(ZH_PREV)

    // El turno actual llega como mensaje user final.
    const userMessages = lastSentMessages().filter((m) => m.role === 'user')
    expect(String(userMessages[userMessages.length - 1].content)).toContain('di en chino hola')

    // ── 3) El contrato devuelve lo que la IA decidió (passthrough) ──
    expect(result.contract.respuesta_voz).toBe(ZH_REPLY)
    expect(hasHan(result.contract.respuesta_voz)).toBe(true)
  })

  test('"traduce a español lo que hablaste" → SIN override, historial completo, traducción del modelo', async () => {
    stubFetchWith(JSON.stringify({ respuesta_voz: ES_TRANSLATION, navegacion: { comando: null, destino: null }, workspace: null }))

    const result = await generateFluContract({
      apiKey: 'test-key-12345',
      transcript: 'traduce a español lo que hablaste',
      language: 'es',
      history: [
        { role: 'user', transcript: 'habla en chino' },
        { role: 'assistant', response: ZH_PREV },
      ],
    } as any)

    const systemMessage = lastSentMessages().find((m) => m.role === 'system')
    expect(systemMessage).toBeTruthy()
    const sys = String(systemMessage?.content)

    expect(sys.startsWith('CRÍTICO')).toBe(false)
    expect(sys).not.toContain('INSTRUCCIÓN DE TRADUCCIÓN')
    expect(sys).toContain('IDIOMA — Responde por defecto en español')

    // El historial completo (incluida la respuesta china previa) viaja como
    // contexto: la IA lee la conversación y decide traducir de forma natural.
    const assistantMessages = lastSentMessages().filter((m) => m.role === 'assistant')
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1)
    expect(String(assistantMessages[0].content)).toContain(ZH_PREV)

    expect(result.contract.respuesta_voz).toBe(ES_TRANSLATION)
    expect(hasHan(result.contract.respuesta_voz)).toBe(false)
  })

  test('turno normal → system sin override, IDIOMA activa intacta, passthrough', async () => {
    const normalReply = 'Hola, ¿cómo estás?'
    stubFetchWith(JSON.stringify({ respuesta_voz: normalReply, navegacion: { comando: null, destino: null }, workspace: null }))

    const result = await generateFluContract({
      apiKey: 'test-key-12345',
      transcript: 'hola',
      language: 'es',
      history: [],
    } as any)

    const systemMessage = lastSentMessages().find((m) => m.role === 'system')
    expect(systemMessage).toBeTruthy()
    const sys = String(systemMessage?.content)

    expect(sys.startsWith('CRÍTICO')).toBe(false)
    expect(sys).toContain('IDIOMA — Responde por defecto en español')
    expect(sys).not.toContain('INSTRUCCIÓN DE TRADUCCIÓN')

    expect(result.contract.respuesta_voz).toBe(normalReply)
  })
})
