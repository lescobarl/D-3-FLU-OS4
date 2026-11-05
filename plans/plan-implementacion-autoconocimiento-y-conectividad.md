# Plan de Implementación — Punto 1 (Autoconocimiento de FLU) y Punto 2 (Conectividad: chat grupal, videollamada, juegos en línea)

> Documento de ejecución derivado de [`plans/propuesta-autoconocimiento-flu-y-conectividad.md`](propuesta-autoconocimiento-flu-y-conectividad.md).
> Todo paso está anclado a archivos reales del repo (sin "dummies"). Reglas que no se negocian:
> **NO HARDCODE** (labels/valores desde `FLU_CONFIG` con `|| '...'`), **config-driven**, **sin pantallas nuevas ni rutas nuevas**,
> **audit log**, **DI** (los hooks reciben callbacks), **§9 protocolo de iteración rápida** (validar cada fase antes de seguir),
> **la suite debe seguir verde** (130 archivos / 2618 vitest + Playwright e2e).

---

## §0 Resumen ejecutivo

| Fase | Entregable | Esfuerzo | Riesgo | Valida con |
|---|---|---|---|---|
| **P1-A** | Registro de capacidades compilado `selfKnowledge.ts` | S (1–2 días) | Bajo | `npx tsc --noEmit`, `tests/selfKnowledge.test.ts` |
| **P1-B** | `buildSelfManifesto(lang)` desde el registro | S | Bajo | test puro del manifiesto |
| **P1-C** | Intento local `CONOCER_FLU` (voz + dispatch, sin IA) | M (2–3 días) | Medio | test de detección + dispatch |
| **P1-D** | Inyección del manifiesto en el contexto Gemini | S | Bajo | e2e curado "qué sabes hacer" |
| **P2-F0** | "Sala de estar" local por turnos (offline) | M (3–4 días) | Medio | unit + e2e turnos locales |
| **P2-F1** | Relay de mensajería (`ws`) + panel de chat | M (3–4 días) | Medio | unit relay + e2e 2 clientes |
| **P2-F2** | Videollamada WebRTC (signaling sobre relay) | L (1–2 semanas) | Alto | e2e señalización; video manual |
| **P2-F3** | Juegos en línea (serialización de estado) | L (1–2 semanas) | Alto | unit serialización + e2e 2 jugadores |

**Decisión de producto previa a P2-F1/F2/F3 (obligatoria):** la doctrina "SOLO 2 APIs" del proyecto (Pollinations + OpenRouter, todo offline-first) entra en tensión con la conectividad. El plan asume que **el relay es infraestructura opcional auto-hospedada** (mismo patrón que los proxies de Vite) y que **FLU sigue funcionando 100% offline en F0**. La videollamada y los juegos en línea **no son offline**: requieren red y, en el caso de la videollamada entre dispositivos distintos, un servidor de señalización + STUN/TURN. Esto se plantea como habilitador (feature-flag en `FLU_CONFIG`), nunca como sustitución del modo local.

---

## §1 Punto 1 — Autoconocimiento de FLU

### 1.0 Diagnóstico (qué ya existe, qué falta)

**Ya existe (y hay que reutilizar, no duplicar):**
- [`src/services/capabilities.ts`](capabilities.ts) — catálogo **estático** de 7 capacidades (`FLU_CAPABILITIES`) e inyección en el system prompt vía [`buildCapabilitiesPrompt()`](../src/services/capabilities.ts:88), montada en [`gemini.js:447`](../src/voice/lib/gemini.js:447). Es el patrón a seguir, pero está incompleto y orientado al modelo (campos de contrato), no a orientar al usuario.
- Todas las fuentes de datos reales: `FLU_CONFIG.voiceCommands` (frases, `fluConfig.js:1887-2185`), `GAME_CATALOG` + `GAME_IDS` (`gameCatalog.ts:1-289`), catálogo de sitios del navegador curado + `defaultProfile.allowlist` (`fluConfig.js:714-1081`), `WORKSPACE_TIPOS` (`appConfig.ts:168`), proveedores de búsqueda web/imágenes/video (`fluConfig.js:883-1080`), pestañas de la app (`fluConfig.js:1605-1611`), comandos de voz (`NAVIGATION_COMMAND_IDS` en `voiceCommands.js:16-32`).
- API de voz: [`voiceCommands.js`](../src/voice/lib/voiceCommands.js), detección en [`audioMath.js`](../src/voice/lib/audioMath.js) (`detectSessionVoiceCommand` 538, `collectVoiceCommandPhrases` 161), dispatch por handlers en `App.tsx` (`__fluHandleTemporalText` 2367, `__fluHandleReminderText` 2262).
- Patrón de inyección de contexto en el user prompt: `agendaText` (líneas `gemini.js:518-523`), `recentMemory` (`gemini.js:527-532`), con la cadena `useFluVoiceAssistant.js:995-1028` → `generateFluContract` → `buildUserPrompt`.

