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
1. Ejecutar `npm run test` y confirmar que todos los tests pasan
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
