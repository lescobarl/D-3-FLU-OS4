// @vitest-environment node
/**
 * SUPERFICIE PASIVA del módulo CONVERSACIÓN (tras el corte 2026-10-30).
 *
 * El escritor pasivo de la fila del usuario (`commitUserTurnRow` +
 * `crearEscritorFilaUsuario`) quedó RETIRADO (problema 6: era una ruta doble);
 * la fila la escribe SOLO el módulo (`row.committed`, puerta de abajo) en
 * AMBOS modos. El RESOLUTOR pasivo (`crearResolucionPasiva`) también quedó
 * RETIRADO: la voz la mide el módulo al cerrar y la publica en `row.committed`.
 *
 * Aquí solo sobrevive el RENOMBRE de una fila concreta por su id
 * (`renombrarFilaDeUsuario`): la única corrección de rótulo fuera del módulo
 * (consumidor vivo: `useParticipants`). No escribe filas: solo fija el nombre.
 *
 * La vista es una falsa en memoria (dependencia aislada, §0.7); las UTILIDADES
 * son las REALES del proyecto (las mismas que cablea `adapters.ts`).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/store/integrationStore.ts', () => ({
  useIntegrationStore: {
    getState: () => ({ conversationHistory: [] as unknown[], conversationEpoch: 1 }),
  },
}))

import { renombrarFilaDeUsuario } from '../src/voice/conversation/pasivo'
import type {
  FilaVistaUsuario,
  PuertoVistaFilas,
  UtilidadesFila,
} from '../src/voice/conversation/ports'
import { canonicalSpeakerName } from '../src/voice/lib/speakerLabels.js'

/** Utilidades REALES del proyecto: el mismo cableado que `adapters.ts` (sin el store). */
const utilidades: UtilidadesFila = {
  canonica: (nombre) => canonicalSpeakerName(nombre),
}

/** Vista falsa en memoria: solo la lectura y el renombre que la superficie usa. */
function crearVista() {
  let filas: FilaVistaUsuario[] = []
  const vista: PuertoVistaFilas = {
    leerHistorial: () => filas,
    fijarNombre: (id, nombre) => {
      filas = filas.map((f) => (f.id === id ? { ...f, speakerName: nombre } : f))
    },
  }
  return {
    vista,
    filas: () => filas,
    sembrar: (nuevas: readonly FilaVistaUsuario[]) => {
      filas = nuevas.map((f) => ({ ...f }))
    },
  }
}

/** Fila de usuario sembrada en la vista (datos de test, no del dominio). */
const filaUsuario = (id: string, sobre: Partial<FilaVistaUsuario> = {}): FilaVistaUsuario => ({
  id,
  role: 'user',
  text: 'hola',
  epoch: 1,
  ...sobre,
})

describe('renombrarFilaDeUsuario — corrección de una fila concreta', () => {
  it('fija el nombre canónico de la fila de usuario', () => {
    const v = crearVista()
    v.sembrar([filaUsuario('r-1')])

    expect(renombrarFilaDeUsuario('r-1', 'luis', { vista: v.vista, utilidades })).toBe(true)
    expect(v.filas()[0].speakerName).toBe('Luis')
  })

  it('no toca una fila inexistente', () => {
    const v = crearVista()

    expect(renombrarFilaDeUsuario('no-existe', 'luis', { vista: v.vista, utilidades })).toBe(false)
  })

  it('no toca una fila de FLU', () => {
    const v = crearVista()
    v.sembrar([filaUsuario('r-1', { role: 'flu' })])

    expect(renombrarFilaDeUsuario('r-1', 'luis', { vista: v.vista, utilidades })).toBe(false)
  })

  it('un nombre vacío no fija nada', () => {
    const v = crearVista()
    v.sembrar([filaUsuario('r-1')])

    expect(renombrarFilaDeUsuario('r-1', '  ', { vista: v.vista, utilidades })).toBe(false)
    expect(v.filas()[0].speakerName).toBeUndefined()
  })
})
