// @vitest-environment jsdom
// ============================================================
// conversacionInsertaNoReescribeGuard - P1/P2/P3 de la especificacion
// (tests/cajaConversacionSim.test.ts: 30 hablantes / 600 filas)
// ------------------------------------------------------------
// MEDIDO hoy: reutilizar la fila del turno reconstruia la conversacion entera
// (`history.map(...)` + `batchLoadHistory`) en CADA emision (3.600 veces / 600 filas) y el texto
// de una fila ya insertada se reescribia al "recomponer" un fragmento.
// REGLA: (P1) el TEXTO de una fila se decide UNA vez (solo se COMPLETA una fila FRAGMENTO);
//        (P2) la VOZ se actualiza DIRIGIDA e idempotente (una entrada, no el array);
//        (P3) la fila se dibuja MEMOIZADA (un insert no redibuja las N filas).
// Este guard mide CONDUCTA (store real) y TEXTO (el escritor de filas no reconstruye).
// ============================================================
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../src/voice/lib/conversationRow', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/voice/lib/conversationRow')>()
  return {
    ...real,
    formatRowClock: vi.fn(real.formatRowClock),
    resolveRowSpeakerLabel: vi.fn(real.resolveRowSpeakerLabel),
  }
})

import { useIntegrationStore } from '../src/store/integrationStore'
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow'
import { formatRowClock, resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow'
import { ConversationLog } from '../src/voice/components/ConversationLog'

const ESCRITOR = 'src/voice/lib/conversationTurnRow.ts'

/** El escritor de filas NO puede reconstruir la conversacion ni reescribir textos. */
export function reconstruyeLaConversacion(fuente: string): string[] {
  return fuente
    .split(/\r?\n/)
    .flatMap((linea, i) =>
      /batchLoadHistory\(|text:\s*completa/.test(linea) ? [`${i + 1}: ${linea.trim()}`] : [],
    )
}

const historial = () => useIntegrationStore.getState().conversationHistory

describe('P2 - la VOZ se actualiza DIRIGIDA e idempotente', () => {
  it('toca UNA entrada (las demas conservan su objeto) y repetirla no hace nada', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    const store = useIntegrationStore.getState()
    store.addConversationEntry({ id: 'a1', role: 'user', text: 'primera', speakerId: 'voz-1', timestamp: 1 })
    store.addConversationEntry({ id: 'a2', role: 'user', text: 'segunda', speakerId: 'voz-2', timestamp: 2 })
    store.addConversationEntry({ id: 'a3', role: 'user', text: 'tercera', speakerId: 'voz-3', timestamp: 3 })
    const [uno, dos, tres] = historial()

    useIntegrationStore.getState().setEntrySpeaker('a2', 'voz-9')
    const despues = historial()
    expect(despues.find((e) => e.id === 'a2')?.speakerId, 'la fila dirigida cambia').toBe('voz-9')
    expect(despues.find((e) => e.id === 'a1'), 'la fila vecina conserva su objeto').toBe(uno)
    expect(despues.find((e) => e.id === 'a3'), 'la otra tambien').toBe(tres)
    expect(dos).not.toBe(despues.find((e) => e.id === 'a2'))

    const antesDeRepetir = historial()
    useIntegrationStore.getState().setEntrySpeaker('a2', 'voz-9')
    expect(historial(), 'idempotente: el mismo valor no toca nada').toBe(antesDeRepetir)
  })

  it('el escritor de filas NO reconstruye la conversacion (texto)', () => {
    const fuente = readFileSync(ESCRITOR, 'utf8')
    expect(reconstruyeLaConversacion(fuente), 'la conversacion no se reconstruye para mover una fila').toEqual([])
  })

  it('control NEGATIVO del detector (no es decorativo)', () => {
    expect(reconstruyeLaConversacion('  store.batchLoadHistory(history.map((e) => e))')).toHaveLength(1)
    expect(reconstruyeLaConversacion('  { ...e, text: completa }')).toHaveLength(1)
    expect(reconstruyeLaConversacion('  store.setEntrySpeaker(entry.id, voz)')).toEqual([])
  })
})

describe('P1 - el texto se decide UNA vez (inserts), solo se COMPLETA un fragmento', () => {
  it('dos turnos distintos: dos inserts y CERO reconstrucciones (espiando el store)', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    const espia = vi.spyOn(useIntegrationStore.getState(), 'batchLoadHistory')
    commitUserTurnRow({ text: 'hola que tal', speakerName: 'Hablante 1', turnId: 1 })
    commitUserTurnRow({ text: 'otra locucion distinta', speakerName: 'Hablante 1', turnId: 2 })
    expect(historial().map((e) => e.text), 'las dos locuciones entran como filas').toEqual(['hola que tal', 'otra locucion distinta'])
    expect(espia, 'ninguna fila se ha movido reconstruyendo la conversacion').not.toHaveBeenCalled()
    espia.mockRestore()
  })

  it('una emision mas corta (trozo) NO toca el texto ya insertado', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    commitUserTurnRow({ text: 'vamos a validar la transcripcion completa de la frase', speakerName: 'Hablante 1', turnId: 7 })
    const textoAntes = historial()[0].text
    commitUserTurnRow({ text: 'la transcripcion completa', speakerName: 'Hablante 1', turnId: 7, replaceLast: true })
    expect(historial(), 'el trozo reutiliza la fila: no hay fila nueva').toHaveLength(1)
    expect(historial()[0].text, 'y el texto mostrado NO se acorta').toBe(textoAntes)
  })

  it('completar un FRAGMENTO es la unica escritura de texto, y va dirigida a su fila', () => {
    useIntegrationStore.setState({ conversationHistory: [] })
    const vecina = { id: 'vecina', role: 'user' as const, text: 'vecina', speakerId: 'voz-2', timestamp: 9 }
    useIntegrationStore.getState().addConversationEntry(vecina)
    commitUserTurnRow({ text: 'hasta aqui llego la frase', speakerName: 'Hablante 1', turnId: 8 })
    const id = historial()[1].id
    const vecinaAntes = historial().find((e) => e.id === 'vecina')
    // Una respuesta de FLU en medio: la fila queda ANTES del turno en curso (es el caso en el que
    // el ASR reentrega la locucion completa de una fila ya escrita).
    useIntegrationStore.getState().addConversationEntry({ id: 'flu1', role: 'flu', text: 'respuesta de FLU', timestamp: 10 })
    // La emision nueva TRAE la locucion completa de la fila anterior (era un fragmento).
    commitUserTurnRow({ text: 'hasta aqui llego la frase y siguio hablando un rato mas', speakerName: 'Hablante 1', turnId: 8, replaceLast: true })
    expect(historial().find((e) => e.id === id)?.text, 'la fila completa su texto').toBe('hasta aqui llego la frase y siguio hablando un rato mas')
    expect(historial().find((e) => e.id === 'vecina'), 'y ninguna otra fila se toca').toBe(vecinaAntes)
  })
})

