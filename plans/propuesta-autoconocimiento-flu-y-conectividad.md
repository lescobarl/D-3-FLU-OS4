# Propuesta: Autoconocimiento de FLU + Conectividad multiusuario + Búsqueda web (imágenes/vídeo) + Pizarrón IA + Video + Acceso remoto

> Análisis y propuesta solicitados: "flu no sabe nada de sí mismo… dame tu propuesta", "chat grupal estilo WhatsApp, videollamada y juegos en línea", "cambiar Pollinations por búsqueda web de imágenes y video", "pizarrón como Google con buscador + IA", "necesitamos video", "¿qué necesitamos para TeamViewer? analiza y explica".
>
> Todo lo que se propone está aterrizado en el código real (`src/`, `tests/`). Sin dummies, sin hardcode, sin pantallas/ruteo nuevos salvo que se indique, config-driven, con guardia de auditoría y sin romper la suite (130 archivos / 2618 tests + e2e curados verdes).
>
> Estado de referencia: la pasada de UX tipo Chrome quedó **completa y validada** (tsc exit 0, vitest 2618, Playwright curado 3/3).

---

## 0. Resumen ejecutivo

| # | Tema | Veredicto | Esfuerzo |
|---|------|-----------|----------|
| 1 | Autoconocimiento de FLU | **Alto valor, barato, 100% offline** — los datos ya existen; falta un *registro de capacidades* consultable y una vía de respuesta local | Bajo (nuevo módulo data-driven + intent) |
| 2 | Chat grupal WhatsApp + videollamada + juegos en línea | **Requiere infraestructura nueva** (relay + WebRTC). Existe una fase 0 local 100% offline (charla con turnos en un solo dispositivo). Juegos por turnos son los más fáciles de llevar en línea | Medio–Alto |
| 3 | Reemplazar Pollinations por búsqueda web | **Muy viable y casi gratis** — la búsqueda de imágenes/vídeo YA existe; falta un selector de fuente y normalizar resultados como artefacto | Bajo–Medio |
| 4 | Pizarrón como Google (buscador + IA) | **Ya está implementado** — explicar cómo funciona y qué queda opcional | Ya hecho (+ pequeños extras) |
| 5 | Video | **Ya existe** (generar + buscar); falta habilitar proveedores de vídeo por defecto | Bajo |
| 6 | TeamViewer | **Análisis honesto**: vista/asistencia remota sí en navegador; control total requiere agente nativo + señalización/TURN | Alto |

---

## 1. Autoconocimiento de FLU ("FLU se conoce a sí mismo")

### 1.1 Estado actual (diagnóstico aterrizado)

- [`FLU_CONFIG.knowledgeBase`](src/voice/lib/fluConfig.js:361) **solo contiene etiquetas de UI** ("KB general", "KB minutas") y alimenta un chip del header; **no es un registro de capacidades**.
- **No existe ningún intent de autoconocimiento/ayuda**: la búsqueda de `que sabes hacer|qué puedes hacer|capabilities|helpMe|selfKnowledge|conoces…` en `src/` devuelve **0 resultados**.
- **PERO todos los datos fuente ya existen** y son la fuente de verdad única:
  - Comandos de voz: [`FLU_CONFIG.voiceCommands`](src/voice/lib/fluConfig.js:1887) (wakeWords, resetAvatarColors, openListening, nextSpeaker, closeListening, startConversation, generateMinute, generateSummary, analyzeDocument, analyzeApp, generateDocument, generateVideo, saveMinute, navigate, buscar, grantFloor, dismissFloor) + API [`voiceCommands.js`](src/voice/lib/voiceCommands.js:16) con `NAVIGATION_COMMAND_IDS`.
  - Juegos: [`GAME_CATALOG`](src/core/games/gameCatalog.ts:124) con 21 juegos, alias y `requiresApi` (21 ids en `GAME_IDS`).
  - Páginas accesibles: allowlist/categorías/roles en [`browserProfileService.ts`](src/core/browser/browserProfileService.ts) + `FLU_CONFIG.browser.catalog/categories`.
  - Escenas/workspace: `WORKSPACE_TIPOS` (`text`, `image_prompt`, `diagram`, `3d`, `horario`) en [`appConfig.ts`](src/core/config/appConfig.ts:168).
  - Búsqueda: proveedores web/imágenes/vídeo en `FLU_CONFIG.browser.search`.
  - Memoria/agenda: `minuteKnowledge`, `agenda`, `reminders`, `horario`, `materiaGris`, `diario`, `contactos`, `hábitos`.

