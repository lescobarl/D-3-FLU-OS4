# FLU OS 2.0 — Reglas Absolutas de Ingeniería

> Este archivo es vinculante. El agente DEBE leer y cumplir todas las reglas aquí definidas antes de cualquier operación.
> Este es el ÚNICO archivo de constraints. No existen archivos duplicados.

---

## 1. PROHIBICIONES ABSOLUTAS

| # | Regla | Descripción |
|---|-------|-------------|
| 0 |NO! notificar hasta tener 100% validado| se debe notificar la conclusion de una tarea hasta que este 100% validada , con prubas productivas|
| 0.1 |Integra en tus validaciones screenshot para que certifiques que todo esta bien!|
| 0.2 |No esta permitido genracion de objetos dummy todo debe ser perfectamente funional|
| 0.3 |Las validaciones y pruebas deben incluir auditorias visuales , funcionales y tecnicas completas asegurando funcionalidad y visualizacion completa|
| 1 | ❌ NO ENTREGAS PARCIALES O SIN VALIDAR | Cada tarea resuelta debe estar completa , validada tanto funcional como visualmente  |
| 1 | ❌ NO HARDCODE | Toda configuración debe venir de variables de entorno, archivos de configuración o inyección de dependencias. Prohibido escribir valores quemados en el código. |
| 2 | ❌ NO PARCHES | Si se detecta un error, se debe corregir de fondo. No se permiten parches de código para casos de borde. Cero soluciones temporales. |
| 3 | ❌ NO `new` en lógica de negocio | Prohibida la instanciación directa de clases con operador `new` dentro de la lógica de negocio. Toda dependencia debe inyectarse mediante interfaces. |
| 4 | ❌ NO commits directos a `main`/`master` | El flujo de desarrollo exige ramas de características aisladas (`feature/*`). Prohibido commitear directo a producción. |
| 5 | ❌ NO try-catch vacíos | No se permiten bloques try-catch vacíos o que silencien errores. Toda excepción debe ser capturada, registrada en el log de auditoría y propagada con contexto descriptivo. |
| 6 | ❌ NO modificar +2 archivos de dominio sin interfaz común | Si una tarea requiere modificar más de dos archivos de dominio distintos, el agente debe proponer primero un diseño de interfaz común antes de implementar. |
| 7 | ❌ NO cambios temporales o rutas dobles | Cualquier cambio debe ser realizado de fondo. No se permiten archivos duplicados para prueba, comentarios de código legacy, ni implementaciones paralelas. |
| 8 | ❌ NO borrado físico en offline | El borrado es estrictamente lógico (`deleted: true`), nunca físico en offline. |
| 9 | ❌ NO a entregas parciales, todo se debe entregar completo de acuerdo a la solicitud |
| 10 | ❌ NO a grandes respuestas, solo cualdo se solicita el detalle responder detalladamente, de modo contrario responder en resumen lo mas claro y preciso posible |
| 11 | ❌ NO casos de prueba arbitrarios o duplicados | Prohibido crear casos de prueba de manera arbitraria o duplicados. Cada test debe cubrir una regla/escenario real y único, sin solaparse con otros tests existentes. |
| 12 | ❌ NO rutas dobles | Prohibido crear rutas duplicadas o implementaciones paralelas para el mismo destino. Una única ruta/flujo por intención, convergente en una sola fuente de verdad. |
| 13 | ❌ NO parches | Prohibido aplicar parches o soluciones temporales para casos de borde. Todo error se corrige de fondo y de forma definitiva. |
| 14 | ❌ NO basura ni duplicados | Prohibido dejar código o archivos inútiles, obsoletos o duplicados. El proyecto se depura diariamente tanto en código como en archivos. |
| 15 | ❌ NO disculpas | Las disculpas son inaceptables. Todo debe ser consistente con las definiciones y constraints. Ante un error se corrige de fondo, no se justifica. |
| 16 | ❌ NO errores de programación/lógica/implementación | Los errores de programación, lógica o implementación son inaceptables. Cada cambio debe ser correcto, validado y consistente desde la primera entrega. |

