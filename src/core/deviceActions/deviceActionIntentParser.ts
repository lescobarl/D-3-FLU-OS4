// ============================================================
// Device Action Intent Parser — Llamar, WhatsApp, SMS y correo
// ------------------------------------------------------------
// Parser determinista es/en sobre acciones de dispositivo en
// una PWA. Solo lanza esquemas de URL estándar:
//   - 'llama a Monse'                                   → call.start
//   - 'call Monse'                                      → call.start
//   - 'envía un whatsapp a Monse'                       → whatsapp.send
//   - 'send a whatsapp to Monse tell her that hi'       → whatsapp.send
//   - 'manda un mensaje de texto a Monse'               → sms.send
//   - 'envía un correo a Monse'                         → email.send
//   - 'envía un whatsapp a Monse dile que es mi vida'   → whatsapp.send (+message)
// Mismo patrón probado que temporalIntentParser:
//   - `handled:false` si no reconoce ninguna intención.
//   - `handled:true, action:null` si hace falta aclaración.
// Regla #1: sin hardcode — textos deterministas es/en.
// Regla de oro: motor puro (sin DOM, sin Dexie, sin Gemini).
// ============================================================

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

export type DeviceActionIntentAction =
  | 'call.start'
  | 'whatsapp.send'
  | 'sms.send'
  | 'email.send';

export interface DeviceActionIntentData {
  /** Nombre de la persona destinataria tal como se escuchó. */
  contactName: string;
  /** Mensaje opcional a pre-rellenar (whatsapp.send / sms.send / email.send). */
  message?: string;
}

export interface DeviceActionIntent {
  /** true si el input fue reconocido como acción de dispositivo. */
  handled: boolean;
  /** Acción a ejecutar; null cuando hace falta aclaración. */
  action: DeviceActionIntentAction | null;
  /** Mensaje determinista para confirmar o pedir aclaración. */
  reply: string;
  data?: DeviceActionIntentData;
}

// ------------------------------------------------------------
// Constantes declarativas — Regla #1 (sin hardcode disperso)
// ------------------------------------------------------------

// Verbos compartidos por los canales (SMS/WhatsApp/correo). Las
// variantes con infinitivo necesitan `(?:me|le|r)?` porque `\b`
// falla cuando tras la raíz aparece la 'r' final ("enviar").
const SEND_VERBS_ES =
  '(?:puedes\\s+)?(?:env[ií]a(?:me|le|r)?|m[aá]nda(?:me|le|r)?|haz(?:me)?|hacer|escr[ií]be(?:me)?|escribir|m[eé]tele|p[aá]sa(?:me|le|r)?|comparte|compartir)';
const SEND_VERBS_EN = '(?:can\\s+you\\s+)?(?:send|write|text)';

// Palabras de canal. Las frases multi-palabra van PRIMERO en la
// alternancia para que ganen sobre la palabra corta.
const SMS_WORDS_ES = 'mensaje\\s+de\\s+texto|sms|texto|mensaje';
const SMS_WORDS_EN = 'text\\s+message|message|text|sms';
const EMAIL_WORDS_ES = 'correo\\s+electr[oó]nico|correo|email|e-mail|mail';
const EMAIL_WORDS_EN = 'e-mail|email|mail';

// Llamadas (canal fijo, sin barrido perezoso).
const CALL_ES =
  /^(?:puedes\s+)?(?:ll[aá]ma(?:me|le|r)?|m[aá]rca(?:me|r)?|comun[ií]cate\s+con|haz(?:me)?\s+una\s+llamada|hacer\s+una\s+llamada)\s*(?:al?\s*|con\s*|para\s*)?/i;
const CALL_EN =
  /^(?:can\s+you\s+)?(?:call|phone|ring|dial)\s*(?:up\s*)?(?:the\s*)?/i;

// Canales con barrido perezoso: el verbo abre, se tolera cualquier
// texto intermedio ("envía un mensaje por whatsapp a X") y se exige
// el conector al destinatario.
const WHATSAPP_ES = new RegExp(
  `^${SEND_VERBS_ES}\\b(?:(?!whatsapp|wsp\\b).)*?\\b(?:whatsapp|wsp)\\b\\s+(?:a|para|al|con)\\s*`,
  'i'
);
const WHATSAPP_EN = new RegExp(
  `^${SEND_VERBS_EN}\\b(?:(?!whatsapp\\b).)*?\\bwhatsapp\\b\\s+(?:to|for)\\s*|^whatsapp\\s+(?:to\\s+)?`,
  'i'
);
const SMS_ES = new RegExp(
  `^${SEND_VERBS_ES}\\b(?:(?!${SMS_WORDS_ES}).)*?\\b(?:${SMS_WORDS_ES})\\b\\s+(?:a|para|al|con)\\s*`,
  'i'
);
const SMS_EN = new RegExp(
  `^${SEND_VERBS_EN}\\b(?:(?!${SMS_WORDS_EN}).)*?\\b(?:${SMS_WORDS_EN})\\b\\s+(?:to|for)\\s*`,
  'i'
);
const EMAIL_ES = new RegExp(
  `^${SEND_VERBS_ES}\\b(?:(?!${EMAIL_WORDS_ES}).)*?\\b(?:${EMAIL_WORDS_ES})\\b\\s+(?:a|para|al|con)\\s*`,
  'i'
);
const EMAIL_EN = new RegExp(
  `^${SEND_VERBS_EN}\\b(?:(?!${EMAIL_WORDS_EN}).)*?\\b(?:${EMAIL_WORDS_EN})\\b\\s+(?:to|for)\\s*`,
  'i'
);

// Separadores del mensaje: lo que viene después es el contenido.
const MESSAGE_SEP_ES =
  /\b(?:dile\s+que|dici[eé]ndole\s+que|d[ií]cele\s+que|que\s+diga\s+que|con\s+el\s+mensaje)\b/i;