**Falta (el hueco confirmado con búsqueda = 0 resultados en `src/`):**
1. No existe ningún intento `CONOCER_FLU`/"qué sabes hacer" (0 hits).
2. El catálogo de capacidades no cubre juegos, comandos de voz, páginas, sitios permitidos, tipos de workspace ni proveedores de búsqueda.
3. No hay respuesta **determinista offline** a "¿qué puedes hacer, FLU?" — hoy depende de que Gemini conteste bien con el system prompt.

### 1.1 Fase A — Registro de capacidades compilado

**Nuevo archivo:** `src/core/selfKnowledge/selfKnowledge.ts` (módulo TS puro, sin React, testeable).

Contrato:
```ts
export interface FluCapability {
  id: string
  categoria: 'comando' | 'pagina' | 'juego' | 'sitio' | 'workspace' | 'busqueda' | 'contrato'
  labelEs: string
  labelEn: string
  descriptionEs: string
  descriptionEn: string
  triggerPhrases: string[]   // compiladas desde FLU_CONFIG.voiceCommands / aliases
  requiresApi: boolean
}

export interface SelfKnowledgeSnapshot {
  capabilities: FluCapability[]
  comandos: string[]
  juegos: string[]
  sitiosPermitidos: string[]
  tiposWorkspace: string[]
  pestañas: string[]
  proveedoresBusqueda: string[]
  totalCapacidades: number
}
```

**Regla clave (anti-hardcode, §10 de CLAUDE.md):** el registro se **compila** (nunca se escribe a mano) a partir de:
- `FLU_CONFIG.voiceCommands` → entrada `comando` (1 por bloque, con sus frases como `triggerPhrases`).
- `GAME_CATALOG` (`src/core/games/gameCatalog.ts`) → entrada `juego` por id, `triggerPhrases` = aliases, `requiresApi` = flag del catálogo.
- `FLU_CONFIG.browser.catalog` + `defaultProfile.allowlist` + `browserProfileService` → entradas `sitio`.
- `WORKSPACE_TIPOS` (`src/core/config/appConfig.ts:168`) → entradas `workspace`.
- `FLU_CONFIG.ui.tabs.items` (`fluConfig.js:1605-1611`) → entradas `pagina`.
- `FLU_CONFIG.browser.search.providers` (`fluConfig.js:883-1080`) → entradas `busqueda`.
- `src/services/capabilities.ts` (`FLU_CAPABILITIES`) → entradas `contrato` (reutiliza las 7 existentes).

Funciones exportadas: `buildSelfKnowledgeSnapshot(config = FLU_CONFIG): SelfKnowledgeSnapshot`, `findCapabilityByText(text, lang)`, `capabilitiesByCategoria(snapshot)`.

### 1.2 Fase B — Manifiesto de FLU (`buildSelfManifesto`)

**Mismo archivo** `src/core/selfKnowledge/selfKnowledge.ts`:

```ts
export function buildSelfManifesto(lang: 'es' | 'en' = 'es', config = FLU_CONFIG): string
```

- Genera un texto de 1ª persona ("Soy FLU… puedo…") compilado desde el snapshot (Fase A), **nunca hardcodeado**.
- Secciones: comandos de voz, páginas/pestañas, juegos (con flag "requieren IA" solo para `cuentacuentos`/`cuento_colaborativo`), sitios permitidos, tipos de workspace, búsqueda (web/imágenes/video), capacidades de contrato.
- Labels es/en desde `FLU_CONFIG` con fallback `|| '...'`.

