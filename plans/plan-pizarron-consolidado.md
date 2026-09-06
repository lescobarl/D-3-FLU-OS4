# Plan — Pizarrón Consolidado "Un Solo Objeto" (ejecución)

> **Objetivo:** reemplazar el pizarrón ACTUAL de pestañas fragmentadas
> (`respuesta | buscar | horario | documento | app | generacion | archivos`,
> donde cada pestaña oculta a las demás con un `switch`) por el diseño
> **consolidado** de "un solo objeto":
> un solo objeto con **panel lateral "Hoy"** (Outlook) siempre visible,
> un **feed de resultados unificado** con insignias de origen, y el
> **diario/notas** integrados. Sin `switch` que oculte regiones entre sí.
>
> **Regla #1 (NO HARDCODE):** todas las etiquetas, días, colores y textos
> salen de `FLU_CONFIG` con fallback vía `pickLabel`. Nada de cadenas fijas
> en los componentes.

---

## 0. Diagnóstico (por qué "no ves nada")

- El pizarrón actual sigue siendo el de **pestañas** (`WorkspaceHub.tsx:878`),
  con `renderContent()` haciendo `switch (activeTab)` (`WorkspaceHub.tsx:592`).
- El trabajo previo (digitalización de horario → confirmación) quedó **dentro**
  de la pestaña vieja `horario` (`WorkspaceHub.tsx:710`), por eso la pantalla
  principal no cambió.
- El diseño objetivo (panel HOY + feed unificado) **no está implementado**;
  era la propuesta que este plan ejecuta (referencia histórica: `propuesta-agenda-pizarron.md`, superada).

---

## 1. Arquitectura objetivo

```
WorkspaceHub (UN solo objeto, sin switch que oculte)
├── Columna principal · RESULTADOS (feed unificado)
│     [ Todo | Imágenes | Doc/Video ]   ← filtro por TIPO, no por origen
│     └── tarjetas consolidadas, cada una con insignia de origen
│         🟢 WEB · 🔵 IA · ⚪ OCR
├── Columna lateral · HOY (Outlook, colapsable a iconos)
│     ├── 📅 HOY (próxima clase / horario genérico del día)
│     ├── 📓 DIARIO (+ ánimo)
│     └── 📝 NOTAS
└── (MEMORIA = invisible; FLU la consulta por dentro)
```

**Decisiones ya resueltas (de la propuesta §9):**
1. Panel lateral = **riel colapsable** (HOY + DIARIO + NOTAS). MEMORIA no es sección visible.
2. Guardar conversaciones = **solo al cerrar** (resumen `kind`); el transcripto crudo ya se guarda turno a turno.
3. La consulta a memoria se responde en los **Resultados** (Sección 2), como tarjeta con insignia.

---

## 2. Reutilización (NO crear sistemas paralelos)

| Necesidad | Componente/hook existente | Archivo |
|-----------|---------------------------|---------|
| Horario genérico (semana/día/próxima) | `HorarioPizarron` + `useHorario` | `src/components/HorarioPizarron.tsx`, `src/hooks/useHorario.ts` |
| Confirmación de digitalización | `HorarioImportConfirm` (ya exportado) | `src/components/WorkspaceHub.tsx:278` |
| Recordatorios/alarmas | `RemindersPanel` + `useReminders` | `src/components/RemindersPanel.tsx` |
| Diario | `DiaryPanel` + `useDiary` | `src/components/DiaryPanel.tsx` |
| Ánimo (campo del diario) | `MoodPanel` + `useMood` | `src/components/MoodPanel.tsx` |
| Notas (reemplaza lista de compras) | nuevo sobre patrón de `useShoppingList` | nuevo |
| Memoria invisible (minutas) | `useMinuteKnowledge` + KB | `src/hooks/useMinuteKnowledge.ts` |

---

## 3. Pasos de implementación (orden lógico)

### Paso 1 — Restructurar `WorkspaceHub` a layout de 2 columnas
- Reemplazar el `switch (activeTab)` por un layout de columnas:
  - **Columna principal:** feed de resultados consolidado (reutilizar el contenido
    de `respuesta` + `buscar` + `documento` + `app` + `generacion` como tarjetas
    en un feed, cada una con insignia de origen).
  - **Columna lateral:** panel "Hoy" colapsable con HOY / DIARIO / NOTAS.
- Mantener la barra de comandos y la sección de cargas.
- **No** eliminar aún las pestañas internas de los paneles de Ajustes; solo el
  pizarrón deja de fragmentar.

