# Plan de IMPLEMENTACIÓN: Catálogos Dinámicos (DB-backed) — Ambientes, Temporadas y Catálogos de Datos

- **Fecha:** 2026-08-28 (America/Mexico_City)
- **Estado:** PROPUESTO — pendiente de aprobación. **No se ejecuta nada en producción** hasta autorización expresa (regla "no ejecutes nada" vigente).
- **Documento base:** [`plans/plan-ejecucion-reorganizacion-ambientes.md`](plans/plan-ejecucion-reorganizacion-ambientes.md:1) (COMPLETADO Q11).
- **Objetivo:** convertir los catálogos estáticos (ambientes, temporadas/paletas, bancos de juego, perfiles, sinónimos de voz, etc.) en **catálogos dinámicos**: registros persistentes en IndexedDB/Dexie que se **fusionan** con los built-in en runtime, manteniendo el esquema existente, sin parches ni hardcode y sin regresiones.
- **Patrón único a replicar:** [`src/core/multiuser/participantRegistry.ts`](src/core/multiuser/participantRegistry.ts:1) — registro DB-backed (Dexie) + esquema con validación + CRUD (register/upsert/get/list/remove) + tupla `Sync` + UUIDv4 + `addAuditLog` + DI `{ db, config, now, newId }`.
- **Alcance:** SOLO catálogos existentes + gestión de datos. **NO SEP**, NO pantallas nuevas, NO routing/lazy-loading nuevo, NO empaquetado APP.
- **Prerequisitos:**
  - Suite completa en verde (baseline actual: **2047 tests / 103 archivos**, `tsc` exit 0, `build` 590 módulos) antes de cualquier cambio.
  - Respaldo full antes de ejecutar (mismo procedimiento de respaldo usado en Q6).

---

## 0. Principio y arquitectura común

### 0.1 El patrón de referencia (participantRegistry)

[`createParticipantRegistry()`](src/core/multiuser/participantRegistry.ts:111) demuestra en producción el patrón exacto:

