// ============================================================
// vozAnclaBaseSesionGuard - VOZ CONOCIDA EN LA BASE = NOMBRE INMEDIATO;
// VOZ NUEVA = UN «Hablante N» QUE SE CONSERVA
// ------------------------------------------------------------
// MANDATO DEL DUENO (2026-10-18, validacion en vivo):
//   - "Voz nueva incrementa 1 en hablante(N) y se conserva ese hablante durante toda la
//      sesion, a menos que se ejecute el comando ok flu soy XXX"
//   - "Voz conocida en la base la pone inmediatamente"
//   - "No se estan cambiando las voces, solo una vez"
//
// DEFECTO MEDIDO (log del dueno 2026-10-18): la base de participantes TENIA el vector
// de "Luis" y TODOS sus turnos salian "Hablante 1": la base solo se consultaba al final,
// en el contrato (`resolveVoiceIdentity`), nunca en la decision de diarizacion. Por la
// otra puerta, el renombre por continuidad eliminaba el cluster de la voz que hablaba
// (dos personas, una sola ancla) y el numero de la etiqueta se reciclaba.
//
// ESTE GUARD mide la CADENA REAL: `seedRegisteredAnchors` siembra las anclas MEDIDAS de
// la base en la sesion y `resolveConversationSpeaker` (dueno unico de la decision)
// resuelve cada turno sobre esos clusters. La voz conocida suena con su nombre en su
// PRIMER turno sostenido; la desconocida abre UN «Hablante N» y lo conserva.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ensureClusterForLabel,
  mergeSpeakerClustersOnRename,
  seedRegisteredAnchors,
} from '../src/voice/lib/speakerClusters.js'
import { resolveConversationSpeaker } from '../src/voice/lib/speakerDiarization.js'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister.js'
import { isAutoSpeakerLabel, isProperSpeakerName, reservedSpeakerLabels } from '../src/voice/lib/speakerLabels.js'
import { getFallbackSpeaker, nextAutoSpeakerLabel } from '../src/voice/lib/speakerCore.js'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import { useIntegrationStore } from '../src/store/integrationStore'

const DIM = 64
/** Modelo de embedding vigente: un vector de OTRO modelo no es comparable. */
const MODELO = 'wavlm-sv-base'

/** Vector de una voz: un eje propio (voces ortogonales = coseno 0). */
function eje(indice: number): number[] {
  const vector = new Array(DIM).fill(0)
  vector[indice] = 1
  return vector
}

const VOZ_BASE = eje(0) // la voz registrada en la base de participantes ("Luis")
const VOZ_MUJER = eje(1) // TV / hija: desconocida y acusticamente DISTINTA
const VOZ_TERCERA = eje(2) // otra voz nueva de la sala

const ANCLA_BASE = [{ name: 'Luis', vector: VOZ_BASE, model: MODELO }]

/** Turno SOSTENIDO (2 s de voz, frase larga): la unica ventana que puede afirmar nombre. */
const TURNO_SOSTENIDO = {
  voicedSampleCount: 96000,
  minVoicedSamples: 12000,
  sampleRate: 48000,
  utteranceText: 'esta es una frase sostenida de prueba para medir la voz',
  atTurnBoundary: true,
  allowNewCluster: true,
}

/** Sesion recien sembrada con las anclas de la base (como al arrancar el hook). */
function sembrar(anchors = ANCLA_BASE): any[] {
  return seedRegisteredAnchors([], anchors, { model: MODELO }) || []
}

/** Decisor REAL de identidad, sobre los clusters de la sesion. */
function resolver(
  vector: number[],
  {
    clusters,
    lastSpeaker = '',
    lastSignature = null,
    sessionPrimary = '',
  }: { clusters: any[]; lastSpeaker?: string; lastSignature?: number[] | null; sessionPrimary?: string },
): string {
  return resolveConversationSpeaker({
    ...TURNO_SOSTENIDO,
    signatureVector: vector,
    speakerClusters: clusters,
    lastSpeaker,
    lastSignature,
    sessionPrimary,
  } as never)
}

