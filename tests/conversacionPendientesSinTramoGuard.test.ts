// @vitest-environment node
/**
 * COLA DE PENDIENTES — el texto SIN TRAMO espera el tramo que lo continúa.
 * Dueño de la regla: `crearPendientes` (cola.ts).
 *
 * Defecto medido (playback 2026-10-31): tras una pausa que el VAD no segmentó,
 * el final del enunciado llegó SIN tramo y su continuación llegó CON tramo. El
 * retén fusionaba dos textos sin tramo como revisión con `tramoId` vacío (lo
 * que la regla 3 prohíbe) y dejaba la continuación bloqueada detrás del
 * parcial hasta expirar.
 *
 * FALSIFICACIÓN (tres mutaciones): si se quitara la guarda de «sin tramo», el
 * primer caso lanza al pedir `decidirRevision` sin tramo; si se quitara la
 * adopción, el segundo caso conserva DOS entradas; si la adopción no midiera la
 * relación, el tercer caso adoptaría un texto ajeno.
 */
import { describe, expect, it } from 'vitest'
import { crearPendientes } from '../src/voice/conversation/cola.ts'
import { CONVERSACION_CONFIG } from '../src/voice/conversation/ports.ts'
import type { EntradaPendiente } from '../src/voice/conversation/tipos.ts'

const PARCIAL = 'voy a poner a la mujer hablar para que no digan que'
const FINAL = 'voy a poner a la mujer hablar para que no digan que no hago mi tarea'

/** Entrada del retén con los campos obligatorios y el cambio pedido. */
function entrada(cambios: Partial<EntradaPendiente>): EntradaPendiente {
  return {
    tramoId: '',
    texto: '',
    final: true,
    idioma: 'es',
    turnId: 'turno-1',
    voz: {},
    recibidoAt: 0,
    ...cambios,
  }
}

/** Retén real con reloj fijo (la expiración no participa de estos casos). */
function crear() {
  return crearPendientes({
    reloj: { ahora: () => 0 },
    orphanBufferMs: 8000,
    silenceCloseMs: CONVERSACION_CONFIG.silenceCloseMs,
    contarDescarte: () => {},
  })
}

describe('cola de pendientes — el texto sin tramo espera el tramo que lo continúa', () => {
  it('dos textos SIN tramo no se fusionan: cada uno espera su audio', () => {
    const pendientes = crear()
    pendientes.encolar(entrada({ texto: 'duplicados' }))
    pendientes.encolar(entrada({ texto: 'otra frase' }))
    expect(pendientes.primero()?.texto).toBe('duplicados')
    pendientes.quitarPrimero()
    expect(pendientes.primero()?.texto).toBe('otra frase')
  })

  it('el texto con tramo que CONTINÚA adopta el pendiente sin tramo', () => {
    const pendientes = crear()
    pendientes.encolar(entrada({ texto: PARCIAL }))
    pendientes.encolar(entrada({ tramoId: 'tramo-del-final', texto: FINAL }))
    expect(pendientes.primero()).toMatchObject({ tramoId: 'tramo-del-final', texto: FINAL })
    pendientes.quitarPrimero()
    expect(pendientes.primero()).toBeNull()
  })

  it('el texto con tramo que NO continúa no adopta: el pendiente sin tramo se conserva', () => {
    const pendientes = crear()
    pendientes.encolar(entrada({ texto: 'hola' }))
    pendientes.encolar(entrada({ tramoId: 'tramo-ajeno', texto: 'la otra vez hablante x' }))
    expect(pendientes.primero()).toMatchObject({ tramoId: '', texto: 'hola' })
    pendientes.quitarPrimero()
    expect(pendientes.primero()).toMatchObject({ tramoId: 'tramo-ajeno' })
  })
})
