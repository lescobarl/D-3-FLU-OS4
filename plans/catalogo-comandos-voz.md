# 🎙️ Catálogo Completo de Comandos de Voz — FLU OS4

**Fecha:** 2026-08-24 · **Última actualización:** 2026-08-25 (correcciones + observaciones aplicadas)
**Alcance:** Todos los comandos de voz implementados en FLU OS4, extraídos de la fuente única de verdad del sistema. Incluye **los comandos de toda la aplicación** (no solo configuración) y el **catálogo completo de configuración por voz** (44 claves soportadas + 8 no soportadas).

---

## ⭐ Observaciones y cambios aplicados (2026-08-25)

> Las secciones siguientes documentan el catálogo de comandos **tal como funciona hoy**, ya con los cambios aplicados. Observaciones relevantes:

### 1. Resolución determinista de configuración por voz (rebranding primavera)
- El resolver [`resolveConfigCommandFromText`](src/voice/lib/configCommands.js:326) interpreta el transcript de forma **100% determinista** (no depende del modelo) y construye el contrato `configuracion`.
- **Fast-path determinista (2026-08-24):** el comando se resuelve y **despacha al instante** — sin esperar a la IA — por la **ruta única** [`onContractResolved`](src/App.tsx:803) → [`applyConfigAction`](src/App.tsx:240), mediante el helper [`dispatchFastConfigCommand`](src/voice/hooks/useFluVoiceAssistant.js:2732), mientras la IA sigue generando la confirmación verbal. **Sin rutas dobles ni bypass.**
- **Idempotencia en los 3 ensamblados del hook:** si el fast-path ya aplicó la config, el contrato tardío lleva `configuracion: null` (`fastPathConfig?.accion ? null : resolveConfigCommandFromText(...) ?? contract?.contract?.configuracion`). Puntos: [`processConversationFluQuery`](src/voice/hooks/useFluVoiceAssistant.js:2874), [`processCapture` CONFIGURACION](src/voice/hooks/useFluVoiceAssistant.js:3336) y [`processCapture` SESION_ACTIVA](src/voice/hooks/useFluVoiceAssistant.js:3492).
- Funciona **incluso cuando el modelo solo verbaliza** la intención y **no emite** el campo `configuracion` en su JSON. El `configuracion` crudo que sí emite el modelo se sanitiza con [`normalizeConfiguracion`](src/voice/lib/configCommands.js:357) (objeto, JSON string o `null` → contrato estricto) antes de aplicarse.
- **Ejemplo validado:** *"cambia la temporada a primavera"* → `{accion: 'set_branding', componente: 'branding', clave: 'activeSeason', valor: 'primavera'}`.

### 2. No-op documentado: "activa la temporada de cumpleaños"
- `birthday` es `tipo: 'date'` (sin resolver de texto) y el sustantivo `'cumpleanos'` (10 caracteres) **supera** a `'temporada'` (9) en el orden por longitud (descendente) de `NOUN_PAIRS` → la frase resuelve a la entrada `birthday`, cuyo valor **no es resoluble** → **`null` (no-op seguro)**. No cambia la temporada ni rompe nada.

### 3. Configuración muerta: `conversationSettleStableMs`
- [`conversationSettleStableMs: 80`](src/voice/lib/fluConfig.js:267) **no se referencia en ningún punto** de la app (0 usos globales). Se conserva por compatibilidad, pero **no influye en la latencia**.

### 4. Optimización de latencia — 7 reducciones en `FLU_CONFIG.timing`
Valores actuales (antes → ahora) en [`FLU_CONFIG.timing`](src/voice/lib/fluConfig.js:245):

| Clave | Antes | Ahora |
|-------|-------|-------|
| `wakeWordCommandDelayMs` | 1800 | **1500** |
| `interimCommandDelayMs` | 800 | **500** |
| `conversationMinMsAfterLastResult` | 60 | **30** |
| `interimFinalizeGraceMs` | 100 | **25** |
| `scheduleAutoProcessDelayMs` | 300 | **150** |
| `scheduleAutoProcessWhileCommittingMs` | 30 | **15** |
| `recognitionRestartDefaultDelayMs` | 300 | **120** |

### 5. Validación
- **38 tests nuevos** en [`tests/configCommands.test.ts`](tests/configCommands.test.ts) (rebranding primavera determinista, guardia de "sin afectación", `normalizeConfiguracion`, matchers).
- **Suite completa:** 57 archivos · **1268 tests verdes** (`npm test`).
- `npx tsc --noEmit` → **exit 0** (sin errores de tipos).