1. **Tipos de registro** en la capa de DB ([`fluDatabase.ts`](src/core/db/fluDatabase.ts:192)) con `id: UUIDv4`, `createdAt`, `updatedAt` y `sync: SyncTuple` (Obligación #7).
2. **Service por factoría** con DI `{ db, config, now, newId }` ([`participantRegistry.ts:111`](src/core/multiuser/participantRegistry.ts:111)).
3. **CRUD**: `register` ([`:147`](src/core/multiuser/participantRegistry.ts:147)), `upsert` ([`:178`](src/core/multiuser/participantRegistry.ts:178)), `get` ([`:207`](src/core/multiuser/participantRegistry.ts:207)), `list` ([`:213`](src/core/multiuser/participantRegistry.ts:213)), `remove` ([`:221`](src/core/multiuser/participantRegistry.ts:221)).
4. **Validación** en cada mutación (nombre normalizado, duplicados → `{ ok:false, reason }`).
5. **Auditoría** en cada mutación vía [`addAuditLog()`](src/core/db/fluDatabase.ts:474) (Obligación #5).

### 0.2 Fusión built-in + dinámicos

Regla de oro: **el built-in es la fuente por defecto y el dinámico es una extensión**. En runtime, cada getter expone la **lista fusionada**:

```
catálogo efectivo = builtins (readonly, orden canónico) + registros dinámicos (por id único, orden alfabético)
```

- **Id reservado:** un id de built-in (ej. `chef`, `navidad`, `trivia`) **no puede sobrescribirse ni borrarse**; el usuario solo puede crear ids nuevos (o clonar un built-in bajo id propio).
- **No-borrables:** los built-in no se eliminan; solo los dinámicos.
- **Sanitización:** cada schema valida campos (hex, slug, frases no vacías, ids de pestaña válidos, claves de decoración existentes, límite de items por banco).

### 0.3 Componentes nuevos (capa compartida)

| Archivo nuevo | Contenido |
|---|---|
| `src/core/catalogs/catalogRegistry.ts` | **Núcleo genérico** `createCatalogRegistry<T>({ db, table, schema, now, newId })` que implementa CRUD + `Sync` + auditoría + protección de ids reservados + validación por schema. Reutiliza `newId()`, `newSyncTuple()`, `bumpSync()`, `addAuditLog()` de [`fluDatabase.ts`](src/core/db/fluDatabase.ts:443). |
| `src/core/catalogs/catalogSchema.ts` | Validadores por tipo: `slug`, `colorHex`, `textNonEmpty`, `tabIds`, `decorationKey`, `profileId`, `voiceKey`, `bankItems` (límite), `timeoutPreset`. Más utilidades de normalización (minúsculas sin acentos para alias de voz). |
| `src/core/catalogs/mergeCatalog.ts` | `mergeCatalog(builtins, dynamic)` + `isReservedId(id, builtins)` + clonado de built-in con id nuevo. |

---

## 1. Capa de datos — `fluDatabase` v10 (nuevas tablas)

Se añade **una nueva versión Dexie** siguiendo exactamente el patrón de v3→v9 ([`fluDatabase.ts:373`](src/core/db/fluDatabase.ts:373)):

```
// v10: Tablas de Catálogos Dinámicos (2026-08-28)
this.version(10).stores({
    ambientes:        'id, nombre, createdAt',          // ambientes dinámicos (EnvironmentDefinition)
    paletas:          'id, name, createdAt',            // temporadas/paletas dinámicas (Palette)
    gameBanks:        'id, tipo, createdAt',            // bancos de contenido de juegos (*_BANK)
    voiceSynonyms:    'id, tipo, createdAt',            // sinónimos de voz (CONFIG_NOUNS, MODE_SYNONYMS, aliases, COLOR_NAME_HEX)
    profiles:         'id, profileId, createdAt',       // perfiles FLU dinámicos (FLU_PROFILES)
    participationProfiles: 'id, profileId, createdAt',  // PARTICIPATION_PROFILES dinámicos
    recoveryRules:    'id, reglaId, createdAt',         // DEFAULT_RECOVERY_RULES dinámicos
});
```

Cada registro conserva el contrato de persistencia existente: `id` (UUIDv4), `createdAt`, `updatedAt`, `sync: SyncTuple`, y el **payload del catálogo** (campos del built-in que replica).

> **Nota:** las tablas solo se crean si se ejecuta la fase correspondiente. La fase 1 (ambientes + paletas) puede introducir solo `ambientes` y `paletas`; el resto se agrega por fase para mantener migraciones mínimas y reversibles.

### Reglas de migración
- Dexie preserva tablas previas automáticamente; la nueva versión solo **agrega** tablas.
- Sin borrados ni renombres de tablas existentes → sin pérdida de datos.
- Prueba de migración: apertura de `fluDb` en versión 10 sobre una base v9 con datos → datos intactos.

---

## 2. Fases de implementación (por nivel de viabilidad)

### FASE 1 — Nivel L1: datos puros, alto retorno

Son catálogos **100% datos**; convertirlos a dinámicos no toca lógica de negocio, solo las fuentes de lectura.

#### 1A. Ambientes dinámicos (el más relevante — Q9/Q10)
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| A1 | **Tabla + registry de ambientes** | `fluDatabase.ts` (v10), `src/core/catalogs/catalogRegistry.ts` | `ambientes` guarda `EnvironmentDefinition` serializable ([`environmentRegistry.ts:83`](src/core/environments/environmentRegistry.ts:83)). Registry con CRUD + validación (slug id, `frasesActivacion.es/en` no vacías, `pestanas.mostrar ⊆ ENVIRONMENT_TAB_IDS`, `tema.vars` solo claves de `ENVIRONMENT_CSS_VAR_KEYS`, `tema.decoracion` ∈ claves existentes de `DECORATION_MAP`). |
| A2 | **Getters fusionados** | [`environmentRegistry.ts:455`](src/core/environments/environmentRegistry.ts:455) | `getAmbientes()` → built-ins + dinámicos. `isAmbienteId()` ([`:465`](src/core/environments/environmentRegistry.ts:465)), `getVisibleTabIds()` ([`:473`](src/core/environments/environmentRegistry.ts:473)), `getEnvironmentCssVars()` ([`:483`](src/core/environments/environmentRegistry.ts:483)) operan sobre la lista fusionada (caché en memoria recargable tras mutación). |
| A3 | **Resolución por voz fusionada** | [`environmentIntents.ts:37`](src/core/environments/environmentIntents.ts:37) | `resolveEnvironmentIntent()` itera `getAmbientes()` (ya fusionado) → un ambiente dinámico con frases "modo x / actúa como x" se activa por voz sin tocar el fast-path. `normalizeEnvironment()` ([`:63`](src/core/environments/environmentIntents.ts:63)) valida contra `isAmbienteId()` fusionado. |
| A4 | **Store + blindaje** | [`environmentStore.ts:85`](src/store/environmentStore.ts:85) | El `merge` persistido ya cae a `asistente` ante id inválido; al volverse dinámico un id guardado que ya no existe (usuario borró el ambiente) cae al default. Sin cambios de contrato. |
| A5 | **UI de gestión (Ajustes)** | `src/App.tsx` (sub-sección existente de A2, [`src/App.tsx:3222`](src/App.tsx:3222)) | En la sub-sección FLU se añade la tarjeta **"Mis ambientes"**: listado (built-in = fijo, dinámicos = editable/borrable), formulario crear/editar (nombre, tagline, icono, frases de activación ES/EN, tema vars, decoración, pestañas visibles), y botón **Clonar built-in** (parte de una copia editable con id nuevo). Sin pantalla nueva. |

#### 1B. Temporadas / Paletas dinámicas
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| B1 | **Tabla + registry de paletas** | `fluDatabase.ts` (v10), `catalogRegistry.ts` | `paletas` guarda `Palette` ([`seasonalPalettes.ts:13`](src/core/branding/seasonalPalettes.ts:13)). Validación: `colors` con claves exactas del set de variables CSS y valores `#RRGGBB`; `decoration`/`cssClass` opcionales. |
| B2 | **Getters fusionados** | [`seasonalPalettes.ts:40`](src/core/branding/seasonalPalettes.ts:40) | `getPalette(key)` / `getAllPalettes()` → `PALETTES` + dinámicas. `getActiveSeason()` ([`seasonalCalendar.ts:299`](src/core/branding/seasonalCalendar.ts:299)) y `applyPaletteToCSS()` ([`seasonalPalettes.ts:587`](src/core/branding/seasonalPalettes.ts:587)) operan sobre la fusión. |
| B3 | **Alias de voz de temporada fusionados** | [`configCommands.js:189`](src/voice/lib/configCommands.js:189) | `buildSeasonAliases()` y `matchSeason()` ([`:228`](src/voice/lib/configCommands.js:228)) construyen aliases desde el set fusionado (los nombres de paleta dinámicos se activan por voz). |
| B4 | **UI de gestión (Ajustes)** | `src/App.tsx` | Tarjeta **"Mis temporadas"**: crear/editar/borrar paletas, clonar built-in, y (opcional) asignar a un evento del calendario. Reutiliza `useSeasonalBranding` ([`useSeasonalBranding.ts:155`](src/core/branding/useSeasonalBranding.ts:155)). |

#### 1C. Bancos de contenido de juegos (16 bancos `*_BANK`)
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| C1 | **Tabla + registry de bancos** | `fluDatabase.ts` (v10), `catalogRegistry.ts` | `gameBanks` guarda por `tipo` (ej. `ahorcado`, `trivia`, `cuento`, `loteria`, …) el array de items del banco. Validación por tipo (items con campos requeridos, límite por banco). |
| C2 | **Lectura fusionada por juego** | `src/core/games/*.ts` | Cada juego (ej. [`ahorcado.ts:25`](src/core/games/ahorcado.ts:25)) lee su banco vía `getGameBank(tipo)` que devuelve built-in + dinámicos. Si el banco dinámico está vacío, se usa el built-in (sin romper `gameCatalog.ts` / `GAME_IDS`). |
| C3 | **UI de gestión (Ajustes)** | `src/App.tsx` | Tarjeta **"Contenido de juegos"**: ver/editar el banco de cada juego, agregar items (palabras, preguntas, rimas, canciones…). Guardrails de formato por tipo. |

#### 1D. Sinónimos de voz y listas de datos (configCommands)
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| D1 | **Tabla + registry de sinónimos** | `fluDatabase.ts` (v10), `catalogRegistry.ts` | `voiceSynonyms` por `tipo` (`configNoun`, `modeSynonym`, `avatarAlias`, `colorHex`, `language`, `provider`, `emotion`). |
| D2 | **Lectura fusionada** | [`configCommands.js:95`](src/voice/lib/configCommands.js:95) | `CONFIG_NOUNS`, `MODE_SYNONYMS` ([`:240`](src/voice/lib/configCommands.js:240)), `AVATAR_COMPONENT_ALIASES` ([`:563`](src/voice/lib/configCommands.js:563)) y `COLOR_NAME_HEX` ([`:566`](src/voice/lib/configCommands.js:566)) se resuelven contra el set fusionado. El usuario puede añadir un alias nuevo ("la palabra de activación x significa…", "el color 'esmeralda' es #50C878"). |
| D3 | **Perfiles de participación y emociones** | [`participantProfiles.ts:36`](src/lib/participantProfiles.ts:36), [`voiceConfigCatalog.ts:126`](src/core/config/voiceConfigCatalog.ts:126) | `PARTICIPATION_PROFILES` y `PERSONALITY_EMOTIONS` pasan a tablas + fusión (validación de keys contra el set de emociones existente). |

### FASE 2 — Nivel L2: requieren esquema + UI con guardrails
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| E1 | **FLU_PROFILES dinámicos** | [`appConfig.ts:288`](src/core/config/appConfig.ts:288) | Tabla `profiles` + fusión. El selector de rol de sesión ([`src/App.tsx:2685`](src/App.tsx:2685)) y `applyConfigAction('applyProfile')` operan sobre la fusión. Validación de `FluProfileDefinition` ([`bridge.ts:209`](src/types/bridge.ts:209)). |
| E2 | **Pasos de onboarding** | [`fluConfig.js:758`](src/voice/lib/fluConfig.js:758) | `onboarding.steps` pasa a tabla + fusión con orden explícito. Guardrails: `id` único, texto no vacío, tipos de paso válidos. |
| E3 | **Reglas de recuperación automática** | [`autoRecovery.ts:126`](src/core/autonomy/autoRecovery.ts:126) | `DEFAULT_RECOVERY_RULES` → tabla `recoveryRules` + fusión. Validación de campos (condición, acción, prioridad). |
| E4 | **Pestañas de shell y grupos de Ajustes** | [`fluConfig.js:967`](src/voice/lib/fluConfig.js:967), [`src/App.tsx:3157`](src/App.tsx:3157) | `ui.tabs.items` y `SETTINGS_GROUPS` → dinámicos con guardrails estrictos (solo reordenar/ocultar pestañas existentes; los grupos de Ajustes solo se reordenan/renombran, no se crean paneles nuevos). |
| E5 | **Presets de timeout HTTP** | [`httpClient.ts:27`](src/core/ai/httpClient.ts:27) | `REQUEST_TIMEOUT_PRESETS` → tabla + fusión (nombre + ms, límite). |

### FASE 3 — Nivel L3: catálogos con código incrustado (requieren plugin keys)
| # | Tarea | Archivos | Detalle |
|---|-------|----------|---------|
| F1 | **Motores de juego** | [`gameCatalog.ts:37`](src/core/games/gameCatalog.ts:37) | `GAME_INTENT_ENTRY` incluye `engine: () => GameEngine` (código). Convertir a dinámico = registrar un **plugin key**: `{ id, aliases, engineKey }` donde `engineKey` resuelve contra un registro de fábricas de motor. Un juego nuevo de la app se registra en el registry de plugins (una línea); la voz y el catálogo ya son data-driven. |
| F2 | **Decoraciones 3D** | [`decorationsCatalog.ts:80`](src/avatar/decorations/decorationsCatalog.ts:80) | `DECORATIONS` construyen grupos 3D (código). Convertir = registry de **builders de decoración** por `decorationKey`; el catálogo (datos) apunta a keys. Las claves existentes se conservan intactas ([`decorationsCatalog.test.ts:17`](tests/decorationsCatalog.test.ts:17) en verde). |
| F3 | **Expresiones** | [`expressionRegistry.ts:75`](src/core/anim/expressionRegistry.ts:75) | Ya es data-driven (`ExpressionDef[]`); la conversión es trivial (tabla + fusión). `getValidExpressions` ([`:429`](src/core/anim/expressionRegistry.ts:429)) y `getGroupExpressions` ([`:445`](src/core/anim/expressionRegistry.ts:445)) operan sobre la fusión. |

---

## 3. UI de gestión (transversal)

- **Ubicación:** dentro de la pestaña **Ajustes** existente, en las sub-secciones de A2 ([`src/App.tsx:3144`](src/App.tsx:3144)). **No** se crean pestañas ni rutas nuevas.
- **Patrón UI:** reutilizar el estilo de `ParticipantsPanel` ([`src/components/ParticipantsPanel.tsx:31`](src/components/ParticipantsPanel.tsx:31)) y `AmbientesPanel` ([`src/App.tsx:3222`](src/App.tsx:3222)): tarjeta `<details>` con lista + formulario + botones.
- **Cada tarjeta muestra:** built-ins (fila fija con badge "sistema") y dinámicos (editar/borrar). Botón **"＋ Crear"** y **"Clonar"** para partir de un built-in.
- **Validación en vivo** con los mismos mensajes de `catalogSchema.ts` (rechazo con `reason` legible).

---

## 4. Calidad y pruebas

| # | Tarea | Detalle |
|---|-------|---------|
| T1 | `tests/catalogRegistry.test.ts` | Núcleo genérico: CRUD, duplicados, ids reservados no borrables, SyncTuple, auditoría, sanitización por tipo. |
| T2 | `tests/dynamicAmbientes.test.ts` | Fusión built-in+dinámicos en `getAmbientes/isAmbienteId/getVisibleTabIds`; resolución por voz de un ambiente dinámico ([`environmentIntents.test.ts:32`](tests/environmentIntents.test.ts:32) extendido); `normalizeEnvironment` con id dinámico. |
| T3 | `tests/dynamicPaletas.test.ts` | Fusión de paletas; alias de voz de temporada dinámica (`matchSeason`); `applyPaletteToCSS` sobre paleta dinámica. |
| T4 | `tests/dynamicGameBanks.test.ts` | Lectura fusionada por banco; banco dinámico vacío → built-in; guardrails por tipo. |
| T5 | `tests/migration-v10.test.ts` | Apertura de `fluDb` v10 sobre base v9 con datos → sin pérdida (usa Dexie testing con db de prueba). |
| T6 | **e2e** | (1) Crear ambiente por UI → `"actúa como <ambiente>"` por voz → se aplica tema/atuendo/pestañas; (2) crear paleta → se activa la temporada; (3) regresión: suite completa + `environment-e2e.spec.ts` **9/9 + 27/27** en verde. |

**Criterios de éxito**
1. Suite completa en verde tras cada fase (baseline 2047 tests/103 archivos; `tsc` exit 0; `build` 590 módulos).
2. Un ambiente/temporada/banco creado por el usuario persiste entre sesiones (IndexedDB) y se activa por voz igual que un built-in.
3. Los built-in quedan intactos y no editables; ningún id reservado puede borrarse.
4. Sin pantallas nuevas, sin routing nuevo, sin SEP.

---

## 5. Orden de implementación y dependencias

```
FASE 1  ──►  1A ambientes (A1→A5) ──► 1B paletas (B1→B4) ──► 1C bancos (C1→C3) ──► 1D sinónimos (D1→D3)
               │                          │                        │
FASE 2  ◄──────┴──────────────────────────┴────────────────────────┴──► E1..E5 (esquema + UI + guardrails)
FASE 3  ◄──────┴───────────────────────────────────────────────────────► F1..F3 (plugin keys)
T1..T5  (unit) ──► T6 (e2e) ◄──────────────────────────────────────────────────────────┘
```

- Cada fase termina en verde y se respalda antes de la siguiente.
- 1A es la **fase piloto** (mayor valor, menor riesgo): valida el patrón genérico completo antes de extenderlo a los demás catálogos.
- Las fases 2 y 3 solo se ejecutan si 1A/1B quedan validadas y autorizadas.

---

## 6. Fuera de alcance (NO se toca)

- **SEP:** Estudiantes/Grupos, Planeación/Evaluación, Reportes, Sistemas.
- **Features nuevas:** pantallas nuevas, routing/lazy-loading nuevo, `screenRegistry`/`workflowEngine` (solo existen en docs como features SEP fuera de alcance), empaquetado/publicación como APP.
- Nada de esto se integra; el plan se limita a **catálogos existentes → dinámicos** dentro de la shell actual.

---

## 7. Rollback

- Antes de cada fase: confirmar verde en la suite completa.
- Cada cambio puntual que rompa un test se revierte de inmediato.
- Punto de restauración segura: respaldo full previo a la ejecución (procedimiento de respaldo Q6).
- Al ser tablas **nuevas** en `version(10)` (solo `ADD`), la reversión de una fase = eliminar la tabla/versión sin afectar datos previos.

---

> ⚠️ **Estado: PROPUESTO — sin ejecutar.** El patrón único a replicar es [`participantRegistry.ts`](src/core/multiuser/participantRegistry.ts:1) (Dexie CRUD + esquema con validación + fusión con built-in + UI de gestión). Este plan está listo para ejecutarse por fases cuando lo autorices explícitamente; por ahora **no se modifica ningún archivo de producción**.
