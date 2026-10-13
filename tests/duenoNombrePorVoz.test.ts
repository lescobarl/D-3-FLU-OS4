// ============================================================
// duenoNombrePorVoz - El NOMBRE de una voz sale SOLO de su VOZ.
// ------------------------------------------------------------
// Mandato del dueno (2026-10-13):
//   - "si dos personas suenan parecido, no adivines: Hablante N";
//   - el nombre de una voz sale SOLO de su VOZ (el vector), no de la etiqueta ni del
//     participante activo;
//   - el vector vive en UN solo lugar y es comparable entre reuniones (el modelo que lo
//     genera no puede cambiar en silencio);
//   - UN solo dueno del nombre.
// NACE ROJO: hoy el nombre se liga a la ETIQUETA (alias) y se reescribe en las filas.
// ============================================================
import { afterEach, describe, expect, it } from 'vitest'
import {
  registerVoiceName,
  resolveVoiceName,
  matchDirectoryVoice,
  resetVoiceDirectory,
  voiceVectorModel,
} from '../src/voice/lib/speakerDirectory.js'

const VOZ_LUIS = [0.9, 0.4, 0.05, 0.0]
const VOZ_PARECIDA = [0.0, 0.05, 0.3, 0.95]

afterEach(() => resetVoiceDirectory())

describe('N1 - el nombre se resuelve por la VOZ (su id), no por la etiqueta', () => {
  it('la voz registrada lleva su nombre; otra voz NO lo hereda', () => {
    registerVoiceName('speaker_2', 'Luis', { vector: VOZ_LUIS })
    expect(resolveVoiceName('speaker_2'), 'la voz que lo dijo').toBe('Luis')
    expect(resolveVoiceName('speaker_3'), 'otra voz: nada').toBe('')
  })

  it('sin nombre registrado no se adivina: la voz queda como Hablante N', () => {
    expect(resolveVoiceName('speaker_1')).toBe('')
  })

  it('el emparejamiento es por VECTOR: una voz parecida (bajo el piso) no empareja', () => {
    registerVoiceName('speaker_2', 'Luis', { vector: VOZ_LUIS })
    expect(matchDirectoryVoice(VOZ_LUIS), 'el mismo timbre').toBe('speaker_2')
    expect(matchDirectoryVoice(VOZ_PARECIDA), 'timbre distinto: no se adivina').toBe(null)
  })
})

// Prueba de DETECTOR: la marca discrimina (el detector no es decorativo).
describe('PRUEBA DE DETECTOR (el detector no es decorativo: la marca discrimina)', () => {
  it('mutacion: con el piso a 1.0 nada empareja; con el piso real, el mismo timbre SI', () => {
    registerVoiceName('speaker_2', 'Luis', { vector: VOZ_LUIS })
    expect(matchDirectoryVoice(VOZ_LUIS, { floor: 1.5 }), 'el piso mandando').toBe(null)
    expect(matchDirectoryVoice(VOZ_LUIS), 'y con el piso real SI').toBe('speaker_2')
  })
})

describe('N1b - el vector no se compara en silencio entre MODELOS distintos', () => {
  it('un vector de OTRO modelo no empareja (se declara el modelo)', () => {
    const modelo = voiceVectorModel()
    expect(modelo, 'el modelo que genera el vector tiene que estar declarado').toBeTruthy()
    registerVoiceName('speaker_2', 'Luis', { vector: VOZ_LUIS })
    expect(matchDirectoryVoice(VOZ_LUIS, { model: 'otro-modelo-que-no-existe' })).toBe(null)
    expect(matchDirectoryVoice(VOZ_LUIS, { model: modelo })).toBe('speaker_2')
  })
})
