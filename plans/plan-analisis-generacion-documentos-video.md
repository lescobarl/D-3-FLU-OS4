# Plan: Análisis de Documentos, Análisis de Apps y Generación de Documentos/Video

> Estado: PROPUESTA (sin implementar)
> Alcance: Transformar FLU en un asistente que analiza documentos completos (Excel, presentaciones, texto, PDF), analiza la funcionalidad de una app, y genera documentos/videos bajo petición por voz.
> Restricciones: CLAUDE.md — sin hardcode, sin parches (no modificar app source para pasar tests), sin entregas parciales, respuestas cortas.

---

## 1. Resumen ejecutivo

FLU ya es un asistente conversacional con voz, avatar, pizarra, minutas y generación de imágenes. El salto a "verdadero asistente" requiere **cuatro capacidades nuevas**, ordenadas por valor/esfuerzo:

| # | Capacidad | Viabilidad (validada) | Esfuerzo |
|---|-----------|----------------------|----------|
| 1 | **Análisis de documentos** (lectura + estructura + Q&A) | ALTA | Medio |
| 2 | **Análisis de funcionalidad de apps** (estático + dinámico) | ALTA | Medio |
| 3 | **Generación de documentos** (PDF, docx, xlsx, pptx, md, csv, ics) | ALTA | Medio |
| 4 | **Generación de video** (walkthrough ensamblado, no texto-a-video) | MEDIA | Alto |

**Conclusión central de la fase de análisis:** el video generativo nativo (texto-a-video) NO es viable sin API externa; el video **explicativo** (walkthrough grabado + guion + TTS + ensamblado) SÍ lo es reutilizando la infraestructura E2E y de voz existentes. Todos los formatos de documento son viables con bibliotecas maduras; lo único realmente nuevo es la capa de parsing/adaptadores y el ensamblador de video.

---

## 2. Objetivo y visión

FLU debe poder, con un comando de voz y un archivo anexado en el área de carga (digitalización):

- "OK FLU lee el archivo que te anexé y resúmelo."
- "OK FLU genera un PDF / Excel / presentación del análisis."
- "OK FLU genera un video explicativo del documento con calidad alta que dure 3 minutos explicando todas las pestañas."
- "OK FLU analiza la funcionalidad de esta app."

Todo sin romper las funcionalidades actuales (105 pruebas E2E de cobertura + validación integral verdes).

---

## 3. Alcance completo del cambio (análisis integral)

### 3.1 Capacidades nuevas

**C1. Análisis de documentos** — tres niveles:
- **Lectura** (ALTA): extraer texto narrativo (README, etiquetas, instrucciones) + valores cacheados → resumen ejecutivo, Q&A.
- **Estructura** (MEDIA): reconstruir layout (celdas combinadas), roles de hoja (input/cálculo/output) → tabla de contenido del documento.
- **Lógica** (MEDIA-BAJA): fórmulas y macros → requiere motor de recálculo server-side (LibreOffice headless) o replicación (como ya hace D-0-Pension). Las macros VBA no se evalúan en cliente.

**C2. Análisis de funcionalidad de apps** — dos fases:
- **Estática** (ALTA): leer código, manifest, config de pestañas/pantallas, componentes, store, rutas → mapa funcional.
- **Dinámica** (ALTA): ejecutar la app headless y recorrer pantallas capturando DOM/screenshots/consola/transiciones → validar y documentar el mapa. Este es el patrón E2E ya existente en OS4.

**C3. Generación de documentos** — el LLM produce el contenido; una **capa de adaptadores** lo serializa: PDF, docx, xlsx, pptx, md/html, csv/json, ics, minuta/informe.

**C4. Generación de video explicativo** — pipeline de ensamblado: guion → slides/capturas → TTS → ffmpeg.wasm → mp4. Parámetros `calidad` (resolución/fps/bitrate) y `duración` (longitud de guion → estimación TTS).

### 3.2 Contexto que ya existe y se reutiliza (evidencia)

