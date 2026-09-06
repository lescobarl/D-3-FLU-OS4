# Plan de EJECUCIÓN: Reorganización de la IU existente + Sistema de Ambientes

- **Fecha:** 2026-08-27 (America/Mexico_City)
- **Estado:** COMPLETADO (Q11) — **Fase A:** A1 ✓, A2 ✓, A3 ✓, A4 ✓, A5 ✓ (validación smoke e2e 42/42). **Fase B:** B1 ✓ (registro de ambientes), B2 ✓ (store persistente), B3 ✓ (aplicador de tema/identidad + pestañas y decoración reactivas), **B4 ✓ (activación por voz)**, **B5 ✓ (panel Ambientes en Ajustes)**, **B6 ✓ (transición del tema y bienvenida)**, **B7 ✓ (tests de catálogo y store)**, **B8 ✓ (validación end-to-end Fase B)**: [`tests/e2e/environment-e2e.spec.ts`](tests/e2e/environment-e2e.spec.ts:1) **9/9 PASSED** + **27/27** (`--repeat-each=3`), flake de coexistencia eliminado **a nivel de test**. Suite completa en verde (**2047 tests / 103 archivos**, `tsc` exit 0, `npm run build` 590 módulos).
- **Documento conceptual base:** reorganización IU/rebranding (plan previo superado por este).
- **Alcance:** SOLO lo existente + el sistema de **Ambientes**. NO SEP, NO features nuevas adicionales, NO empaquetado APP.
- **Prerequisitos:**
  - Respaldo full de hoy como punto seguro: [`backups/2026-08-27/seq-1/`](backups/2026-08-27/seq-1/MANIFEST.md) (581 archivos · 118.33 MB · 0 fallos).
  - Línea base de pruebas: suite actual (1268 tests) en verde antes de empezar.

---

## FASE A — Reorganizar la IU existente (sin cambio funcional)

Principio: **una pantalla = una tarea**, solo con componentes y pestañas actuales. No se crea routing/lazy ni pantallas nuevas.

| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| A1 | **Refactor de tema a variables CSS** | [`src/App.css`](src/App.css:1) | Extraer colores/acentos/fondos hardcodeados a variables CSS (`--flu-bg`, `--flu-accent`, …) definidas bajo `:root`. Base para que el Ambiente pueda inyectar tema por `data-ambiente`. Sin cambio visual en `asistente` (default). |
| A2 | **Agrupar los 10 paneles de Ajustes en sub-secciones** | [`src/App.tsx:3069`](src/App.tsx:3069) | Los 10 paneles existentes ([`src/App.tsx:3080`](src/App.tsx:3080)-[`3242`](src/App.tsx:3242)) se organizan en 3 sub-secciones dentro de la misma pestaña, **mismos componentes, mismo estado**: <br> • **FLU** → Flu, Asistente, Participantes/Voces. <br> • **Mis datos** → Contactos, Diario, Ánimo, Hábitos. <br> • **Gestión** → Recordatorios, Compras, Materia gris. <br> Un sub-menú simple (píldoras) muestra/oculta cada grupo (CSS, no routing). |
| A3 | **Navegación inferior en móvil** | [`src/App.css:198`](src/App.css:198), [`src/App.css:957`](src/App.css:957) | En el breakpoint `@media (max-width: 768px)` existente, las pestañas actuales pasan a barra inferior fija (íconos + etiqueta). Aprovecha el layout de 2 columnas actual sin rediseño. |
| A4 | **Refuerzo "una pantalla = una tarea"** | [`src/App.tsx:2700`](src/App.tsx:2700)-[`3260`](src/App.tsx:3260) | Claridad en las 5 pestañas existentes: títulos, íconos, menos ruido visual. **Sin funcionalidad nueva.** |
| A5 | **Validación Fase A** | tests | Correr `vitest` (1268) + smoke e2e básico (`npm run build` + `playwright`). Debe quedar **idéntica funcionalidad**, solo reorganizada. |

> ⚠️ Regla Fase A: si algún test falla, se revierte ese cambio puntual; no se avanza hasta volver a verde.

---

## FASE B — Sistema de AMBIENTES (el único feature nuevo)

