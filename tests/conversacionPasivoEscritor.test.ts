// @vitest-environment node
/**
 * SUPERFICIE PASIVA del módulo CONVERSACIÓN (tras el corte 2026-10-30).
 *
 * El escritor pasivo de la fila del usuario (`commitUserTurnRow` +
 * `crearEscritorFilaUsuario`) quedó RETIRADO (problema 6: era una ruta doble);
 * la fila la escribe SOLO el módulo (`row.committed`, puerta de abajo) en
 * AMBOS modos. Este guard mide las DOS superficies pasivas que sobreviven:
 *  - el RENOMBRE de una fila concreta por su id (`renombrarFilaDeUsuario`):
 *    la única corrección de rótulo fuera del módulo (consumidor vivo:
 *    `useParticipants`). No escribe filas: solo fija el nombre;
 *  - la RESOLUCIÓN pasiva del hablante (`crearResolucionPasiva`): medida +
 *    `decidirIdentidad` — el MISMO dueño que usan ingesta y cierre. El
 *    resultado alimenta el contrato de resolución del turno, nunca una fila.
 *
 * La vista es una falsa en memoria (dependencia aislada, §0.7); las UTILIDADES
 * son las REALES del proyecto (las mismas que cablea `adapters.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/store/integrationStore.ts', () => ({
  useIntegrationStore: {
    getState: () => ({ conversationHistory: [] as unknown[], conversationEpoch: 1 }),
  },
}))

import {
  crearResolucionPasiva,
  renombrarFilaDeUsuario,
} from '../src/voice/conversation/pasivo'
import type {
  FilaVistaUsuario,
  PuertoVistaFilas,
  UtilidadesFila,
} from '../src/voice/conversation/ports'
import { canonicalSpeakerName } from '../src/voice/lib/speakerLabels.js'
import { autoSpeakerLabel, compareCosineSignatures } from '../src/voice/lib/speakerCore.js'

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

describe('crearResolucionPasiva — identidad nativa por puerto (decisión A)', () => {
  /**
   * Embebedor falso: la voz la decide la PRIMERA muestra (A=[1,0], B=[0,1]),
   * y el coseno es el REAL del dueño (`speakerCore.compareCosineSignatures`).
   * Sin muestras no hay medida (silencio).
   */
  const embebedor = {
    medir: async (muestras: Float32Array): Promise<readonly number[] | null> => {
      if (muestras.length === 0) return null
      if (muestras[0] === 1) return [1, 0]
      if (muestras[0] === 2) return [0, 1]
      return null
    },
    comparar: (a: readonly number[], b: readonly number[]) =>
      compareCosineSignatures([...a], [...b]),
  }
  let uuid = 0
  const resolutor = crearResolucionPasiva({
    embebedor,
    config: {
      umbralContinuidadVoz: () => 0.85,
      etiquetaAnonima: (n) => autoSpeakerLabel(n),
    },
    id: { uuid: () => `voz-${(uuid += 1)}` },
    registro: { registrar: () => {} },
  })

  /** Memoria de sesión del caso: se resetea por test (patrón del hook). */
  let memoria: {
    plantillas: Array<{ vozId: string; vector: readonly number[]; etiqueta: string }>
    contador: number
  }
  beforeEach(() => {
    memoria = { plantillas: [], contador: 0 }
  })

  /** Resuelve la voz `1 | 2` avanzando la memoria como lo hace la sesión. */
  const resolver = async (voz: 1 | 2) => {
    const resultado = await resolutor({
      muestras: new Float32Array([voz, 0.5, 0.5, 0.5]),
      sampleRate: 16000,
      plantillas: memoria.plantillas,
      contadorVoces: memoria.contador,
    })
    if (!resultado.evidencia) return resultado
    const previa = memoria.plantillas.find((p) => p.vozId === resultado.vozId)
    if (previa) {
      if (resultado.vector) previa.vector = resultado.vector
      if (resultado.hablante) previa.etiqueta = resultado.hablante
    } else {
      memoria.plantillas.push({
        vozId: resultado.vozId,
        vector: resultado.vector ?? [],
        etiqueta: resultado.hablante,
      })
      memoria.contador += 1
    }
    return resultado
  }

  it('DOS VOCES distintas acuñan DOS etiquetas distintas', async () => {
    const primera = await resolver(1)
    const segunda = await resolver(2)

    expect(primera.evidencia).toBe(true)
    expect(primera.continuidad).toBe(false)
    expect(primera.hablante).toBe(autoSpeakerLabel(1))
    expect(segunda.hablante).toBe(autoSpeakerLabel(2))
    expect(primera.vozId).not.toBe(segunda.vozId)
  })

  it('la MISMA voz sigue a la anterior (continuidad, con la etiqueta de SU plantilla)', async () => {
    const primera = await resolver(1)
    const misma = await resolver(1)

    expect(misma.continuidad).toBe(true)
    expect(misma.hablante, 'la plantilla casada devuelve SU etiqueta').toBe(autoSpeakerLabel(1))
    expect(misma.vozId).toBe(primera.vozId)
  })

  it('A→B→A: la voz A recupera SU etiqueta (la plantilla de sesion, no la ultima)', async () => {
    const primera = await resolver(1)
    await resolver(2)
    const vuelveA = await resolver(1)

    expect(vuelveA.continuidad).toBe(true)
    expect(vuelveA.hablante).toBe(autoSpeakerLabel(1))
    expect(vuelveA.vozId).toBe(primera.vozId)
  })

  it('SIN EVIDENCIA (medida nula) no hay voz ni rótulo', async () => {
    const sin = await resolutor({
      muestras: new Float32Array(0),
      sampleRate: 16000,
      plantillas: memoria.plantillas,
      contadorVoces: memoria.contador,
    })

    expect(sin.evidencia).toBe(false)
    expect(sin.vozId).toBe('')
    expect(sin.hablante).toBe('')
  })
})