---

## 0. Estructura del sistema de voz

FLU OS4 reconoce comandos por **tres capas complementarias**:

| Capa | Mecanismo | Dónde vive |
|------|-----------|------------|
| **1. Comandos directos** | Detección por frases exactas en español/inglés, con aliases ASR (Chrome confunde `flu` → `flow`/`blue`/`flo`) | [`FLU_CONFIG.voiceCommands`](src/voice/lib/fluConfig.js:781) |
| **2. Intents de navegación** | Identificadores canónicos que la UI y el hook usan para despachar acciones | [`NAVIGATION_COMMAND_IDS`](src/voice/lib/voiceCommands.js:16) |
| **3. Acciones resueltas por la IA** | Gemini devuelve un contrato JSON (`respuesta_voz`, `navegacion`, `workspace`, `musica`, `configuracion`, `emocion`, `animacion`, consulta de minutas) que [`onContractResolved`](src/App.tsx:803) ejecuta | [`src/App.tsx`](src/App.tsx:803) |

> **Nota de diseño:** La detección de frases es bilingüe (es + en). El módulo de comandos centraliza la detección en [`voiceCommands.js`](src/voice/lib/voiceCommands.js) y las frases en [`fluConfig.js`](src/voice/lib/fluConfig.js) — **un solo punto de verdad**. El catálogo de configuración vive en [`voiceConfigCatalog.ts`](src/core/config/voiceConfigCatalog.ts:1).

---

## 1. Palabras de activación (Wake Words)

Despiertan a FLU para que escuche y procese un comando. **16 frases** (8 en español + 8 en inglés).

| # | Español | Inglés |
|---|---------|--------|
| 1 | oye flu | hey flu |
| 2 | oye flow | hey flow |
| 3 | oye blue | hey blue |
| 4 | oye flo | hey flo |
| 5 | ok flu | okay flu |
| 6 | ok flow | okay flow |
| 7 | ok blue | okay blue |
| 8 | ok flo | okay flo |

> `flow` / `blue` / `flo` son **aliases ASR**: Chrome a menudo transcribe `flu` como esas variantes; se aceptan deliberadamente. Definidas en [`wakeWords`](src/voice/lib/fluConfig.js:783).

**Respuesta hablada (FLU_WAKE):** `Te escucho.` / `I'm listening.`

---

## 2. Control de escucha

### 2.1 Abrir / iniciar escucha (`openListening`) — 10 frases
| Español | Inglés |
|---------|--------|
| abrir escucha | open listening |
| abre escucha | start listening |
| iniciar escucha | resume listening |
| activar escucha | continue listening |
| seguir escuchando | |
| continuar escuchando | |

**Respuesta (ABRIR_ESCUCHA):** `Abriendo escucha.` / `Opening listening.`

### 2.2 Cerrar / detener escucha (`closeListening`) — 11 frases
| Español | Inglés |
|---------|--------|
| cerrar escucha | close listening |
| cierra escucha | stop listening |
| detener escucha | end listening |
| deten la escucha | turn off listening |
| apagar escucha | |
| dejar de escuchar | |
| parar escucha | |

**Respuesta (CERRAR_ESCUCHA):** `Cerrando escucha.` / `Closing listening.`

### 2.3 Confirmar que está escuchando (`listeningAckPhrases`)
Frases con las que el usuario pregunta si FLU sigue activo (derivadas de `LISTENING_ACK_PHRASES`):

| Español | Inglés |
|---------|--------|
| estas escuchando | are you listening |
| me escuchas | can you hear me |
| estas ahi / estas ahí | hey flu are you listening |
| estas por ahi / estas por ahí | |
| oye flu estas escuchando | |

---

## 3. Gestión de la conversación

### 3.1 Iniciar / reiniciar conversación (`startConversation`) — 17 frases
| Español | Inglés |
|---------|--------|
| iniciar conversacion / iniciar conversación | start conversation |
| inicia conversacion / inicia conversación | begin conversation |
| empezar conversacion / empezar conversación | new conversation |
| comenzar conversacion / comenzar conversación | start session |
| arrancar conversacion | new session |
| reiniciar conversacion | |
| nueva conversacion | |
| nueva sesion | |

**Respuesta (INICIAR_CONVERSACION):** `Iniciando conversacion.` / `Starting conversation.`