## 2. OBLIGACIONES ESTRICTAS

| # | Regla | Descripción |
|---|-------|-------------|
| 1 | ✅ Inyección de Dependencias | Toda dependencia debe ser inyectada mediante interfaces. Prohibida la instanciación directa. Garantiza desacoplación total y testabilidad. |
| 2 | ✅ JSDoc en todo componente/método | Todo nuevo componente o método debe incluir comentarios JSDoc que expliquen el contrato de la interfaz, no la implementación interna. |
| 3 | ✅ Principio de Responsabilidad Única (SRP) | Cada archivo/clase debe tener una única razón para cambiar. |
| 4 | ✅ Tests de inmutabilidad | Toda pieza desarrollada debe incluir un test que valide que la arquitectura sigue siendo agnóstica al negocio tras los cambios. |
| 5 | ✅ Log de auditoría | Todo cambio en configuración debe ser registrado en un log inmutable de auditoría. |
| 6 | ✅ UUIDv4 en toda inserción | Queda estrictamente prohibido el uso de llaves numéricas secuenciales. Toda inserción genera UUIDv4 en texto plano. |
| 7 | ✅ Tupla de sincronización obligatoria | Cada tabla incorpora obligatoriamente `[revision, updated_at, deleted]`. Las modificaciones incrementan `revision` atómicamente y actualizan `updated_at` en UTC. |
| 8 | ✅ Gestión de errores con contexto | Toda excepción debe ser capturada, registrada en el log de auditoría y propagada con un contexto descriptivo. |
| 9 | ✅ Aislamiento de contexto de IA | Cada llamada de inferencia debe inicializar un contexto ciego aislado: `escuela_id + alumno_id + materia_id`. Purgar variables globales residuales antes de cada inferencia. |
| 10 | ✅ Circular Buffer en audio | El pipeline de audio debe implementar vaciado cíclico cada 30 segundos para evitar fugas de memoria. |
| 11 | ✅ requestAnimationFrame para 3D | El renderizado 3D del avatar debe aislarse con `requestAnimationFrame`. Comunicación con IndexedDB via `postMessage`. |
| 12 | ✅ Consistencia con las definiciones | Todo cambio debe ser consistente con las definiciones y constraints vigentes. Prohibido contradecir o divergir de lo ya definido. |
| 13 | ✅ Depuración diaria | El proyecto se depura diariamente: eliminar código y archivos inútiles, obsoletos o duplicados, tanto en `src/` como en `tests/`, `plans/` y raíz. |
| 14 | ✅ Tests únicos y no duplicados | Cada caso de prueba debe ser único, no arbitrario y no duplicado. Antes de crear un test, verificar que no exista uno equivalente. |
| 15 | ✅ Fuente única por intención | Cada intención/ruta/flujo converge en una única fuente de verdad. Prohibido implementar la misma lógica en dos lugares. |

## 3. STACK TECNOLÓGICO OBLIGATORIO

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Lenguaje | TypeScript (estricto) | Tipado seguro |
| Build | Vite 5 + React 18 | Rapidez, HMR, PWA |
| Routing | React Router v6 | Navegación lazy de módulos |
| Estado Global | Zustand | Ligero, persistencia selectiva |
| DB Local | Dexie.js (wrapper IndexedDB) | Versioning, queries reactivas |
| Estilos | Tailwind CSS 3 | Utility-first, purge automático |
| PWA | vite-plugin-pwa | Service Worker, caching offline |
| Testing | Vitest + React Testing Library | Tests de inmutabilidad |
| 3D Avatar | Three.js + @react-three/fiber | Renderizado 3D offline |
| IA Local | WebLLM + Orama + Whisper WASM + Piper TTS + Rhubarb WASM | Edge computing completo |

## 4. CONVENCIONES DE CÓDIGO

