// ============================================================
// vozRegistroNombreUnicoGuard - A1: el REGISTRO del nombre propio tiene UN dueno
// ------------------------------------------------------------
// DEFECTO MEDIDO (2026-10-10): el registro de un nombre propio para la voz activa
// estaba implementado DOS veces:
//   - src/voice/hooks/useFluVoiceAssistant.js:1472 (resolucion tardia)
//   - src/voice/lib/turnSpeakerCommit.js:217     (ruta `wake-intro` del commit)
// y el comando `REGISTRAR_PARTICIPANTE` (producido en src/voice/lib/audioMath.js:946
// con el nombre introducido) NO tenia consumidor: `handleNavigationCommand` no traia
// caso para el, asi que decia "Registrado {name}." sin registrar NADA. Dos rutas para
// el mismo responsable y la del comando muerta.
//
// DUENO UNICO: `registerSpeakerIdentity` (src/voice/lib/speakerIdentityRegister.js)
// = alias de sesion + renombrado de las filas de la MISMA voz. Lo llaman las dos
// rutas: el commit (`applyResolvedSpeakerToSessionRefs`, fuente wake-intro) y el
// comando (`registerSpeakerIdentityFromCommand`).
//
// PRUEBA DE DETECTOR (el detector no es decorativo): el guard EJECUTA las dos rutas
// sobre un store sembrado (no cuenta nombres) y
// exige el MISMO resultado: una etiqueta automatica de la MISMA voz pasa al nombre
// propio, y la de OTRA voz no se toca.
// ============================================================
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { walkFiles } from './_helpers'
import { useIntegrationStore } from '../src/store/integrationStore'
import { renameSpeakerRows } from '../src/voice/lib/conversationTurnRow'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'
import {
  registerSpeakerIdentity,
  registerSpeakerIdentityFromCommand,
} from '../src/voice/lib/speakerIdentityRegister.js'
import { applyResolvedSpeakerToSessionRefs } from '../src/voice/lib/turnSpeakerCommit.js'

/** Vector con coseno EXACTO `c` respecto a la base [1,0,0]. */
function v(c: number): number[] {
  return [c, Math.sqrt(Math.max(0, 1 - c * c)), 0]
}
const ANCLA = [1, 0, 0]
const MISMA_VOZ = 0.70 // techo medido de la banda de la misma voz
// VOZ DISTINTA REAL: ortogonal a [1,0,0] y a v(0.70) (coseno 0). `v(0.58)` NO servia como "otra
// voz": su coseno con `v(0.70)` es 0.987 (la MISMA voz re-clusterizada), asi que el cosido por FIRMA
// la unia con razon. La voz distinta se modela ortogonal.
const OTRA_VOZ_VEC = [0, 0, 1] // ortogonal a [1,0,0] Y a v(0.70)
const CLUSTERS = [
  { label: 'Luz', signature: ANCLA },
  { label: 'Hablante 1', signature: v(MISMA_VOZ) },
  { label: 'Hablante 2', signature: OTRA_VOZ_VEC },
]

/**
 * Store con tres filas de usuario: la voz de 'Hablante 1' y una voz distinta.
 * FORMA REAL de la fila (mandato 2026-10-13): guarda su VOZ (`speakerId`), no el nombre.
 * 'Hablante 1' -> speaker_1, 'Hablante 2' -> speaker_2.
 */
function seedRows() {
  useIntegrationStore.setState({
    conversationHistory: [
      { id: 'r1', role: 'user', text: 'hola', speakerName: 'Hablante 1', speakerId: 'speaker_1', timestamp: '10:00' },
      { id: 'r2', role: 'user', text: 'que tal', speakerName: 'Hablante 2', speakerId: 'speaker_2', timestamp: '10:01' },
      { id: 'r3', role: 'user', text: 'bueno', speakerName: 'Hablante 1', speakerId: 'speaker_1', timestamp: '10:02' },
    ] as any,
  })
}

/** Etiqueta VISIBLE de cada fila: se resuelve AL MOSTRAR por la VOZ (`speakerId`). */
function speakerRows(): string[] {
  return useIntegrationStore
    .getState()
    .conversationHistory.filter((e) => e.role === 'user')
    .map((e) => resolveRowSpeakerLabel(e))
}

// Aislamiento: el DIRECTORIO de nombres por VOZ (estado de sesion) se vacia entre casos.
beforeEach(() => resetVoiceDirectory())