### 1.2 Propuesta (config-driven, sin nuevas pantallas, sin hardcode)

**Pieza A — Registro de capacidades (`src/core/selfKnowledge/selfKnowledge.ts`)** — módulo autónomo data-driven (estilo [`gameCatalog.ts`](src/core/games/gameCatalog.ts)) que **compila** las capacidades reales desde las fuentes existentes, sin duplicar datos:

```ts
export interface FluCapability {
  id: string            // 'voice.generateMinute' | 'game.loteria' | 'browser.wikipedia' | 'workspace.horario' | ...
  categoria: 'comando' | 'juego' | 'pagina' | 'workspace' | 'funcion' | 'memoria'
  label: string         // 'Generar minuta'
  description: string   // 'Te ayudo a generar la minuta de la sesión'
  triggerPhrases: string[] // reutiliza aliases existentes (games) o frases de voiceCommands
  requiresApi?: boolean
}
```

- **Comandos**: derivados de `FLU_CONFIG.voiceCommands` (las frases ya son la fuente de verdad; el registro solo las agrupa y etiqueta).
- **Juegos**: derivados de `GAME_CATALOG` (id + alias + `requiresApi`) — **cero duplicación**.
- **Páginas**: derivadas de la allowlist por rol + `FLU_CONFIG.browser.catalog` (wikipedia, youtube, etc.).
- **Escenas**: derivadas de `WORKSPACE_TIPOS` + `VISUAL_WORKSPACE_TIPOS`.

**Pieza B — "Manifiesto de FLU" (self-manifesto)** — función `buildSelfManifesto(lang)` que genera un bloque de texto legible ("Puedo: … 21 juegos como la lotería, el ahorcado…; genero minutas, resúmenes, documentos y vídeo; busco en la web, imágenes y vídeo; navego solo a páginas permitidas por tu perfil; recuerdo tus pendientes y fechas…") a partir del registro. **No es texto hardcodeado**: se construye desde el registro para que nunca quede desactualizado.

**Pieza C — Respuesta, en dos vías (sin pantallas nuevas):**

1. **Inyección en el contexto de Gemini** (como ya se hace con agenda/orden del día): el manifiesto se agrega al contexto de la conversación, así **FLU responde naturalmente** "¿qué puedes hacer?" a través del pipeline existente, con su voz y personalidad.
2. **Fast-path local determinista** (como los juegos): nuevo intent en la detección — "qué sabes hacer", "qué puedes hacer", "qué juegos tienes", "a qué páginas puedes entrar", "quién eres", "ayúdame", "dime tus funciones" — que se resuelve **sin API** (0 latencia, 0 costo) leyendo el manifiesto y respondiendo por voz + log. Puntos de inserción reales:
   - Añadir el comando (p. ej. `CONOCER_FLU`) a [`NAVIGATION_COMMAND_IDS`](src/voice/lib/voiceCommands.js:16).
   - Frases en `FLU_CONFIG.voiceCommands` (nuevo bloque `conocerFlu`).
   - Detección en [`audioMath.js`](src/voice/lib/audioMath.js) (`detectSessionVoiceCommand`) y dispatch en `App.tsx` siguiendo el patrón de `__fluHandleTemporalText` / `__fluHandleReminderText` (o mejor: un handler genérico de "consulta meta" que devuelve el manifiesto).

**Entregables** (fases): (1) módulo `selfKnowledge.ts` + registro compilado + manifiesto; (2) intent local + frases config; (3) inyección del manifiesto en contexto Gemini; (4) tests unitarios (`tests/selfKnowledge.test.ts`) + hardcodeGuard pasa (las frases viven en config, no en el módulo).

**Por qué así**: se respeta "sin hardcode" (los textos de etiquetas van en `FLU_CONFIG` con `|| '…'`), sin nuevas rutas, sin tocar la suite, y resuelve el problema real: hoy FLU "está perdido" porque no tiene dónde consultar sus propias capacidades.

---

## 2. Chat grupal estilo WhatsApp + videollamada + juegos en línea

### 2.1 Estado actual (honestidad primero)