**Inyección en el system prompt (reforzar, no duplicar):** en [`buildSystemPrompt()`](../src/voice/lib/gemini.js:327) se agrega un elemento más al array (junto a `buildCapabilitiesPrompt` en la línea 447):
```ts
...buildSelfManifestoPrompt(isEnglish ? 'en' : 'es')
```
donde `buildSelfManifestoPrompt` se implementa en `selfKnowledge.ts` como bloque compacto para el system prompt (el LLM debe saber que puede responder a "¿qué sabes hacer?" enumerando capacidades reales, sin inventar).

### 1.3 Fase C — Intento local determinista `CONOCER_FLU` (sin IA)

**1.3.1** Añadir id a la lista congelada [`NAVIGATION_COMMAND_IDS`](../src/voice/lib/voiceCommands.js:16-32): `'CONOCER_FLU'`.

**1.3.2** Nuevo bloque de frases en `FLU_CONFIG.voiceCommands` ([`fluConfig.js:1887-2185`](../src/voice/lib/fluConfig.js:1887)) — config-driven, NO hardcode:
```js
conocerFlu: [
  'que sabes hacer', 'que puedes hacer', 'que sabe hacer flu', 'que puedes hacer flu',
  'que haces', 'que funciones tienes', 'cuentame tus habilidades', 'para que sirves',
  'what can you do', 'what do you do', 'what are your skills', 'what can flu do',
],
```
Regla de pares es/en (mismo patrón que `navigate`/`buscar`).

**1.3.3** Detección en [`audioMath.js`](../src/voice/lib/audioMath.js): ampliar `collectVoiceCommandPhrases` (línea 161) para recolectar `voiceCommands.conocerFlu` y `detectSessionVoiceCommand` (línea 538) para resolver `CONOCER_FLU`. Patrón idéntico a `NAVEGAR`/`BUSCAR`.

**1.3.4** Dispatch en `App.tsx` (patrón `__fluHandleTemporalText` línea 2367): nuevo handler `__fluHandleConocerFluText` (o case dentro del dispatch de comandos) que:
1. Detecta `CONOCER_FLU`.
2. Construye `buildSelfManifesto(lang)`.
3. Devuelve la respuesta hablada local (respuesta_voz) **sin llamar a Gemini** (fast-path offline).
4. Escribe en el audit log (hook `useAuditLog.logEvent`) con la categoría de la acción.

**Nota de armonía con `mapChatMessagesToGemini`:** si el fast-path local responde, **no se genera contrato**; si por el contrario el flujo cae en Gemini, el manifiesto ya está en el system prompt (1.2) y en el user prompt (1.4).

### 1.4 Fase D — Inyección del manifiesto en el contexto Gemini (vía del LLM)

Replicar exactamente el patrón `agendaText`:

1. **`gemini.js` — [`buildUserPrompt`](../src/voice/lib/gemini.js:451):** nuevo parámetro `selfKnowledgeText = ''`; inyectar junto a `agendaText` (líneas 518-523):
```js
...(selfKnowledgeText
  ? [isEnglish
    ? `FLU SELF-KNOWLEDGE (answer what FLU can do using this only):\n${selfKnowledgeText}`
    : `AUTOCONOCIMIENTO DE FLU (responde qué sabe hacer FLU usando SOLO esto):\n${selfKnowledgeText}`
  ]
  : []),
```
2. **`gemini.js` — [`buildConversationMessages`](../src/voice/lib/gemini.js:539)** y **`generateFluContract` (línea 1024):** propagar el parámetro `selfKnowledgeText` (mismo camino que `agendaText`, líneas 592-593 y 1144-1145).
3. **`useFluVoiceAssistant.js`:** aceptar callback `getSelfManifesto = () => ''` (junto a `getDailyAgenda`, línea 354), calcular `const selfKnowledgeText = getSelfManifestoRef.current() || ''` (junto a línea 996-998) y pasarlo en `requestFluContract` (líneas 1010-1028).
4. **`App.tsx`:** registrar `getSelfManifesto: () => buildSelfManifesto(language)` en el proveedor de `FluBridgeProvider` (patrón `getDailyAgenda` en `App.tsx:1411-1431`) y pasar el callback a `useFluVoiceAssistant` (patrón línea 355).

