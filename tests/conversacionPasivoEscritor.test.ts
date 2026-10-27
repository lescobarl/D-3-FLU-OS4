// @vitest-environment node
/**
 * SUPERFICIE PASIVA del módulo CONVERSACIÓN — el escritor de la fila del
 * usuario en modo wake (sin conversación activa).
 *
 * Sustituye al escritor retirado (`conversationTurnRow`): un solo escritor de
 * la fila del usuario para los dos modos, con la etiqueta decidida por el
 * dueño del módulo (`resolverEtiqueta`) y la regla «es fragmento» (P9.67)
 * propiedad del módulo.
 *
 * La vista es una falsa en memoria (dependencia aislada, §0.7); las UTILIDADES
 * son las REALES del proyecto (las mismas que cablea `adapters.ts`), para que
 * el flujo central se ejercite con los dueños vivos.
 *
 * AISLAMIENTO ÚNICO declarado: `integrationStore`. Importar las utilidades
 * reales arrastra `echoPolicy → integrationStore → fachada → listenParity →
 * conversationStream → ingressGuards` (borrado en la retirada de la tubería
 * vieja; se sustituye en el paso (c)). El escritor no toca el store: aquí la
 * vista es la falsa. El mock corta SOLO ese nodo; ningún caso del escritor
 * llega a ejecutarlo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/store/integrationStore.ts', () => ({
  useIntegrationStore: {
    getState: () => ({ conversationHistory: [] as unknown[], conversationEpoch: 1 }),
  },
}))

import { crearEscritorFilaUsuario, crearResolucionPasiva, escribeFilaDeUsuario } from '../src/voice/conversation/pasivo'
import type {
  EntradaCompromisoUsuario,
  FilaVistaUsuario,
  NuevaEntradaVista,
  PuertoVistaFilas,
  UtilidadesFila,
} from '../src/voice/conversation/ports'
import { canonicalSpeakerName, isProperSpeakerName, pendingSpeakerLabel } from '../src/voice/lib/speakerLabels.js'
import {
  autoSpeakerIndexFromKey,
  autoSpeakerLabel,
  compareCosineSignatures,
  getFallbackSpeaker,
  isAutoSpeakerLabel,
} from '../src/voice/lib/speakerCore.js'
import { labelToSpeakerId, normalizeRowSignature, speakerIdToDefaultName } from '../src/voice/lib/conversationRow.js'
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

/** Config del módulo con los dueños reales: sin literales dispersos. */
const config = {
  esEtiquetaAnonima: (etiqueta: string) => isAutoSpeakerLabel(etiqueta),
  semillaEtiqueta: () => getFallbackSpeaker(),
}

/** Vista falsa en memoria: registra las acciones para poder verificarlas. */
function crearVista() {
  let filas: FilaVistaUsuario[] = []
  let highWater = 0
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
    anotarHighWater: (n) => {
      if (n > highWater) highWater = n
    },
    epoch: () => 1,
  }
  return {
    vista,
    filas: () => filas,
    highWater: () => highWater,
    acciones: () => acciones,
    sembrar: (nuevas: readonly FilaVistaUsuario[]) => {
      filas = nuevas.map((f) => ({ ...f }))
    },
  }
}

let contador = 0
/** Escritor fresco por test: estado de turno aislado, reloj determinista. */
function crearEscritor() {
  const v = crearVista()
  const eventos: Array<{ contexto: string; detalles: unknown[] }> = []
  const escritor = crearEscritorFilaUsuario({
    vista: v.vista,
    utilidades,
    config,
    id: { uuid: () => `uuid-${(contador += 1)}` },
    reloj: { ahora: () => 1000 },
    registro: { registrar: (contexto, ...detalles) => eventos.push({ contexto, detalles }) },
  })
  return { escritor, vista: v, eventos }
}

/** Entrada mínima de compromiso con los datos del test por encima. */
const entrada = (sobre: Partial<EntradaCompromisoUsuario> = {}): EntradaCompromisoUsuario => ({
  text: 'hola mundo',
  turnId: 'turno-1',
  ...sobre,
})

/** Fila de usuario sembrada en la vista (datos de test, no del dominio). */
const filaUsuario = (id: string, sobre: Partial<FilaVistaUsuario> = {}): FilaVistaUsuario => ({
  id,
  role: 'user',
  text: 'hola',
  epoch: 1,
  ...sobre,
})