- FLU OS4 es una **PWA offline-first de un solo dispositivo**. Ya existe **multiusuario local** (perfiles/roles por persona: [`FLU_CONFIG.multiuser`](src/voice/lib/fluConfig.js:635), `participantFloor`, `contacts`), pero **no hay red**: no hay servidor de mensajería, ni WebSocket, ni WebRTC.
- La doctrina actual es "SOLO 2 APIs" (Pollinations + OpenRouter). Cualquier chat/videollamada/TeamViewer **rompe esa doctrina** porque necesita señalización en tiempo real. Es un cambio arquitectónico que hay que **declarar y decidir**, no esconder.

### 2.2 Propuesta por fases (sin sobre-vender)

**Fase 0 — "Sala de estar" (100% offline, mismo dispositivo, ya casi gratis).** Un "chat grupal" **con turnos** en el mismo equipo: FLU modera, `participantFloor` cede la palabra, cada participante habla/teclea por turnos y FLU lleva el hilo. Esto es exactamente el flujo de reunión que ya existe (`multiuser`, floor, minutas). Valor real en aula con un solo dispositivo; **cero infraestructura**.

**Fase 1 — Relay de mensajes (chat de texto asíncrono).** Para chat grupal real entre dispositivos se necesita un **relay** (el más simple: un servidor Node pequeño con WebSocket, o un BaaS como Firebase Realtime/Ably/PeerJS Cloud). El navegador ya tiene `WebSocket` y la app ya tiene un patrón de **middleware Vite** (`src/server/*Proxy.ts`) donde se puede colocar `src/server/realtimeProxy.ts` durante desarrollo. Flujo: dispositivo A publica → relay → suscriptores (B, C) reciben; FLU mantiene estado de conversación. Persistencia opcional en `indexedDB`/relay para histórico.

**Fase 2 — Videollamada (WebRTC).** Con el mismo relay como **señalización** (SDP/ICE exchange por mensajes), cada cliente usa `getUserMedia` + `RTCPeerConnection`:
- 1 a 1: conexión directa P2P (gratis si hay NAT abierto).
- Grupo: **mesh** (cada uno se conecta a todos) hasta ~4–6 participantes, o **SFU** (servidor de reenvío, costo) para grupos grandes.
- **Ojo TURN**: muchos NATs/CGNAT bloquean P2P; sin servidor TURN la llamada puede fallar. Un TURN de bajo costo (coturn en un VPS pequeño) es el componente que "nadie ve pero todo lo hace".

**Fase 3 — Juegos en línea.** Aquí FLU tiene una ventaja enorme: **los 21 juegos son máquinas de estado deterministas** (`createSession`/`handleTurn` en [`gameCatalog.ts`](src/core/games/gameCatalog.ts:253)). Llevarlos a multijugador es **serializar el estado de la sesión y reenviar los turnos por el relay** — no hay que reescribir lógica de juego.

Juegos ideales para en línea (por turnos, estado portable):
- `loteria` (tablero de 16 cartas ya definido en `LOTERIA_BANK`) — el mejor candidato.
- `quien_soy` (¿Quién soy?), `adivina_numero`, `calculo_mental`, `ahorcado`, `memoria_secuencias`, `trivia`, `ordena_secuencia`, `palabras_encadenadas`, `cuento_colaborativo`, `simon_dice`.

Juegos menos aptos en línea (dependen de voz/cámara/input local): `karaoke`, `respiracion`, `veo_veo`, `abecedario`, `cuenta_conmigo`, `repite_traduce`, `cuentacuentos` (requiere API).

**Recomendación**: implementar **Fase 0 ya** (es gratis y mejora el aula) y validar con el usuario si se quiere invertir en Fase 1–3 (relay + WebRTC), que es un proyecto nuevo con dependencias de hosting. Nunca "dummies": si no hay relay, el botón de videollamada no debe existir.

---

## 3. Reemplazo de Pollinations por búsqueda web de imágenes (y vídeo)

### 3.1 Estado actual (aterrizado)

- Pollinations es la **única API de imágenes**: `POLLINATIONS_CONFIG` + [`buildPollinationsUrl(prompt)`](src/core/config/appConfig.ts:781), proxy `POST /api/workspace-image` en [`geminiProxy.ts`](src/server/geminiProxy.ts), cliente [`imageGeneration.js`](src/voice/lib/imageGeneration.js), render en [`App.tsx`](src/App.tsx:3472) (`workspaceImage.imageUrl` + overlay).
- **La búsqueda web de imágenes YA existe**: [`searchProxy.ts`](src/server/searchProxy.ts:195) expone `/api/search/web`, `/api/search/images` y `/api/search/video`; el normalizador de **Wikimedia Commons** (`normalizeCommonsMedia` en [`searchSession.ts`](src/core/search/searchSession.ts:231)) devuelve `thumbnail`, `fileUrl`, host; hay pruebas verdes en `tests/searchProxy.test.ts` y `tests/searchSession.test.ts`.

