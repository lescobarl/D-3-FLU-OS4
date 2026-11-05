// @vitest-environment node
/**
 * ETAPA 4 · HABLANTES / DIARIZACIÓN — guard de la ventana con voz.
 *
 * Los casos de CONTINUIDAD e IDENTIDAD que vivían aquí se sostenian en el
 * dueño muerto `src/voice/lib/conversationTurnRow.ts` (retirado con la tubería
 * vieja: `commitUserTurnRow` hoy vive en el módulo `src/voice/conversation`).
 * Su cobertura la da el test del módulo nuevo (`conversacionPasivoEscritor`):
 * «sin identidad la fila nace SIN rótulo», «la etiqueta pendiente deja la fila
 * marcada para completarse», «continuidad: la etiqueta anónima nueva NO pisa
 * la del mismo epoch» y «sin evidencia → Hablante N al mostrar». El guard de
 * «UN SOLO escritor de la etiqueta» media `setEntrySpeakerName` dentro del
 * archivo borrado: sin sujeto, no hay implementación que medir.
 *
 * Queda el criterio VIVO: la medida se calcula sobre la ventana con voz, el
 * MISMO dueño que usa el tramo de la fila.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const leer = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Sin comentarios: un guard mide IMPLEMENTACION, no menciones en prosa. */
const codigo = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('ETAPA 4 · la medida y el tramo comparten la ventana con voz', () => {
  it('G U A R D (fuente): la MEDIDA se calcula sobre la ventana con voz, igual que el tramo', () => {
    const hook = codigo(leer('src/voice/hooks/useFluVoiceAssistant.js'))
    // La firma del turno se embebe sobre `selectVoicedWindow(audioSnapshot)` (tramo con voz).
    expect(hook).toMatch(/selectVoicedWindow\(audioSnapshot/)
    // El tramo de la fila usa el MISMO dueno (`ventanaConVoz`), no un criterio propio.
    expect(codigo(leer('src/voice/core/tramo.js'))).toContain('ventanaConVoz')
  })
})
