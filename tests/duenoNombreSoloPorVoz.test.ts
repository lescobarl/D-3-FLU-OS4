// ============================================================
// duenoNombreSoloPorVoz - El nombre de una VOZ sale SOLO de su VOZ.
// ------------------------------------------------------------
// MANDATO DEL DUENO 2026-10-13 (segunda vuelta):
//   (1) "La etiqueta y el PARTICIPANTE ACTIVO no nombran a nadie": si el timbre de esa voz no
//       se midio, la fila se queda "Hablante N". Ni la etiqueta ni el participante activo (su
//       nombre + su speakerLabel) pueden pegarle un nombre a una voz.
//   (2) "Que TODO consumidor vea el nombre RESUELTO, no la etiqueta cruda": lo que ve la IA
//       (minuta/resumen/contexto) tiene que ser el MISMO nombre resuelto que ve el dueno.
// AMEND 2026-10-17 (freeze del dueno): el nombre se CONGELA en la FILA (no se re-resuelve desde
// el directorio), asi que N2 siembra la fila con su nombre congelado; la fila sin nombre escrito
// NO hereda de la clave.
// NACE ROJO.
// ============================================================
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveCommitStickyFallback } from '../src/voice/lib/speakerPolicy.js'
import { buildConversationLog } from '../src/core/ai/aiServiceBase'
import { listSessionSpeakers } from '../src/voice/lib/conversationSession.js'
import { registerVoiceName, resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'

afterEach(() => resetVoiceDirectory())

describe('N1 - ni la etiqueta ni el participante ACTIVO nombran a nadie', () => {
  it('el primario de la sesion (participante activo) NO se usa como hablante de una fila', () => {
    // Si el primario fuera un NOMBRE propio y no hubiera etiqueta, la fila saldria con ese
    // nombre SIN medida: es el camino "lo puse como hablante" (Luis a la chica).
    const sticky = resolveCommitStickyFallback({
      sessionPrimary: 'Luis',
      lastLogged: '',
      fallback: '',
    } as never)
    expect(sticky, 'sin etiqueta no se inventa el nombre del participante').toBe('')
  })

  it('el efecto del PARTICIPANTE ACTIVO no registra el nombre de ninguna voz', () => {
    const hook = readFileSync('src/voice/hooks/useFluVoiceAssistant.js', 'utf8')
    // El efecto del participante activo: fija el PRIMARIO (dato de sesion) y NO puede llamar al
    // registro (el participante es un DATO de la persona, no la identidad de una voz).
    const marca = "'participant')"
    const idx = hook.lastIndexOf(marca)
    expect(idx, 'el efecto del participante tiene que existir (anti-vacuidad)').toBeGreaterThan(0)
    const tramo = hook.slice(Math.max(0, idx - 1500), idx)
    expect(tramo, 'y el tramo es el del efecto (anti-vacuidad)').toContain('setSessionPrimarySpeaker')
    expect(/registerSpeakerIdentity\s*\(/.test(tramo), 'el participante activo NO nombra voces').toBe(false)
  })

  it('PRUEBA DE DETECTOR: un fuente que SI registra desde el participante se marca', () => {
    const infractor = 'activeParticipantName) { registerSpeakerIdentity({ name: activeName })'
    expect(/registerSpeakerIdentity\s*\(/.test(infractor), 'el detector discrimina').toBe(true)
  })
})

describe('N2 - lo que ve la IA es el nombre RESUELTO (no la etiqueta cruda)', () => {
  it('el log de conversacion que va a la IA lleva el nombre de la VOZ', () => {
    registerVoiceName('speaker_1', 'Luis')
    const log = buildConversationLog(
      [
        { role: 'user', text: 'hola a todos', speakerId: 'speaker_1', speakerName: 'Luis' },
        { role: 'flu', text: 'Hola Luis', speakerName: 'FLU' },
      ] as never,
      false,
    )
    expect(log, 'la IA tiene que saber QUIEN hablo').toContain('Luis: hola a todos')
    expect(log, 'y no la etiqueta cruda').not.toContain('Usuario: hola a todos')
  })

  it('sin nombre de esa voz, la IA ve la etiqueta provisional (no se adivina)', () => {
    const log = buildConversationLog([{ role: 'user', text: 'hola', speakerId: 'speaker_2' }] as never, false)
    expect(log).toContain('Hablante 2: hola')
  })

  it('los hablantes de la sesion se listan por su VOZ resuelta', () => {
    registerVoiceName('speaker_1', 'Luis')
    const speakers = listSessionSpeakers([
      { role: 'user', text: 'hola', speakerId: 'speaker_1', speakerName: 'Luis' },
    ] as never)
    expect(speakers).toContain('Luis')
  })
})