- **Archivos**: PascalCase para componentes (`FluAvatar.tsx`), camelCase para hooks/utils (`useAvatarState.ts`)
- **Un componente por archivo**: Cada archivo exporta un único componente principal
- **Estructura de carpetas**: `src/modules/[bloque]/[modulo]/Componente.tsx`
- **Interfaces**: Prefijo `I` (ej. `IAvatarState`), tipos sin prefijo
- **Archivos de tipos**: `src/types/[dominio].ts`

## 5. ESTRUCTURA DEL PROYECTO

```
flu-os/
├── public/
│   ├── models/          # Modelos 3D (FBX, GLTF)
│   ├── seeds/           # Archivos JSON de carga inicial
│   └── sounds/          # Assets de audio
├── src/
│   ├── components/      # Componentes compartidos
│   ├── core/            # Lógica de negocio pura (sin React)
│   │   ├── ai/          # Motores de IA
│   │   ├── db/          # Base de datos y repositorios
│   │   └── sync/        # Motor de sincronización
│   ├── hooks/           # Custom hooks de React
│   ├── modules/         # Módulos de interfaz (lazy loaded)
│   │   ├── flu/         # Bloque de identidad core
│   │   ├── operaciones/ # Bloque de aula
│   │   ├── gestion/     # Bloque escolar
│   │   └── configuracion/ # Bloque de infraestructura
│   ├── routes/          # Configuración de rutas
│   ├── store/           # Stores de Zustand
│   ├── types/           # Tipos e interfaces globales
│   └── utils/           # Utilidades
├── plans/               # Planes de módulos (especificaciones para Code)
├── CONTEXTO_FLU_OS2.md  # Especificación completa del proyecto
├── CLAUDE.md            # Este archivo (reglas vinculantes — ÚNICO archivo de reglas)
└── tailwind.config.js
```

## 6. VALIDACIÓN PRE-COMMIT

Antes de realizar un commit, el agente DEBE:
1. Ejecutar `npm run test:full` (suite completa) y confirmar que todos los tests pasan
2. Verificar que no hay código hardcodeado
3. Verificar que no hay try-catch vacíos
4. Verificar que toda nueva tabla tiene tupla `[revision, updated_at, deleted]`
5. Si falla algo, revertir el último cambio automáticamente

> **📚 Especificación del proyecto:** [`CONTEXTO_FLU_OS2.md`](CONTEXTO_FLU_OS2.md) — El agente DEBE leer este archivo como fuente de especificación del sistema.

## 7. CONSTRAINTS ARQUITECTÓNICOS