### 3.2 Siguiente hablante (`nextSpeaker`) — 8 frases
| Español | Inglés |
|---------|--------|
| otro hablante | next speaker |
| siguiente hablante | another speaker |
| cambio de hablante | other speaker |
| nuevo hablante | |
| habla otra persona | |

### 3.3 Ceder la palabra a FLU (`grantFloor`) — tras wake, mano alzada — 11 frases
| Español | Inglés |
|---------|--------|
| adelante | go ahead |
| participa | proceed |
| dale / dale flu | continue |
| continua / continúa | |
| sigue | |
| procede | |

**Respuesta (FLU_ADELANTE):** `De acuerdo.` / `Go ahead.`
**Respuesta (FLU_ADELANTE_EMPTY):** `No tengo nada pendiente por ahora.` / `I have nothing pending right now.`

### 3.4 Rechazar intervención de FLU (`dismissFloor`) — 8 frases
| Español | Inglés |
|---------|--------|
| no ahora | not now |
| ahora no | wait |
| espera / espera flu / flu espera | later |

**Respuesta (FLU_ESPERA):** `Entendido, espero.` / `Understood, I will wait.`

---

## 4. Productividad: minutas y resúmenes

### 4.1 Generar minuta (`generateMinute`) — 14 frases
| Español | Inglés |
|---------|--------|
| generar minuta | generate minute |
| genera minuta | generate summary |
| generame minuta | create minute |
| generame una minuta | create a minute |
| generame la minuta | make a minute |
| crear minuta | |
| crea una minuta | |
| preparar minuta | |
| hacer minuta | |

**Respuesta (GENERAR_RESUMEN):** `Generando minuta.` / `Generating summary.`

### 4.2 Generar resumen (`generateSummary`) — 13 frases
| Español | Inglés |
|---------|--------|
| generar resumen | generate summary |
| generar resuemn (alias ASR) | create summary |
| crear resumen | summarize conversation |
| crea un resumen | summarise conversation |
| resume la conversacion | make a summary |
| resumir la conversacion | |
| hacer resumen | |
| preparar resumen | |

### 4.3 Guardar minuta (`saveMinute`) — 7 frases
| Español | Inglés |
|---------|--------|
| guardar minuta | save minute |
| guarda minuta | save the minute |
| guardame minuta | |
| guardame la minuta | |
| guardar la minuta | |

**Respuesta (GUARDAR_MINUTA):** `Minuta guardada.` / `Minute saved.`

---

## 5. Análisis y generación de contenido

### 5.1 Analizar documento (`analyzeDocument`) — archivo anexado en la zona de carga — 22 frases
| Español | Inglés |
|---------|--------|
| analizar documento | analyze document |
| analiza documento | analyze the document |
| analiza el documento | analyze file |
| analizar el documento | analyze the file |
| analiza este documento | read the document |
| analizar este documento | read the file |
| leer documento | |
| lee el documento | |
| leer el archivo | |
| lee el archivo | |
| analiza el archivo | |
| analizar archivo | |
| analiza el archivo que te anexe | |
| resume el documento | |
| resumir el documento | |
| resume el archivo | |

**Respuesta (ANALIZAR_DOCUMENTO):** `Analizando el documento.` / `Analyzing the document.`

### 5.2 Analizar app (`analyzeApp`) — análisis de funcionalidad — 14 frases
| Español | Inglés |
|---------|--------|
| analizar app | analyze app |
| analiza app | analyze the app |
| analiza la app | analyze application |
| analizar la app | analyze functionality |
| analiza la aplicacion | |
| analizar la aplicacion | |
| analiza esta app | |
| analizar esta app | |
| analizar funcionalidad | |
| analiza la funcionalidad | |

**Respuesta (ANALIZAR_APP):** `Analizando la app.` / `Analyzing the app.`

### 5.3 Generar documento (`generateDocument`) — pdf/docx/xlsx/pptx/md/csv/ics… — 18 frases
| Español | Inglés |
|---------|--------|
| generar documento | generate document |
| genera documento | create document |
| generame documento | create a document |
| genera un documento | generate a document |
| generar un documento | |
| generame un documento | |
| crear documento | |
| crea un documento | |
| generar pdf / genera un pdf | |
| generar excel / genera un excel | |
| generar presentacion / genera una presentacion | |

**Respuesta (GENERAR_DOCUMENTO):** `Generando el documento.` / `Generating the document.`

### 5.4 Generar video (`generateVideo`) — video explicativo — 12 frases
| Español | Inglés |
|---------|--------|
| generar video | generate video |
| genera video | create video |
| generame video | create a video |
| genera un video | generate a video |
| generar un video | |
| generame un video | |
| crear video | |
| crea un video | |

