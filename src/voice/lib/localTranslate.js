// ============================================================
// 🈯 LOCAL TRANSLATE — fallback de traducción offline (OS4)
// ============================================================
// Se usa SOLO como última red de seguridad: si tras los reintentos
// anti-eco el modelo SIGUE devolviendo la fuente sin traducir, este
// módulo busca la frase en un diccionario curado de frases comunes.
// Si hay coincidencia, se entrega la traducción offline real (evitando
// el molesto "no pude traducir"). Si NO hay coincidencia, cae en
// buildTranslationFallbackMessage(), que genera un aviso de UX mejorado
// e incluye el texto original para que el usuario sepa qué falló.
//
// NOTA: este NO es un traductor automático. Es un glosario estático de
// frases de alta frecuencia para no bloquear la conversación. Extiende
// TRANSLATION_TABLE cuando aparezcan frases recurrentes en producción.

const TRANSLATION_TABLE = Object.freeze([
  // ── Chino (zh) → Español (es): el caso reportado en producción ─
  // Solicitud "tradu traduce a español lo que acabas de decir" sobre
  // "你好，我很好，谢谢！" → el modelo devolvía eco → ahora se traduce offline.
  { from: 'zh', to: 'es', source: '你好，我很好，谢谢！', target: 'Hola, estoy muy bien, ¡gracias!' },
  // Frase multi-turno del pipeline anti-echo (ZH_PREV → ES_TRANSLATION).
  { from: 'zh', to: 'es', source: '好的，我们开始用中文交流吧，请问你今天过得怎么样？', target: 'Bien, empecemos a hablar en chino. ¿Cómo estás hoy?' },
  { from: 'zh', to: 'es', source: '你好', target: 'Hola' },
  { from: 'zh', to: 'es', source: '谢谢', target: 'Gracias' },
  { from: 'zh', to: 'es', source: '早上好', target: 'Buenos días' },
  { from: 'zh', to: 'es', source: '晚上好', target: 'Buenas noches' },
  { from: 'zh', to: 'es', source: '再见', target: 'Adiós' },
  { from: 'zh', to: 'es', source: '你好吗', target: '¿Cómo estás?' },
  { from: 'zh', to: 'es', source: '我很好，谢谢', target: 'Estoy muy bien, gracias' },
  { from: 'zh', to: 'es', source: '不客气', target: 'De nada' },

  // ── Chino (zh) → Inglés (en) ─
  { from: 'zh', to: 'en', source: '你好', target: 'Hello' },
  { from: 'zh', to: 'en', source: '谢谢', target: 'Thank you' },
  { from: 'zh', to: 'en', source: '早上好', target: 'Good morning' },
  { from: 'zh', to: 'en', source: '晚上好', target: 'Good evening' },
  { from: 'zh', to: 'en', source: '再见', target: 'Goodbye' },
  { from: 'zh', to: 'en', source: '你好吗', target: 'How are you?' },
  { from: 'zh', to: 'en', source: '我很好，谢谢', target: "I'm fine, thank you" },
  { from: 'zh', to: 'en', source: '不客气', target: "You're welcome" },

  // ── Japonés (ja) → Español (es) ─
  { from: 'ja', to: 'es', source: 'こんにちは', target: 'Hola' },
  { from: 'ja', to: 'es', source: 'ありがとう', target: 'Gracias' },
  { from: 'ja', to: 'es', source: 'さようなら', target: 'Adiós' },
  { from: 'ja', to: 'es', source: 'おはようございます', target: 'Buenos días' },
  { from: 'ja', to: 'es', source: 'こんばんは', target: 'Buenas noches' },

  // ── Japonés (ja) → Inglés (en) ─
  { from: 'ja', to: 'en', source: 'こんにちは', target: 'Hello' },
  { from: 'ja', to: 'en', source: 'ありがとう', target: 'Thank you' },
  { from: 'ja', to: 'en', source: 'さようなら', target: 'Goodbye' },

  // ── Inglés (en) → Español (es) ─
  { from: 'en', to: 'es', source: 'hello', target: 'Hola' },
  { from: 'en', to: 'es', source: 'hi', target: 'Hola' },
  { from: 'en', to: 'es', source: 'thank you', target: 'Gracias' },
  { from: 'en', to: 'es', source: 'thanks', target: 'Gracias' },
  { from: 'en', to: 'es', source: 'good morning', target: 'Buenos días' },
  { from: 'en', to: 'es', source: 'good afternoon', target: 'Buenas tardes' },
  { from: 'en', to: 'es', source: 'good evening', target: 'Buenas noches' },
  { from: 'en', to: 'es', source: 'good night', target: 'Buenas noches' },
  { from: 'en', to: 'es', source: 'goodbye', target: 'Adiós' },
  { from: 'en', to: 'es', source: 'bye', target: 'Adiós' },
  { from: 'en', to: 'es', source: 'how are you', target: '¿Cómo estás?' },
  { from: 'en', to: 'es', source: "i'm fine, thank you", target: 'Estoy muy bien, gracias' },
  { from: 'en', to: 'es', source: "you're welcome", target: 'De nada' },

  // ── Español (es) → Inglés (en) ─
  { from: 'es', to: 'en', source: 'hola', target: 'Hello' },
  { from: 'es', to: 'en', source: 'adiós', target: 'Goodbye' },
  { from: 'es', to: 'en', source: 'gracias', target: 'Thank you' },
  { from: 'es', to: 'en', source: 'buenos días', target: 'Good morning' },
  { from: 'es', to: 'en', source: 'buenas noches', target: 'Good night' },
  { from: 'es', to: 'en', source: '¿cómo estás?', target: 'How are you?' },

  // ── Francés (fr) → Español (es) ─
  { from: 'fr', to: 'es', source: 'bonjour', target: 'Hola' },
  { from: 'fr', to: 'es', source: 'salut', target: 'Hola' },
  { from: 'fr', to: 'es', source: 'merci', target: 'Gracias' },
  { from: 'fr', to: 'es', source: 'au revoir', target: 'Adiós' },
  { from: 'fr', to: 'es', source: 'bonsoir', target: 'Buenas noches' },
  { from: 'fr', to: 'es', source: 'bonne nuit', target: 'Buenas noches' },

  // ── Alemán (de) → Español (es) ─
  { from: 'de', to: 'es', source: 'hallo', target: 'Hola' },
  { from: 'de', to: 'es', source: 'guten morgen', target: 'Buenos días' },
  { from: 'de', to: 'es', source: 'gute nacht', target: 'Buenas noches' },
  { from: 'de', to: 'es', source: 'danke', target: 'Gracias' },
  { from: 'de', to: 'es', source: 'auf wiedersehen', target: 'Adiós' },
  { from: 'de', to: 'es', source: 'tschüss', target: 'Adiós' },

  // ── Italiano (it) → Español (es) ─
  { from: 'it', to: 'es', source: 'ciao', target: 'Hola' },
  { from: 'it', to: 'es', source: 'buongiorno', target: 'Buenos días' },
  { from: 'it', to: 'es', source: 'buonasera', target: 'Buenas noches' },
  { from: 'it', to: 'es', source: 'buonanotte', target: 'Buenas noches' },
  { from: 'it', to: 'es', source: 'grazie', target: 'Gracias' },
  { from: 'it', to: 'es', source: 'arrivederci', target: 'Adiós' },

  // ── Portugués (pt) → Español (es) ─
  { from: 'pt', to: 'es', source: 'olá', target: 'Hola' },
  { from: 'pt', to: 'es', source: 'bom dia', target: 'Buenos días' },
  { from: 'pt', to: 'es', source: 'boa tarde', target: 'Buenas tardes' },
  { from: 'pt', to: 'es', source: 'boa noite', target: 'Buenas noches' },
  { from: 'pt', to: 'es', source: 'obrigado', target: 'Gracias' },
  { from: 'pt', to: 'es', source: 'tchau', target: 'Adiós' },

  // ── Ruso (ru) → Español (es) ─
  { from: 'ru', to: 'es', source: 'привет', target: 'Hola' },
  { from: 'ru', to: 'es', source: 'доброе утро', target: 'Buenos días' },
  { from: 'ru', to: 'es', source: 'добрый вечер', target: 'Buenas noches' },
  { from: 'ru', to: 'es', source: 'спасибо', target: 'Gracias' },
  { from: 'ru', to: 'es', source: 'до свидания', target: 'Adiós' },

  // ── Árabe (ar) → Español (es) ─
  { from: 'ar', to: 'es', source: 'مرحبا', target: 'Hola' },
  { from: 'ar', to: 'es', source: 'صباح الخير', target: 'Buenos días' },
  { from: 'ar', to: 'es', source: 'مساء الخير', target: 'Buenas noches' },
  { from: 'ar', to: 'es', source: 'شكرا', target: 'Gracias' },
  { from: 'ar', to: 'es', source: 'مع السلامة', target: 'Adiós' },

  // ── Coreano (ko) → Español (es) ─
  { from: 'ko', to: 'es', source: '안녕하세요', target: 'Hola' },
  { from: 'ko', to: 'es', source: '감사합니다', target: 'Gracias' },
  { from: 'ko', to: 'es', source: '안녕히 가세요', target: 'Adiós' },

  // ── Hindi (hi) → Español (es) ─
  { from: 'hi', to: 'es', source: 'नमस्ते', target: 'Hola' },
  { from: 'hi', to: 'es', source: 'धन्यवाद', target: 'Gracias' },
])