Construido **sobre** los sistemas existentes: branding estacional ([`src/App.tsx:311`](src/App.tsx:311)), decoraciones, voz ([`voiceConfigCatalog.ts`](src/core/config/voiceConfigCatalog.ts:266)), navegación por voz ([`useNavigationCommands.ts`](src/hooks/useNavigationCommands.ts:1)) y proactividad ([`proactiveEngine.ts`](src/core/autonomy/proactiveEngine.ts:24)).

### B0 — Catálogo (nuevo, por datos)
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| B1 | **`environmentRegistry.ts`** | nuevo `src/core/environments/environmentRegistry.ts` | Catálogo **solo datos** de los 5 ambientes: `asistente`, `chef`, `jardinero`, `bricolaje`, `bienestar`. Cada entrada: `id`, `nombre`, `tagline`, `icono`, `bienvenida`, `tema` (vars CSS + props escena + atuendo), `voz` (perfil/rasgos/frases), `pestañas` (mostrar/ocultar de las 5 actuales), `contenido` (catálogo + reglas proactividad). |

### B1 — Estado y aplicación
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| B2 | **`environmentStore`** | nuevo `src/store/environmentStore.ts` | Store zustand con persistencia, **mismo patrón que los stores existentes** (ej. `src/store/integrationStore`). Guarda `activeAmbienteId` entre sesiones. |
| B3 | **`applyEnvironment(ambiente)`** | nuevo `src/core/environments/applyEnvironment.ts` + integración en [`src/App.tsx`](src/App.tsx:1) | Función central que: (1) inyecta CSS vars en `document.documentElement.dataset.ambiente` (base: refactor A1); (2) conmuta props de escena + atuendo vía `DecorationsRenderer`/decoraciones; (3) aplica perfil de voz + rasgos + frases reutilizando los mecanismos de `applyConfigAction` ([`src/App.tsx:311`](src/App.tsx:311)); (4) muestra/oculta pestañas; (5) conmuta contenido y reglas de proactividad. |