| # | Regla | Descripción |
|---|-------|-------------|
| 1 | 🏗️ Catálogos como Metadata + UI Configuradora | Todos los catálogos del sistema (roles, grados, tipos de junta, entidades SEP, regiones, etc.) DEBEN gestionarse como metadata unificada en una sola tabla `app_catalogos` con estructura `{ id, tipo_catalogo, codigo, valor, metadata_json, orden, padre_id, activo, ...sync_tuple }`. DEBE incluir una **IU de Configuración de Catálogos** que permita: definir nuevos tipos de catálogo con su schema (campos, tipos, obligatorios), CRUD de entidades, relaciones jerárquicas, e importación/exportación. Nuevos catálogos se agregan desde la UI, no como código. |
| 2 | 🏗️ Flujos Configurables (Workflow Engine) + UI Diseñadora | Todos los flujos operativos del sistema (asistencia, tareas, juntas CTE, ceremonias, sincronización, etc.) DEBEN ser configurables mediante un motor de workflows. Cada flujo se define como datos: `{ id, nombre, pasos: [{ orden, pantalla_id, evento, componente, config, transiciones }] }`. DEBE incluir una **IU Diseñadora de Flujos** que permita: definir pasos, eventos y transiciones visualmente, asignar componentes/pantallas a cada paso, configurar reglas de validación, y probar el flujo. Las pantallas se construyen al vuelo. Los componentes se cargan lazy. Nuevos flujos se agregan desde la UI, no como código. |
| 3 | ⏳ NO timeout:null en comandos | Prohibido usar `timeout: null` en `execute_command`. Todo comando debe tener un timeout finito (máx. 30s para comandos rápidos, máx. 120s para instalaciones). Para servidores largos (vite, npm start, etc.), usar timeout de 15-30s solo para verificar arranque y luego verificar con otro comando. El uso de `timeout: null` causa el botón "Run" y bloquea el chat. |
| 4 | ✅ Commit por hito funcional | Commitea CADA hito funcional en cuanto quede validado en verde (tests + tipos). No acumular cambios para un solo commit al final. Cada commit es un checkpoint seguro y pequeño que acelera el avance y permite revertir sin perder el resto del trabajo. |
| 5 | 🧪 Tests de lógica pura en entorno `node` | Solo los tests que renderizan UI usan `jsdom`. Los tests de lógica pura corren en `node` (arranque mucho más rápido). El arranque de jsdom domina el tiempo cuando la suite es grande. |
| 6 | 📊 Medir antes de asumir | Antes de "optimizar" la config de tests/build, hacer un benchmark controlado (baseline vs. cambio) y quedarse con la opción más rápida medida. Nunca asumir que una teoría (ej. `threads` > `forks`) es cierta sin medir. |
| 7 | 🚫 Cero warnings de framework en tests | Eliminar warnings de `act()`/render en tests. Son la causa raíz de la flakiness y ralentizan el debug. |
| 8 | 🪟 Mitigar límite de longitud de línea Windows | En Windows, comandos con cadenas gigantes fallan con "The command line is too long". Usar mensajes de commit concisos y evitar comandos con argumentos enormes. `--no-verify` SOLO en consolidaciones puntuales ya validadas, nunca como atajo habitual. |

## 8. CONVENCIONES DE CONFIGURACIÓN EXTERNA

> Actualizado: 2026-08-19 (Fase 4 del plan `plans/analisis-hardcode-parches-rutas-2026-08-19.md`).

Estas convenciones complementan la Regla 1 (NO HARDCODE). Son vinculantes para cualquier configuración externa nueva.