| Pieza | Ubicación |
|---|---|
| Zona de carga / digitalización | [`App.tsx`](../src/App.tsx:1147) (`processImageFile`), `frame-content__upload-zone` |
| Fábrica de proveedores AI (Gemini/DeepSeek + fallback) | [`aiServiceFactory.ts`](../src/services/aiServiceFactory.ts:69), [`fallbackResponses.ts`](../src/services/fallbackResponses.ts) |
| Servidor proxy | [`geminiProxy.ts`](../src/server/geminiProxy.ts:25) (`analyzeImage`, `generateWorkspaceImage`) |
| Store global | [`integrationStore.ts`](../src/store/integrationStore.ts) |
| Contrato de workspace (patrón a extender) | `generateFluContract` / `workspaceArtifact` |
| Comandos de voz (detección + frases) | [`fluConfig.js`](../src/voice/lib/fluConfig.js:748), [`audioMath.js`](../src/voice/lib/audioMath.js:161), [`voiceCommands.js`](../src/voice/lib/voiceCommands.js:1) |
| Generación de imágenes (slides) | [`gemini.ts`](../src/services/gemini.ts:499) (`generateWorkspaceImage`), [`useWorkspaceImage.ts`](../src/hooks/useWorkspaceImage.ts:74) |
| TTS / voz | [`VoiceAssistantBarWrapper.tsx`](../src/components/VoiceAssistantBarWrapper.tsx:48) |
| Exportación | [`exportUtils.ts`](../src/lib/exportUtils.ts) |
| Recorrido E2E de pantallas (fase dinámica) | [`cobertura-completa.spec.ts`](../tests/e2e/cobertura-completa.spec.ts:136), [`validation-integral.spec.ts`](../tests/e2e/validation-integral.spec.ts:147) |
| Agenda diaria (para .ics) | [`dailyAgenda.ts`](../src/lib/dailyAgenda.ts) |

### 3.3 Evidencia del archivo real (D-0-Pension)

Diagnóstico realizado sobre `Calculadora ley 73 IMSS - Escobar Lopez Luis Adan.xlsm` (816 KB):
- **23 hojas**, `vbaProject.bin` presente (macros VBA).
- **9,486 celdas con valor, 8,186 (86%) son fórmulas**; 321 celdas combinadas; `Sheet1` tiene 6,107 fórmulas.
- **Errores heredados**: `#REF!` / `#VALUE!` en varias hojas → el análisis de valores crudos puede propagar datos erróneos; hay que marcar las celdas de error.
- Sin rangos con nombre → fórmulas opacas tipo `=D12*$E$5`; evaluación solo posible con recálculo.
- Texto narrativo minoritario pero suficiente para resumen/Q&A (README, etiquetas, tablas de porcentajes Ley 73/97, escenarios).

**Implicación:** el análisis de Excel debe ser **estratificado** (leer → estructurar → calcular) y los libros tipo "calculadora" requieren un paso server-side de recálculo para análisis profundo.

---

## 4. Arquitectura propuesta

```
┌─ Cliente (app FLU) ────────────────────────────────────────────────┐
│ Upload zone (extendida: acepta documentos, no solo imágenes)       │
│   → src/lib/documentParser.ts   (parsing por MIME en cliente)      │
│   → src/lib/documentChunker.ts  (chunking + map-reduce)            │
│   → documentArtifact / appAnalysisArtifact / generationJob (store) │
│   → Hooks: useDocumentAnalysis / useAppAnalysis / useGeneration    │
│   → Paneles de resultado (nuevos)                                   │
└───────────────┬─────────────────────────────────────────────────────┘
                │ HTTP (/api/documents/…, /api/generation/…)
┌───────────────▼─────────────────────────────────────────────────────┐
│ Servidor (geminiProxy.ts extendido)                                 │
│   → recálculo LibreOffice headless (solo si se requiere Nivel Lógica)│
│   → render de formatos pesados (opcional)                           │
│   → LLM: aiServiceFactory (Gemini/DeepSeek) + fallbackResponses     │
└──────────────────────────────────────────────────────────────────────┘
```

Principios:
1. **Un solo motor de contenido** (LLM) produce texto/datos; los **adaptadores de formato** solo serializan.
2. **Contratos nuevos** siguen el patrón `workspaceContract`: `documentContract`, `appAnalysisContract`, `generationContract`.
3. **Comandos de voz nuevos** en `fluConfig.voiceCommands` sin tocar los existentes.
4. **Parsing ligero en cliente** (SheetJS/pdfjs/mammoth/pptx) y **recálculo en servidor** (solo para Nivel Lógica).

---

## 5. Modelo de datos (contratos)

