# Estado de entrega — 2026-09-10 (trabajo autónomo)

> Resumen para revisión al despertar. Nada está commiteado. El dev server sigue arriba
> (`bgp_089ae549e001rzYDEIPaF8aris`, puerto 5173).

## Hecho y verificado (estructura)

| Bloque | Qué | Evidencia |
|---|---|---|
| §9 H1 | El motor de voz no almacena; deriva del store (`dialogueView`, `userRowsTextView`, `userSpeakersView`) | G1 ✓ · validado en vivo por el usuario |
| §9 H2 | Frase visible única (`selectVisiblePhrase`) | G5 ✓ |
| §9 H3 | Un solo punto de creación de escucha (`acquireSpeechRecognition`) | G4 ✓ |
| §9 H4 | Barra pura, sin almacén propio (`lastVoiceCommand` eliminado) | G7 ✓ |
| §9 H5 | Query única (`planConversationDispatch`) | G3 ✓ |
| §9 H6 | Wake word solo de config (3 sitios) | G6 ✓ |
| §9 H7 | Una sola ruta para el estado de Buscar (RESET gateado para BUSCAR/NAVEGAR) | G8 ✓ |
| INV-7 | Prueba funcional "una frase → una fila + misma query" | `tests/voiceCanonicalPhrase.test.ts` ✓ |
| Guard voz | `tests/voiceSingleSourceGuard.test.ts` | 7/7 ✓ |

**Verificación global (2026-09-10)**
- `npx tsc -b` → 0 errores.
- `npm run lint` → 5 archivos / 29 tests verde.
- `npm run test:full` → `153 files | 2732 passed | 6 failed` = **exactamente el baseline**
  (`deterministicArbiter` ×3, `hoyPanel` ×3). **0 fallos nuevos.**

## Pendiente que NO puedo cerrar solo

1. **Validación en vivo** (tuya):
   - §9 G2–G7: una frase → una fila; contexto multi-turno; comandos; barra; onboarding.
   - H7: "ok flu busca en la web …" **y** "ok flu navega a …" → resultados en la grilla
     aunque el ASR emita varias revisiones.
2. **Defecto de segmentación** (requiere reproducción en vivo): una locución se partió en
   dos filas ("hacen sus nidos" + frase completa) por cambio de hablante (`luis` →
   `Hablante 2`). Evidencia en log; el arreglo toca el pipeline de voz y exige validación.
3. **Cierre de entrega**: commit/CI bloqueado por `.task/contract.json` y
   `.task/frozen.json` desactualizados. Re-congelar el criterio necesita tu autorización.

## Respaldo

- `git stash@{0}` = parche §9 viejo (referencia). No tocar salvo para comparar.
- Planes: `plans/plan-tuberia-unica-voz.md`, `plans/contrato-h7-ruta-unica-busqueda.md`.