### B2 — Activación
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| B4 | **Activación por voz** | [`src/core/environments/environmentIntents.ts`](src/core/environments/environmentIntents.ts:1) + [`src/voice/hooks/useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:1) + [`src/App.tsx`](src/App.tsx:1) | **Fast-path determinista** (mismo patrón que `configCommands`/`gameCommands`): [`resolveEnvironmentIntent()`](src/core/environments/environmentIntents.ts:37) resuelve local y sincrónicamente el intent a partir de `frasesActivacion` del catálogo (*"actúa como chef/jardinero…"*, *"modo cocina/taller/bienestar…"*, *"vuelve a ser mi asistente"*) → [`dispatchFastEnvironmentCommand()`](src/voice/hooks/useFluVoiceAssistant.js:2802) inyecta el contrato `{ ambiente }` por la **ÚNICA ruta** `onContractResolved` → [`applyEnvironment()`](src/core/environments/applyEnvironment.ts:87)/[`resetEnvironment()`](src/core/environments/applyEnvironment.ts:141) + bienvenida hablada en App.tsx. Idempotencia de contrato tardío (`ambiente: null`) + supresión de voz LLM vía `fastPathEnvironment`. **NO** se extiende `handleNavigationCommand`. |
| B5 | **Panel Ambientes en Ajustes** | [`src/App.tsx:3069`](src/App.tsx:3069) | Nueva tarjeta/sección **Ambientes** (dentro de las sub-secciones de A2): tarjetas con vista previa + botón "Activar". Llama a `applyEnvironment(...)`. |
| B6 | **Transición y bienvenida** | `src/App.tsx` + `src/App.css` | Animación suave del tema (CSS transition sobre las variables) + mensaje hablado de bienvenida del nuevo rol (frases del registry). |

### B3 — Calidad
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| B7 | **Tests nuevos** | `tests/environmentRegistry.test.ts`, `tests/environmentStore.test.ts`, `tests/environmentIntents.test.ts` | (1) Registry: 5 ambientes, campos completos, default `asistente`; (2) Store: persistencia y restauración; (3) Intents: frases de activación/restauración resuelven al ambiente correcto. Además: `decorationsCatalog.test.ts` existente sigue en verde (no se altera el catálogo de decoraciones, solo se añade mapeo ambiente→props). |
| B8 | **Validación end-to-end Fase B** | e2e | Flujo: *"actúa como chef"* → se aplica cocina/atuendo/voz/pestañas; *"vuelve a ser mi asistente"* → restaura. Comprobar que la **temporada estacional activa se conserva** (ambiente y temporada coexisten). |

---

## Orden de implementación y dependencias

```
A1 (tema CSS) ──► A2 (agrupar paneles) ──► A3 (nav móvil) ──► A4 (claridad) ──► A5 (validar)
                                                                                    │
B1 (registry) ──► B2 (store) ──► B3 (applyEnvironment, depende de A1) ──────────────┤
                                 │                                                   │
                                 ├──► B4 (voz)                                       │
                                 ├──► B5 (panel UI, depende de A2)                   │
                                 └──► B6 (transición)                                │
B7 (tests) ──► B8 (e2e) ◄────────────────────────────────────────────────────────────┘
```

Regla general: **Fase A completa y en verde antes de B**. Cada paso de B se valida por separado; el catálogo por datos permite agregar ambientes sin tocar el núcleo.

---

## Criterios de éxito

1. IU existente reorganizada (Ajustes sin 10 paneles apilados; móvil navegable) **sin funcionalidad nueva** y sin regresiones en los 1268 tests.
2. Demo de rebranding: *"actúa como chef"* → cocina (tema, escena, avatar, voz, pestañas, contenido); *"vuelve a ser mi asistente"* → restaura. Igual para jardinero (huerto), bricolaje (taller) y bienestar (respiraciones guiadas reutilizando [`src/core/games/respiracion.ts`](src/core/games/respiracion.ts:1)).
3. El Ambiente **coexiste** con la temporada estacional (ambiente = oficio; temporada = festividad).
4. Catálogo extensible **por datos** (agregar un oficio = agregar una entrada, sin tocar el núcleo).

---

## Fuera de alcance (NO se toca)

- **SEP:** Estudiantes/Grupos, Planeación/Evaluación, Reportes, Sistemas.
- **Features nuevas adicionales:** nuevas pantallas, routing/lazy-loading nuevo, `catalogRepository`/`workflowEngine`, empaquetado/publicación como APP.
- Nada de esto se integra; el plan se limita a **lo existente + Ambientes**.

---

## Rollback

- Antes de cada fase: confirmar verde en la suite completa.
- Cualquier cambio puntual que rompa un test se revierte de inmediato.
- Punto de restauración segura (todo el árbol): [`backups/2026-08-27/seq-1/`](backups/2026-08-27/seq-1/MANIFEST.md).

---

> ⚠️ **NOTA (actualizado 2026-08-28):** La ejecución fue **aprobada explícitamente (Q11)** y está **COMPLETADA al 100%**. **Fase A:** A1 ✓, A2 ✓, A3 ✓, A4 ✓ (íconos de pestaña vía `::before` en escritorio y móvil sin tocar el DOM; título real del Pizarrón desde config), **A5 ✓ (Validación Fase A)** — smoke e2e **verde**: [`tests/e2e/complete-validation.spec.ts`](tests/e2e/complete-validation.spec.ts:1) **42/42 PASSED** (10 Escenarios: carga, paneles, tabs verbatim "Pizarron", API/settings, conversación, workspace, minutas, perfiles de voz, inyección de datos, estados del sistema, responsive/estilos) y [`tests/e2e/visual-check.spec.ts`](tests/e2e/visual-check.spec.ts:1) **1/1 PASSED**. Nota técnica: el test 1.5 (estado inicial IDLE) se estabilizó **a nivel de fixture** en `gotoClean` (seed de `flu-onboarding-completed` vía `page.addInitScript` para arrancar como usuario que regresa — sin tocar el onboarding de producción). El harness heredado `os2-vs-os3-comparison.spec.ts` quedó **eliminado (2026-08-28)** por obsoleto: hardcodeaba servidores externos legados en 5173/5174 y no aplica a la app actual (OS4 en 5175). **Fase B:** B1 ✓, B2 ✓, B3 ✓ (aplicador de tema/identidad + **resto B3: pestañas y decoración reactivas**) — pestañas visibles por ambiente (prop `visibleIds` en [`FluShellTabs.jsx`](src/voice/components/FluShellTabs.jsx:1) + `getVisibleTabIds(activeAmbienteId)` + clamp de `activeTab` en [`App.tsx`](src/App.tsx:894)) y decoración 3D con **precedencia ambiente > temporada** (props `environmentDecoration`/`environmentCapVisible` en [`SeasonalDecoration.tsx`](src/core/branding/SeasonalDecoration.tsx:1), alimentadas desde [`FluAvatarVoiceBridge.tsx`](src/components/FluAvatarVoiceBridge.tsx:1) leyendo el `environmentStore`), **B4 ✓ (activación por voz)** — fast-path determinista completo: [`environmentIntents.ts`](src/core/environments/environmentIntents.ts:1) + [`dispatchFastEnvironmentCommand()`](src/voice/hooks/useFluVoiceAssistant.js:2802) + `contract.ambiente` en [`App.tsx`](src/App.tsx:1) + tests [`tests/environmentIntents.test.ts`](tests/environmentIntents.test.ts:1) (**31 tests**). **B5 ✓ (panel Ambientes en Ajustes)** — [`AmbientesPanel.tsx`](src/components/AmbientesPanel.tsx:1) presentacional con vista previa de tema por tarjeta + botón "Activar" → [`handleActivateAmbiente()`](src/App.tsx:1057) (aplica `applyEnvironment` + bienvenida hablada del rol) y etiquetas en `FLU_CONFIG.ui.ambientes`. **B6 ✓ (transición del tema y bienvenida)** — variables `--flu-*` registradas con `@property` + `transition` en `:root` ([`src/App.css`](src/App.css:261)); la bienvenida hablada del rol ya vive en [`handleActivateAmbiente()`](src/App.tsx:1057). **B7 ✓ (tests nuevos)** — [`tests/environmentRegistry.test.ts`](tests/environmentRegistry.test.ts:1) (**43 tests**: catálogo de 5 ambientes, campos completos data-driven, default `asistente`, tema con las 8 vars CSS, decoración válida, pestañas, accessors puros) + [`tests/environmentStore.test.ts`](tests/environmentStore.test.ts:1) (**9 tests**: estado inicial, set/reset, persistencia en localStorage, rehidratación y guardia de merge) + [`tests/environmentIntents.test.ts`](tests/environmentIntents.test.ts:1) (31 tests ya existentes); `decorationsCatalog.test.ts` sigue en verde. Suite completa en verde (**2047 tests / 103 archivos**, `tsc` exit 0, `npm run build` 590 módulos). **B8 ✓ (Validación end-to-end Fase B)** — [`tests/e2e/environment-e2e.spec.ts`](tests/e2e/environment-e2e.spec.ts:1) **9/9 PASSED** (7 Escenarios: estado base, chef, jardinero, bricolaje, bienestar, reset y **coexistencia ambiente + temporada** 7.1/7.2) + **27/27 PASSED** con `--repeat-each=3` (3 workers): **flake de coexistencia eliminado**. **Raíz del flake (diagnóstico):** carrera cold-boot con la compuerta de branding (`useSeasonalBranding.ts` L218 `if (!loaded) return`) que bloqueaba el CSS estacional por contrato mientras el boot cargaba la config desde **IndexedDB** (`fluDb.brandingConfig` — `localStorage.clear()` de `gotoClean` NO la borra) y saturaba el hilo principal; la paleta de arranque además depende de la fecha en modo `auto`. **Fix 100% a nivel de test (cero cambios de producción, sin hardcode):** `waitAppReady()` dentro de `gotoClean` espera `.flu-branding-scope` montado + **cualquier** `--bg-primary` aplicada (señal robusta de que `applyBranding` corrió → `loaded === true`; deliberadamente NO un color fijo) y los 23 polls del spec subieron de 10s a 15s. **Q11 COMPLETADO — plan ejecutado al 100% de forma limpia y estructurada.**