describe('A1 - un solo dueno del registro del nombre propio', () => {
  beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [] })
  })

  it('registrar el nombre pasa AL NOMBRE las filas de la MISMA voz y deja la voz distinta', () => {
    seedRows()
    const result = registerSpeakerIdentity({
      name: 'Luz',
      clusters: CLUSTERS,
      previousLabel: 'Hablante 1',
    })
    expect(result.registered).toBe(true)
    // El nombre se resuelve AL MOSTRAR por la VOZ: las filas de speaker_1 salen 'Luz'.
    expect(speakerRows()).toEqual(['Luz', 'Hablante 2', 'Luz'])
    // Mandato 2026-10-13: el registro NO reescribe filas (vive en el DIRECTORIO por VOZ).
    expect(result.rowsChanged).toBe(0)
  })

  it('RUTA DEL COMANDO: REGISTRAR_PARTICIPANTE registra el nombre (antes no registraba nada)', () => {
    seedRows()
    const result = registerSpeakerIdentityFromCommand({
      transcript: 'okay flu soy Luz',
      speakerName: 'Hablante 1',
    })
    expect(result.registered).toBe(true)
    expect(speakerRows()).toEqual(['Luz', 'Hablante 2', 'Luz'])
    // El nombre REGISTRADO pertenece a la VOZ que lo dijo: su etiqueta provisional se
    // resuelve al nombre por VOZ (mandato 2026-10-13). Una VOZ SIN registro se muestra con
    // su etiqueta canonica ('Hablante N').
    expect(resolveRowSpeakerLabel({ speakerId: 'speaker_1' })).toBe('Luz')
    expect(resolveRowSpeakerLabel({ speakerId: 'speaker_3' })).toBe('Hablante 3')
  })

  it('MISMA RUTA: comando y wake-intro dejan el store identico para la misma voz', () => {
    seedRows()
    applyResolvedSpeakerToSessionRefs(
      { speakerName: 'Luz', source: 'wake-intro', previousLabel: 'Hablante 1' } as any,
      {
        renameSpeakerRows,
        speakerClustersRef: { current: CLUSTERS },
        sessionPrimarySpeakerRef: { current: '' },
      } as any,
    )
    const porCommit = speakerRows()

    seedRows()
    registerSpeakerIdentityFromCommand({ transcript: 'okay flu soy Luz', speakerName: 'Hablante 1' })
    const porComando = speakerRows()

    expect(porComando).toEqual(porCommit)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): sin nombre propio no se registra ni se toca una fila', () => {
    seedRows()
    const sinNombre = registerSpeakerIdentity({ name: 'Hablante 3', clusters: CLUSTERS })
    expect(sinNombre.registered).toBe(false)
    expect(sinNombre.rowsChanged).toBe(0)
    expect(speakerRows()).toEqual(['Hablante 1', 'Hablante 2', 'Hablante 1'])

    const sinWake = registerSpeakerIdentityFromCommand({
      transcript: 'buenos dias a todos',
      speakerName: 'Hablante 1',
    })
    expect(sinWake.registered).toBe(false)
    expect(speakerRows()).toEqual(['Hablante 1', 'Hablante 2', 'Hablante 1'])
  })

  it('PRUEBA DE DETECTOR: una etiqueta que NO es esa voz no se renombra', () => {
    seedRows()
    useIntegrationStore.setState({
      conversationHistory: [
        ...useIntegrationStore.getState().conversationHistory,
        { id: 'r4', role: 'user', text: 'otro', speakerName: 'Hablante 9', speakerId: 'speaker_9', timestamp: '10:03' },
      ] as any,
    })
    registerSpeakerIdentity({ name: 'Luz', clusters: CLUSTERS, previousLabel: 'Hablante 1' })
    // 'Hablante 2' (otra voz) y 'Hablante 9' (sin cluster) quedan como estaban.
    expect(speakerRows()).toEqual(['Luz', 'Hablante 2', 'Luz', 'Hablante 9'])
  })
})