**Respuesta (GENERAR_VIDEO):** `Preparando el video.` / `Preparing the video.`

---

## 6. Personalización del avatar por voz (comando directo)

| Comando (ejemplos hablados) | Clave | Efecto |
|------------------------------|-------|--------|
| "restablecer colores del avatar" | `resetAvatarColors` | Restaura colores por defecto |
| "reset avatar colors" | `resetAvatarColors` | Ídem (inglés) |
| "restablecer colores de flu" | `resetAvatarColors` | Ídem |
| "reset flu colors" | `resetAvatarColors` | Ídem |
| "colores por defecto" | `resetAvatarColors` | Ídem |
| "default colors" | `resetAvatarColors` | Ídem |

> Frases definidas en [`resetAvatarColors`](src/voice/lib/fluConfig.js:801). El resto de colores del avatar se controlan por el contrato IA (sección 9.9).

---

## 7. Intents de navegación canónicos (13)

Identificadores internos de [`NAVIGATION_COMMAND_IDS`](src/voice/lib/voiceCommands.js:16) que el sistema despacha. 10 se ejecutan en [`handleNavigationCommand`](src/hooks/useNavigationCommands.ts:107); `REGISTRAR_PARTICIPANTE` / `FLU_ADELANTE` / `FLU_ESPERA` se gestionan en el flujo OS2 (participación de Flu).

| Intent | Frase/acción asociada | Respuesta hablada (es/en) |
|--------|-----------------------|---------------------------|
| `INICIAR_CONVERSACION` | Iniciar conversación | `Iniciando conversacion.` / `Starting conversation.` |
| `GENERAR_RESUMEN` | Generar minuta/resumen | `Generando minuta.` / `Generating summary.` |
| `GUARDAR_MINUTA` | Guardar minuta | `Minuta guardada.` / `Minute saved.` |
| `ABRIR_ESCUCHA` | Abrir escucha | `Abriendo escucha.` / `Opening listening.` |
| `CERRAR_ESCUCHA` | Cerrar escucha | `Cerrando escucha.` / `Closing listening.` |
| `REGISTRAR_PARTICIPANTE` | Registrar participante | `Registrado {name}.` / `Registered {name}.` |
| `FLU_WAKE` | Palabra de activación | `Te escucho.` / `I'm listening.` |
| `FLU_ADELANTE` | Ceder la palabra a FLU | `De acuerdo.` / `Go ahead.` |
| `FLU_ESPERA` | Pedir a FLU que espere | `Entendido, espero.` / `Understood, I will wait.` |
| `ANALIZAR_DOCUMENTO` | Analizar documento | `Analizando el documento.` / `Analyzing the document.` |
| `ANALIZAR_APP` | Analizar app | `Analizando la app.` / `Analyzing the app.` |
| `GENERAR_DOCUMENTO` | Generar documento | `Generando el documento.` / `Generating the document.` |
| `GENERAR_VIDEO` | Generar video | `Preparando el video.` / `Preparing the video.` |

> Las respuestas habladas se resuelven con [`getCommandSpeech`](src/voice/lib/voiceCommands.js:86) desde `ui.commandSpeech`.

---

## 8. Acciones resueltas por la IA (capa de contrato)

Cuando el usuario no usa una frase directa, Gemini genera un contrato JSON que [`onContractResolved`](src/App.tsx:803) interpreta. Además de `configuracion` (sección 9), resuelve **toda la aplicación**:

> **Nota (2026-08-25):** para `configuracion` existe un **resolver determinista** ([`resolveConfigCommandFromText`](src/voice/lib/configCommands.js:326)) que construye el contrato localmente, de modo que **no depende** de que Gemini emita el campo. Ver Observaciones §1.

| Campo del contrato | Qué hace | Ejemplo hablado |
|--------------------|----------|-----------------|
| `respuesta_voz` | Texto que FLU pronuncia como respuesta | *"Hola, ¿en qué te ayudo?"* |
| `navegacion` `{comando, destino, parametros}` | Navega a una pestaña/área de la app (workspace, conversation, minutes, settings, system…) o ejecuta un intent | *"ve a la pestaña de ajustes"* → `{destino: 'settings'}` |
| `workspace` | Genera/reemplaza el artefacto del workspace (puntos clave, análisis, documento, video, imagen) | *"analiza y muéstrame los puntos clave"* |
| `musica` `{accion, cancion}` | Reproduce música según el contexto | *"pon algo de música"* |
| `minute-lookup-hit` | Consulta una minuta guardada → [`selectMinuteForLookup`](src/App.tsx:960) | *"muéstrame la minuta del lunes"* |
| `emocion` + `animacion` | Cambia la expresión/animación del avatar en la conversación | *(derivado automáticamente del tono)* |
| `configuracion` `{accion, clave, valor…}` | Aplica cambios reales de configuración (ver sección 9) | *"sube el volumen a 0.8"* |