```ts
// documentContract — resultado del análisis de un documento
interface documentContract {
  tipo: 'xlsm' | 'xlsx' | 'pptx' | 'docx' | 'pdf' | 'text';
  mime: string;
  nombre: string;
  tamaño: number;
  hojas?: Array<{ nombre: string; rol: 'input' | 'calculo' | 'output' | 'informativa'; celdas: number; errores: string[] }>;
  errores: string[];          // #REF!, #VALUE!, etc. detectados
  resumen: string;
  puntos_clave: string[];
  escenarios?: Record<string, unknown>[];
  qa_context: string;         // texto estructurado para Q&A
}

// appAnalysisContract — resultado del análisis de una app
interface appAnalysisContract {
  proyecto: string;
  framework: 'react' | 'flutter' | 'other';
  pantallas: Array<{ id: string; nombre: string; proposito: string; entradas: string[]; acciones: string[]; salidas: string[] }>;
  flujos: Array<{ nombre: string; pasos: string[] }>;
  errores_detectados: string[];
}

// generationContract — petición de generación
interface generationContract {
  formato: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'html' | 'csv' | 'json' | 'ics' | 'video';
  parametros: { calidad?: 'baja' | 'media' | 'alta'; duracion_min?: number; orientacion?: 'vertical' | 'horizontal'; tema?: string };
  fuentes: Array<{ tipo: 'documento' | 'app' | 'conversacion' | 'minuta'; ref: string }>;
}

// generationJob — estado de un trabajo de generación (para UI/progreso)
interface generationJob {
  id: string;
  estado: 'pendiente' | 'analizando' | 'escribiendo' | 'ensamblando' | 'listo' | 'error';
  progreso: number;
  formato: string;
  url_resultado?: string;
  error?: string;
}
```

---

## 6. Componentes nuevos y modificados

### Nuevos
- `src/lib/documentParser.ts` — parsing por MIME (SheetJS, pdfjs-dist, mammoth, pptx-parser).
- `src/lib/documentChunker.ts` — chunking + resumen jerárquico (map-reduce).
- `src/lib/formatAdapters/` — `pdf.ts`, `docx.ts`, `xlsx.ts`, `pptx.ts`, `md.ts`, `csv.ts`, `ics.ts`.
- `src/services/videoAssembler.ts` — ffmpeg.wasm: ensamblado slides/capturas + TTS → mp4.
- `src/hooks/useDocumentAnalysis.ts`, `src/hooks/useAppAnalysis.ts`, `src/hooks/useDocumentGeneration.ts`.
- `src/server/documentRoutes.ts`, `src/server/generationRoutes.ts` — rutas del proxy (recálculo, render pesado).
- Slices en `integrationStore.ts`: `documentArtifact`, `appAnalysisArtifact`, `generationJob`.
- Componentes de UI: `DocumentResultPanel`, `AppAnalysisPanel`, `GenerationProgressPanel`.

### Modificados
- `src/App.tsx` — zona de carga acepta documentos (MIME) y renderiza los nuevos paneles.
- `src/store/integrationStore.ts` — nuevos slices.
- `src/voice/lib/fluConfig.js` — comandos de voz, límites de tamaño/MIME, config de generación.
- `src/voice/lib/gemini.js` — prompts de contrato para documentos y apps.
- `src/services/aiServiceFactory.ts` + `src/core/ai/IAIService.ts` — métodos `analyzeDocument`, `analyzeApp`, `generateDocument`.
- `src/services/gemini.ts`, `src/services/deepseek.ts` — implementación de los métodos (deepseek delega generación de imágenes/video a gemini).
- `src/lib/exportUtils.ts` — exportación a los nuevos formatos.
- `src/components/FluSettingsPanel.tsx` — configuración de generación (calidad, duración, formatos, umbrales).

---

## 7. Comandos de voz (nuevos en `fluConfig.voiceCommands`)

| Comando | Frases (es/en) | Acción |
|---|---|---|
| `ANALIZAR_DOCUMENTO` | "lee el documento/excel/pdf", "analiza el archivo", "resume el excel" | Parsing + análisis + `documentContract` |
| `ANALIZAR_APP` | "analiza la funcionalidad de la app", "explícame la app" | Fase estática + dinámica → `appAnalysisContract` |
| `GENERAR_DOCUMENTO` | "genera un pdf/excel/presentación de esto" | `generationContract` → adaptador |
| `GENERAR_VIDEO` | "genera un video explicativo … de X minutos con calidad alta" | Guion → capturas/slides → TTS → ensamblado |

Todos deben respetar la detección existente en `audioMath.js`/`voiceCommands.js` (no duplicar la lógica de detección).

---

## 8. Dependencias nuevas

| Librería | Uso | Dónde |
|---|---|---|
| `xlsx` (SheetJS) | Leer/escribir xlsx/xlsm (valores + fórmulas) | cliente + proxy |
| `pdfjs-dist` o `pdf-parse` | Extraer texto de PDF | cliente/proxy |
| `mammoth` | docx → texto | cliente/proxy |
| `pptx-parser` | pptx → texto/estructura | cliente/proxy |
| `pptxgenjs` | escribir presentaciones | cliente |
| `docx` | escribir Word | cliente |
| `pdfkit` o `jsPDF` | escribir PDF | cliente |
| `exceljs` | escribir xlsx con estilos | cliente |
| `ffmpeg.wasm` | ensamblar video (lazy-load) | cliente |
| LibreOffice headless (opcional) | recálculo de fórmulas (`soffice --convert-to xlsx --calc`) | proxy |

