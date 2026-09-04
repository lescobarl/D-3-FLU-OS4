# Plan — Completar la consolidación visual del Pizarrón "Un Solo Objeto"

> **Problema real (verificado en código):** los 8 pasos previos crearon componentes y tests
> **aislados**, pero la transformación central del Paso 4 — reemplazar el `switch (activeTab)`
> y renderizar `ResultFeed` como columna principal — **nunca se ejecutó**. Por eso la pantalla
> sigue mostrando las mismas pestañas.
>
> **Criterio de hecho del plan original (no cumplido):** [`analisis-ejecucion-pizarron-consolidado.md`](analisis-ejecucion-pizarron-consolidado.md:142)
> — "El pizarrón muestra a la vez resultados (feed con insignias) y el panel lateral
> HOY/DIARIO/NOTAS — **sin `switch` que oculte regiones**."

---

## Evidencia del hueco (código actual)

| Plan exige | Código real | Archivo |
|---|---|---|
| Reemplazar `switch (activeTab)` | `switch (activeTab)` sigue presente | [`WorkspaceHub.tsx:602`](../src/components/WorkspaceHub.tsx:602) |
| Columna principal = `ResultFeed` | `ResultFeed` **nunca se importa** (solo existe en su propio archivo) | búsqueda global `.tsx` |
| `respuesta` = feed consolidado | `respuesta` sigue con estructura inline vieja | [`WorkspaceHub.tsx:611`](../src/components/WorkspaceHub.tsx:611) |
| Sin `switch` que oculte regiones | Barra de 7 pestañas sigue renderizándose | [`WorkspaceHub.tsx:887`](../src/components/WorkspaceHub.tsx:887) |
| `HoyPanel` en columna lateral | ✅ Ya cableado (única parte del Paso 4 hecha) | [`WorkspaceHub.tsx:911`](../src/components/WorkspaceHub.tsx:911) |

---

## Objetivo único

Que el pizarrón muestre **a la vez** el feed de resultados consolidado (con insignias
WEB/IA/OCR y filtro Todo/Imágenes/Doc-Video) **y** el panel lateral HOY/DIARIO/NOTAS,
**sin** la barra de pestañas que fragmenta y oculta regiones.

---

## Pasos de implementación (una sola tarea coherente en `WorkspaceHub`)

### 1. Construir los ítems del feed desde el estado real
En [`WorkspaceHub.tsx`](../src/components/WorkspaceHub.tsx:1), crear un `useMemo` que
ensamble `ResultFeedItem[]` a partir de los datos que YA llegan por props:
- **IA (origen `ia`, kind `text`):** `latestResponse` + `workspaceArtifact.contenido` +
  `puntos_clave` + `homeworkContext` (lo que hoy vive en el case `respuesta`).
- **IA imagen (origen `ia`, kind `image`):** la imagen generada (`image.imageUrl`).
- **WEB (origen `web`, kind `text`):** resultados de búsqueda web (hoy en `buscar`).
- **OCR (origen `ocr`, kind `doc`):** análisis de documento (`document.artifact`).
- **Doc/Video (origen `ia`, kind `doc`/`video`):** `app.artifact`, `generation.result`,
  `generation.videoResult`.

Cada tarjeta reutiliza el JSX presentacional existente (sin duplicar lógica).

### 2. Importar y renderizar `ResultFeed` como columna principal
- Añadir `import { ResultFeed } from './ResultFeed';` (hoy NO está importado).
- Reemplazar el cuerpo de la columna principal por `<ResultFeed items={feedItems} ... />`.

### 3. Eliminar la fragmentación por pestañas del pizarrón
- **Eliminar** la barra `<nav className="workspace-hub__tabs">` ([`WorkspaceHub.tsx:887`](../src/components/WorkspaceHub.tsx:887)).
- **Eliminar** el `switch (activeTab)` ([`WorkspaceHub.tsx:602`](../src/components/WorkspaceHub.tsx:602))
  y los cases `respuesta`/`buscar`/`documento`/`app`/`generacion`/`archivos` que ocultaban
  regiones.
- **Conservar** la columna lateral `HoyPanel` ([`WorkspaceHub.tsx:911`](../src/components/WorkspaceHub.tsx:911)).
- **Reubicar** `HorarioImportConfirm` (digitalización → HOY) dentro del panel HOY, no como
  pestaña.
- **No tocar** los paneles de Ajustes (fuera del pizarrón).

### 4. Mantener la barra de comandos y la sección de cargas
Conservar la Sección 1 (barra de comandos) y la Sección 3 (cargas) como regiones
permanentes del pizarrón, no como pestañas.

### 5. Actualizar el test de layout
- Reescribir [`tests/workspaceHubLayout.test.tsx`](../tests/workspaceHubLayout.test.tsx) para
  que verifique la **integración real**: que `ResultFeed` aparece en la columna principal y
  `HoyPanel` en la lateral, y que **NO** existe la barra de pestañas.
- Añadir un test que monte `WorkspaceHub` con datos reales y compruebe que las insignias
  WEB/IA/OCR y el filtro Todo/Imágenes/Doc-Video se renderizan.
- Mantener verdes los tests aislados existentes (`resultFeed`, `hoyPanel`).

### 6. Verificación final (visual + técnica)
- `npx tsc --noEmit` limpio y `npm test` verde.
- Confirmar en el dev server (Terminal 1) que la pantalla muestra el feed consolidado +
  panel HOY **sin** la barra de pestañas.

---

## Criterio de "hecho" (idéntico al plan original)

- El pizarrón muestra **a la vez** resultados (feed con insignias) y el panel lateral
  HOY/DIARIO/NOTAS — **sin `switch` que oculte regiones**.
- La digitalización de una imagen de horario puebla el HOY con confirmación previa.
- `npx tsc --noEmit` limpio y `npm test` verde.