describe('A - la base de participantes siembra sus anclas en la SESION', () => {
  it('siembra un nombre propio con su vector MEDIDO del mismo modelo', () => {
    const seeded = sembrar()
    expect(seeded.map((cluster) => cluster.label)).toEqual(['Luis'])
    expect(seeded[0].signature).toEqual(VOZ_BASE)
    expect(seeded[0].anchorSource).toBe('participant-base')
  })

  it('NO siembra vectores vacios/degenerados, ni de otro modelo, ni etiquetas que no son personas', () => {
    const anchors = [
      { name: 'Vacio', vector: [], model: MODELO },
      { name: 'Ceros', vector: new Array(DIM).fill(0), model: MODELO },
      { name: 'Otro Modelo', vector: eje(3), model: 'otro-modelo' },
      { name: 'Hablante 7', vector: eje(4), model: MODELO },
      { name: 'FLU', vector: eje(5), model: MODELO },
    ]
    expect(seedRegisteredAnchors([], anchors, { model: MODELO })).toBeNull()
  })

  it('NO siembra un ancla SIN modelo ni una de otro dtype: sin clave no es comparable', () => {
    // MEDIDO 2026-10-18: el ancla "Luis" de la base casaba a 0.44 con su propia voz porque
    // su vector (otro dtype / sin clave) se comparaba como si fuera del espacio vigente.
    expect(seedRegisteredAnchors([], [{ name: 'Luis', vector: VOZ_BASE }], { model: MODELO })).toBeNull()
    expect(
      seedRegisteredAnchors([], [{ name: 'Luis', vector: VOZ_BASE, model: `${MODELO}|q8` }], { model: `${MODELO}|fp32` }),
    ).toBeNull()
  })

  it('la SESION manda: un nombre ya vivo no se reescribe con el vector de la base', () => {
    const vivo = { label: 'Luis', signature: VOZ_MUJER, signatureHistory: [VOZ_MUJER] }
    const out = seedRegisteredAnchors([vivo], ANCLA_BASE, { model: MODELO })
    expect(out, 'sin cambios no hay nueva lista').toBeNull()
    expect(vivo.signature, 'la firma aprendida en vivo se conserva').toEqual(VOZ_MUJER)
  })

  it('es idempotente: sembrar dos veces no duplica el ancla ("solo una vez")', () => {
    const una = sembrar()
    const dos = seedRegisteredAnchors(una, [{ name: 'luis', vector: VOZ_BASE, model: MODELO }], { model: MODELO })
    expect(dos).toBeNull()
    expect(una).toHaveLength(1)
  })
})