### 3.2 Propuesta (viabilidad: alta; esfuerzo: bajo–medio)

**Nueva fuente de imagen configurable**: añadir un selector de fuente en config (p. ej. `FLU_CONFIG.imageSource: 'web' | 'pollinations' | 'auto'`, con fallback `|| 'pollinations'` para no romper nada):

1. `imageGeneration.js` resuelve la fuente:
   - `web`: hace `GET /api/search/images?q=<prompt>` y toma el **mejor resultado** (`thumbnail`/`fileUrl` de Commons) → se muestra como `workspaceImage.imageUrl` con su `host` (crédito/licencia, muy apropiado para educación).
   - `pollinations`: flujo actual (fallback cuando la web no devuelve resultados o la fuente se deshabilita).
   - `auto`: web primero, Pollinations como respaldo si la web viene vacía.
2. **Vídeo en vez de imagen**: el mismo `/api/search/video` (YouTube embed/watch + Invidious + Commons vídeo) puede proveer el "resultado" para `generateVideo` o como respuesta visual; y el **ensamblador de vídeo** ya existe (`videoAssembler.ts` + `generateVideo`).

**Ventajas**: sin costo por volumen (Commons/DDG sin API key), resultados reales con licencia, y **no se tira Pollinations**: queda como proveedor opcional. Impacto mínimo: solo `imageGeneration.js` + config + un par de tests (manteniendo los 158 tests actuales del área verde).

---

## 4. Pizarrón como Google (buscador + IA)

### 4.1 Estado actual: ya está implementado

El área del Pizarrón **ya es** una interacción estilo Google: [`WorkspaceSearch`](src/components/WorkspaceSearch.tsx:57) renderiza: barra de búsqueda → **resumen IA** (AI overview, [`fetchAiOverview`](src/hooks/useWorkspaceSearch.ts:152) vía Gemini) → resultados web (con línea verde de origen al estilo Chrome) → cuadrícula de **imágenes** ([`ImageGrid`](src/components/ImageGrid.tsx:50)) → cuadrícula de **vídeo** ([`VideoGrid`](src/components/VideoGrid.tsx:58)) → pestañas curadas; todo config-driven (`FLU_CONFIG.browser.search.ui`), con chips de sugerencias, spinner, estados de error/vacío con reintento y auto-focus. La pasada tipo Chrome recién validada lo pulió.

### 4.2 Cómo funciona (flujo de datos)

1. El usuario escribe/habla una consulta → `useWorkspaceSearch` (`search`) la envía al proxy (`/api/search/web`) con la **allowlist del perfil activo**.
2. `searchSession.normalizeResults` normaliza Wikipedia/DDG/Commons/YouTube/Invidious; `filterNavigable` marca lo permitido; en modo seguro solo quedan resultados de la allowlist.
3. En paralelo `fetchAiOverview` pide a Gemini un resumen de los resultados → se muestra como "vista general".
4. Pestañas Web / Imágenes / Vídeo: cada tipo golpea su endpoint y pinta sus tarjetas; el vídeo abre embed.

### 4.3 Viabilidad y qué queda

- Viabilidad: **muy alta — ya funciona**.
- Opcionales (no urgentes): habilitar proveedores de vídeo por defecto (hoy `youtube enabled:false` + `invidious endpoint:''` → la pestaña Vídeo está deshabilitada por defecto en config), historial de búsquedas recientes, "vista previa" de resultados, y el botón de "usar esta imagen como imagen del Pizarrón" (enlaza con §3).

---

## 5. Video ("necesitamos también video")

### 5.1 Estado actual: ya existe en tres formas

1. **Generar vídeo** (walkthrough): comando de voz `generateVideo` → [`videoAssembler.ts`](src/services/videoAssembler.ts) arma un vídeo con **ffmpeg.wasm** (assets en `public/ffmpeg/`), con UI de progreso ([`GenerationProgressPanel`](src/components/GenerationProgressPanel.tsx)) y **degradación a guion/storyboard si ffmpeg no está disponible** (línea ~280).
2. **Buscar vídeo**: `/api/search/video` con normalizadores YouTube/Invidious/Commons y pestaña Vídeo en el Pizarrón.
3. **Vídeo como respuesta visual** (propuesto en §3): usar el resultado de vídeo en lugar de imagen generada.