> El flujo de despliegue de navegación en la UI usa [`handleNavigationCommand`](src/hooks/useNavigationCommands.ts:107) y la aplicación de configuración [`applyConfigAction`](src/App.tsx:240).

---

## 9. Configuración por voz (contrato IA `configuracion`) — Catálogo completo

La IA detecta la intención de configuración y devuelve un objeto `configuracion` que [`applyConfigAction`](src/App.tsx:240) aplica. Ejecuta **acciones reales** sobre el `integrationStore` (TTS, voz, personalidad, avance), el perfil de sesión, los colores del avatar y el branding.

El catálogo es la **fuente única de verdad**: [`VOICE_CONFIG_CATALOG`](src/core/config/voiceConfigCatalog.ts:1) — **52 entradas: 44 soportadas (4 `set_branding` + 40 `set_config`) + 8 no soportadas**. El prompt que se inyecta a la IA se genera con [`buildConfiguracionPrompt`](src/core/config/voiceConfigCatalog.ts:742).

> **Cambio aplicado (2026-08-24):** se cablearon `voiceSpeed`/`volume` al `integrationStore.setVoiceConfig` (antes código muerto) y los colores del avatar (`setComponentColor`/`resetComponentColors`) al store del avatar. Antes, por voz no tenían efecto real; ahora **sí se aplican**.

> **Cambio aplicado (2026-08-25):** la resolución es ahora **determinista con fast-path**. En los 3 ensamblados de contrato de [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:2874) se antepone [`resolveConfigCommandFromText`](src/voice/lib/configCommands.js:326) al `configuracion` del modelo, y el comando se **despacha al instante** por [`dispatchFastConfigCommand`](src/voice/hooks/useFluVoiceAssistant.js:2732) (ruta única `onContractResolved`). Si el fast-path aplicó la config, el contrato tardío lleva `configuracion: null` (idempotente). Así, el rebranding (p. ej. **primavera**) se aplica aunque Gemini **solo verbalice** la petición. Ver Observaciones §1.

### 9.1 Acción `set_branding` — Temporada / modo / cumpleaños (4)

> **Determinista con fast-path (2026-08-25):** *"cambia la temporada a primavera"* se resuelve localmente y **siempre** produce el contrato `set_branding`/`activeSeason`/`primavera`, con o sin emisión del modelo, y **se aplica al instante** mientras la IA confirma por voz. La frase *"activa la temporada de cumpleaños"* es un **no-op seguro** (ver Observaciones §2): no cambia la temporada.

| # | Clave | Valores | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 1 | `activeSeason` | 21 temporadas (derivadas de `Object.keys(PALETTES)`) | Activa una temporada y cambia el modo a `manual` automáticamente | *"cambia la temporada a verano"* | `{accion: 'set_branding', clave: 'activeSeason', valor: 'verano'}` |
| 2 | `mode` | `auto` \| `manual` \| `disabled` | Cambia el modo de temporada | *"pon el modo de temporada en manual"* | `{accion: 'set_branding', clave: 'mode', valor: 'manual'}` |
| 3 | `birthday` | `YYYY-MM-DD` \| `null` | Configura el cumpleaños (o lo borra con `null`) | *"mi cumpleaños es el 15 de marzo de 1990"* | `{accion: 'set_branding', clave: 'birthday', valor: '1990-03-15'}` |
| 4 | `celebrateAchievements` | `true` \| `false` | Activa/desactiva las celebraciones de logros | *"activa las celebraciones de logros"* | `{accion: 'set_branding', clave: 'celebrateAchievements', valor: true}` |

### 9.2 Acción `set_config` — Texto (3)

| # | Clave | Valores | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 5 | `textApiKey` | texto | Guarda la API key del motor de texto | *"guarda mi api key de texto"* | `{accion: 'set_config', clave: 'textApiKey', valor: 'AIza…'}` |
| 6 | `textModel` | texto | Cambia el modelo de texto | *"usa el modelo gemini 2.5 flash para texto"* | `{accion: 'set_config', clave: 'textModel', valor: 'gemini-2.5-flash'}` |
| 7 | `textApiUrl` | texto (URL) | Cambia la URL de la API de texto | *"cambia la url de la api de texto"* | `{accion: 'set_config', clave: 'textApiUrl', valor: 'https://…'}` |

