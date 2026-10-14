// ============================================================
// vozCierreSoloSilencioGuard (P11.12) - la ultima frase se vacia por SILENCIO o cambio de hablante.
// ------------------------------------------------------------
// MANDATO DEL DUENO (2026-10-13): "una vez que termina la ultima frase se pasan los datos a la
// conversacion, puede ser por un silencio o cambio de hablante" y "la conversacion solo lleva
// datos consolidados (solo inserts, no updates)".
// MEDIDO en su log (03:35:57): el trigger disparo con sinceResult=1114 ms (umbral de silencio
// 3500) por la rama 'SIN CONTENIDO NUEVO' (openLineAge=3597): la fila se escribio A MITAD del
// dictado y la cola hubo que ACTUALIZARLA despues (row reused/replaced).
// Se RETIRA esa rama: el cierre de la ultima frase es SOLO por silencio (el cambio de hablante
// tiene su puerta). El caso "Chrome repite lo mismo" lo cubre el detector de eco + rebuild.
// ============================================================
import { describe, expect, it } from 'vitest'
import { resolveSrGapTrigger } from '../src/voice/lib/fluTranscriptPause.js'
import { evaluateSrGapSegmentCommit } from '../src/voice/lib/conversationStream.js'

const AHORA = 1_000_000
const CUATRO_S = AHORA - 4000

const estado = (over: Record<string, unknown> = {}) => ({
  openLine: 'quiero que me expliques la receta completa con todos los pasos',
  pendingInterim: '',
  pendingFinal: '',
  openLineStartedAtMs: CUATRO_S,
  openLineLastTouchMs: CUATRO_S,
  ...over,
})

const opts = (over: Record<string, unknown> = {}) => ({
  nowMs: AHORA,
  sinceLastResultMs: 4000,
  lastCommitted: '',
  lastCommitAtMs: 0,
  ...over,
})

describe('P11.12 - el cierre de la ultima frase es SOLO silencio (o cambio de hablante)', () => {
  it('trigger: con el ASR entregando y el contenido estancado NO se cierra (medido: sinceResult=1114)', () => {
    const r = resolveSrGapTrigger({
      sinceLastResultMs: 1114,
      sinceLastCommitMs: 22383,
      hasOpenLine: true,
      openLineAgeMs: 3597,
    })
    console.log(`  trigger estancado: fire=${r.fire} reason=${r.reason}`)
    expect(r.fire, 'la persona seguia hablando: no puede cerrarse la ultima frase').toBe(false)
  })

  it('trigger: silencio real (>= srGapCommitMs) SI cierra', () => {
    const r = resolveSrGapTrigger({ sinceLastResultMs: 3721, sinceLastCommitMs: 5000, hasOpenLine: true, openLineAgeMs: 0 })
    console.log(`  trigger silencio: fire=${r.fire} reason=${r.reason}`)
    expect(r.fire).toBe(true)
  })

  it('eval: sin silencio NO vuelca (aunque el reloj de contenido este vencido)', () => {
    const r = evaluateSrGapSegmentCommit(estado(), opts({ sinceLastResultMs: 1114 }))
    console.log(`  eval estancado: flush=${r.flush} reason=${r.reason}`)
    expect(r.flush).toBe(false)
    expect(r.reason).toBe('sr-active')
  })

  it('eval: con silencio vuelca la locucion COMPLETA (una sola vez, sin actualizar nada)', () => {
    const r = evaluateSrGapSegmentCommit(estado(), opts({ sinceLastResultMs: 4000 }))
    console.log(`  eval silencio: flush=${r.flush} capture="${String(r.capture).slice(0, 40)}..."`)
    expect(r.flush).toBe(true)
    expect(r.capture).toBe(estado().openLine)
  })

  it('freno CONSERVADO: con silencio y texto identico al ya commiteado NO vuelca', () => {
    const r = evaluateSrGapSegmentCommit(
      estado({ openLine: 'hola mundo que tal' }),
      opts({ lastCommitted: 'hola mundo que tal' }),
    )
    expect(r.flush).toBe(false)
    expect(r.reason).toBe('already-committed')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): es el SILENCIO lo que cierra, no el reloj de contenido', () => {
    const sinSilencio = resolveSrGapTrigger({ sinceLastResultMs: 1114, hasOpenLine: true, openLineAgeMs: 9999 })
    const conSilencio = resolveSrGapTrigger({ sinceLastResultMs: 4000, hasOpenLine: true, openLineAgeMs: 9999 })
    expect(sinSilencio.fire).toBe(false)
    expect(conSilencio.fire).toBe(true)
  })
})