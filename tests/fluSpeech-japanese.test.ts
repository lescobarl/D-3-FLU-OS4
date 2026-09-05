// @vitest-environment jsdom
// ============================================================
// fluSpeech — Japonés y otros scripts (TTS multi-idioma)
// Validación funcional de la corrección "habla en japonés sin audio":
//  1) resolveSpeechLocale detecta el script del texto (kana/kanji → ja-JP)
//  2) speakSingleChunk elige una voz que coincida con ese locale
//  3) El system prompt (gemini) ordena escribir respuesta_voz COMPLETA
//     en el idioma solicitado (no solo confirmar en español)
// ============================================================
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { speakResponse } from '../src/voice/lib/fluSpeech'
import { buildSystemPrompt } from '../src/voice/lib/gemini'

interface MockVoice {
  name: string
  lang: string
  localService: boolean
  default: boolean
  voiceURI: string
}

class MockUtterance {
  text: string
  lang = ''
  voice: MockVoice | null = null
  rate = 1
  pitch = 1
  volume = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

// Store controlable por test (voiceConfig, conversationState)
const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    conversationState: 'IDLE',
    setConversationState: vi.fn(),
    voiceConfig: { rate: 1, pitch: 1, volume: 1, voiceURI: '' },
  },
}))

vi.mock('../src/store/integrationStore', () => ({
  useIntegrationStore: { getState: () => mockStore },
}))

function makeMockSynth(voices: MockVoice[]) {
  const speak = vi.fn()
  const cancel = vi.fn()
  const resume = vi.fn()
  const synth = {
    getVoices: vi.fn(() => voices),
    speak,
    cancel,
    resume,
    speaking: false,
    pending: false,
  } as unknown as SpeechSynthesis
  return { synth, speak, cancel, resume }
}

function installSpeechSynthesis(voices: MockVoice[]) {
  const mocks = makeMockSynth(voices)
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: mocks.synth,
  })
  vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
  return mocks
}

// speakResponse es async ANTES de llamar a synth.speak (enterSpeakingState +
// refreshVoiceConfigCache se aguardan con dynamic-import), así que hay que
// esperar a que el mock speak sea llamado antes de inspeccionar el utterance.
async function runSpeak(text: string, language: string, mocks: ReturnType<typeof installSpeechSynthesis>) {
  const p = speakResponse(text, language)
  await vi.waitFor(() => expect(mocks.speak).toHaveBeenCalledTimes(1))
  const utterance = mocks.speak.mock.calls[0][0] as MockUtterance
  utterance.onend?.()
  await p
  return utterance
}

// Fixtures de voz
const ES_MX: MockVoice = { name: 'Microsoft Sabina', lang: 'es-MX', localService: true, default: true, voiceURI: 'es-MX-Sabina' }
const EN_US: MockVoice = { name: 'Microsoft Aria', lang: 'en-US', localService: false, default: false, voiceURI: 'en-US-Aria' }
const JA_JP: MockVoice = { name: 'Microsoft Nanami', lang: 'ja-JP', localService: false, default: false, voiceURI: 'ja-JP-Nanami' }
const ZH_CN: MockVoice = { name: 'Microsoft Huihui', lang: 'zh-CN', localService: false, default: false, voiceURI: 'zh-CN-Huihui' }

// Textos DIFERENTES por test para evitar el dedup de 350ms
const JA_TEXT_1 = '承知いたしました。日本語で話します。'
const JA_TEXT_2 = 'はい、わかりました。日本語でお答えします。'
const JA_TEXT_3 = 'こんにちは。今日はいい天気ですね。'
const JA_TEXT_4 = 'ありがとうございます。また明日お会いしましょう。'
const JA_TEXT_5 = 'はい、承知しました。'
const JA_TEXT_6 = 'テスト用の日本語テキストです。'
const ZH_TEXT_1 = '你好，我会说中文。'
const ZH_TEXT_2 = '好的，我可以用中文回答你。'
const KO_TEXT = '알겠습니다. 한국어로 말하겠습니다.'
const RU_TEXT = 'Понял. Буду говорить по-русски.'
const AR_TEXT = 'فهمت. سأتحدث بالعربية.'
const EL_TEXT = 'Κατάλαβα. Θα μιλήσω ελληνικά.'
const ES_TEXT = 'Entendido. Voy a responder en español.'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (typeof window !== 'undefined') {
    // @ts-expect-error limpieza del stub de jsdom
    delete window.speechSynthesis
  }
  mockStore.conversationState = 'IDLE'
  mockStore.voiceConfig = { rate: 1, pitch: 1, volume: 1, voiceURI: '' }
  mockStore.setConversationState.mockClear()
})