### 5.2 Qué falta realmente

- **Habilitar proveedores** de vídeo en config (hoy deshabilitados por defecto) y definir política de seguridad (vídeo embebido = navegación con terceros).
- Opcional: integrar el vídeo resultado de la búsqueda como artefacto en el Pizarrón (reproducir inline) y guardar el vídeo generado en el histórico.

---

## 6. TeamViewer-like ("¿qué necesitamos? analiza y explica")

### 6.1 Análisis honesto: qué es posible en navegador y qué no

- **SÍ en navegador (WebRTC, sin instalar nada en el cliente remoto):**
  - **Ver pantalla** (`getDisplayMedia` + `RTCPeerConnection` → el otro participante ve la pantalla en streaming).
  - **Asistencia** (pointer/alta visibilidad, audio, chat, cursor compartido vía DataChannel).
  - Control **dentro del propio Pizarrón** (si el "host" es la propia app, el "control remoto" es que FLU teclea/actúa por ti — ya es su función asistente).
- **NO en navegador puro (necesita agente nativo en el host):**
  - **Control total del escritorio ajeno** (mover mouse, teclear, abrir apps del SO) exige **inyección de entrada a nivel de sistema operativo** → requiere un **agente nativo** en la máquina controlada (ej. Tauri/Electron, o un CLI companion) que capture pantalla y reciba eventos de entrada.
  - **Atravesar NAT** requiere **STUN + TURN** (igual que la videollamada).

### 6.2 Componentes necesarios (para control completo, tipo TeamViewer)

| Componente | Qué es | ¿Ya existe? |
|---|---|---|
| Señalización (relay) | Intercambio SDP/ICE entre equipos | No (nuevo `realtimeProxy`/BaaS) |
| STUN | Descubrir IP pública (gratis, público) | No |
| TURN | Retransmitir cuando P2P falla (costo) | No |
| Captura de pantalla | `getDisplayMedia` | Sí (API nativa) |
| **Agente nativo en el host** | Inyección de entrada + captura continua | **No (componente nuevo, no-web)** |
| Datachannel de entrada | Enviar mouse/teclado por WebRTC | No (API disponible) |

### 6.3 Recomendación

Empezar por **"asistencia remota"** (ver pantalla + audio + cursor + chat), 100% en navegador y reutiliza toda la infra de §2 (relay + WebRTC). El **control total** (TeamViewer estricto) es un producto aparte que requiere el agente nativo y no debe venderse como "gratis" ni como "inmediato". Nunca dummies: si no hay agente, no se ofrece control remoto.

---

## 7. Roadmap sugerido (prioridad)

1. **P1 — Autoconocimiento de FLU** (fase 0): registro + manifiesto + fast-path local + inyección en contexto. Barato, sin infra, cierra la queja principal.
2. **P2 — Búsqueda web como fuente de imagen/vídeo** (fuente `web`/`auto` configurable) y **habilitar proveedores de vídeo**.
3. **P3 — Chat grupal fase 0** (turnos en un dispositivo) + pequeña mejora de UX de "sala".
4. **P4 — Decisión de producto**: ¿se acepta infraestructura real (relay + WebRTC + TURN) para chat red/videollamada/juegos en línea/TeamViewer? Si sí: Fase 1 relay → Fase 2 videollamada → Fase 3 juegos en línea → asistencia remota; y TeamViewer completo solo si se acepta el agente nativo.

## 8. Riesgos y restricciones

- **Doctrina "2 APIs"**: los ítems 2, 3 (parcial) y 6 introducen más proveedores (Wikimedia/DDG son gratuitos y sin key; relay/WebRTC son infraestructura nueva). Debe decidirse conscientemente.
- **Offline-first**: todo lo propuesto en los ítems 1, 3, 4, 5 funciona offline o con caída elegante; 2 y 6 requieren red.
- **NO HARDCODE**: las frases del intent de autoconocimiento, etiquetas y textos van en `FLU_CONFIG`; el manifiesto se **construye** desde el registro (nunca texto fijo).
- **Sin romper suite**: cada fase lleva sus tests unitarios + respeto a `hardcodeGuard.test.ts`; las fases 2/6 requieren decisión de producto antes de tocar arquitectura.
