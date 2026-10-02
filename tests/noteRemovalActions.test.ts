// ============================================================
// noteRemovalActions - CONDUCTA del despacho UNICO de borrado de notas.
//
// `runNoteRemovalIntent` mapea intent -> escritura -> respuesta hablada.
// Se sustituye SOLO la frontera de persistencia (el store inyectado, que en
// produccion es Dexie via useNotes); los colaboradores REALES (superNoteActions,
// superNoteTarget, uiStrings) quedan sin tocar, de modo que el texto hablado y
// el troceado de la lista se miden de verdad.
// ============================================================
import { describe, it, expect, vi } from 'vitest'

import { runNoteRemovalIntent } from '../src/app/noteRemovalActions'
import type { NoteRemovalStore, NoteRemovalMessages } from '../src/app/noteRemovalActions'
import type { SuperNoteRow } from '../src/core/notes/superNoteTarget'

const MESSAGES: NoteRemovalMessages = {
  cleared: 'Listo, borré todas las notas.',
  clearedEmpty: 'No había notas que borrar.',
  removed: 'Listo, borré la nota.',
  notFound: 'No encontré esa nota.',
}

function makeStore(over: Partial<NoteRemovalStore> = {}): NoteRemovalStore {
  return {
    add: vi.fn().mockResolvedValue({ ok: true }),
    rename: vi.fn().mockResolvedValue({}),
    setBody: vi.fn().mockResolvedValue({}),
    softRemove: vi.fn().mockResolvedValue({}),
    removeByTarget: vi.fn().mockResolvedValue(0),
    clearAll: vi.fn().mockResolvedValue(0),
    ...over,
  }
}

const superRow = (over: Partial<SuperNoteRow> = {}): SuperNoteRow => ({
  id: 'n1',
  label: 'Super',
  body: '',
  ...over,
})

describe('runNoteRemovalIntent - despacho de intents', () => {
  it('devuelve null si no es un intent de borrado (null o accion ajena)', async () => {
    await expect(runNoteRemovalIntent(null, makeStore(), [], 'es', MESSAGES)).resolves.toBeNull()
    const intent = { action: 'notes.add', data: { target: 'Super' } }
    await expect(runNoteRemovalIntent(intent, makeStore(), [], 'es', MESSAGES)).resolves.toBeNull()
  })
})

describe('runNoteRemovalIntent - notes.clear (vaciar todas)', () => {
  it('vacía y confirma cuando había notas', async () => {
    const store = makeStore({ clearAll: vi.fn().mockResolvedValue(3) })

    const out = await runNoteRemovalIntent({ action: 'notes.clear' }, store, [], 'es', MESSAGES)

    expect(store.clearAll).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ failed: false, text: MESSAGES.cleared })
  })

  it('reporta fallo (nada que borrar) cuando el store devuelve 0', async () => {
    const store = makeStore({ clearAll: vi.fn().mockResolvedValue(0) })

    const out = await runNoteRemovalIntent({ action: 'notes.clear' }, store, [], 'es', MESSAGES)

    expect(out).toEqual({ failed: true, text: MESSAGES.clearedEmpty })
  })
})

describe('runNoteRemovalIntent - notes.removeItem (quitar un item)', () => {
  it('devuelve null si falta el item', async () => {
    const store = makeStore()
    await expect(runNoteRemovalIntent({ action: 'notes.removeItem', data: {} }, store, [], 'es', MESSAGES)).resolves.toBeNull()
    await expect(
      runNoteRemovalIntent({ action: 'notes.removeItem', data: { item: '   ' } }, store, [], 'es', MESSAGES),
    ).resolves.toBeNull()
    expect(store.setBody).not.toHaveBeenCalled()
  })

  it('quita el item de la lista y responde con el texto real (ES)', async () => {
    const store = makeStore()
    const rows = [superRow({ body: 'cloro\npan\nfocos' })]

    const out = await runNoteRemovalIntent(
      { action: 'notes.removeItem', data: { item: 'cloro' } },
      store,
      rows,
      'es',
      MESSAGES,
    )

    expect(store.setBody).toHaveBeenCalledWith('n1', 'pan\nfocos')
    expect(out).toEqual({ failed: false, text: 'Listo, quité cloro de la lista.' })
  })

  it('avisa que no lo encontro y NO toca la nota si el item no estaba', async () => {
    const store = makeStore()
    const rows = [superRow({ body: 'pan\nfocos' })]

    const out = await runNoteRemovalIntent(
      { action: 'notes.removeItem', data: { item: 'cloro' } },
      store,
      rows,
      'es',
      MESSAGES,
    )

    expect(store.setBody).not.toHaveBeenCalled()
    expect(out).toEqual({ failed: true, text: 'No encontré "cloro" en la lista.' })
  })

  it('responde en ingles cuando el idioma es en', async () => {
    const store = makeStore()
    const rows = [superRow({ body: 'cloro\npan' })]

    const out = await runNoteRemovalIntent(
      { action: 'notes.removeItem', data: { item: 'cloro' } },
      store,
      rows,
      'en',
      MESSAGES,
    )

    expect(out).toEqual({ failed: false, text: 'Done, I removed cloro from the list.' })
  })

  it('falla honestamente si no hay lista viva del super', async () => {
    const store = makeStore()
    const rows = [superRow({ label: 'Compra', body: 'cloro' })]

    const out = await runNoteRemovalIntent(
      { action: 'notes.removeItem', data: { item: 'cloro' } },
      store,
      rows,
      'es',
      MESSAGES,
    )

    expect(store.setBody).not.toHaveBeenCalled()
    expect(out).toEqual({ failed: true, text: 'No pude actualizar la nota.' })
  })

  it('marca fallo si la persistencia no confirma la escritura', async () => {
    const store = makeStore({ setBody: vi.fn().mockResolvedValue(null) })
    const rows = [superRow({ body: 'cloro\npan' })]

    const out = await runNoteRemovalIntent(
      { action: 'notes.removeItem', data: { item: 'cloro' } },
      store,
      rows,
      'es',
      MESSAGES,
    )

    expect(out).toEqual({ failed: true, text: 'No pude actualizar la nota.' })
  })
})

describe('runNoteRemovalIntent - notes.remove (borrar por destino)', () => {
  it('borra por destino y confirma si habia coincidencias', async () => {
    const store = makeStore({ removeByTarget: vi.fn().mockResolvedValue(2) })

    const out = await runNoteRemovalIntent(
      { action: 'notes.remove', data: { target: 'súper' } },
      store,
      [],
      'es',
      MESSAGES,
    )

    expect(store.removeByTarget).toHaveBeenCalledWith('súper')
    expect(out).toEqual({ failed: false, text: MESSAGES.removed })
  })

  it('devuelve null si falta el destino', async () => {
    const store = makeStore()
    await expect(
      runNoteRemovalIntent({ action: 'notes.remove', data: { target: '  ' } }, store, [], 'es', MESSAGES),
    ).resolves.toBeNull()
    expect(store.removeByTarget).not.toHaveBeenCalled()
  })

  it('reporta "no encontrada" cuando no habia nota de ese destino', async () => {
    const store = makeStore({ removeByTarget: vi.fn().mockResolvedValue(0) })

    const out = await runNoteRemovalIntent(
      { action: 'notes.remove', data: { target: 'súper' } },
      store,
      [],
      'es',
      MESSAGES,
    )

    expect(out).toEqual({ failed: true, text: MESSAGES.notFound })
  })
})