### Paso 2 — Crear el panel lateral "Hoy" (`HoyPanel`)
- Nuevo componente presentacional controlado `src/components/HoyPanel.tsx`.
- Bloques colapsables (`<details>`), cada uno con su etiqueta de `FLU_CONFIG`:
  - **📅 HOY:** próxima clase (`proximaClaseDe`) + horario del día (`clasesDelDia`)
    + botón "Ver horario completo" que expande `HorarioPizarron` en el mismo panel.
  - **📓 DIARIO (+ ánimo):** última entrada (`useDiary`) con su campo de ánimo
    (`useMood`), una sola entrada, sin secciones separadas.
  - **📝 NOTAS:** listado de notas (nuevo store).
- Recibe todo por props desde `App.tsx` (patrón de `AgendaHub`).

### Paso 3 — Feed de resultados unificado con insignias
- Crear `src/components/ResultFeed.tsx` que consolida las tarjetas de
  WEB / IA / OCR en una sola lista.
- Cada tarjeta lleva una **insignia de color de origen** (🟢 WEB, 🔵 IA, ⚪ OCR).
- Filtro superior por **tipo** (Todo | Imágenes | Doc/Video) — nunca por origen.
- Reutilizar los paneles existentes (`DocumentResultPanel`, `AppAnalysisPanel`,
  `GenerationProgressPanel`, imagen generada) como tarjetas del feed.

### Paso 4 — Store de NOTAS (nuevo, patrón `useShoppingList`)
- Nuevo hook `src/hooks/useNotes.ts` + tabla Dexie `fluDb.notes`
  (o reutilizar el patrón de ítems de compras con un campo `kind`).
- Persistente por perfil (sobrevive recargas).

### Paso 5 — FLU lee el pizarrón (radar de contexto)
- Inyectar en `requestFluContract` (`useFluVoiceAssistant.js:1025`) los bloques
  que hoy faltan (radar §8 de la propuesta):
  - Bloque 6 · Resultados (última consulta + feed) — FALTA
  - Bloque 7 · DIARIO (+ ánimo) — FALTA
  - Bloque 8 · NOTAS — FALTA
  - Bloque 9 · Horario del día (HOY) — FALTA
- Cada bloque se construye **dinámicamente** desde su fuente (Dexie) y devuelve
  `''` si no hay datos (Rule #1). Resúmenes cortos (top-N) para respetar
  `CONTEXT_HISTORY_LIMIT`.

### Paso 6 — Generalizar la memoria con campo `kind`
- Añadir campo `kind: 'minuta' | 'conversacion' | 'diario'` al registro de
  conocimiento (patrón de `MinuteSummarySnapshot`).
- Ampliar `buildMinuteKnowledgeBase2` y la consulta para cubrir diario y
  conversaciones, no solo minutas.
- Guardar el resumen de conversación **una sola vez al cerrar** la app.

### Paso 7 — CSS
- Añadir estilos en `src/App.css` para el layout de 2 columnas, el panel "Hoy"
  colapsable, el feed unificado y las insignias de origen.
- Reutilizar tokens/colores existentes; sin valores mágicos hardcodeados.

### Paso 8 — Pruebas
- Actualizar/crear tests de render para `HoyPanel`, `ResultFeed` y el nuevo
  layout de `WorkspaceHub`.
- Mantener verdes los tests existentes de horario (`horarioService`,
  `horarioPizarron`, `useHorario`, `workspaceContractHorario`,
  `horarioImportConfirm`).
- `npx tsc --noEmit` limpio y `npm test` verde.

---

## 4. Riesgos y mitigación

| Riesgo | Mitigación |
|--------|-----------|
| Romper el flujo de digitalización de horario ya implementado | Conservar `HorarioImportConfirm` y su lógica; solo reubicarlo en el panel HOY |
| Regresión de los paneles de Ajustes | No tocar los paneles de Ajustes; solo el pizarrón deja de fragmentar |
| Contexto de FLU demasiado grande | Bloques = resúmenes cortos top-N; `''` si no hay datos |
| Migración destructiva de Dexie | Campo `kind` opcional → sin migración destructiva |

---

## 5. Criterio de "hecho"

- El pizarrón muestra **a la vez** resultados (feed con insignias) y el panel
  lateral HOY/DIARIO/NOTAS — sin `switch` que oculte regiones.
- La digitalización de una imagen de horario puebla el HOY (bloque 9) con
  confirmación previa del usuario.
- FLU puede responder "¿qué tengo mañana?" y "¿qué anoté ayer?" desde su contexto.
- `npx tsc --noEmit` limpio y `npm test` verde.