**Umbral de uso:** solo se inyecta el manifiesto cuando la intención es de autoconocimiento (para no ensuciar el user prompt en turnos normales — coherencia con la Optimización 1.2/1.4 de latencia comentada en `gemini.js:1062-1068`).

### 1.5 Tests y validación (Punto 1)

**Nuevo archivo:** `tests/selfKnowledge.test.ts`
- `buildSelfKnowledgeSnapshot` compila desde `FLU_CONFIG` real (sin mocks): contiene todos los comandos de `voiceCommands`, los 21 juegos del catálogo, los sitios de la allowlist, los `WORKSPACE_TIPOS`, las pestañas.
- `buildSelfManifesto('es')` / `('en')` no está vacío, no repite placeholders `||`, menciona al menos 1 juego y 1 comando, y **no contiene URLs hardcodeadas** (compatible con `tests/hardcodeGuard.test.ts`).
- `findCapabilityByText` resuelve "loteria", "quien soy", "que sabes hacer".
- `collectVoiceCommandPhrases`/`detectSessionVoiceCommand` reconocen `CONOCER_FLU` con frases es y en.

**Comandos:**
```
npx tsc --noEmit
npx vitest run tests/selfKnowledge.test.ts tests/voiceCommands.test.ts tests/hardcodeGuard.test.ts
npm run build   # si existe script de build del PWA
```

---

## §2 Punto 2 — Chat grupal (estilo WhatsApp) + videollamada + juegos en línea

### 2.0 Diagnóstico (qué ya existe, qué falta)

**Ya existe (reutilizable):**
- `ws: ^8.21.1` **ya está en dependencies** de `package.json` (NO usado aún en el repo; el único `WebSocket` es el del navegador en `src/voice/lib/streamStt/client.js:73`). El relay lo estrenará.
- Patrón de middleware de Vite: [`vite.config.ts:37-41`](../vite.config.ts) registra `createGeminiMiddleware`, `createBrowserProxy`, `createSearchProxy`. El patrón `configureServer(server)` + `server.middlewares.use(path, handler)` está en [`src/server/searchProxy.ts:195-222`](../src/server/searchProxy.ts:195).
- `FLU_CONFIG.multiuser` ([`fluConfig.js:635-673`](../src/voice/lib/fluConfig.js:635)): roles (Familiar/Amigo/Estudiante/Colega/Otro), `kindToRole`, `defaultVoice`, labels ui/voice → base de la "sala de estar".
- [`participantFloor.js`](../src/voice/lib/participantFloor.js) (572 líneas): máquina de fases `idle/evaluating/raised/cooldown`, `canScheduleParticipantEvaluation`, log por turnos, **cesión de turno** (comandos `grantFloor`/`dismissFloor` en `fluConfig.js:2159-2185`). Es el moderador de turnos local.
- Juegos = máquinas de estado deterministas por turnos: cada `src/core/games/*.ts` exporta `{ id, createSession, handleTurn }`; `getGameEngine`/`matchGameIntent`/`GAME_CATALOG` en [`gameCatalog.ts`](../src/core/games/gameCatalog.ts). Los 19 juegos `requiresApi:false` son 100% locales → serializables.
- No hay socket.io / peerjs / firebase → relay propio con `ws` (mantiene la doctrina de pocas dependencias).

**Falta:** servidor relay, cliente de señalización, panel de chat grupal (dentro del patrón de pestañas existente, sin pantalla nueva), canal de video, y serialización/reenvío de partidas.

### 2.1 Fase 0 — "Sala de estar" local por turnos (OFFLINE, single-device)

Objetivo: entregar **valor inmediato sin infraestructura** y validar el modelo de turnos que F1-F3 reutilizarán.

**2.1.1** Nuevo `src/core/salaEstar/salaEstar.ts` (TS puro, testeable):
- `createSalaEstarSession({ participantes, config = FLU_CONFIG.multiuser })`.
- Turnos por ronda usando los roles de `FLU_CONFIG.multiuser` (`kindToRole`).
- `grantFloor(participantId)` / `dismissFloor()` → integra el flujo de `participantFloor.js` (fase `raised` → `granted`) y los comandos `grantFloor`/`dismissFloor` ya existentes.
- Estado serializable (`toJSON`/`fromJSON`) — **esta es la pieza que F3 reutiliza para red**.

