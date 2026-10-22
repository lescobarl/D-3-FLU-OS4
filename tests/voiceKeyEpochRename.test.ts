// @vitest-environment node
// ============================================================
// voiceKeyEpochRename - "soy Luis" renombra TODA la voz; el numero no se reutiliza
// ------------------------------------------------------------
// DEFECTOS que fija (2026-10-21):
//   1. el renombre de la CLAVE primaria exigia PISO DE FIRMA: las filas de esa misma
//      voz sin medida (o con medida debil) se quedaban en "Hablante 1";
//   2. el numero de hablante se reutilizaba: al renombrar/borrar/podar, la siguiente
//      voz nueva volvia a "Hablante 1";
//   3. el renombre no distinguia epoch: una conversacion anterior podia reescribirse.
//
// El epoch y el high-water son DATOS de la sesion (store); el renombre por clave y el
// siguiente numero tienen UN solo dueno.
// ============================================================
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow, renameVoiceRowsByKey } from '../src/voice/lib/conversationTurnRow'
import { registerSpeakerIdentity } from '../src/voice/lib/speakerIdentityRegister'
import { nextAutoSpeakerLabel, sessionSpeakerHighWater } from '../src/voice/lib/speakerCore.js'
import { pruneGhostSpeakerClusters } from '../src/voice/lib/speakerLabels.js'

const ROOT = process.cwd()
const V = (semilla: number) => {
  const v = new Array(16).fill(0)
  v[semilla % 16] = 1
  return v
}

const store = () => useIntegrationStore.getState()

function resetStore() {
  useIntegrationStore.setState({
    conversationHistory: [],
    conversationEpoch: 0,
    speakerHighWater: 0,
  })
}

/** Fila de usuario por la PUERTA UNICA (sella epoch y high-water). */
function fila(text: string, speakerName: string, signature: number[] | null = null, turnId: number | string = text) {
  return commitUserTurnRow({ text, speakerName, signature, turnId })
}

/** Fila insertada a mano (simula filas restauradas/legacy de un epoch concreto). */
function filaDirecta(id: string, speakerId: string, speakerName: string, epoch: number, signature?: number[]) {
  store().addConversationEntry({
    id,
    role: 'user',
    text: `texto ${id}`,
    timestamp: 1,
    speakerId,
    speakerName,
    epoch,
    ...(signature ? { signature } : {}),
  })
}

const nombres = (speakerId?: string) =>
  store()
    .conversationHistory.filter((e) => e.role === 'user' && (!speakerId || e.speakerId === speakerId))
    .map((e) => String(e.speakerName || ''))

beforeEach(() => {
  resetStore()
})