| # | Convención | Descripción |
|---|------------|-------------|
| 1 | 🎛️ Configuración única centralizada | TODA configuración externa (URLs de API, branding, tipos de workspace, personalidad, STT, network probes) DEBE vivir en [`src/core/config/appConfig.ts`](src/core/config/appConfig.ts). Prohibido dispersar constantes de configuración en lógica de negocio. |
| 2 | 🌱 Patrón de variables de entorno | Cada valor configurable usa el patrón `(import.meta as any)?.env?.VITE_X || 'default'` con un **default idéntico** al valor documentado en `.env.example`. El default garantiza que la app funcione sin env vars; `.env.example` es la **única fuente de verdad** de las vars disponibles y sus comentarios documentan los valores por defecto. |
| 3 | 🛡️ Guard test de hardcode | [`tests/hardcodeGuard.test.ts`](tests/hardcodeGuard.test.ts) escanea `src/` y falla si aparece una URL literal fuera de los módulos de configuración permitidos (`appConfig.ts`, `visualConfig.js`, `musicPlayer.ts`). Es la "lint rule" pragmática del proyecto (no hay ESLint instalado). |
| 4 | 🏷️ Dominios constantes centralizados | Constantes de dominio único en módulos de datos explícitos son aceptables y están allowlisted: `SOUNDHELIX_BASE_URL` + pistas demo en [`musicPlayer.ts`](src/services/musicPlayer.ts) (datos de playlist), `GEMINI_API_KEY_URL` en [`geminiDiagnostics.js`](src/voice/lib/geminiDiagnostics.js) (mensajes de ayuda), `VISUAL_CONFIG` en [`visualConfig.js`](src/voice/lib/visualConfig.js) (config visual). Los **hosts de endpoints de API** (`generativelanguage.googleapis.com`, `api.deepseek.com`, `api.openverse.org`) NO están en el allowlist global: DEBEN vivir en `appConfig`. |
| 5 | 📢 Eventos centralizados | Prohibido `window.dispatchEvent(new CustomEvent('flu:*'))` disperso. Toda comunicación por eventos usa el bus [`src/core/events/fluEvents.ts`](src/core/events/fluEvents.ts) (`FLU_EVENTS`, `dispatchFluEvent`, `onFluEvent`). |
| 6 | 🚦 Dispatch con fuente única | La lógica de dispatch de conversación converge en `planConversationDispatch()` ([`audioMath.js`](src/voice/lib/audioMath.js:707)) como única fuente de verdad para decidir acciones de voz. |
| 7 | ⚙️ URLs configurables probadas | [`tests/configEnv.test.ts`](tests/configEnv.test.ts) valida que `appConfig.ts` lee cada `VITE_*` (con `vi.stubEnv` + `resetModules`) y que los defaults coinciden con `.env.example`. Cualquier URL de servicio nueva DEBE agregarse aquí con su test de override + default. |
| 8 | 🚫 Sin timers como parche | Prohibido usar `setTimeout` para sincronizar estado (ej. visibilidad de avatar). Los stores de Zustand sin `persist` son síncronos: `getState()` está disponible al montar. Usar llamadas deterministas (ej. `ensureAvatarPantsVisible()` en [`bunnyStore.ts`](src/avatar/store/bunnyStore.ts:378)). |
| 9 | 🧱 Handlers por responsabilidad | Los handlers de servidor deben tener una responsabilidad por función. En [`geminiProxy.ts`](src/server/geminiProxy.ts) los modos `contract` / `response` / `minute` se despachan desde `handleContract()` a `handleContractMode()` / `handleResponseMode()` / `handleMinuteMode()`. |
| 10 | 🧅 Regla de capas de voz | La lógica de voz se separa por capas: `src/voice/lib/*` = **lógica pura y testeable** (sin React, sin refs, sin efectos); `src/voice/hooks/*` = **solo orquestación, estado y efectos** (React hooks); `src/core/*` = **dominios de negocio** (catálogos, servicios, parsers). Prohibido meter negocio/parseo dentro de un hook gigante: si una decisión es testeable en aislamiento, debe vivir en `lib/` como función pura y el hook solo orquestarla. |
| 11 | 🧩 Módulos cohesivos, no 1-función-por-archivo | Al añadir helpers, agruparlos en módulos cohesivos por responsabilidad (ej. [`deterministicArbiter.js`](src/voice/lib/deterministicArbiter.js), [`audioMath.js`](src/voice/lib/audioMath.js)) en lugar de crear un archivo por función. La fragmentación excesiva dificulta la navegación. |

## 9. PROTOCOLO DE ITERACIÓN RÁPIDA (optimización de velocidad/costo)

> Vigente hasta nueva indicación. Mantiene intactas las reglas de calidad: sin hardcode, sin parches, estructurado. Actualizado: 2026-08-29.

| # | Regla | Descripción |
|---|-------|-------------|
| 1 | ⚡ Verificación por iteración mínima | El comando por defecto `npm test` ejecuta SOLO la prueba del cambio específico (`vitest run --changed --reporter=dot --silent`; añadir `-t "<nombre>"` para acotar dentro del archivo). La suite completa queda reservada a `npm run test:full`, que se usa SOLO en cierre de hitos/entregas y pre-commit (Sección 6). Esta estructura está blindada por [`tests/protocolGuard.test.ts`](tests/protocolGuard.test.ts): si `npm test` deja de ser `--changed` o se elimina `test:full`, la suite completa falla. |
| 2 | 🚪 Puerta de tipos por iteración | Correr `npx tsc -b` en cada iteración (verificación de tipos incremental). El `vite build` completo solo en cierre de hitos. El dev server + HMR sirve como capa de verificación de runtime en vivo. |
| 3 | 📦 Sin backups por iteración | No crear backups robocopy por cada iteración; solo cuando el usuario lo indique explícitamente. |
| 4 | ✂️ Edición sobre bloques ya mapeados | Aplicar `apply_diff` directamente con `start_line` y contenido ya conocido (bloques mapeados), sin re-leer archivos completos de miles de líneas. Solo re-leer un bloque si el diff falla por desajuste. |
| 5 | ⚙️ Paralelismo de herramientas | Ejecutar comandos y ediciones independientes en un solo mensaje (en paralelo) para reducir rondas de ida y vuelta. |
| 6 | 🎬 E2E solo con cambio de UI | Ejecutar playwright solo cuando el cambio altera comportamiento visual, y únicamente el spec afectado. |