**2.1.2** Panel dentro del **patrón de pestañas existente** (sin pantalla nueva): nuevo componente `SalaEstarPanel` bajo `src/components/` que se registra como elemento de una pestaña existente (p. ej. dentro del contenedor de la pestaña "conversation"/"system" o un panel de `FluSettingsPanel`). NO se agrega ruta ni tab nueva al enrutador.

**2.1.3** Juegos por turnos locales: invocar `getGameEngine(id)` → `createSession` → `handleTurn` dentro del turno de la sala (quien tiene el piso juega). Reutiliza `applyGameAction` (`App.tsx:824-878`) para la salida (voz/emoción/animación).

**2.1.4** Labels es/en desde `FLU_CONFIG` (nuevo bloque `salaEstar` en `fluConfig.js`), con fallback `|| '...'`. Audit log en cada `grantFloor`/`dismissFloor`/turno.

**Test:** `tests/salaEstar.test.ts` (turnos, roles, cesión de piso, serialización ida-y-vuelta). **e2e:** `tests/e2e/pwa-sala-estar.spec.ts` (turno completo en un solo navegador).

### 2.2 Fase 1 — Relay de mensajería (`ws`) + chat grupal

**2.2.1 Servidor (dev):** nuevo [`src/server/realtimeProxy.ts`](../src/server/realtimeProxy.ts) siguiendo el patrón de `searchProxy.ts:195-222`:
- `export function createRealtimeProxy({ env = {} } = {})` con `configureServer(server)`.
- Monta un `WebSocketServer` (`ws`, `{ noServer: true }`) sobre el server HTTP de Vite, con upgrade en `/api/realtime`.
- **Solo relay** (sin persistencia en esta fase): mensajes `{ tipo: 'chat' | 'sala' | 'señal' | 'partida', salaId, remitente, payload, ts }`; los reenvía a los demás miembros de la sala (broadcast por `salaId`). **No almacena contenido** (privacidad/offline-first).
- Registro en [`vite.config.ts`](../vite.config.ts): añadir `createRealtimeProxy({ env })` al array `plugins` (junto a líneas 37-41).

**2.2.2 Cliente:** nuevo `src/core/realtime/realtimeClient.ts`:
- `connectRealtime({ url, salaId, onMessage, onStatus })` sobre el `WebSocket` del navegador.
- Reconexión con backoff (patrón existente en `streamStt/client.js:72-80`).
- Cache offline local (Dexie, `fluDatabase.ts`) del historial del chat para que la sala siga legible sin red.
- Guard de configuración: el relay se activa solo si `FLU_CONFIG.realtime?.enabled === true` y hay `endpoint` configurado (feature-flag, config-driven).

**2.2.3 UI:** `ChatGrupalPanel` (componente, dentro de pestaña existente; sin ruta nueva). Estructura de burbujas estilo WhatsApp con los labels de `FLU_CONFIG.multiuser`. La "sala" local (F0) y la remota (F1) comparten el mismo modelo de mensajes → **la F0 se convierte en el modo offline del chat**.

**Test:** `tests/realtimeClient.test.ts` (protocolo, backoff, reenvío) + `tests/realtimeProxy.test.ts` (harness tipo `tests/searchProxy.test.ts:143-184`: crear servidor Vite de prueba, conectar 2 sockets `ws`, verificar broadcast). **e2e:** 2 páginas Playwright con 2 clientes en la misma sala.

### 2.3 Fase 2 — Videollamada WebRTC

**2.3.1** [`src/core/realtime/signaling.ts`](../src/core/realtime/signaling.ts): oferta/respuesta/ICE sobre el relay (mensajes `tipo:'señal'` del F2.2.1). Un participante actúa de "responder" (caller/callee por orden de entrada a la sala).

**2.3.2** [`src/core/realtime/videoCall.ts`](../src/core/realtime/videoCall.ts): `getUserMedia({ video: true, audio: true })` + `RTCPeerConnection` + `addIceCandidate`/`setLocalDescription`. Gestión de permisos con fallback solo-audio y mensaje claro si el usuario rechaza cámara.