// Normaliza una frase para comparar: recorta, colapsa espacios y pasa a
// minúsculas (no afecta a CJK/Cirílico/Devanagari, solo a alfabetos latinos).
function normalizePhrase(text = '') {
  return String(text).trim().replace(/\s+/g, ' ').toLowerCase()
}

// Recorta una fuente larga para no saturar la síntesis de voz.
function snippetOf(text = '', max = 120) {
  const value = String(text || '').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

/**
 * Traducción offline de una frase mediante el diccionario curado.
 * @param {{ text?: string, targetLanguage?: string, sourceLanguage?: string }} options
 * @returns {string | null} Traducción exacta o null si no hay coincidencia.
 */
export function localTranslate({ text = '', targetLanguage = 'es', sourceLanguage = '' } = {}) {
  const target = String(targetLanguage || 'es').toLowerCase()
  const sourceLang = String(sourceLanguage || '').toLowerCase()
  const key = normalizePhrase(text)
  if (!key) return null

  const matches = TRANSLATION_TABLE.filter(
    (entry) => entry.to === target && normalizePhrase(entry.source) === key,
  )
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0].target
  // Con varias coincidencias (p. ej. "ciao" en it/es), prioriza el par origen
  // conocido; si no, devuelve la primera coincidencia del diccionario.
  if (sourceLang) {
    const bySource = matches.find((entry) => entry.from === sourceLang)
    if (bySource) return bySource.target
  }
  return matches[0].target
}

/**
 * Mensaje de UX mejorado cuando NO hay traducción offline disponible.
 * Incluye el texto original para que el usuario sepa exactamente qué falló
 * (en lugar del genérico "no pude traducir" sin contexto).
 * @param {{ source?: string, language?: string }} options
 * @returns {string}
 */
export function buildTranslationFallbackMessage({ source = '', language = 'es' } = {}) {
  const snippet = snippetOf(source)
  if (language === 'en') {
    return snippet
      ? `I couldn't translate this automatically: "${snippet}". Could you rephrase it, please?`
      : "I couldn't translate the previous response automatically. Could you rephrase it, please?"
  }
  return snippet
    ? `No pude traducir esto automáticamente: "${snippet}". ¿Puedes reformularlo, por favor?`
    : 'No pude traducir la respuesta anterior automáticamente. ¿Puedes reformularlo, por favor?'
}