## 10. PROTOCOLO DE DEPURACIÓN DIARIA Y CALIDAD (vigente)

> Estas reglas son vinculantes y complementan las secciones 1 y 2. Actualizado: 2026-09-04.

| # | Regla | Descripción |
|---|-------|-------------|
| 1 | 🧹 Depuración diaria de código | Cada jornada se elimina código inútil, obsoleto, duplicado o muerto en `src/`. Prohibido acumular basura. |
| 2 | 🗂️ Depuración diaria de archivos | Cada jornada se eliminan archivos inútiles, obsoletos o duplicados (en raíz, `plans/`, `tests/`, `reports/`). Prohibido dejar archivos huérfanos o sin referencia. |
| 3 | 🧪 Sin casos de prueba arbitrarios o duplicados | Prohibido crear tests de forma arbitraria o duplicada. Todo test cubre una regla/escenario real y único. Antes de crear uno, verificar que no exista uno equivalente. |
| 4 | 🛤️ Sin rutas dobles | Prohibido crear rutas duplicadas o implementaciones paralelas. Cada intención converge en una única fuente de verdad. |
| 5 | 🩹 Sin parches | Prohibido aplicar parches o soluciones temporales. Todo error se corrige de fondo y de forma definitiva. |
| 6 | 🙅 Sin disculpas | Las disculpas son inaceptables. Todo debe ser consistente con las definiciones y constraints. Ante un error se corrige de fondo, no se justifica. |
| 7 | 🚫 Sin errores de programación/lógica/implementación | Los errores de programación, lógica o implementación son inaceptables. Cada cambio debe ser correcto, validado y consistente desde la primera entrega. |

## 11. CONSTRAINTS CONSOLIDADOS DE ACELERACIÓN, CALIDAD Y COSTO (A–E)

> Consolidación vinculante de las reglas operativas del ciclo de desarrollo. Muchas ya están reforzadas en las secciones 7, 8, 9 y 10; esta sección las agrupa de forma completa y explícita (reglas 1–24) para que ninguna quede implícita. Actualizado: 2026-09-05.

### A. Reglas de aceleración del ciclo

| # | Regla | Descripción | Ref. |
|---|-------|-------------|------|
| 1 | ⚡ Commit por hito funcional en verde | Commitea CADA hito funcional en cuanto quede validado en verde (tests + tipos). No acumular cambios. | §7.4, §9 |
| 2 | ⚡ Verificación por iteración mínima | `npm test` corre SOLO el cambio (`--changed`; añadir `-t "<nombre>"` para acotar). Suite completa solo en cierre de hitos/pre-commit. | §9.1 |
| 3 | 🚪 Puerta de tipos por iteración | Correr `npx tsc -b` (o `tsc --noEmit`) en cada iteración. `vite build` solo en cierre de hitos. | §9.2 |
| 4 | ✂️ Edición sobre bloques ya mapeados | Aplicar `apply_diff` con `start_line` y contenido ya conocido. Solo re-leer si el diff falla por desajuste. | §9.4 |
| 5 | ⚙️ Paralelismo de herramientas | Ejecutar comandos y ediciones independientes en un solo mensaje (en paralelo). | §9.5 |
| 6 | ⏳ NO `timeout: null` | Todo comando con timeout finito (rápidos ≤30s, instalaciones ≤120s). Servidores: timeout corto solo para verificar arranque. | §7.3 |
| 7 | 📦 Sin backups por iteración | No crear backups robocopy por iteración; solo cuando el usuario lo indique. Git es el backup. | §9.3 |

### B. Reglas de calidad