**2.3.3 UI:** `VideoCallPanel` (componente en pestaña existente) — botón "videollamada" en el `ChatGrupalPanel`, vista local + remota (`<video>`), botón colgar. **SIN** librería de terceros (solo API nativa del navegador; PWA necesita `https` o `localhost` para `getUserMedia`).

**2.3.4 Honestidad (crítica, §10):** la videollamada **punto-a-punto real entre dispositivos distintos** necesita **STUN/TURN** (relay de hielo) y señalización; con NATs estrictos sin TURN fallará. El plan entrega:
- STUN público gratuito por defecto (config en `FLU_CONFIG.realtime.iceServers`, sin hardcode de URL — va en config).
- TURN: **opcional**, requiere decisión de infraestructura del usuario (TURN auto-hospedado, p. ej. coturn, o servicio comercial). Si no hay TURN configurado, se muestra aviso honesto "la videollamada puede fallar en redes cerradas" y se degrada a solo-audio.
- **Modo local (mismo dispositivo / red local):** también se puede probar con dos pestañas del mismo navegador (loopback), donde STUN no es necesario.

**Test:** `tests/signaling.test.ts` (orden de señales, validación de payload) + e2e de **señalización** entre 2 páginas (sin abrir cámara real en CI — se mockea `getUserMedia`). El video real se valida manualmente.

### 2.4 Fase 3 — Juegos en línea (serialización de estado)

**2.4.1** Nuevo `src/core/games/onlineSession.ts`:
- `serializeSession(session)` / `deserializeSession(json)` → aprovecha el `toJSON`/`fromJSON` de la F0.
- `applyRemoteTurn(session, turn, engineId)` → `handleTurn` del engine local con el turno remoto; resultado se reenvía por el relay (`tipo:'partida'`).
- Validación de **quién tiene el turno** (anti-trampa básico por `salaId` + remitente) y de estado (los engines son deterministas → se puede verificar el hash del estado antes/después).

**2.4.2** Catálogo online: `FLU_CONFIG.realtime.juegosEnLinea` con lista de ids habilitados (config-driven). **Ranking de idoneidad** (del catálogo real, 21 juegos):
- **Muy aptos (turnos + estado pequeño + sin IA):** `loteria`, `quien_soy`, `adivina_numero`, `ahorcado`, `trivia`, `memoria_secuencias`.
- **Aptos con moderación:** `simon_dice`, `ordena_secuencia`, `palabras_encadenadas`, `calculo_mental`, `trabalenguas`, `adivina_cancion`.
- **Requieren IA por turno (`requiresApi:true`):** `cuento_colaborativo`, `cuentacuentos` → online solo si hay API configurada (cada turno llama al motor de texto).
- **No aptos online:** `karaoke`, `respiracion`, `veo_veo`, `abecedario`, `cuenta_conmigo`, `repite_traduce` (dependen del tiempo real / misma sala / micrófono).
- `getGameEngine(id).requiresApi` se respeta al habilitar la partida online.

**2.4.3 UI:** botón "jugar en línea" en `SalaEstarPanel` → `OnlineGameHost` (el que crea la sala elige el juego) y `OnlineGameJoin`. Reutiliza `applyGameAction` para la presentación (voz/emoción/animación) y el piso de la sala para turnos.

**Test:** `tests/onlineSession.test.ts` (serialización, turno remoto aplicado, hash de estado) + e2e 2 páginas jugando `loteria` (host elige carta, remoto confirma).

### 2.5 Decisión de producto que el usuario debe tomar (antes de F2)

| Opción | Pros | Contras | Recomendación |
|---|---|---|---|
| **A. Relay en dev-servidor (este plan) + STUN público** | Cero infra extra para probar; reutiliza Vite | No funciona en producción PWA hosteada (el middleware es de `vite dev`) | **F1/F3 ya** |
| **B. BaaS gestionado (Firebase/Ably/Supabase)** | Menos código de servidor | Añade dependencias (rompe "pocas deps"); no offline-first; costo/credenciales | Solo si el usuario lo pide |
| **C. Servidor Node propio (separado) con `ws` + TURN (coturn)** | Producción real, multi-dispositivo | Infraestructura nueva (servidor + dominio + TURN) | **F2/F3 producción** |

El relay en `vite dev` es **suficiente para demostrar y probar localmente** (2 pestañas/mismo equipo o red local). Para una videollamada real entre dos casas se necesita C (al menos señalización + TURN).