### 9.3 Acción `set_config` — Imagen (3)

| # | Clave | Valores | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 8 | `imageApiKey` | texto | Guarda la API key del motor de imagen | *"guarda mi api key de imagen"* | `{accion: 'set_config', clave: 'imageApiKey', valor: 'AIza…'}` |
| 9 | `imageModel` | texto | Cambia el modelo de imagen | *"usa el modelo de imagen gemini 2.5 flash"* | `{accion: 'set_config', clave: 'imageModel', valor: 'gemini-2.5-flash'}` |
| 10 | `imageApiUrl` | texto (URL) | Cambia la URL de la API de imagen | *"cambia la url de la api de imagen"* | `{accion: 'set_config', clave: 'imageApiUrl', valor: 'https://…'}` |

### 9.4 Acción `set_config` — General (2)

| # | Clave | Valores | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 11 | `language` | `es` \| `en` \| `both` | Cambia el idioma activo de la sesión | *"pon el idioma en inglés"* | `{accion: 'set_config', clave: 'language', valor: 'en'}` |
| 12 | `sessionRole` | texto (perfil) | Establece el rol/perfil de sesión | *"el rol de esta sesión es docente"* | `{accion: 'set_config', clave: 'sessionRole', valor: 'docente'}` |

### 9.5 Acción `set_config` — Voz / TTS (4)

| # | Clave | Valores | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 13 | `voiceSpeed` | número **0.5–2.0** (acepta 0.1–10 y se acota) | Velocidad real de TTS (`rate`) vía `integrationStore.setVoiceConfig` | *"cambia la velocidad de voz a 1.5"* | `{accion: 'set_config', clave: 'voiceSpeed', valor: 1.5}` |
| 14 | `voice` | texto (voz TTS) | Selecciona la voz de TTS | *"usa la voz femenina"* | `{accion: 'set_config', clave: 'voice', valor: 'es-MX-SalvadoraNeural'}` |
| 15 | `pitch` | número **0.5–2.0** | Tono de la voz | *"sube el tono de voz a 1.2"* | `{accion: 'set_config', clave: 'pitch', valor: 1.2}` |
| 16 | `volume` | número **0.0–1.0** | Volumen real de TTS (`volume`) vía `integrationStore.setVoiceConfig` | *"sube el volumen a 0.8"* | `{accion: 'set_config', clave: 'volume', valor: 0.8}` |

### 9.6 Acción `set_config` — Personalidad (5)

| # | Clave | Valores | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 17 | `traits` | lista de rasgos; **requiere `subvalor` `add`\|`remove`** | Añade o quita un rasgo de personalidad | *"agrega el rasgo empático"* | `{accion: 'set_config', clave: 'traits', valor: 'empatico', subvalor: 'add'}` |
| 18 | `tone` | texto (tono) | Cambia el tono de la personalidad | *"cambia tu tono a amigable"* | `{accion: 'set_config', clave: 'tone', valor: 'amigable'}` |
| 19 | `customInstructions` | texto | Define instrucciones personalizadas persistentes | *"recuerda que siempre me hables de usted"* | `{accion: 'set_config', clave: 'customInstructions', valor: '…'}` |
| 20 | `proactivity` | número **0.0–1.0** | Nivel de proactividad de FLU | *"sube tu proactividad a 0.7"* | `{accion: 'set_config', clave: 'proactivity', valor: 0.7}` |
| 21 | `defaultEmotion` | 7 emociones | Emoción por defecto del avatar | *"pon tu emoción por defecto en alegre"* | `{accion: 'set_config', clave: 'defaultEmotion', valor: 'alegre'}` |

### 9.7 Acción `set_config` — Avanzado (14) — handler `advancedNumber`