describe('B - la escena del dueno: primero habla la TV/mujer, despues el', () => {
  it('la voz desconocida abre UN «Hablante N» y lo conserva; la voz de la base suena con su nombre', () => {
    const clusters = sembrar()
    // 1) La primera voz de la sala NO es la del onboarding (la TV): se bautiza anonima.
    const primera = resolver(VOZ_MUJER, { clusters })
    expect(primera, 'la voz desconocida no hereda el nombre de la base').toBe('Hablante 1')
    expect(clusters).toHaveLength(2)
    // 2) La MISMA voz sigue hablando: conserva SU etiqueta; no se renumera ni se parte.
    const segunda = resolver(VOZ_MUJER, { clusters, lastSpeaker: primera, lastSignature: VOZ_MUJER })
    expect(segunda, 'una voz = una etiqueta estable').toBe('Hablante 1')
    expect(clusters.filter((cluster) => isAutoSpeakerLabel(cluster.label)), 'una voz = un cluster').toHaveLength(1)
    // 3) Ahora habla la voz CONOCIDA de la base: el nombre sale en su primer turno sostenido.
    const tercera = resolver(VOZ_BASE, {
      clusters,
      lastSpeaker: segunda,
      lastSignature: VOZ_MUJER,
      sessionPrimary: 'Luis',
    })
    expect(tercera, 'voz conocida en la base = nombre inmediato').toBe('Luis')
    expect(clusters.map((cluster) => cluster.label).sort(), 'un cluster por voz').toEqual(['Hablante 1', 'Luis'])
    // 4) El turno siguiente de la mujer NO hereda el nombre (voz distinta, medida ortogonal).
    const cuarta = resolver(VOZ_MUJER, {
      clusters,
      lastSpeaker: tercera,
      lastSignature: VOZ_BASE,
      sessionPrimary: 'Luis',
    })
    expect(cuarta, 'la intervencion de otra voz no se mezcla').toBe('Hablante 1')
  })

  it('el nombre de la base no depende de que la sesion ya lo haya fijado como primario', () => {
    expect(resolver(VOZ_BASE, { clusters: sembrar() })).toBe('Luis')
  })

  it('DETECTOR: la voz ortogonal a la base NO toma su nombre y la de la base SI', () => {
    const etiquetaBaseDe = (vector: number[]) => {
      const label = resolver(vector, { clusters: sembrar() })
      return { label, esNombre: isProperSpeakerName(label) }
    }
    expect(etiquetaBaseDe(VOZ_BASE).esNombre, 'entrada legitima: lleva el nombre').toBe(true)
    expect(etiquetaBaseDe(VOZ_MUJER).label, 'entrada infractora: conserva su anonima').toBe('Hablante 1')
    expect(etiquetaBaseDe(VOZ_MUJER).esNombre).toBe(false)
  })
})

describe('C - voz nueva: incrementa 1 UNA vez y se conserva toda la sesion', () => {
  it('la tercera voz abre «Hablante 2» y no se renumera al repetir', () => {
    const clusters = sembrar()
    const tv = resolver(VOZ_MUJER, { clusters })
    const luis = resolver(VOZ_BASE, {
      clusters,
      lastSpeaker: tv,
      lastSignature: VOZ_MUJER,
      sessionPrimary: 'Luis',
    })
    const tercera = resolver(VOZ_TERCERA, {
      clusters,
      lastSpeaker: luis,
      lastSignature: VOZ_BASE,
      sessionPrimary: 'Luis',
    })
    expect(tercera, 'incrementa exactamente 1 sobre el high-water').toBe('Hablante 2')
    const repetida = resolver(VOZ_TERCERA, {
      clusters,
      lastSpeaker: tercera,
      lastSignature: VOZ_TERCERA,
      sessionPrimary: 'Luis',
    })
    expect(repetida, 'la etiqueta se conserva; no se incrementa por turno').toBe('Hablante 2')
    expect(clusters.map((cluster) => cluster.label).sort()).toEqual(['Hablante 1', 'Hablante 2', 'Luis'])
  })
})

describe('D - "ok flu soy XXX" renombra UNA vez y NO recicla numeros', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
    resetVoiceDirectory()
  })

  it('renombrar por comando conserva el indice: la voz siguiente es Hablante 2, no Hablante 1', () => {
    let sesion: any[] = [{ label: 'Hablante 1', signature: [...VOZ_BASE], signatureHistory: [[...VOZ_BASE]] }]
    const registro = registerSpeakerIdentity({
      name: 'Luis',
      previousLabel: 'Hablante 1',
      signatureVector: VOZ_BASE,
      clusters: sesion,
      refs: { setClusters: (next: unknown[]) => { sesion = next as any[] } },
    })
    expect(registro.registered).toBe(true)
    expect(sesion.map((cluster) => cluster.label), 'el cluster de ESA voz pasa al nombre').toEqual(['Luis'])
    expect(sesion[0].autoNumber, 'el indice de la etiqueta sobrevive al renombre').toBe(1)
    // Repetir el comando con otra grafia no crea un segundo cluster ("solo una vez").
    const otraVez = registerSpeakerIdentity({
      name: 'luis',
      previousLabel: 'Hablante 1',
      signatureVector: VOZ_BASE,
      clusters: sesion,
      refs: { setClusters: (next: unknown[]) => { sesion = next as any[] } },
    })
    expect(otraVez.name).toBe('Luis')
    expect(sesion.map((cluster) => cluster.label)).toEqual(['Luis'])
    // La voz SIGUIENTE (distinta) incrementa 1 sobre el high-water: no reusa Hablante 1.
    expect(resolver(VOZ_MUJER, { clusters: sesion })).toBe('Hablante 2')
  })
})