// ============================================================
// A1 (huecos 1 y 2) - el registro COMPLETO por las DOS rutas:
//   hueco 1: la ruta del comando no recibia los clusters -> no cosia 'Hablante 3'/'4'
//            (la MISMA voz re-clusterizada), asi que esas filas seguian con etiqueta.
//   hueco 2: el dueno no fijaba el hablante PRIMARIO con fuente 'presented' -> los
//            turnos siguientes seguian cayendo a 'Hablante N' (el sembrado del panel,
//            de rango menor, mandaba).
// ============================================================
const CLUSTERS_VOZ_UNICA = [
  { label: 'Luz', signature: ANCLA },
  { label: 'Hablante 1', signature: v(0.70) },
  { label: 'Hablante 3', signature: v(0.71) },
  { label: 'Hablante 4', signature: v(0.69) },
  { label: 'Hablante 2', signature: OTRA_VOZ_VEC },
]

function seedFilasDeLaMismaVoz() {
  // FORMA REAL: la MISMA VOZ re-clusterizada ('Hablante 1'/'3'/'4', mismo timbre) lleva UN
  // solo `speakerId` (la clave por TIMBRE, `voiceKeyFor`, los une): por eso las tres filas
  // de esa voz salen con su nombre al registrarlo. 'Hablante 2' es OTRA voz (speaker_2).
  useIntegrationStore.setState({
    conversationHistory: [
      { id: 'r1', role: 'user', text: 'uno', speakerName: 'Hablante 1', speakerId: 'speaker_1', timestamp: '10:00' },
      { id: 'r2', role: 'user', text: 'dos', speakerName: 'Hablante 3', speakerId: 'speaker_1', timestamp: '10:01' },
      { id: 'r3', role: 'user', text: 'tres', speakerName: 'Hablante 4', speakerId: 'speaker_1', timestamp: '10:02' },
      { id: 'r4', role: 'user', text: 'cuatro', speakerName: 'Hablante 2', speakerId: 'speaker_2', timestamp: '10:03' },
    ] as any,
  })
}

describe('A1 hueco 1 - el COMANDO recibe los clusters y cose la MISMA voz', () => {
  it('registrar por el comando pasa al nombre las etiquetas de la MISMA voz (3 y 4)', () => {
    seedFilasDeLaMismaVoz()
    const result = registerSpeakerIdentityFromCommand({
      transcript: 'okay flu soy Luz',
      speakerName: 'Hablante 1',
      clusters: CLUSTERS_VOZ_UNICA,
    })
    expect(result.registered).toBe(true)
    expect(speakerRows()).toEqual(['Luz', 'Luz', 'Luz', 'Hablante 2'])
  })
})

describe('A1 hueco 2 - el registro fija el PRIMARIO como presented', () => {
  it('la ruta del COMMIT fija el primario (presented manda sobre el sembrado del panel)', () => {
    seedRows()
    const sessionPrimarySpeakerRef = { current: 'Luis' } // sembrado por el participante
    applyResolvedSpeakerToSessionRefs(
      { speakerName: 'Luz', source: 'wake-intro', previousLabel: 'Hablante 1' } as any,
      {
        renameSpeakerRows,
        speakerClustersRef: { current: CLUSTERS_VOZ_UNICA },
        sessionPrimarySpeakerRef,
      } as any,
    )
    expect(sessionPrimarySpeakerRef.current).toBe('Luz')
  })

  it('la ruta del COMANDO fija el mismo primario', () => {
    seedRows()
    const sessionPrimarySpeakerRef = { current: 'Luis' }
    registerSpeakerIdentityFromCommand({
      transcript: 'okay flu soy Luz',
      speakerName: 'Hablante 1',
      clusters: CLUSTERS_VOZ_UNICA,
      refs: { sessionPrimarySpeakerRef },
    })
    expect(sessionPrimarySpeakerRef.current).toBe('Luz')
  })

  it('MISMA RUTA: comando y wake-intro dejan el MISMO estado de identidad (filas + primario)', () => {
    seedRows()
    const refCommit = { current: 'Luis' }
    applyResolvedSpeakerToSessionRefs(
      { speakerName: 'Luz', source: 'wake-intro', previousLabel: 'Hablante 1' } as any,
      {
        renameSpeakerRows,
        speakerClustersRef: { current: CLUSTERS_VOZ_UNICA },
        sessionPrimarySpeakerRef: refCommit,
      } as any,
    )
    const estadoCommit = { filas: speakerRows(), primario: refCommit.current }

    seedRows()
    const refComando = { current: 'Luis' }
    registerSpeakerIdentityFromCommand({
      transcript: 'okay flu soy Luz',
      speakerName: 'Hablante 1',
      clusters: CLUSTERS_VOZ_UNICA,
      refs: { sessionPrimarySpeakerRef: refComando },
    })
    expect({ filas: speakerRows(), primario: refComando.current }).toEqual(estadoCommit)
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): con fuente "resolved" el sembrado MANDA', () => {
    seedRows()
    const sessionPrimarySpeakerRef = { current: 'Luis' }
    registerSpeakerIdentity({
      name: 'Luz',
      clusters: CLUSTERS_VOZ_UNICA,
      previousLabel: 'Hablante 1',
      refs: { sessionPrimarySpeakerRef },
      source: 'resolved', // el relleno NO pisa un nombre ya fijado
    })
    expect(sessionPrimarySpeakerRef.current).toBe('Luis')
  })
})

