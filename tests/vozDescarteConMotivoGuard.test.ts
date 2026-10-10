// ============================================================
// vozDescarteConMotivoGuard - B1: un unico dueno del descarte de locuciones, y TODO
// descarte emite su motivo.
// ------------------------------------------------------------
// MEDIDO (2026-10-10): los descartes del pipeline del stream estaban repartidos y la
// mayoria eran SILENCIOSOS (`return` / `return false`), con un `fluDebugHot('stream-skip')`
// de DESARROLLO como unico rastro (invisible en produccion): el preview que encogia y la
// re-entrega del mismo turno. El guard anti-alucinacion emitia su motivo por su cuenta.
//
// REGLA B1: todo descarte pasa por `discardLocution` (dueno unico), que SIEMPRE emite
// `motivo=` + `site=` y devuelve el valor de descarte; un motivo fuera del vocabulario se
// registra como `unknown` (nunca en silencio).
// ============================================================
import { describe, expect, it, vi } from 'vitest'
import {
  DISCARD_REASONS,
  discardLocution,
  isKnownDiscardReason,
} from '../src/voice/lib/phraseDiscard.js'

describe('B1 - un dueno del descarte y todo descarte con motivo', () => {
  it('cada descarte emite UN registro con motivo y sitio', () => {
    for (const reason of Object.values(DISCARD_REASONS)) {
      const log = vi.fn()
      const out = discardLocution({ reason, phrase: 'hola que tal', site: 'stream', log })
      expect(out, 'el descarte devuelve el valor de descarte').toBe('')
      expect(log).toHaveBeenCalledTimes(1)
      const message = String(log.mock.calls[0][2] || '')
      expect(message).toContain(`motivo=${reason}`)
      expect(message).toContain('site=stream')
      expect(message).toContain('hola que tal')
    }
  })

  it('un motivo FUERA del vocabulario NO se descarta en silencio (se registra unknown)', () => {
    const log = vi.fn()
    discardLocution({ reason: 'porque-si', phrase: 'algo', site: 'x', log })
    const message = String(log.mock.calls[0][2] || '')
    expect(message).toContain(`motivo=${DISCARD_REASONS.UNKNOWN}`)
    expect(message).toContain('no declarado')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): el vocabulario discrimina', () => {
    expect(isKnownDiscardReason(DISCARD_REASONS.DUPLICATE_COMMIT)).toBe(true)
    expect(isKnownDiscardReason('')).toBe(false)
    expect(isKnownDiscardReason('lo-que-sea')).toBe(false)
    // Sin relay inyectado no hay excepcion: el descarte sigue devolviendo el valor de descarte.
    expect(discardLocution({ reason: DISCARD_REASONS.EMPTY })).toBe('')
  })

  it('el vocabulario es CERRADO (sin motivos duplicados) y cubre los puntos del pipeline', () => {
    const values = Object.values(DISCARD_REASONS)
    expect(new Set(values).size).toBe(values.length)
    for (const clave of ['DUPLICATE_COMMIT', 'SHRINK_PREVIEW', 'AMBIENT_BLOCKED', 'EMPTY', 'NONWORD']) {
      expect(values).toContain((DISCARD_REASONS as Record<string, string>)[clave])
    }
  })
})