describe('renombre por CLAVE (sin piso de firma) y por epoch', () => {
  it('1. filas de speaker_1 con y sin firma del epoch actual: TODAS "Luis"', () => {
    fila('hola uno', 'Hablante 1', V(1))
    fila('hola dos', 'Hablante 1') // sin medida
    const resultado = registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })

    expect(resultado.rowsChanged).toBeGreaterThanOrEqual(2)
    expect(nombres('speaker_1')).toEqual(['Luis', 'Luis'])
  })

  it('2. las filas de speaker_2 NO se tocan', () => {
    fila('hola uno', 'Hablante 1')
    fila('hola otro', 'Hablante 2')
    registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })

    expect(nombres('speaker_1')).toEqual(['Luis'])
    expect(nombres('speaker_2')).toEqual(['Hablante 2'])
  })

  it('3. una fila con OTRO nombre propio no se pisa (write-once entre identidades)', () => {
    fila('hola uno', 'Hablante 1')
    filaDirecta('r-ana', 'speaker_1', 'Ana', 0)
    registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })

    expect(nombres('speaker_1')).toEqual(['Luis', 'Ana'])
  })

  it(
    '9. firma CLARAMENTE de otra voz: la clave NO la renombra (proteccion mujer)',
    () => {
      // Fila ANONIMA de `speaker_1` cuya FIRMA no casa con la voz que dice ser Luis. El piso
      // de "voz distinta" (`differentVoiceFloor`, config) separa las dos bandas medidas.
      const vozDeLuis = V(1)
      filaDirecta('r-luis', 'speaker_1', 'Hablante 1', 0, vozDeLuis)
      // La MISMA clave con la firma de otra persona (turno mezclado / diarizacion): es
      // exactamente el caso "la mujer sale Luis".
      filaDirecta('r-ajena', 'speaker_1', 'Hablante 1', 0, V(6))
      registerSpeakerIdentity({
        name: 'Luis',
        clusters: [],
        previousLabel: 'Hablante 1',
        signatureVector: vozDeLuis,
      })

      const porId = (id: string) =>
        String(store().conversationHistory.find((e) => e.id === id)?.speakerName || '')
      expect(porId('r-ajena'), 'una firma de OTRA voz no se renombra por clave').toBe('Hablante 1')
      expect(nombres('speaker_1')).toContain('Luis')
    },
  )

  it('10. firma COMPATIBLE con la voz: si se renombra (no se bloquea lo legitimo)', () => {
    const vozDeLuis = V(1)
    filaDirecta('r-compatible', 'speaker_1', 'Hablante 1', 0, vozDeLuis)
    registerSpeakerIdentity({
      name: 'Luis',
      clusters: [],
      previousLabel: 'Hablante 1',
      signatureVector: vozDeLuis,
    })

    const porId = (id: string) =>
      String(store().conversationHistory.find((e) => e.id === id)?.speakerName || '')
    expect(porId('r-compatible')).toBe('Luis')
  })

  it('4. una fila de OTRO epoch no se toca', () => {
    fila('actual', 'Hablante 1')
    filaDirecta('r-vieja', 'speaker_1', 'Hablante 1', 99)
    registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })

    expect(nombres('speaker_1')).toEqual(['Luis', 'Hablante 1'])
    expect(store().conversationHistory.find((e) => e.id === 'r-vieja')?.speakerName).toBe('Hablante 1')
  })

  it('5. voz PARTIDA (speaker_1 + speaker_3, misma firma): ambas "Luis"', () => {
    const firma = V(2)
    const primera = fila('parte uno', 'Hablante 1', firma)
    // Fila de la MISMA voz con otra clave: se escribe a mano (la diarizacion la partio).
    filaDirecta('r-3', 'speaker_3', 'Hablante 3', 0, firma)
    const clusters = [
      { label: 'Hablante 1', signature: firma, signatureHistory: [firma] },
      { label: 'Hablante 3', signature: firma, signatureHistory: [firma] },
    ]

    registerSpeakerIdentity({ name: 'Luis', clusters, previousLabel: 'Hablante 1', signatureVector: firma })

    const porId = (id: string | null) => String(store().conversationHistory.find((e) => e.id === id)?.speakerName || '')
    expect(porId(primera.id)).toBe('Luis')
    expect(porId('r-3')).toBe('Luis')
  })

  it('6. tras renombrar speaker_1, la voz NUEVA es "Hablante 2" (max+1)', () => {
    fila('hola uno', 'Hablante 1')
    expect(store().speakerHighWater).toBe(1)
    registerSpeakerIdentity({ name: 'Luis', clusters: [], previousLabel: 'Hablante 1' })

    expect(nextAutoSpeakerLabel([], [], { highWater: store().speakerHighWater })).toBe('Hablante 2')
  })

  it('7. tras borrar el "Hablante N" mas alto, la nueva sigue en N+1 (no reutiliza)', () => {
    fila('uno', 'Hablante 1')
    fila('dos', 'Hablante 2')
    expect(store().speakerHighWater).toBe(2)

    // Borrar la fila del 2 y podar los clusters fantasma NO bajan el high-water.
    useIntegrationStore.setState({
      conversationHistory: store().conversationHistory.filter((e) => e.speakerId !== 'speaker_2'),
    })
    const podados = pruneGhostSpeakerClusters(
      [
        { label: 'Hablante 1' },
        { label: 'Hablante 2' },
      ],
      ['Hablante 1'],
      { keepLabels: [] },
    )
    expect(podados.map((c) => c.label)).toEqual(['Hablante 1'])
    expect(store().speakerHighWater).toBe(2)

    expect(nextAutoSpeakerLabel(podados, [], { highWater: store().speakerHighWater })).toBe('Hablante 3')
  })

  it('8. clave MIXTA: una firma contraria impide renombrar filas sin evidencia', () => {
    fila('firma voz', 'Hablante 1', V(1))
    fila('firma ajena', 'Hablante 1', V(2))
    fila('sin firma', 'Hablante 1')
    const changed = renameVoiceRowsByKey('speaker_1', 'Luis', {
      signatures: [V(1)],
      floor: 0.66,
    })
    expect(changed).toBe(1)
    // Las filas protegidas quedan SIN nombre congelado (la UI resuelve su etiqueta);
    // lo importante es que NO se les pegue el nombre del titular.
    expect(nombres('speaker_1')).toEqual(['Luis', '', ''])
  })

  it('9. reset de epoch reinicia el high-water pero NO toca las filas viejas', () => {
    fila('uno', 'Hablante 1')
    fila('dos', 'Hablante 2')
    expect(store().speakerHighWater).toBe(2)

    // Filas restauradas de la conversacion anterior (epoch 0) que siguen visibles.
    const viejas = store().conversationHistory.map((e) => ({ ...e }))
    store().resetConversationHistory()
    expect(store().conversationEpoch).toBe(1)
    expect(store().speakerHighWater).toBe(0)
    useIntegrationStore.setState({ conversationHistory: viejas })

    // El epoch nuevo numera desde cero (las filas viejas no cuentan)...
    expect(sessionSpeakerHighWater({ rows: viejas, epoch: store().conversationEpoch })).toBe(0)
    expect(nextAutoSpeakerLabel([], [], { highWater: store().speakerHighWater })).toBe('Hablante 1')

    // ...y el renombre del epoch actual no reescribe las viejas.
    filaDirecta('r-nueva', 'speaker_1', 'Hablante 1', 1)
    expect(renameVoiceRowsByKey('speaker_1', 'Luis')).toBe(1)
    expect(viejas.every((e) => e.speakerName !== 'Luis')).toBe(true)
    expect(store().conversationHistory.find((e) => e.id === 'r-nueva')?.speakerName).toBe('Luis')
  })
})

