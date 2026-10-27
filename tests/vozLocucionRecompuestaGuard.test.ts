// @vitest-environment node
// ============================================================
// vozLocucionRecompuestaGuard - B4: la locucion se RECOMPONE antes de commitear; ningun
// fragmento entra cortado.
// ------------------------------------------------------------
// MEDIDO (2026-10-10, con las funciones reales):
//   reconcileCommitText('a comer del', 'vamos a comer del plato') -> 'a comer del'
// El ASR cierra el turno con un TROZO de la locucion (corte a mitad de frase) y el commit
// escribia ESE trozo, aunque lo ultimo mostrado y el texto validado del turno tuvieran la
// locucion COMPLETA: la fila quedaba cortada ("a comer del").
//
// CORTE 2026-10-26: los duenos viejos (`recomposeLocution`/`reconcileCommitText`,
// turnStream.js, y `resolveTurnCommitPhrase`, turnCommitPhrase.js — islas de la tuberia
// retirada) se borran con ella. El dueno VIVO de «ningun fragmento entra cortado» es el
// escritor del modulo nuevo: `commitUserTurnRow` (src/voice/conversation) reutiliza la
// fila del turno para un trozo (regla P9.67, rama del fragmento) y la COMPLETA solo
// cuando el texto crece. El caso del texto VALIDADO por separado se retira: la dualidad
// capture/fallback no existe en el modulo (una sola frase canonica, invariante 3).
// ============================================================
import { describe, expect, it, vi } from 'vitest'

// Aislamiento unico declarado (mismo que tests/conversacionPasivoEscritor.test.ts):
// las utilidades reales arrastran echoPolicy -> integrationStore -> fachada ->
// listenParity -> conversationStream (borrado en la retirada); el escritor no toca
// el store, asi que el mock corta SOLO ese nodo.
vi.mock('../src/store/integrationStore.ts', () => ({
  useIntegrationStore: {
    getState: () => ({ conversationHistory: [] as unknown[], conversationEpoch: 1 }),
  },
}))

import { crearEscritorFilaUsuario } from '../src/voice/conversation'
import type {
  EntradaCompromisoUsuario,
  FilaVistaUsuario,
  NuevaEntradaVista,
  PuertoVistaFilas,
  UtilidadesFila,
} from '../src/voice/conversation/ports'
import { canonicalSpeakerName, isProperSpeakerName, pendingSpeakerLabel } from '../src/voice/lib/speakerLabels.js'
import { autoSpeakerIndexFromKey, getFallbackSpeaker, isAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { labelToSpeakerId, normalizeRowSignature } from '../src/voice/lib/conversationRow.js'
import { cleanForSpeech } from '../src/lib/textUtils'
import { speechWords, stripDiacritics } from '../src/voice/lib/audioMath.js'
import { voiceKeyFor } from '../src/voice/lib/speakerDirectory.js'

/** Utilidades REALES del proyecto: el mismo cableado que `adapters.ts` (sin el store). */
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

/** Vista falsa en memoria: registra las acciones para poder verificarlas. */
function crearVista() {
  let filas: FilaVistaUsuario[] = []
  const acciones: string[] = []
  const vista: PuertoVistaFilas = {
    leerHistorial: () => filas,
    agregarEntrada: (entrada: NuevaEntradaVista) => {
      filas = [...filas, entrada]
      acciones.push('add')
    },
    completarFragmento: (id, texto) => {
      filas = filas.map((f) => (f.id === id ? { ...f, text: texto } : f))
      acciones.push('complete')
    },
    fijarAltavoz: (id, vozId, opciones) => {
      filas = filas.map((f) =>
        f.id === id
          ? { ...f, speakerId: vozId, ...(opciones?.firma ? { signature: [...opciones.firma] } : {}) }
          : f,
      )
      acciones.push('speaker')
    },
    fijarNombre: (id, nombre) => {
      filas = filas.map((f) => (f.id === id ? { ...f, speakerName: nombre } : f))
      acciones.push('name')
    },
    anotarHighWater: () => {},
    epoch: () => 1,
  }
  return {
    vista,
    filas: () => filas,
    acciones: () => acciones,
    sembrar: (nuevas: readonly FilaVistaUsuario[]) => {
      filas = nuevas.map((f) => ({ ...f }))
    },
  }
}

/** Escritor fresco por caso: estado de turno aislado, reloj determinista. */
function crearEscritor() {
  const v = crearVista()
  const escritor = crearEscritorFilaUsuario({
    vista: v.vista,
    utilidades,
    config,
    id: { uuid: () => 'uuid-test' },
    reloj: { ahora: () => 1000 },
    registro: { registrar: () => {} },
  })
  return { escritor, vista: v }
}

const filaUsuario = (id: string, sobre: Partial<FilaVistaUsuario> = {}): FilaVistaUsuario => ({
  id,
  role: 'user',
  text: 'hola',
  epoch: 1,
  ...sobre,
})

/** FLU ya respondio: la fila queda atras de `turnStart` y manda la rama del fragmento (P9.67). */
const filaFlu = (id: string, text: string): FilaVistaUsuario => ({ id, role: 'flu', text, epoch: 1 })

/** Compromiso tardio del MISMO turno con el texto por encima. */
const entrada = (texto: string): EntradaCompromisoUsuario => ({
  text: texto,
  turnId: 'turno-1',
  replaceLast: true,
})

describe('B4 - ningun fragmento entra cortado', () => {
  it('el trozo central reutiliza la fila y NO degrada la locucion completa', () => {
    for (const trozo of ['a comer del', 'del plato', 'plato']) {
      const { escritor, vista } = crearEscritor()
      vista.sembrar([
        filaUsuario('r-1', { turnId: 'turno-1', text: 'vamos a comer del plato' }),
        filaFlu('f-1', 'aqui tienes'),
      ])
      const resultado = escritor.commitUserTurnRow(entrada(trozo))

      expect(resultado.action).toBe('reused')
      expect(vista.filas()).toHaveLength(2)
      expect(vista.filas()[0].text).toBe('vamos a comer del plato')
    }
  })

  it('la locucion completa NUNCA se degrada con un trozo: la fila trozo se COMPLETA', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([
      filaUsuario('r-1', { turnId: 'turno-1', text: 'a comer del' }),
      filaFlu('f-1', 'aqui tienes'),
    ])
    const resultado = escritor.commitUserTurnRow(entrada('vamos a comer del plato'))

    expect(resultado.action).toBe('replaced')
    expect(vista.acciones()).toContain('complete')
    expect(vista.filas()[0].text).toBe('vamos a comer del plato')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): un texto NUEVO no se sustituye', () => {
    // El fragmento solo cuenta si es CONTIGUO y en orden dentro de la locucion:
    // 'plato del' invierte el orden y 'comer plato' salta 'del'. Si alguien
    // cambiara contiguidad por subsecuencia, estos casos se pondrian rojos.
    for (const otro of ['pon la alarma', 'plato del', 'comer plato']) {
      const { escritor, vista } = crearEscritor()
      vista.sembrar([
        filaUsuario('r-1', { turnId: 'turno-1', text: 'vamos a comer del plato' }),
        filaFlu('f-1', 'aqui tienes'),
      ])
      const resultado = escritor.commitUserTurnRow(entrada(otro))

      expect(resultado.action).toBe('added')
      expect(vista.filas()).toHaveLength(3)
    }
  })
})