// ============================================================
// IMPLEMENTACIONES, NO LITERALES (AGENTS 7.7.d): el registro tiene UN modulo. Se
// cuenta quien IMPLEMENTA el registro del nombre propio, no quien invoca una funcion
// suelta.
//
// Mandato del dueno 2026-10-13: el nombre de una VOZ sale SOLO de su VOZ (el vector) y
// se resuelve AL MOSTRAR. El registro = RESOLVER el nombre del enunciado
// (`resolveSpeakerNameFromUtterance`) Y pegar ese nombre a LA VOZ por el TIMBRE
// (`voiceKeyFor` + `registerVoiceName`, en el DIRECTORIO `speakerDirectory`).
// ============================================================
const ROOT = process.cwd()
/** Dueno del NOMBRE de una VOZ (directorio por TIMBRE). */
const DEFINICION_VOZ_COMPARTIDA = 'src/voice/lib/speakerDirectory.js'
/** El registro RESUELVE el nombre del enunciado... */
const RESUELVE_NOMBRE_DEL_ENUNCIADO = /resolveSpeakerNameFromUtterance\(/
/** ...Y lo pega a la VOZ por su TIMBRE (`voiceKeyFor`). */
const CLAVE_DE_VOZ_POR_TIMBRE = /voiceKeyFor\(/

/** Modulos que IMPLEMENTAN el registro (resuelven el enunciado y lo ligan a la VOZ). */
export function modulosQueRegistran(fuentes: Record<string, string>): string[] {
  return Object.entries(fuentes)
    .filter(([ruta, texto]) => ruta !== DEFINICION_VOZ_COMPARTIDA
      && RESUELVE_NOMBRE_DEL_ENUNCIADO.test(String(texto))
      && CLAVE_DE_VOZ_POR_TIMBRE.test(String(texto)))
    .map(([ruta]) => ruta)
    .sort()
}

describe('A1 - el registro del nombre vive en UN modulo', () => {
  it('solo el dueno resuelve el nombre del enunciado y lo pega a la VOZ por su TIMBRE', () => {
    const fuentes: Record<string, string> = {}
    for (const abs of walkFiles(join(ROOT, 'src'), /\.(js|ts|tsx)$/)) {
      const ruta = relative(ROOT, abs).replace(/\\/g, '/')
      if (ruta.endsWith('.d.ts')) continue
      fuentes[ruta] = readFileSync(abs, 'utf8')
    }
    expect(modulosQueRegistran(fuentes)).toEqual(['src/voice/lib/speakerIdentityRegister.js'])
  })

  it('PRUEBA DE DETECTOR: una copia inline en otro modulo lo pone ROJO', () => {
    const conCopia = {
      'src/voice/lib/speakerIdentityRegister.js': 'const n = resolveSpeakerNameFromUtterance(t); registerVoiceName(voiceKeyFor({ label, signature }), n)',
      'src/voice/hooks/useFluVoiceAssistant.js': 'const n = resolveSpeakerNameFromUtterance(t); registerVoiceName(voiceKeyFor({ label, signature }), n)',
      [DEFINICION_VOZ_COMPARTIDA]: 'export function voiceKeyFor(...) {}',
    }
    expect(modulosQueRegistran(conCopia)).toEqual([
      'src/voice/hooks/useFluVoiceAssistant.js',
      'src/voice/lib/speakerIdentityRegister.js',
    ])
    expect(modulosQueRegistran({ 'src/a.js': 'soy una copia sin el registro' })).toEqual([])
  })
})