describe('P3 - la fila se dibuja MEMOIZADA (un insert no redibuja las N filas)', () => {
  const entradas = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `f${i}`, role: 'user' as const, text: `frase ${i}`, speakerId: 'voz-1', timestamp: 1000 + i,
    }))

  it('anadir UNA entrada dibuja UNA fila (no las 30)', () => {
    vi.mocked(formatRowClock).mockClear()
    vi.mocked(resolveRowSpeakerLabel).mockClear()
    const base = entradas(30)
    const { rerender, container } = render(<ConversationLog entries={base} emptyLabel="vacio" />)
    expect(vi.mocked(formatRowClock).mock.calls.length, 'las 30 filas se dibujan la primera vez').toBe(30)
    vi.mocked(formatRowClock).mockClear()
    vi.mocked(resolveRowSpeakerLabel).mockClear()

    const nueva = { id: 'f30', role: 'user' as const, text: 'frase 30', speakerId: 'voz-1', timestamp: 2000 }
    rerender(<ConversationLog entries={[...base, nueva]} emptyLabel="vacio" />)
    expect(vi.mocked(formatRowClock).mock.calls.length, 'solo la fila NUEVA se redibuja').toBe(1)
    expect(container.querySelectorAll('.audit-item').length, 'la fila nueva esta en la lista').toBe(31)
    void resolveRowSpeakerLabel
  })

  it('un cambio de VOZ redibuja SOLO su fila', () => {
    const base = entradas(30)
    const { rerender } = render(<ConversationLog entries={base} emptyLabel="vacio" />)
    vi.mocked(formatRowClock).mockClear()
    // La fila 7 cambia de objeto (su VOZ cambio): el resto conserva identidad.
    const cambiadas = base.map((e) => (e.id === 'f7' ? { ...e, speakerId: 'voz-9' } : e))
    rerender(<ConversationLog entries={cambiadas} emptyLabel="vacio" />)
    expect(vi.mocked(formatRowClock).mock.calls.length, 'solo la fila tocada se redibuja').toBe(1)
  })
})