// ------------------------------------------------------------------
// GUARDS de fuente (dueno unico)
// ------------------------------------------------------------------
describe('guards: un solo dueno del renombre, del high-water y del nombre', () => {
  const leer = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
  /** Codigo sin comentarios: el mapa retirado se NOMBRA en la documentacion a proposito. */
  const codigo = (rel: string) =>
    leer(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  it('el renombre por clave se escribe UNA vez (conversationTurnRow) y lo llama el registro', () => {
    const src = leer('src/voice/lib/conversationTurnRow.ts')
    expect((src.match(/export function renameVoiceRowsByKey/g) || []).length).toBe(1)
    const registro = leer('src/voice/lib/speakerIdentityRegister.js')
    expect(registro).toContain('renameVoiceRowsByKey(voiceId, clean, { signatures')
    // No hay segundo writer de nombres en el registro: delega en el dueno.
    expect(registro).not.toContain('setEntrySpeakerName')
  })

  it('setEntrySpeakerName solo lo llama el dueno de las filas', () => {
    const src = leer('src/voice/lib/conversationTurnRow.ts')
    const llamadas = (src.match(/\.setEntrySpeakerName\(/g) || []).length
    expect(llamadas).toBeGreaterThan(0)
    for (const rel of [
      'src/voice/lib/speakerIdentityRegister.js',
      'src/voice/lib/speakerDiarization.js',
      'src/voice/lib/turnSpeakerCommit.js',
    ]) {
      expect(leer(rel), `${rel} no puede escribir nombres de fila`).not.toContain('setEntrySpeakerName')
    }
  })

  it('el siguiente numero tiene UN dueno (nextAutoSpeakerLabel) y no un segundo contador', () => {
    const core = leer('src/voice/lib/speakerCore.js')
    expect((core.match(/export function nextAutoSpeakerLabel/g) || []).length).toBe(1)
    expect((core.match(/export function sessionSpeakerHighWater/g) || []).length).toBe(1)
    const labels = leer('src/voice/lib/speakerLabels.js')
    // Consumidor declarado: conserva la firma historica y DELEGA (no reimplementa).
    expect((labels.match(/export function next\w*SpeakerLabel/g) || []).length).toBe(1)
    expect(labels).toContain('nextAutoSpeakerLabel(clusters, extraLabels')
    const diarizacion = leer('src/voice/lib/speakerDiarization.js')
    expect(diarizacion, 'la diarizacion no puede acunar etiquetas').not.toMatch(/export function next\w*SpeakerLabel/)
  })

  it('no hay mapa global etiqueta->nombre (el nombre vive en la VOZ/fila)', () => {
    for (const rel of [
      'src/voice/lib/conversationTurnRow.ts',
      'src/voice/lib/speakerIdentityRegister.js',
      'src/voice/lib/speakerLabels.js',
      'src/voice/lib/speakerCore.js',
    ]) {
      expect(codigo(rel)).not.toMatch(/speakerAliases|labelToName|nameByLabel/)
    }
  })
})
