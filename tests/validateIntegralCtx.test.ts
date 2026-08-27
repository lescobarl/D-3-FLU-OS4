// ============================================================
// VALIDACIÓN INTEGRAL — memoria de contexto (determinista)
// ------------------------------------------------------------
// Complemento determinista (sin red) para las correcciones de memoria OS4.
// Se ejecuta con vitest porque los módulos importan código TypeScript
// (fluConfig.js → appConfig.ts) que Node puro no resuelve sin loader (Vite sí).
//
//   A) appendDialogueEntry (conversationDialogue.js) conserva respuesta_voz
//      y mapea roles correctamente.
//   B) buildConversationMessages (gemini.js) mapea role 'flu' → assistant,
//      lee respuesta_voz / text / response / transcript según disponibilidad
//      y reenvía el HISTORIAL COMPLETO (la IA resuelve la estructura de la
//      conversación de forma natural; nada se vacía ni se incrusta hardcode).
// ============================================================
import { describe, it, expect } from 'vitest'
import { appendDialogueEntry } from '../src/voice/lib/conversationDialogue.js'
import { buildConversationMessages } from '../src/voice/lib/gemini.js'

const ZH_RESP = '好的，我们开始用中文交流吧，请问你今天过得怎么样？'

describe('VALIDACIÓN INTEGRAL — memoria de contexto determinista', () => {
  // ── A) appendDialogueEntry — corrección de conversationDialogue.js ──
  describe('A) appendDialogueEntry — conserva respuesta_voz y mapea roles', () => {
    it('respuesta_voz se conserva como text (corrección OS4)', () => {
      const h = appendDialogueEntry([], {
        role: 'assistant', speaker: 'Flu', respuesta_voz: ZH_RESP, phase: 'SESION_ACTIVA', source: 'log',
      })
      expect(h.length).toBe(1)
      expect(h[0].text).toBe(ZH_RESP)
    })

    it('role assistant se conserva como assistant', () => {
      const h = appendDialogueEntry([], { role: 'assistant', speaker: 'Flu', respuesta_voz: ZH_RESP })
      expect(h[0].role).toBe('assistant')
      expect(h[0].speaker).toBe('Flu')
    })

    it('role user se conserva como user', () => {
      const h = appendDialogueEntry([], { role: 'user', speaker: 'Hablante 1', transcript: 'hola' })
      expect(h[0].role).toBe('user')
      expect(h[0].speaker).toBe('Hablante 1')
    })

    it('entrada sin texto no se agrega (ni vacía ni undefined)', () => {
      expect(appendDialogueEntry([], { role: 'assistant', respuesta_voz: '' }).length).toBe(0)
      expect(appendDialogueEntry([], { role: 'assistant' }).length).toBe(0)
    })
  })

  // ── B) buildConversationMessages — corrección de gemini.js ──
  describe('B) buildConversationMessages — role flu, respuesta_voz e historial completo', () => {
    const base = {
      transcript: 'hola', intent: '', speaker: '', theme: '', role: '', phase: '', language: 'es',
    }

    it('role `flu` se mapea a assistant y conserva el contenido (integrationStore)', () => {
      const msgs = buildConversationMessages({
        ...base,
        history: [{ role: 'user', text: 'habla en chino' }, { role: 'flu', respuesta_voz: ZH_RESP }],
      } as any)
      const fluMsg = msgs.find((m) => String(m.content).includes(ZH_RESP))
      expect(fluMsg?.role).toBe('assistant')
      expect(String(fluMsg?.content)).toContain(ZH_RESP)
    })

    it('respuesta_voz se usa como contenido cuando no hay text/response', () => {
      const msgs = buildConversationMessages({
        ...base,
        history: [{ role: 'assistant', respuesta_voz: ZH_RESP }],
      } as any)
      expect(msgs[0].role).toBe('assistant')
      expect(String(msgs[0].content)).toBe(ZH_RESP)
    })

    it('el último mensaje es el user final', () => {
      const msgs = buildConversationMessages({
        ...base,
        history: [{ role: 'flu', respuesta_voz: ZH_RESP }],
      } as any)
      expect(msgs[msgs.length - 1].role).toBe('user')
    })

    it('el HISTORIAL COMPLETO se reenvía (asistente incluido): la IA resuelve la estructura', () => {
      // OS4: nada se vacía ni se incrusta por hardcode. Ante un turno como
      // "traduce a español lo que hablaste", la respuesta china previa sigue
      // viajando como mensaje assistant para que la IA la lea y traduzca.
      const msgs = buildConversationMessages({
        ...base,
        transcript: 'traduce a español lo que hablaste',
        history: [
          { role: 'user', text: 'habla en chino' },
          { role: 'assistant', response: ZH_RESP },
        ],
      } as any)
      const assistantMsgs = msgs.filter((m) => m.role === 'assistant')
      expect(assistantMsgs.length).toBe(1)
      expect(String(assistantMsgs[0].content)).toContain(ZH_RESP)
      // 2 user (turno previo + prompt final) + 1 assistant = 3 mensajes totales.
      expect(msgs.filter((m) => m.role === 'user').length).toBe(2)
    })
  })
})