Costo/riesgo: `ffmpeg.wasm` (~30 MB) — cargar bajo demanda, nunca en bundle inicial. LibreOffice headless — solo si se habilita el Nivel Lógica.

---

## 9. Fases del plan (entregables y criterios de aceptación)

### Fase 1 — Análisis de documentos (MVP: lectura + estructura)
**Entregables:**
- `documentParser.ts` + `documentChunker.ts` con soporte xlsx/xlsm, pptx, docx, pdf, texto.
- `analyzeDocument` en IAIService + implementaciones gemini/deepseek + fallback.
- `documentArtifact` en store + panel de resultados + comandos `ANALIZAR_DOCUMENTO`.
- Detección y marcado de errores de fórmula (`#REF!`, `#VALUE!`).
**Aceptación:**
- Tests unitarios de parser por tipo (archivos fixture) y de chunking.
- Análisis real del `.xlsm` de D-0-Pension produce `documentContract` con resumen, hojas y errores.
- `npx vitest run` y `npm run build` verdes; E2E cobertura/validation siguen verdes.

### Fase 2 — Análisis de funcionalidad de apps (estático + dinámico)
**Entregables:**
- Fase estática: lector de estructura (manifest, config de pestañas, componentes, rutas) → `appAnalysisContract`.
- Fase dinámica: reutilizar patrón E2E (Playwright) para recorrer pantallas y capturar DOM/consola/transiciones.
- Comando `ANALIZAR_APP`.
**Aceptación:**
- Análisis de OS4 mismo produce mapa funcional de las 5 pestañas correcto.
- Análisis de un proyecto Flutter (D-0-Pension) desde su build web.
- Vitest/build/E2E verdes.

### Fase 3 — Generación de documentos
**Entregables:**
- `formatAdapters/*` (pdf, docx, xlsx, pptx, md, csv, ics) sobre el contenido del análisis.
- `generateDocument` en IAIService + `generationContract` + `GENERAR_DOCUMENTO`.
- `generationJob` con progreso en UI.
**Aceptación:**
- Desde un `documentContract` se generan PDF, docx, xlsx y pptx reales (descargables).
- Los archivos abren sin errores (validación básica de estructura).
- Vitest/build/E2E verdes.

### Fase 4 — Generación de video (walkthrough ensamblado)
**Entregables:**
- Guion (LLM) con control de duración por sección.
- Visuales: capturas reales de la app (patrón E2E + MediaRecorder) o slides (imageGeneration existente).
- TTS con infraestructura de voz existente.
- `videoAssembler.ts` (ffmpeg.wasm) → mp4.
- Parámetros `calidad` (resolución/fps/bitrate) y `duración` en `generationContract`.
**Aceptación:**
- Genera un mp4 real de un análisis de documento y de un walkthrough de pestañas.
- Cumple duración objetivo ±20% y calidad parametrizada.
- Vitest/build/E2E verdes.

**Orden recomendado:** F1 → F2 → F3 → F4 (cada fase es entregable y desplegable por separado; F4 depende de F1/F2 para el contenido).

---

## 10. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Sin API keys (headless) → ruido 401 | Fallos de análisis | `fallbackResponses.ts` + filtros de consola ya implementados en E2E |
| Errores de fórmula heredados (`#REF!`/`#VALUE!`) | Análisis erróneo | Detección y marcado como error en `documentContract` |
| Macros VBA no evaluables | Nivel Lógica incompleto | Documentar limitación; recálculo LibreOffice para lo no-VBA |
| Documentos grandes exceden contexto | Timeout/costo | `documentChunker` map-reduce + límites en `fluConfig.limits` |
| `ffmpeg.wasm` pesado | Bundle grande | Lazy-load bajo demanda, nunca en bundle inicial |
| Duración TTS vs. guion | Video fuera de objetivo | Estimación por caracteres/velocidad antes de ensamblar |
| No romper cobertura actual | Regresión | Correr cobertura/validation antes y después de cada fase |

---

## 11. Estrategia de validación (constraints CLAUDE.md)