| # | Regla | Descripción | Ref. |
|---|-------|-------------|------|
| 8 | 🧹 Depuración diaria de código/archivos muertos | Eliminar código y archivos inútiles, obsoletos o duplicados cada jornada (raíz, `src/`, `tests/`, `plans/`, `reports/`). | §10.1–2 |
| 9 | 🧪 Sin tests arbitrarios o duplicados | Todo test cubre una regla/escenario real y único. Verificar que no exista uno equivalente antes de crear. | §10.3 |
| 10 | 🛤️ Sin rutas dobles | Prohibido crear rutas duplicadas o implementaciones paralelas. Cada intención converge en una única fuente de verdad. | §10.4 |
| 11 | 🩹 Sin parches | Prohibido aplicar parches o soluciones temporales. Todo error se corrige de fondo y de forma definitiva. | §10.5 |
| 12 | 🧅 Separación lógica pura vs. orquestación | `src/voice/lib/*` = lógica pura testeable; `src/voice/hooks/*` = solo orquestación/estado/efectos; `src/core/*` = dominios de negocio. Si una decisión es testeable en aislamiento, vive en `lib/` como función pura. | §8.10 |
| 13 | 🎬 E2E solo con cambio de UI | Ejecutar playwright solo cuando el cambio altera comportamiento visual, y únicamente el spec afectado. | §9.6 |

### C. Rendimiento de suite

| # | Regla | Descripción | Ref. |
|---|-------|-------------|------|
| 14 | 🧪 Tests de lógica pura en `node` | Solo los tests que renderizan UI usan `jsdom`. Los de lógica pura corren en `node` (arranque más rápido). | §7.5 |
| 15 | 📊 Medir antes de asumir | Antes de "optimizar" config de tests/build, hacer benchmark controlado (baseline vs. cambio) y quedarse con la opción más rápida medida. | §7.6 |
| 16 | 🗃️ Cache de transform compartido | Mantener y aprovechar el cache de transform de Vite/Vitest compartido entre corridas para evitar re-transformar archivos sin cambios. No invalidar el cache innecesariamente (evitar tocar configs que lo reseteen sin motivo medido). | — |
| 17 | 🚫 Cero warnings `act()` | Eliminar warnings de `act()`/render en tests. Son causa raíz de flakiness y ralentizan el debug. | §7.7 |

### D. Ahorro de tokens/costo de IA

| # | Regla | Descripción | Ref. |
|---|-------|-------------|------|
| 18 | 🪟 Mitigar límite de longitud de línea Windows | En Windows, comandos con cadenas gigantes fallan con "The command line is too long". Usar mensajes de commit concisos y evitar comandos con argumentos enormes. `--no-verify` SOLO en consolidaciones puntuales ya validadas, nunca como atajo habitual. | §7.8 |
| 19 | 📖 Leer solo fragmentos necesarios | Leer únicamente los fragmentos/bloques requeridos (con `start_line`/`offset`/`limit` o modo `indentation`), no archivos completos de miles de líneas. | §9.4 |
| 20 | 🎯 Modelo adecuado por tarea | Usar el modelo apropiado según la tarea (p. ej. no usar el modelo más caro para tareas simples de edición/refactor). Delegar subtareas a modos/modelos ligeros cuando aplique. | — |
| 21 | 🚫 Evitar ciclos largos de prueba-error | No iterar a ciegas probando teorías sin medir. Validar hipótesis con la verificación mínima antes de escalar. | §7.6, §9.1 |
| 22 | 🧹 Limpiar archivos temporales del contexto | Eliminar archivos temporales/artefactos de diagnóstico del contexto y del workspace al terminar la tarea. | §10.2 |
| 23 | 🧼 Output de tests limpio | Usar `--reporter=dot --silent` por defecto para output mínimo. No inundar el contexto con logs de suite completa. | §9.1 |
| 24 | 🎛️ Contexto mínimo por tarea | Mantener el contexto mínimo necesario por tarea: no arrastrar contexto de tareas previas no relacionadas. | — |
