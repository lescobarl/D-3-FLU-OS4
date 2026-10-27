/**
 * INV-7 (§9.7) — prueba FUNCIONAL de lo visible (complementa el guard G1–G7).
 *
 * Invariante: una frase hablada produce UNA sola fila canónica y la MISMA
 * frase (sin wake word) es la que se envía a la IA y la que muestran las vistas.
 *
 *   fila (bitácora/burbuja) = capture limpio
 *   query (IA)              = fila sin wake word
 *   display (burbuja/barra) = la MISMA fila
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { FLU_CONFIG } from '../src/voice/lib/fluConfig'
import { cleanForSpeech, normalizeVoiceCommandText } from '../src/voice/lib/audioMath'
import { analyzeWakeTurn } from '../src/voice/lib/wakeTurnCommit'
import { deriveUserRowTexts, selectVisiblePhrase } from '../src/voice/lib/conversationDialogue'
import { useIntegrationStore } from '../src/store/integrationStore'
import { crearEscritorFilaUsuario } from '../src/voice/conversation/pasivo'
import type {
  EntradaCompromisoUsuario,
  FilaVistaUsuario,
  PuertoVistaFilas,
  UtilidadesFila,
} from '../src/voice/conversation/ports'
import { canonicalSpeakerName, isProperSpeakerName, pendingSpeakerLabel } from '../src/voice/lib/speakerLabels'
import { autoSpeakerIndexFromKey, getFallbackSpeaker, isAutoSpeakerLabel } from '../src/voice/lib/speakerCore'
import { labelToSpeakerId, normalizeRowSignature } from '../src/voice/lib/conversationRow'
import { speechWords, stripDiacritics } from '../src/voice/lib/audioMath'
import { voiceKeyFor } from '../src/voice/lib/speakerDirectory'

const wakeWords: string[] = FLU_CONFIG.voiceCommands?.wakeWords || []

/** Utilidades REALES del proyecto (mismo cableado que adapters.ts). */
const utilidades: UtilidadesFila = {
  normalizar: (texto) => cleanForSpeech(texto),
  nombrePropio: (nombre) => isProperSpeakerName(nombre),
  canonica: (nombre) => canonicalSpeakerName(nombre),
  etiquetaPendiente: () => pendingSpeakerLabel(),
  respaldoEtiqueta: () => getFallbackSpeaker(),
  claveDeEtiqueta: (etiqueta) => labelToSpeakerId(etiqueta),
  claveVoz: (datos) =>
    voiceKeyFor({ voiceId: datos.voiceId, signature: datos.signature ? [...datos.signature] : null }),
  indiceAltoDeClave: (clave) => autoSpeakerIndexFromKey(clave) ?? 0,
  normalizarFirma: (firma) => normalizeRowSignature(firma ? [...firma] : null),
  palabras: (texto) => speechWords(texto),
  compactar: (texto) => stripDiacritics(cleanForSpeech(texto)).replace(/[^a-z0-9]+/g, ''),
}

const config = {
  esEtiquetaAnonima: (etiqueta: string) => isAutoSpeakerLabel(etiqueta),
  semillaEtiqueta: () => getFallbackSpeaker(),
}

/** Vista falsa del escritor del módulo (dependencia aislada, §0.7). */
function crearEscritorModulo() {
  let filas: FilaVistaUsuario[] = []
  const vista: PuertoVistaFilas = {
    leerHistorial: () => filas,
    agregarEntrada: (entrada) => {
      filas = [...filas, entrada]
    },
    completarFragmento: (id, texto) => {
      filas = filas.map((f) => (f.id === id ? { ...f, text: texto } : f))
    },
    fijarAltavoz: (id, vozId, opciones) => {
      filas = filas.map((f) =>
        f.id === id
          ? { ...f, speakerId: vozId, ...(opciones?.firma ? { signature: [...opciones.firma] } : {}) }
          : f,
      )
    },
    fijarNombre: (id, nombre) => {
      filas = filas.map((f) => (f.id === id ? { ...f, speakerName: nombre } : f))
    },
    anotarHighWater: () => {},
    epoch: () => 1,
  }
  const escritor = crearEscritorFilaUsuario({
    vista,
    utilidades,
    config,
    id: { uuid: () => 'uuid-inv7' },
    reloj: { ahora: () => 1000 },
    registro: { registrar: () => {} },
  })
  return { escritor, filas: () => filas }
}

describe('voiceCanonicalPhrase — una frase → una fila + misma query (§9.7)', () => {
  beforeEach(() => {
    useIntegrationStore.getState().resetConversationHistory()
  })

  it('la query a la IA es la fila canónica sin wake, y el display devuelve esa misma fila', () => {
    const capture = 'Okay flu Platícame de la nave que fue a la luna artemis 2'
    const turn = analyzeWakeTurn(capture, { wakeWords })
    const row = turn.cleaned
    const query = turn.question

    expect(row).toBeTruthy()
    expect(query).toBeTruthy()
    // La query es la MISMA fila sin la wake word (el wake va al inicio).
    // Se compara en forma normalizada (casing/acentos/puntuación).
    expect(normalizeVoiceCommandText(row).endsWith(normalizeVoiceCommandText(query))).toBe(true)
    expect(row.length).toBeGreaterThan(query.length)
    // El display devuelve la MISMA cadena que la fila.
    expect(selectVisiblePhrase({ lastTranscript: row })).toBe(cleanForSpeech(row))
    // La derivación de filas devuelve la MISMA cadena.
    expect(deriveUserRowTexts([{ role: 'user', text: row }] as any)).toEqual([cleanForSpeech(row)])
  })

  it('una misma emisión no agrega fila: el escritor reutiliza la del MISMO turno', () => {
    // Corte 2026-10-26: `resolveLogRowAction` (conversationStream.js, isla) se
    // retira; el dueño vivo de «misma emisión no duplica» es el escritor del
    // módulo: el MISMO turno re-emitido se reutiliza; un turno distinto agrega.
    const { escritor, filas } = crearEscritorModulo()
    const compromiso = (text: string, turnId: string): EntradaCompromisoUsuario => ({ text, turnId })

    const v1 = 'Okay flu Platícame de los aviones'
    expect(escritor.commitUserTurnRow(compromiso(v1, 'turno-1')).action).toBe('added')
    const repite = escritor.commitUserTurnRow(compromiso(v1, 'turno-1'))
    expect(repite.action).toBe('reused')
    expect(filas()).toHaveLength(1)

    const otra = 'Okay flu Cuéntame un chiste'
    const nueva = escritor.commitUserTurnRow(compromiso(otra, 'turno-2'))
    expect(nueva.action).toBe('added')
    expect(filas()).toHaveLength(2)
  })

  it('una frase hablada deja UNA sola fila de usuario en el store, coherente con la query', () => {
    const capture = 'Okay flu Platícame de los aviones'
    const turn = analyzeWakeTurn(capture, { wakeWords })

    useIntegrationStore.getState().addConversationEntry({
      id: 'inv7-row',
      role: 'user',
      text: turn.cleaned,
      timestamp: Date.now(),
    } as any)

    const rows = useIntegrationStore.getState().conversationHistory.filter((e) => e.role === 'user')
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe(cleanForSpeech(turn.cleaned))
    expect(normalizeVoiceCommandText(rows[0].text).endsWith(normalizeVoiceCommandText(turn.question))).toBe(true)
  })
})