describe('E - el renombre no borra el cluster de OTRA voz (defecto medido 2026-10-18)', () => {
  it('si origen y destino son voces DISTINTAS, los dos clusters sobreviven', () => {
    const clusters = [
      { label: 'Hablante 1', signature: [...VOZ_MUJER] },
      { label: 'Luis', signature: [...VOZ_BASE] },
    ]
    const out = mergeSpeakerClustersOnRename(clusters, 'Hablante 1', 'Luis')
    expect(out.map((cluster) => cluster.label).sort()).toEqual(['Hablante 1', 'Luis'])
  })

  it('si es la MISMA voz, se fusiona y hereda el indice (el numero no se recicla)', () => {
    const clusters = [
      { label: 'Hablante 1', signature: [...VOZ_BASE], signatureHistory: [[...VOZ_BASE]] },
      { label: 'Luis', signature: [...VOZ_BASE], signatureHistory: [[...VOZ_BASE]] },
    ]
    const out = mergeSpeakerClustersOnRename(clusters, 'Hablante 1', 'Luis')
    expect(out.map((cluster) => cluster.label)).toEqual(['Luis'])
    expect(out[0].autoNumber).toBe(1)
  })

  it('sin destino, el cluster renombrado suelta el speakerId de la etiqueta vieja y conserva su numero', () => {
    const clusters = [{ label: 'Hablante 1', signature: [...VOZ_BASE], speakerId: 'speaker_1' }]
    const out = mergeSpeakerClustersOnRename(clusters, 'Hablante 1', 'Luis')
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('Luis')
    expect(out[0].autoNumber).toBe(1)
    expect(out[0].speakerId, 'la clave vieja apuntaria a la etiqueta que ya no existe').toBeUndefined()
  })
})

describe('G - el RESPALDO no reserva numero de hablante', () => {
  it('la primera voz medida abre «Hablante 1» aunque el respaldo este en la vista', () => {
    const reservadas = reservedSpeakerLabels([getFallbackSpeaker(), ''])
    expect(reservadas, 'el respaldo no es una voz').toEqual([])
    expect(nextAutoSpeakerLabel([], reservadas)).toBe('Hablante 1')
  })

  it('las voces REALES de la sesion SI reservan su numero (el high-water no se recicla)', () => {
    expect(nextAutoSpeakerLabel([], reservedSpeakerLabels(['Hablante 1', 'Hablante 2']))).toBe('Hablante 3')
  })
})

describe('F - sin MEDIDA no se abre ancla', () => {
  it('learn:false (continuidad) NO crea cluster aunque la etiqueta no exista', () => {
    const clusters: any[] = []
    expect(ensureClusterForLabel(clusters, 'Hablante 3', VOZ_MUJER, { learn: false })).toBeNull()
    expect(clusters).toHaveLength(0)
  })

  it('ni con learn:true se crea un ancla con vector vacio o degenerado', () => {
    const clusters: any[] = []
    expect(ensureClusterForLabel(clusters, 'Hablante 3', [])).toBeNull()
    expect(ensureClusterForLabel(clusters, 'Hablante 3', new Array(DIM).fill(0))).toBeNull()
    expect(clusters, 'un coseno 0 con todo arrastraria la sala entera').toHaveLength(0)
    // Control positivo: con medida real SI se abre el cluster.
    expect(ensureClusterForLabel(clusters, 'Hablante 3', VOZ_MUJER)?.label).toBe('Hablante 3')
  })
})