describe('escribeFilaDeUsuario — decisión pura de escritura', () => {
  it('un SERVICIO (effectOnly) no escribe la fila', () => {
    expect(escribeFilaDeUsuario({ effectOnly: true }, { hayTexto: true, hablable: true })).toBe(false)
  })

  it('el COMMIT TEMPRANO (userCommitOnly) no escribe la fila', () => {
    expect(escribeFilaDeUsuario({ userCommitOnly: true }, { hayTexto: true, hablable: true })).toBe(false)
  })

  it('rawOnly sin hablable no escribe la fila', () => {
    expect(escribeFilaDeUsuario({ rawOnly: true }, { hayTexto: true, hablable: false })).toBe(false)
  })

  it('rawOnly con hablable escribe la fila', () => {
    expect(escribeFilaDeUsuario({ rawOnly: true }, { hayTexto: true, hablable: true })).toBe(true)
  })

  it('sin texto no escribe la fila', () => {
    expect(escribeFilaDeUsuario({}, { hayTexto: false, hablable: true })).toBe(false)
  })

  it('sin payload y con texto escribe la fila', () => {
    expect(escribeFilaDeUsuario(null, { hayTexto: true })).toBe(true)
  })
})

describe('crearEscritorFilaUsuario — fila del usuario pasiva', () => {
  it('agrega la fila con el nombre propio canónico y la identidad del turno', () => {
    const { escritor, vista } = crearEscritor()
    const resultado = escritor.commitUserTurnRow(entrada({ speakerName: 'luis' }))

    expect(resultado.action).toBe('added')
    const fila = vista.filas()[0]
    expect(fila.speakerName).toBe('Luis')
    expect(fila.turnId).toBe('turno-1')
    expect(fila.speakerId).toBe(voiceKeyFor({ voiceId: labelToSpeakerId('luis'), signature: null }))
    expect(fila.timestamp).toBe(1000)
  })

  it('sin identidad la fila nace SIN rótulo (regla A3: el respaldo no se estampa)', () => {
    const { escritor, vista } = crearEscritor()
    escritor.commitUserTurnRow(entrada({ speakerName: '' }))

    const fila = vista.filas()[0]
    expect(fila.speakerName).toBeUndefined()
    expect(fila.speakerPending).toBeUndefined()
    expect(fila.speakerId).toBe(voiceKeyFor({ voiceId: labelToSpeakerId(getFallbackSpeaker()), signature: null }))
  })

  it('la etiqueta pendiente deja la fila marcada para completarse', () => {
    const { escritor, vista } = crearEscritor()
    escritor.commitUserTurnRow(entrada({ speakerName: pendingSpeakerLabel() }))

    const fila = vista.filas()[0]
    expect(fila.speakerPending).toBe(true)
    expect(fila.speakerName).toBe(pendingSpeakerLabel())
  })

  it('anota el HIGH-WATER de la clave automática (nunca baja)', () => {
    const { escritor, vista } = crearEscritor()
    escritor.commitUserTurnRow(entrada({ speakerName: autoSpeakerLabel(2) }))

    expect(vista.highWater()).toBe(2)
  })

  it('el timestamp del llamador se respeta', () => {
    const { escritor, vista } = crearEscritor()
    escritor.commitUserTurnRow(entrada({ timestamp: 42 }))

    expect(vista.filas()[0].timestamp).toBe(42)
  })

  it('la ventana de audio inválida no viaja a la fila', () => {
    const { escritor, vista } = crearEscritor()
    escritor.commitUserTurnRow(entrada({ turnWindow: { inicio: 30, fin: 10 } }))

    expect(vista.filas()[0].turnWindow).toBeUndefined()
  })

  it('replaceLast reutiliza la fila del MISMO turno y fija la voz y el nombre', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([filaUsuario('r-1', { turnId: 'turno-1' })])
    const resultado = escritor.commitUserTurnRow(entrada({ replaceLast: true, speakerName: 'luis' }))

    expect(resultado).toEqual({ id: 'r-1', action: 'reused' })
    expect(vista.filas()).toHaveLength(1)
    expect(vista.acciones()).toContain('speaker')
    expect(vista.acciones()).toContain('name')
    expect(vista.filas()[0].speakerName).toBe('Luis')
  })

  it('replaceLast NO reutiliza la fila de OTRO turno', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([filaUsuario('r-1', { turnId: 'otro-turno' })])
    const resultado = escritor.commitUserTurnRow(entrada({ replaceLast: true }))

    expect(resultado.action).toBe('added')
    expect(vista.filas()).toHaveLength(2)
  })

  it('replaceLast SIN identidad de turno no reutiliza la fila', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([filaUsuario('r-1', { turnId: null })])
    const resultado = escritor.commitUserTurnRow(entrada({ replaceLast: true, turnId: null }))

    expect(resultado.action).toBe('added')
    expect(vista.filas()).toHaveLength(2)
  })

  it('el MISMO turno se reutiliza sin replaceLast (commit temprano + resolución)', () => {
    const { escritor, vista } = crearEscritor()
    escritor.commitUserTurnRow(entrada({ text: 'hola', turnId: 'turno-1' }))
    const resultado = escritor.commitUserTurnRow(entrada({ text: 'hola', turnId: 'turno-1' }))

    expect(resultado.action).toBe('reused')
    expect(vista.filas()).toHaveLength(1)
  })

  it('P9.67 recorte: el trozo posterior del ASR reutiliza la fila del turno', () => {
    const { escritor, vista } = crearEscritor()
    // FLU ya respondió: la fila queda atrás de `turnStart` y manda la rama del
    // fragmento (dueño del módulo), no el bucle de reuso.
    vista.sembrar([
      filaUsuario('r-1', { turnId: 'turno-1', text: 'quiero comer pollo hoy' }),
      filaUsuario('f-1', { role: 'flu', text: 'aquí tienes' }),
    ])
    const resultado = escritor.commitUserTurnRow(
      entrada({ text: 'comer pollo', replaceLast: true, turnId: 'turno-1' }),
    )

    expect(resultado).toEqual({ id: 'r-1', action: 'reused' })
    expect(vista.filas()).toHaveLength(2)
    expect(vista.acciones()).not.toContain('complete')
    expect(vista.filas()[0].text).toBe('quiero comer pollo hoy')
  })

  it('P9.67 crecimiento: la fila trozo se COMPLETA con la frase entera', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([
      filaUsuario('r-1', { turnId: 'turno-1', text: 'comer pollo' }),
      filaUsuario('f-1', { role: 'flu', text: 'aquí tienes' }),
    ])
    const resultado = escritor.commitUserTurnRow(
      entrada({ text: 'quiero comer pollo hoy', replaceLast: true, turnId: 'turno-1' }),
    )

    expect(resultado).toEqual({ id: 'r-1', action: 'replaced' })
    expect(vista.acciones()).toContain('complete')
    expect(vista.filas()[0].text).toBe('quiero comer pollo hoy')
  })

  it('P9.67 no aplica: una frase nueva NO reutiliza la fila del turno', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([
      filaUsuario('r-1', { turnId: 'turno-1', text: 'quiero comer pollo' }),
      filaUsuario('f-1', { role: 'flu', text: 'aquí tienes' }),
    ])
    const resultado = escritor.commitUserTurnRow(
      entrada({ text: 'hola buenos días', replaceLast: true, turnId: 'turno-1' }),
    )

    expect(resultado.action).toBe('added')
    expect(vista.filas()).toHaveLength(3)
  })

  it('write-once: un nombre propio congelado no se degrada ni se reescribe', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([
      filaUsuario('r-1', { turnId: 'turno-1', speakerId: 'speaker_name_Luis', speakerName: 'Luis' }),
    ])
    const resultado = escritor.commitUserTurnRow(
      entrada({ replaceLast: true, turnId: 'turno-1', speakerName: autoSpeakerLabel(2) }),
    )

    expect(resultado).toEqual({ id: 'r-1', action: 'reused' })
    expect(vista.acciones()).not.toContain('speaker')
    expect(vista.acciones()).not.toContain('name')
    expect(vista.filas()[0].speakerName).toBe('Luis')
  })

  it('continuidad: la etiqueta anónima nueva NO pisa la del mismo epoch', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([filaUsuario('r-1', { epoch: 1, speakerName: autoSpeakerLabel(3) })])
    escritor.commitUserTurnRow(entrada({ speakerName: autoSpeakerLabel(2) }))

    expect(vista.filas()[1].speakerName).toBe(autoSpeakerLabel(3))
  })

  it('sin fila anterior, la etiqueta anónima se muestra tal cual', () => {
    const { escritor, vista } = crearEscritor()
    escritor.commitUserTurnRow(entrada({ speakerName: autoSpeakerLabel(2) }))

    expect(vista.filas()[0].speakerName).toBe(autoSpeakerLabel(2))
  })

  it('registra el compromiso con su contexto', () => {
    const { escritor, eventos } = crearEscritor()
    escritor.commitUserTurnRow(entrada({ speakerName: 'luis' }))

    expect(eventos).toHaveLength(1)
    expect(eventos[0].contexto).toBe('conversacion.pasivo.fila')
    expect(eventos[0].detalles[0]).toMatchObject({ action: 'added' })
  })
})