describe('fluSpeech — resolución de locale por script del texto', () => {
  test('japonés (kana/kanji) → utterance.lang = ja-JP aunque el idioma configurado sea es', async () => {
    const mocks = installSpeechSynthesis([ES_MX, EN_US])
    const utterance = await runSpeak(JA_TEXT_1, 'es', mocks)
    expect(utterance.lang).toBe('ja-JP')
  })

  test('elige una voz que coincida con el locale del texto (ja-JP → voz japonesa)', async () => {
    const mocks = installSpeechSynthesis([ES_MX, EN_US, JA_JP])
    const utterance = await runSpeak(JA_TEXT_2, 'es', mocks)
    expect(utterance.lang).toBe('ja-JP')
    expect(utterance.voice).not.toBeNull()
    expect((utterance.voice as MockVoice).voiceURI).toBe('ja-JP-Nanami')
  })

  test('el script domina sobre la voiceURI configurada (no fuerza voz española)', async () => {
    mockStore.voiceConfig = { rate: 1, pitch: 1, volume: 1, voiceURI: 'es-MX-Sabina' }
    const mocks = installSpeechSynthesis([ES_MX, EN_US, JA_JP])
    const utterance = await runSpeak(JA_TEXT_3, 'es', mocks)
    expect(utterance.lang).toBe('ja-JP')
    expect((utterance.voice as MockVoice).voiceURI).toBe('ja-JP-Nanami')
  })

  test('sin voz japonesa disponible: locale ja-JP pero voice null (no cae a es ni lanza error)', async () => {
    const mocks = installSpeechSynthesis([ES_MX, EN_US])
    const utterance = await runSpeak(JA_TEXT_4, 'es', mocks)
    expect(utterance.lang).toBe('ja-JP')
    expect(utterance.voice).toBeNull()
  })

  test('español con voiceURI: sin regresión (locale es-MX y voz configurada)', async () => {
    mockStore.voiceConfig = { rate: 1, pitch: 1, volume: 1, voiceURI: 'es-MX-Sabina' }
    const mocks = installSpeechSynthesis([ES_MX, EN_US, JA_JP])
    const utterance = await runSpeak(ES_TEXT, 'es', mocks)
    expect(utterance.lang).toBe('es-MX')
    expect((utterance.voice as MockVoice).voiceURI).toBe('es-MX-Sabina')
  })

  test('inglés configurado (language=en): texto en español → en-US', async () => {
    const mocks = installSpeechSynthesis([ES_MX, EN_US, JA_JP])
    const utterance = await runSpeak(ES_TEXT, 'en', mocks)
    expect(utterance.lang).toBe('en-US')
  })

  test('modo both con texto japonés → ja-JP (el script manda)', async () => {
    const mocks = installSpeechSynthesis([ES_MX, EN_US, JA_JP])
    const utterance = await runSpeak(JA_TEXT_5, 'both', mocks)
    expect(utterance.lang).toBe('ja-JP')
  })
})

describe('fluSpeech — otros scripts', () => {
  const cases: Array<[string, string]> = [
    [ZH_TEXT_2, 'zh-CN'],
    [KO_TEXT, 'ko-KR'],
    [RU_TEXT, 'ru-RU'],
    [AR_TEXT, 'ar-SA'],
    [EL_TEXT, 'el-GR'],
  ]
  for (const [text, expected] of cases) {
    test(`detecta ${expected}`, async () => {
      const mocks = installSpeechSynthesis([ES_MX, EN_US])
      const utterance = await runSpeak(text, 'es', mocks)
      expect(utterance.lang).toBe(expected)
    })
  }
})

describe('fluSpeech — chino vs japonés (split kana/hanzi)', () => {
  test('hanzi chino (sin kana) → zh-CN, no ja-JP', async () => {
    const mocks = installSpeechSynthesis([ES_MX, EN_US])
    const utterance = await runSpeak(ZH_TEXT_1, 'es', mocks)
    expect(utterance.lang).toBe('zh-CN')
  })

  test('elige una voz china cuando hay voz zh-CN disponible', async () => {
    const mocks = installSpeechSynthesis([ES_MX, EN_US, ZH_CN])
    const utterance = await runSpeak(ZH_TEXT_2, 'es', mocks)
    expect(utterance.lang).toBe('zh-CN')
    expect((utterance.voice as MockVoice).voiceURI).toBe('zh-CN-Huihui')
  })

  test('japonés mixto kanji+kana → ja-JP (kana domina, no cae a zh-CN)', async () => {
    const mocks = installSpeechSynthesis([ES_MX, EN_US])
    const utterance = await runSpeak(JA_TEXT_6, 'es', mocks)
    expect(utterance.lang).toBe('ja-JP')
  })
})

describe('gemini — system prompt: contenido real + traducción, sin ejemplo fijo copiable', () => {
  test('español: exige CONTENIDO REAL en el idioma pedido y regla de TRADUCCIÓN', () => {
    const prompt = buildSystemPrompt({ role: '', theme: '', phase: 'conversation', language: 'es' })
    expect(prompt).toContain('CONTENIDO REAL')
    expect(prompt).toContain('ESCRITO COMPLETO en ese idioma')
    expect(prompt).toContain('TRADUCCIÓN')
    // FIX traducción mixta (ES+ZH): "traduce/tradúcelo" sin idioma → idioma configurado
    expect(prompt).toContain('traduce al idioma configurado')
    // Prohibe meta-texto / citar el original / mezclar idiomas en la salida
    expect(prompt).toContain('un solo idioma')
    expect(prompt).toContain('sin texto meta')
    expect(prompt).toContain('la frase anterior')
    // Regresión: el prompt NO debe contener una frase japonesa fija copiable
    expect(prompt).not.toContain('承知いたしました')
    expect(prompt).not.toContain('中国語で話します')
  })

  test('inglés: exige REAL CONTENT en el idioma pedido y regla de TRANSLATION', () => {
    const prompt = buildSystemPrompt({ role: '', theme: '', phase: 'conversation', language: 'en' })
    expect(prompt).toContain('REAL CONTENT')
    expect(prompt).toContain('ENTIRELY in that language')
    expect(prompt).toContain('TRANSLATION')
    // FIX traducción mixta (ES+ZH): "translate/tradúcelo" sin idioma → idioma configurado
    expect(prompt).toContain('translate into the configured language')
    // Prohibe meta-texto / citar el original / mezclar idiomas en la salida
    expect(prompt).toContain('single language')
    expect(prompt).toContain('no meta-text')
    expect(prompt).toContain('previous phrase')
    // Regresión: el prompt NO debe contener una frase japonesa fija copiable
    expect(prompt).not.toContain('承知いたしました')
    expect(prompt).not.toContain('中国語で話します')
  })
})