- **Sin hardcode**: todos los formatos, MIME, límites y frases en `fluConfig.js` / constantes centralizadas (nunca literales dispersos).
- **Sin parches**: los tests no deben modificar la app source; los fixtures y el análisis real se validan con specs dedicados (como `cobertura-completa.spec.ts`/`validation-integral.spec.ts`, que quedaron verdes 105/105 y 812 vitest).
- **Sin entregas parciales**: cada fase se cierra con vitest + `npm run build` + E2E verdes.
- **Rutas duplicadas**: los nuevos endpoints y comandos se centralizan en el proxy y en `voiceCommands.js` (punto único de verdad).

---

## 12. Alcance NO incluido (fuera de plan)

- Texto-a-video generativo nativo (requiere API externa de video; no es el objetivo del walkthrough).
- Evaluación de macros VBA en navegador (inalcanzable sin Excel/COM server-side).
- Reconocimiento de gráficos/objetos embebidos dentro de hojas de cálculo en el Nivel Lectura inicial.

---

## 13. Implementación 100% local (workstream adicional — completado)

> Estado: IMPLEMENTADO Y VALIDADO (todos los entregables cierran con vitest + build + E2E verdes).
> Restricción: ninguna capacidad depende de un servidor externo.

Se añadió un workstream transversal para garantizar que F1–F4 funcionen **sin servidores externos**
(100% local). Cada letra se cierra como entregable:

### A. Compatibilidad con LLM local (Ollama/localhost)
- Endpoint local reutilizado vía [`buildTextApiUrl`](../src/core/config/appConfig.ts:723) /
  [`isLocalTextEndpoint`](../src/core/config/appConfig.ts:737); proveedor `'local'` en
  [`aiServiceFactory.ts`](../src/services/aiServiceFactory.ts:71).
- Sin key/endpoint local → heurísticas offline por defecto (`analysisFallbacks.ts` +
  `buildGenerationFallbackContent` en [`generationPrompts.ts`](../src/lib/generationPrompts.ts:76)).
- Evidencia: `tests/localAi.test.ts` (11 tests) verdes.

### B. Video mp4 con ffmpeg.wasm autohospedado
- Core single-thread copiado a [`public/ffmpeg/`](../public/ffmpeg/ffmpeg-core.js) por
  [`sync-ffmpeg-core.mjs`](../scripts/sync-ffmpeg-core.mjs).
- **Fix clave (build ESM, no UMD):** la clase `FFmpeg` v0.12 arranca un worker `type:"module"`
  que hace `await import(coreURL).default`; el build UMD no exporta `default` y fallaba con
  "failed to import ffmpeg-core.js". Se cambió la copia de `dist/umd` → `dist/esm`.
- Evidencia: `tests/e2e/probe-ffmpeg-video.mjs` reporta **MP4_REAL** (blob mp4 de 18 s,
  `readyState 4`, sin degradación). Lazy-load bajo demanda; nunca en el bundle inicial.

### C. TTS local (Web Speech API)
- [`localTts.ts`](../src/services/localTts.ts) — voces del SO (`voice.localService`),
  selección de mejor voz por idioma, narración por secciones (markdown).
- Botón "🔊 Reproducir narración (TTS local)" en
  [`GenerationProgressPanel.tsx`](../src/components/GenerationProgressPanel.tsx:99).
- Evidencia: `tests/localTts.test.ts` (20 tests) verdes; botón validado en E2E con stub de
  `speechSynthesis` (headless Chromium no implementa `SpeechSynthesisUtterance`).

### D. E2E navegador F1→F3 (offline)
- [`generacion-documentos.spec.ts`](../tests/e2e/generacion-documentos.spec.ts) — 4 tests:
  F1 análisis de documento (fixture [`sample.txt`](../tests/e2e/fixtures/sample.txt)),
  F1→F3 generación de PDF (evento `flu:generate-document`), F1→F3 TTS, F4 video
  (player mp4 real o degradado). Totalmente offline vía heurísticas.
- Evidencia: 4/4 verdes.

### E. F2 headless (fase dinámica de análisis de apps)
- [`headless-app-inspect.mjs`](../scripts/headless-app-inspect.mjs) — Playwright headless que
  recorre cada pestaña, captura DOM/entradas/acciones/salidas y consola, y escribe
  `test-results/headless/report.json` en la forma de `appAnalysisContract`
  (`pantallas[]`, `flujos[]`, `errores_detectados[]`).
- Evidencia: reporte real de OS4 con 5 pantallas · 2 flujos · 0 errores.

### F. Validación final (Rule #9)
- Vitest completo, `npm run build` y E2E (cobertura + generación de documentos) verdes;
  mp4 real verificado con probe. Dev server detenido al cierre.