describe('renameRowSpeakerName — corrección de una fila concreta', () => {
  it('fija el nombre canónico de la fila de usuario', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([filaUsuario('r-1')])

    expect(escritor.renameRowSpeakerName('r-1', 'luis')).toBe(true)
    expect(vista.filas()[0].speakerName).toBe('Luis')
  })

  it('no toca una fila inexistente', () => {
    const { escritor } = crearEscritor()
    expect(escritor.renameRowSpeakerName('no-existe', 'luis')).toBe(false)
  })

  it('no toca una fila de FLU', () => {
    const { escritor, vista } = crearEscritor()
    vista.sembrar([filaUsuario('r-1', { role: 'flu' })])

    expect(escritor.renameRowSpeakerName('r-1', 'luis')).toBe(false)
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

  /** Memoria de sesión del caso: se resetea por test. */
  let memoria: { ultimoVozId: string; ultimoVector: readonly number[] | null; contador: number }
  beforeEach(() => {
    memoria = { ultimoVozId: '', ultimoVector: null, contador: 0 }
  })

  /** Resuelve la voz `1 | 2` avanzando la memoria como lo hace la sesión. */
  const resolver = async (voz: 1 | 2) => {
    const resultado = await resolutor({
      muestras: new Float32Array([voz, 0.5, 0.5, 0.5]),
      sampleRate: 16000,
      ultimoVozId: memoria.ultimoVozId,
      ultimoVector: memoria.ultimoVector,
      contadorVoces: memoria.contador,
    })
    memoria.ultimoVozId = resultado.vozId
    memoria.ultimoVector = resultado.evidencia ? [voz, 0] : null
    if (resultado.evidencia && !resultado.continuidad) memoria.contador += 1
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

  it('la MISMA voz sigue a la anterior (continuidad, sin etiqueta nueva)', async () => {
    await resolver(1)
    const misma = await resolver(1)

    expect(misma.continuidad).toBe(true)
    expect(misma.hablante).toBe('')
    expect(misma.vozId).toBe(memoria.ultimoVozId)
  })

  it('SIN EVIDENCIA (medida nula) no hay voz ni rótulo', async () => {
    const sin = await resolutor({
      muestras: new Float32Array(0),
      sampleRate: 16000,
      ultimoVozId: memoria.ultimoVozId,
      ultimoVector: memoria.ultimoVector,
      contadorVoces: memoria.contador,
    })

    expect(sin.evidencia).toBe(false)
    expect(sin.vozId).toBe('')
    expect(sin.hablante).toBe('')
  })

  it('flujo completo: dos voces → dos filas etiquetadas; sin evidencia → Hablante N al mostrar', async () => {
    const { escritor, vista } = crearEscritor()
    const primera = await resolver(1)
    const segunda = await resolver(2)

    escritor.commitUserTurnRow(
      entrada({
        text: 'hola',
        turnId: 't-1',
        speakerName: primera.hablante,
        evidenciaAcustica: primera.evidencia,
      }),
    )
    escritor.commitUserTurnRow(
      entrada({
        text: 'otra voz',
        turnId: 't-2',
        speakerName: segunda.hablante,
        evidenciaAcustica: segunda.evidencia,
      }),
    )
    expect(vista.filas()).toHaveLength(2)
    expect(vista.filas()[0].speakerName).toBe(autoSpeakerLabel(1))
    expect(vista.filas()[1].speakerName).toBe(autoSpeakerLabel(2))

    // Sin medida: la fila nace SIN rótulo (regla A3) y su VOZ la muestra como
    // «Hablante N» (dueño de la etiqueta por defecto).
    escritor.commitUserTurnRow(entrada({ text: 'sin voz', turnId: 't-3', speakerName: '' }))
    const filaSin = vista.filas()[2]
    expect(filaSin.speakerName).toBeUndefined()
    expect(speakerIdToDefaultName(String(filaSin.speakerId ?? ''))).toBe(autoSpeakerLabel(1))
  })
})
