// ============================================================
// duenoUnaSolaVia - UNA sola forma de decidir "¿esta voz ya es alguien?".
// ------------------------------------------------------------
// MANDATO DEL DUENO 2026-10-13 (tercera vuelta):
//   (1) UNA sola via: no puede haber dos caminos que decidan lo mismo por separado (la sesion
//       y la base de participantes no pueden tener cada uno su propia regla).
//   (2) El vector se guarda y se compara SIEMPRE con su MODELO, en la sesion y entre reuniones;
//       si el modelo no coincide NO se compara (nada de comparar en silencio).
//   (3) Si hay DOS candidatos parecidos -> NO se decide: se queda "Hablante N".
// NACE ROJO: hoy la base (`matchParticipantByVoice`) compara vectores SIN modelo y, ante dos
// candidatos parecidos, elige el mejor en vez de callarse.
// ============================================================
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import {
  registerVoiceName,
  resolveVoiceIdentity,
  resetVoiceDirectory,
  voiceVectorModel,
} from '../src/voice/lib/speakerDirectory.js'

const LUIS = [0.9, 0.4, 0.05, 0.0]
const LUIS_PARECIDO = [0.88, 0.44, 0.06, 0.02]
const ANA_PARECIDA = [0.87, 0.45, 0.07, 0.03]
const OTRA = [0.0, 0.05, 0.3, 0.95]

afterEach(() => resetVoiceDirectory())

/** La base como CANDIDATOS de la via unica (el mapeo que hace la app: vector + modelo). */
const porVoz = (
  vector: number[],
  base: Array<{ name?: string; voiceVector?: number[]; voiceVectorModel?: string }>,
) => resolveVoiceIdentity(vector, { candidates: base.map((p) => ({ name: p.name, vector: p.voiceVector, model: p.voiceVectorModel })) })

const participante = (name: string, vector: number[], model: string = voiceVectorModel()) => ({
  name,
  voiceVector: vector,
  voiceVectorModel: model,
})

describe('U1 - el MODELO viaja con el vector: si no coincide, NO se compara', () => {
  it('un participante de la base con OTRO modelo no empareja (nada silencioso)', () => {
    const id = porVoz(LUIS, [participante('Luis', LUIS, 'modelo-viejo-que-ya-no-existe')])
    expect(id, 'vector de otro modelo: NO se compara').toBe(null)
  })

  it('con el MISMO modelo si empareja (el caso bueno)', () => {
    const id = porVoz(LUIS_PARECIDO, [participante('Luis', LUIS)])
    expect(id?.name).toBe('Luis')
  })
})

describe('U2 - dos candidatos parecidos: NO se decide', () => {
  it('dos identidades distintas por encima del piso -> Hablante N (null)', () => {
    const id = porVoz(LUIS_PARECIDO, [participante('Luis', LUIS), participante('Ana', ANA_PARECIDA)])
    expect(id, 'dos candidatos parecidos: no se adivina').toBe(null)
  })

  it('un solo candidato claro si decide', () => {
    const id = porVoz(LUIS_PARECIDO, [participante('Luis', LUIS), participante('Ana', OTRA)])
    expect(id?.name).toBe('Luis')
  })

  it('la MISMA persona en la sesion y en la base no son dos candidatos', () => {
    registerVoiceName('speaker_1', 'Luis', { vector: LUIS, model: voiceVectorModel() })
    const id = porVoz(LUIS_PARECIDO, [participante('Luis', LUIS)])
    expect(id?.name, 'el mismo nombre = un candidato').toBe('Luis')
  })
})

describe('U3 - UNA sola via (un dueno, una regla)', () => {
  it('la sesion y la base se resuelven con la MISMA funcion', () => {
    registerVoiceName('speaker_1', 'Luis', { vector: LUIS, model: voiceVectorModel() })
    const porSesion = resolveVoiceIdentity(LUIS_PARECIDO)
    const porBase = porVoz(LUIS_PARECIDO, [participante('Luis', LUIS)])
    expect(porSesion?.name).toBe('Luis')
    expect(porBase?.name, 'misma respuesta por la misma via').toBe(porSesion?.name)
  })

  it('no existe un SEGUNDO camino que decida identidad por vector', () => {
    // El camino viejo (comparar vectores de la base por su cuenta) tiene que haber desaparecido.
    expect(existsSync('src/voice/lib/participantVoiceMatch.js'), 'segundo camino borrado').toBe(false)
    const dir = readFileSync('src/voice/lib/speakerDirectory.js', 'utf8')
    expect(dir, 'el coseno de identidad vive en el dueno unico').toContain('compareCosineSignatures')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): la marca del modelo discrimina', () => {
    const conOtroModelo = porVoz(LUIS_PRECISO_FIXTURE(), [participante('Luis', LUIS, 'otro')])
    const conElMismo = porVoz(LUIS_PRECISO_FIXTURE(), [participante('Luis', LUIS)])
    expect(conOtroModelo).toBe(null)
    expect(conElMismo?.name).toBe('Luis')
  })
})

function LUIS_PRECISO_FIXTURE() {
  return LUIS
}