### 2.6 Tests y validación (Punto 2)

**Nuevos tests unitarios:** `tests/salaEstar.test.ts`, `tests/realtimeProxy.test.ts`, `tests/realtimeClient.test.ts`, `tests/signaling.test.ts`, `tests/onlineSession.test.ts`.

**Nuevos e2e:** `tests/e2e/pwa-sala-estar.spec.ts` (F0, un navegador), `tests/e2e/pwa-chat-grupal.spec.ts` (F1, 2 páginas), `tests/e2e/pwa-videollamada-signaling.spec.ts` (F2, señalización con `getUserMedia` mockeado), `tests/e2e/pwa-juego-online.spec.ts` (F3, loteria a 2 páginas).

**Comandos (secuenciales — los e2e y vitest no deben correr en paralelo):**
```
npx tsc --noEmit
npx vitest run tests/salaEstar.test.ts tests/realtimeProxy.test.ts tests/realtimeClient.test.ts tests/signaling.test.ts tests/onlineSession.test.ts tests/hardcodeGuard.test.ts
npx playwright test tests/e2e/pwa-chat-grupal.spec.ts   # (con vite dev levantado)
```

---

## §3 Orden de ejecución y riesgos

**Orden recomendado (cada fase se valida antes de seguir, §9):**
1. **P1-A + P1-B + P1-C** (autoconocimiento) → `tests/selfKnowledge.test.ts` verde.
2. **P1-D** (inyección Gemini) → e2e "qué sabes hacer" con y sin API key (fast-path local siempre responde).
3. **P2-F0** (sala de estar offline) → base de todo lo conectado.
4. **P2-F1** (relay + chat) → pide la decisión 2.5 para F2/F3.
5. **P2-F2** (video) y **P2-F3** (juegos online) — en ese orden, sobre el relay ya probado.

**Riesgos y mitigaciones:**
- **Doctrina "2 APIs" / offline-first:** F0 es offline puro; F1-F3 son **feature-flag** (`FLU_CONFIG.realtime.enabled`, por defecto `false`) → la suite y el uso normal no cambian.
- **Hardcode guard:** toda URL de relay/ICE y todo label va en `FLU_CONFIG` (config-driven); el relay usa `env` como los proxies existentes.
- **No romper la suite:** los módulos nuevos son TS puros + hooks con DI (callbacks), igual que `useFluVoiceAssistant`; el panel nuevo se monta en pestañas existentes (sin tocar el enrutador).
- **Privacidad:** el relay no persiste contenido; el chat guarda historial solo en Dexie local del dispositivo.
- **WebRTC en PWA:** necesita `https`/`localhost`; se documenta en `ESTADO_SISTEMA.md`.

---

## §4 Resumen (§10)

1. **Autoconocimiento (Punto 1):** compilar un registro de capacidades real desde `voiceCommands` + `GAME_CATALOG` + catálogo de sitios + `WORKSPACE_TIPOS` + pestañas + `FLU_CAPABILITIES`; generar el manifiesto de FLU en 1ª persona (es/en) sin hardcode; añadir el comando de voz `CONOCER_FLU` (frases en config, detección en `audioMath.js`, dispatch en `App.tsx`) con **respuesta local offline**; e inyectar el manifiesto en el contexto Gemini replicando el patrón `agendaText` (`gemini.js` + `useFluVoiceAssistant.js` + `App.tsx`). Validar con `tests/selfKnowledge.test.ts`.
2. **Conectividad (Punto 2):** F0 "sala de estar" local por turnos (reutiliza `multiuser` + `participantFloor` + engines deterministas, todo offline); F1 relay con `ws` (ya en dependencies) montado como `createRealtimeProxy` en `vite.config.ts` + `ChatGrupalPanel` en pestañas existentes; F2 videollamada WebRTC (señalización sobre el relay + STUN/TURN config-driven + honestidad de límites); F3 juegos en línea por serialización de estado (mejores: `loteria`, `quien_soy`, `adivina_numero`, `ahorcado`, `trivia`, `memoria_secuencias`; los 2 `requiresApi` solo con API). La F0 entrega valor sin red; F1-F3 van detrás de un feature-flag y requieren la decisión de infraestructura del §2.5 para producción.