| # | Clave | Rango | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|-------|-------------|---------------|--------------------------|
| 22 | `animationSpeed` | **0.5–2.0** | Velocidad de las animaciones del avatar | *"acelera las animaciones a 1.3"* | `{accion: 'set_config', clave: 'animationSpeed', valor: 1.3}` |
| 23 | `emotionalReactivity` | **0.0–1.0** | Qué tan reactivo es FLU emocionalmente | *"baja tu reactividad emocional a 0.4"* | `{accion: 'set_config', clave: 'emotionalReactivity', valor: 0.4}` |
| 24 | `creativity` | **0.0–1.0** | Temperatura/creatividad de las respuestas | *"pon la creatividad en 0.8"* | `{accion: 'set_config', clave: 'creativity', valor: 0.8}` |
| 25 | `emotionMinConfidence` | **0.0–1.0** (step 0.05) | Confianza mínima para aplicar una emoción | *"sube la confianza mínima de emoción a 0.6"* | `{accion: 'set_config', clave: 'emotionMinConfidence', valor: 0.6}` |
| 26 | `emotionBaseDetectionConfidence` | **0.0–1.0** (step 0.05) | Confianza base de detección emocional | *"pon la confianza base de detección en 0.55"* | `{accion: 'set_config', clave: 'emotionBaseDetectionConfidence', valor: 0.55}` |
| 27 | `emotionTopicChangeOverlapRatio` | **0.0–0.5** (step 0.01) | Ratio de solape para detectar cambio de tema | *"ajusta el solape de cambio de tema a 0.2"* | `{accion: 'set_config', clave: 'emotionTopicChangeOverlapRatio', valor: 0.2}` |
| 28 | `emotionTopicChangeMinWords` | **1–10** | Palabras mínimas para considerar cambio de tema | *"pon 5 palabras mínimas para cambio de tema"* | `{accion: 'set_config', clave: 'emotionTopicChangeMinWords', valor: 5}` |
| 29 | `emotionShortUtteranceWordCount` | **1–10** | Palabras para intervención corta | *"define intervención corta en 3 palabras"* | `{accion: 'set_config', clave: 'emotionShortUtteranceWordCount', valor: 3}` |
| 30 | `tomMaxParticipants` | **2–50** | Máx. participantes en Teoría de la Mente | *"permite hasta 10 participantes"* | `{accion: 'set_config', clave: 'tomMaxParticipants', valor: 10}` |
| 31 | `tomMaxTopicsPerParticipant` | **5–100** | Máx. temas por participante (ToM) | *"máximo 20 temas por participante"* | `{accion: 'set_config', clave: 'tomMaxTopicsPerParticipant', valor: 20}` |
| 32 | `tomParticipantInactivityMs` | **1–120** (min) | Minutos de inactividad para cerrar participante | *"cierra participantes inactivos a los 5 minutos"* | `{accion: 'set_config', clave: 'tomParticipantInactivityMs', valor: 5}` |
| 33 | `tomSummaryDisplayLimit` | **1–10** | Límite de elementos del resumen ToM | *"muestra hasta 3 elementos en el resumen"* | `{accion: 'set_config', clave: 'tomSummaryDisplayLimit', valor: 3}` |
| 34 | `systemEventWindowMs` | **1–30** (min) | Ventana de eventos del sistema | *"ventana de eventos de 10 minutos"* | `{accion: 'set_config', clave: 'systemEventWindowMs', valor: 10}` |
| 35 | `systemEventDedupBucketMs` | **1–30** (s) | Bucket de deduplicación de eventos | *"deduplica eventos cada 15 segundos"* | `{accion: 'set_config', clave: 'systemEventDedupBucketMs', valor: 15}` |

### 9.8 Acción `set_config` — Imagen del avatar (2) — handler `imageBoolean`

| # | Clave | Valores | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 36 | `capVisible` | `true` \| `false` | Muestra/oculta el gorro del avatar | *"muestra el gorro"* | `{accion: 'set_config', clave: 'capVisible', valor: true}` |
| 37 | `hairVisible` | `true` \| `false` | Muestra/oculta el cabello del avatar | *"oculta el cabello"* | `{accion: 'set_config', clave: 'hairVisible', valor: false}` |

### 9.9 Acción `set_config` — Colores del avatar (5)

| # | Clave | Formato | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 38 | `avatarColor` | `Componente:#hex` (ej. `Bunny_pants:#ff0000`) | Colorea la pieza indicada del avatar | *"pinta el componente Bunny_pants de rojo"* | `{accion: 'set_config', clave: 'avatarColor', valor: 'Bunny_pants:#ff0000'}` |
| 39 | `pantsColor` | color | Atajo → pantalones (`Bunny_pants`) | *"ponle pantalones rojos"* | `{accion: 'set_config', clave: 'pantsColor', valor: '#ff0000'}` |
| 40 | `bodyColor` | color | Atajo → cuerpo (`Bunny_body`) | *"cambia el color del cuerpo a azul"* | `{accion: 'set_config', clave: 'bodyColor', valor: '#0000ff'}` |
| 41 | `faceColor` | color | Atajo → cara (`Bunny_face`) | *"pon la cara de color verde"* | `{accion: 'set_config', clave: 'faceColor', valor: '#00ff00'}` |
| 42 | `resetAvatarColors` | — | Restaura los colores por defecto | *"restablece los colores del avatar"* | `{accion: 'set_config', clave: 'resetAvatarColors', valor: null}` |