const MESSAGE_SEP_EN =
  /\b(?:tell\s+(?:her|him|them)\s+that|telling\s+(?:her|him|them)\s+that|with\s+the\s+message|saying\s+that)\b/i;

// Cortesía final ("por favor" / "please") — se ignora.
const POLITE_STRIP = /\b(?:por\s+favor|please)\s*$/i;

// ------------------------------------------------------------
// Helpers puros de limpieza
// ------------------------------------------------------------

/** Normaliza el label del contacto: espacios, cortesía y puntuación final. */
function cleanLabel(text: string): string {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(POLITE_STRIP, '')
    .replace(/[\s.,;:!?¿¡]+$/g, '')
    .trim();
}

/** Extrae solo el contenido del mensaje quitando el separador. */
function cleanMessage(part: string): string {
  return part
    .replace(MESSAGE_SEP_ES, ' ')
    .replace(MESSAGE_SEP_EN, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(POLITE_STRIP, '')
    .replace(/[\s.,;:!?¿¡]+$/g, '')
    .trim();
}

/**
 * Divide el resto (tras el prefijo) en destinatario y mensaje opcional.
 * Busca el primer separador de mensaje (es o en), lo que esté antes
 * es el contacto y lo que siga, el contenido.
 */
function splitContactAndMessage(rest: string): {
  contactName: string;
  message?: string;
} {
  const sepEs = rest.search(MESSAGE_SEP_ES);
  const sepEn = rest.search(MESSAGE_SEP_EN);
  const indexes = [sepEs, sepEn].filter((i) => i >= 0);
  if (indexes.length === 0) {
    return { contactName: cleanLabel(rest) };
  }
  const sep = Math.min(...indexes);
  const contactName = cleanLabel(rest.slice(0, sep));
  const message = cleanMessage(rest.slice(sep)) || undefined;
  return message ? { contactName, message } : { contactName };
}

// ------------------------------------------------------------
// Respuestas deterministas (es/en)
// ------------------------------------------------------------

function callReply(name: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Abriendo el marcador para ${name}...`
    : `Opening the dialer for ${name}...`;
}

function whatsappReply(name: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Abriendo WhatsApp para ${name}...`
    : `Opening WhatsApp for ${name}...`;
}

function smsReply(name: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Abriendo mensajes para ${name}...`
    : `Opening messages for ${name}...`;
}

function emailReply(name: string, lang: 'es' | 'en'): string {
  return lang === 'es'
    ? `Abriendo el correo para ${name}...`
    : `Opening email for ${name}...`;
}

function askContactReply(lang: 'es' | 'en'): string {
  return lang === 'es'
    ? '¿A quién quieres que contacte?'
    : 'Who would you like me to contact?';
}

// ------------------------------------------------------------
// Parser principal
// ------------------------------------------------------------

/**
 * Interpreta una frase de acción de dispositivo. Motor puro y
 * determinista: no abre ventanas ni consulta contactos. La
 * resolución de teléfono/correo la hace el servicio (a través
 * del hook) usando los contactos del usuario.
 */
export function parseDeviceActionIntent(input: string): DeviceActionIntent {
  const text = String(input ?? '').trim();
  if (!text) {
    return { handled: false, action: null, reply: '' };
  }

  // Llamada.
  const callMatch = CALL_ES.exec(text) || CALL_EN.exec(text);
  if (callMatch) {
    const lang = CALL_ES.test(text) ? 'es' : 'en';
    const rest = text.slice(callMatch[0].length).trim();
    const { contactName } = splitContactAndMessage(rest);
    if (!contactName) {
      return { handled: true, action: null, reply: askContactReply(lang) };
    }
    return {
      handled: true,
      action: 'call.start',
      reply: callReply(contactName, lang),
      data: { contactName },
    };
  }

  // WhatsApp.
  const whatsappMatch = WHATSAPP_ES.exec(text) || WHATSAPP_EN.exec(text);
  if (whatsappMatch) {
    const lang = WHATSAPP_ES.test(text) ? 'es' : 'en';
    const rest = text.slice(whatsappMatch[0].length).trim();
    const { contactName, message } = splitContactAndMessage(rest);
    if (!contactName) {
      return { handled: true, action: null, reply: askContactReply(lang) };
    }
    return {
      handled: true,
      action: 'whatsapp.send',
      reply: whatsappReply(contactName, lang),
      data: message ? { contactName, message } : { contactName },
    };
  }

  // SMS.
  const smsMatch = SMS_ES.exec(text) || SMS_EN.exec(text);
  if (smsMatch) {
    const lang = SMS_ES.test(text) ? 'es' : 'en';
    const rest = text.slice(smsMatch[0].length).trim();
    const { contactName, message } = splitContactAndMessage(rest);
    if (!contactName) {
      return { handled: true, action: null, reply: askContactReply(lang) };
    }
    return {
      handled: true,
      action: 'sms.send',
      reply: smsReply(contactName, lang),
      data: message ? { contactName, message } : { contactName },
    };
  }

  // Correo.
  const emailMatch = EMAIL_ES.exec(text) || EMAIL_EN.exec(text);
  if (emailMatch) {
    const lang = EMAIL_ES.test(text) ? 'es' : 'en';
    const rest = text.slice(emailMatch[0].length).trim();
    const { contactName, message } = splitContactAndMessage(rest);
    if (!contactName) {
      return { handled: true, action: null, reply: askContactReply(lang) };
    }
    return {
      handled: true,
      action: 'email.send',
      reply: emailReply(contactName, lang),
      data: message ? { contactName, message } : { contactName },
    };
  }

  return { handled: false, action: null, reply: '' };
}
