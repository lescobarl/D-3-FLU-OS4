/**
 * Guard de la respuesta DIFERIDA del nombre propio.
 *
 * El nombre canónico (“ok flu soy Luis”) sigue siendo válido, pero la respuesta
 * no sale en el acto: el cableado del motor arma un temporizador y lo cancela si
 * llega otra frase (“regístrame en la conversación”). El defer vive en
 * `conversationMotorProducto.js`, dueño del cableado; el hook solo despacha.
 *
 * Este guard impide que vuelva el helper duplicado en el hook y que el test del
 * resolver pasivo retirado reaparezca.
 *
 * @revisor CREAR NUEVO — guard de forma del defer; sin lógica de producto nueva.
 */
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()
const COMPOSE = readFileSync(
  join(RAIZ, 'src/voice/compose/conversationMotorProducto.js'),
  'utf8',
)
const HOOK = readFileSync(
  join(RAIZ, 'src/voice/hooks/useFluVoiceAssistant.js'),
  'utf8',
)
const CONFIG = readFileSync(join(RAIZ, 'src/voice/lib/fluConfig.js'), 'utf8')
const PASSIVE_TEST = join(
  RAIZ,
  'tests/passiveSpeakerCanonicalRoute.test.tsx',
)

describe('nombre propio — respuesta diferida', () => {
  it('el defer vive en el cableado del motor, no en el hook', () => {
    expect(COMPOSE).toContain('nameCommandDeferTimer')
    expect(COMPOSE).toContain('nameCommandDeferPayload')
    expect(COMPOSE).toContain('detectWakeIntroducedName')
    expect(COMPOSE).toContain('splitTranscriptAtWakeWord')
    expect(COMPOSE).toContain('esSoloWake')
    expect(COMPOSE).toContain('FLU_CONFIG.timing.nameCommandDeferMs')
    expect(COMPOSE).toContain('onFraseCanonica(payload.frase, payload.opciones)')
    expect(HOOK).not.toContain('nameCommandDeferTimerRef')
    expect(HOOK).not.toContain('nameCommandDeferPayloadRef')
    expect(CONFIG).toContain('nameCommandDeferMs')
  })

  it('la espera es positiva y el cierre limpia el temporizador', () => {
    expect(CONFIG).toMatch(/nameCommandDeferMs:\s*[1-9]\d*/)
    expect(COMPOSE).toContain('if (nameCommandDeferTimer) clearTimeout(nameCommandDeferTimer)')
  })

  it('no queda el test muerto del resolver pasivo retirado', () => {
    // El hook actual solo espeja fila.firma/row.committed; el resolver pasivo
    // del test viejo se retiró y no está en GUARD_FILES.
    expect(existsSync(PASSIVE_TEST)).toBe(false)
  })
})