### 9.10 Acción `set_config` — Motor IA / Perfil (2)

| # | Clave | Valores | Explicación | Frase hablada | Contrato `configuracion` |
|---|-------|---------|-------------|---------------|--------------------------|
| 43 | `aiProvider` | `openrouter` \| `gemini` \| `deepseek` \| `local` | Cambia el proveedor de IA activo | *"usa deepseek como proveedor de ia"* | `{accion: 'set_config', clave: 'aiProvider', valor: 'deepseek'}` |
| 44 | `profile` | perfiles de `FLU_PROFILES` | Cambia el perfil de Flu | *"cambia el perfil a profesor"* | `{accion: 'set_config', clave: 'profile', valor: 'profesor'}` |

---

### 9.11 Entradas NO soportadas por voz (8)

Presentes en el panel [`FluSettingsPanel`](src/components/FluSettingsPanel.tsx:73) pero **no gestionables por voz**, con su motivo:

| Clave | Motivo (`motivoNoSoportado`) |
|-------|------------------------------|
| `ocrApiKey` | OCR deshabilitado en el proxy |
| `ocrModel` | OCR deshabilitado en el proxy |
| `ocrApiUrl` | OCR deshabilitado en el proxy |
| `memoryCurve` | Sin control real en el módulo de memoria |
| `memoryTamaño` | Sin control real en el módulo de memoria |
| `wakeWords` | Estado local no persistente (editor manual en panel) |
| `clearCache` | Botón de acción, no una clave persistente |
| `debugLogs` | Estado local de depuración |

> Estas claves se incluyen explícitamente en el prompt de [`buildConfiguracionPrompt`](src/core/config/voiceConfigCatalog.ts:742) para que la IA **no invente** valores ni los intente aplicar.

---

## 10. Resumen ejecutivo

- **Comandos directos bilingües (Capa 1):** 16 grupos de frases en [`FLU_CONFIG.voiceCommands`](src/voice/lib/fluConfig.js:781) (`wakeWords` ×16, `openListening` ×10, `closeListening` ×11, `nextSpeaker` ×8, `startConversation` ×17, `generateMinute` ×14, `generateSummary` ×13, `analyzeDocument` ×22, `analyzeApp` ×14, `generateDocument` ×18, `generateVideo` ×12, `saveMinute` ×7, `listeningAckPhrases`, `grantFloor` ×11, `dismissFloor` ×8, `resetAvatarColors` ×6).
- **13 intents de navegación** canónicos ([`NAVIGATION_COMMAND_IDS`](src/voice/lib/voiceCommands.js:16)) con sus respuestas habladas es/en ([`getCommandSpeech`](src/voice/lib/voiceCommands.js:86)).
- **Acciones resueltas por la IA (Capa 3):** navegación a pestañas, artefacto de workspace, música, consulta de minutas, emoción/animación y `respuesta_voz` ([`onContractResolved`](src/App.tsx:803)).
- **Configuración por voz (IA):** catálogo de **52 entradas** ([`VOICE_CONFIG_CATALOG`](src/core/config/voiceConfigCatalog.ts:1)) = **44 soportadas** (`set_branding` × 4 + `set_config` × 40) que **sí producen efecto real**, + **8 no soportadas** con motivo explícito.
- **Resolución determinista (2026-08-25):** [`resolveConfigCommandFromText`](src/voice/lib/configCommands.js:326) construye el contrato `configuracion` localmente en los 3 ensamblados del hook, funcionando incluso si el modelo solo verbaliza (rebranding primavera garantizado).
- **Latencia (2026-08-25):** 7 reducciones en [`FLU_CONFIG.timing`](src/voice/lib/fluConfig.js:245) (ver Observaciones §4).
- **Validación:** build exit 0 · `npx tsc --noEmit` exit 0 · **1268/1268 tests verdes en 57 archivos** (`npm test`) · 38 tests nuevos de configuración por voz ([`tests/configCommands.test.ts`](tests/configCommands.test.ts)).
