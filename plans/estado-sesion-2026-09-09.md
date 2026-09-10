# Estado de sesión — 2026-09-09 (Sesión estable de referencia)

> Archivo de checkpoint para retomar en otra sesión o recuperar si algo falla.
> Sesión ORIGEN: estable, con método de trabajo validado por el usuario.
> Si la sesión nueva falla, VOLVER a esta sesión.

## Contexto del proyecto
- Proyecto: **D-3-FLU-OS4** (TypeScript estricto, Vite 5 + React 18, Zustand, Dexie/IndexedDB).
- Rama git activa: `feature/fase-conversacional-acciones` (NO hacer commit directo a main).
- Servidor dev: `npm run dev` en `http://localhost:5173`.
- Reglas vinculantes: `AGENTS.md` (secciones §1–§13; §13 = protocolo de evidencia estructural anti-cascada).
- Referencia de voz correcta: `D:\D-Proyectos\D-3-FLU-OS2\flu-voz` (solo lectura).

## Estado del código (lo aplicado HOY, validado por tests + pantalla del usuario)

### 1) Unificación de la transcripción/display de voz (conversación)
- `FluConversationTabView.tsx`: se eliminó el escaneo local duplicado de "última frase del usuario"; ahora recibe la fuente canónica por prop `lastHeardText`.
- `FluBridgeContext.tsx` + `FluAvatarVoiceBridge.tsx` + `App.tsx`: la burbuja del avatar y la bitácora comparten la MISMA cadena canónica `live → lastTranscript → última frase del historial → mirror`.
- `WorkspaceHub.tsx`: la barra de búsqueda recibe la misma frase canónica (`lastTranscript`, `lastUserText`) y solo le quita la wake word.
- `FluAvatarVoiceBridge.tsx:327`: mirror `currentTranscript` ahora es espejo fiel (set y clear); antes solo se seteaba y nunca se limpiaba (interino incompleto pegado).

### 2) Ruta duplicada `handleSpeak`/`process-transcript` ELIMINADA
- Borrado de `handleSpeak` (~140 líneas) y el case `process-transcript` en `FluAvatarVoiceBridge.tsx`.
- Eliminado `'process-transcript'` del contrato `voiceCommand`/`sendVoiceCommand` en `integrationStore.ts`.
- Eliminado el callback `onResolveCommunicationProfile` de `App.tsx` (solo lo usaba handleSpeak).
- Borrado `src/voice/lib/conversationLogDispatch.js` (0 referencias en todo el repo).
- Guard actualizado en `tests/integration.test.ts:1908`: ahora exige la ruta ÚNICA (bridge sin `handleSpeak`/`geminiService`/`generateResponse`/`process-transcript`).

### 3) Bugs de voz corregidos de raíz
- **Turno mudo (aviones)**: `App.tsx` gate de habla ahora usa `environmentWillChange` (solo suprime `respuestaVoz` si el ambiente CAMBIA de verdad; un reset espurio idempotente a "asistente" ya no deja el turno mudo).
- **Boca congelada al hablar (audio sí, MouthMove no)**: `useFluVoiceAssistant.js` `suspendRecognitionForAssistantSpeech` reabría la escucha durante el SPEAKING con `requestRecognitionRestart(0)` (commit `3132d2e`). Ahora SOLO reabre en modo pasivo (`if (wasListeningBefore && !conversationActiveRef?.current)`). En conversación activa la reapertura la hace App al terminar el TTS.

### 4) Imagen IA integrada en la sección "Imágenes" del feed web
- `ImageGrid.tsx`: nueva prop `generated` — la imagen IA es la PRIMERA celda del grid de miniaturas (click = ampliar overlay). Estados loading/error dentro de la celda. Etiquetas bilingües resueltas con `pickLabel` (se pasó `language`).
- `WorkspaceHub.tsx`: tarjeta única de imágenes (IA + web). Si es SOLO imagen IA → `id:'ia-imagen'`, origen IA, título "Imagen generada" y `onlyInKind` (solo en filtro Imágenes). Si hay web → `web-imagenes` origen WEB.
- `ResultFeed.tsx`: flag `onlyInKind` — un ítem así solo aparece bajo su filtro de tipo, nunca en "Todo".
- Corregido el "borde falso" en el render de la imagen IA y agregado watchdog limpio: `onLoaded` limpia el timeout de 30 s, `onLoadFailed` reintenta la misma URL (`retry=N`).

### 5) Rediseño del panel lateral "Hoy" (estilo Outlook) + tipografía
- `HoyPanel.tsx`: diseño de tarjetas con columna de estado/hora + cuerpo + botón de acción. Secciones: Próxima, Próximas citas (📅), Alarmas (⏰), Clases de hoy (📚), Notas (checkbox + ×). Íconos uniformes.
- `HoyPanel.tsx` props nuevas: `reminders.onRemove`, `temporals.onCancel` (botones × manuales conectados en `App.tsx`).
- `unified.css`: tipografía unificada (10px), quitar viñeta `▸` del summary, quitar "black" (fondos transparentes), interlineado compacto, separadores `border-top` entre secciones Y entre bloques (`__block + __block`).
- Scroll SOLO en el panel derecho: `.frame-content--workspace`/`.flu-tab-panel--workspace .panel-frame__body` ceden al hub (`flex:1`), `.workspace-hub__columns` ocupa altura, main y side scrollean por separado.

### 6) Parsers de hora arreglados para el formato del ASR (Chrome)
El ASR transcribe "12:13 p.m" como **"12 13 p m"** (dos puntos y punto del meridiano → espacios). El parser solo aceptaba `:`/`.` y `pm` pegado → leía "12:00" y dejaba "13 p m" como label (o "5 00 p m" como 05:00 → saltaba a mañana).
- `temporalIntentParser.ts`: `ES_TIME`/`EN_TIME` aceptan `HH MM` con espacio y meridiano `p m`/`p.m.`/`a m`. `resolveEsTime`/`resolveEnTime` leen minutos del grupo espacio.
- `nlDateParser.ts`: `extractTime` con meridiano de puntos/espacios y reloj `HH MM` por espacio.
- Tests nuevos agregados (43 temporal + 39 date) que fijan: `"12 13 p m"` → 12:13; `"5 00 p m"` → 17:00 HOY.

### 7) Zona de arrastre del pizarrón
- Quitado el botón "🧭 Analizar app" (y su input de carpeta) en ambas zonas de `WorkspaceHub.tsx`.
- Texto cambiado a **"Arrastra tu documento aquí"** y quitado el "— o —".
- Área compacta (fila, min-height 40px) para que no robe espacio.

## Verificación realizada
- `tsc -b`: 0 errores.
- Tests acotados verdes: `temporalIntentParser` (43), `remindersDateParser` (39), `reminderIntentParser`, `reminderService`, `remindersAgenda`, `hardcodeGuard`, `protocolGuard`, `workspaceHubLayout`, `workspaceHubRunSearch`, guards.
- FALLOS PREEXISTENTES (NO tocar, ya fallaban en HEAD): `hoyPanel.test.tsx` — 3 tests del bloque DIARIO (diario deshabilitado en config). `architecture.test.ts:132` — exige `import { WELCOME_MESSAGE }` sin `STORAGE_KEYS`.
- Validación del USUARIO en pantalla: imagen IA en pestaña "Imágenes" ✓, alarma con hora correcta ✓, cita "hoy" no salta a mañana ✓.

## Bugs reales detectados por el usuario (aún SIN corregir)
1. **"No recuerdo si algún escenario quedó pendiente"**: verificar en la próxima sesión que las frases de compras, horario y diario se ejecutan bien con voz real (parsers ya corregidos, falta prueba en vivo).
2. (Si aparecen) cualquier otro caso en que "la IA dice que creó X pero no se ve en el panel" → seguir el flujo: ¿`dispatchArbiterIntent` ejecutó el manejador? ¿`nlDateParser` interpretó bien la hora? ¿se guardó en IndexedDB?

## Cómo validar en vivo (flujo manual recomendado)
Con usuario `luis` activo, decir por voz:
- "okay flu crea una cita médica para hoy a las 5 p.m." → debe verse en Próximas citas HOY a las 17:00.
- "okay flu pon una alarma a las 12:13 p.m." → debe verse ⏰ Alarmas a las 12:13.
- "okay flu crea una nota para el super" → 📝 Notas.
- "okay flu agrega pan a la lista de compras" → lista de compras.
- Verificar que cambiar de usuario en el selector 👤 oculta los ítems de luis.

## Archivos auxiliares creados en la sesión (para limpiar/ignorar si no se usan)
- `scripts/driver-*.mjs`, `scripts/shot-*.mjs`, `scripts/dump-*.mjs`, `scripts/probe-*.mjs`: drivers de verificación visual; NO forman parte de la suite.
- `tests/e2e/comandos-usuario-luis.spec.ts`: DESHABILITADO (`test.describe.skip`) — inyecta `contract:{}` y valida solo el camino offline (falso positivo); no re-habilitar sin Gemini real.
- Screenshots/reportes en `reports/`.

## Consejos para la sesión nueva
- Primero leer este archivo + `AGENTS.md` §12-§13.
- Trabajar en hitos pequeños con `tsc -b` y tests acotados; NO correr la suite completa.
- Antes de cambiar voz/UI, confirmar con el usuario en pantalla.
- No declarar "listo"; reportar "Cambios aplicados · Validado contra · No validado".

## Dónde están los LOGS para validación en vivo (si otra sesión pregunta)
El servidor dev corre como proceso en background de Kilo con id `bgp_083bd2f44001MxmsZxhcjRDZVX`.
- **Forma correcta de leerlos**: usar la herramienta `background_process` → `action: "logs"` con ese id. Contiene las trazas `[CLIENT-LOG]` de voz: `processConversationFluQuery`, `dispatchArbiterIntent`, `onContractResolved`, `__fluHandle*`, `[REC]`, `[geminiProxy]`.
- **Fallback si la herramienta no está disponible**: archivos en `C:\Users\luis_\.local\share\kilo\log\background-process\` (carpetas por scope, log de `npm run dev`).
- **Volcado capturado en esta sesión** (traza del bug de alarma, turno 18:47): `C:\Users\luis_\.local\share\kilo\tool-output\tool_0870829ef001KYEmW9PAIcfNsv`.
- **Evidencia visual**: `reports/ui-review/*.png` (panel Hoy), `reports/comandos-luis/*.png` y `reports/comandos-luis-real/*.png` (screenshots de comandos por usuario).
- Cómo validar con el log: pedir al usuario que ejecute la frase por voz y leer la traza del turno; buscar si `dispatchArbiterIntent` ejecutó el manejador y qué `timeOfDay`/`dueAt` se calculó.
- NOTA 2026-09-09 20:05: el dev server se reinició en otra sesión. Id actual del background process: `bgp_087c30492001ECWNpb2wl3MBpK` (pid 19092). Su log vive en la misma carpeta `log\background-process\` bajo el scope de ESE id; el id `bgp_083bd2f44001...` corresponde al arranque previo.

## Bloque 8 (sesi�n clon 2026-09-09 ~15:21) � 10 reportes de usuario
C�digo aplicado (sin commitear, sobre HEAD 32ea9e3), validado con tsc -b + 190 tests acotados:
- P1 borrar alarmas: refresh de useTemporalItems expone solo status pending (causa: list() devolv�a todos).
- P2 AM/PM: formatTimeOfDayMeridiem (scheduleEngine) usado en citas y alarmas (HoyPanel).
- P3 parsers: ES_TIME acepta "con N minutos"; normalize "con N minutos" antes de OFFSET en nlDateParser; "hoy" con hora pasada rola a ma�ana (temporalIntentParser). +tests.
- P4 alarma triplicada: refs latest para notify/speak + entrega �nica de voz (voice/both no repite speak) en useReminders/useTemporalItems; quitar notify/speak de deps de runTick.
- P5 nota que repite alarma: guard actionBelongsToTranscript en audioMath + aplicado en onContractResolved (App) + tests.
- P6 notas: fila clicable label (checkbox+texto) .hoy-panel__nota-row; contenido completo con wrap; parser "agrega X a la lista del super"; append sem�ntico a nota Super: existente (App __fluHandleNoteText).
- P7 recordatorios: secci�n renombrada "Recordatorios y citas"; top 5 en vez de 3.
- P8 horario: card de clase materia+horario en un rengl�n con wrap; --font-ui = --font-sans (App.css) para tipograf�a unificada.
- P9 zona arrastre: .flu-upload-zone__drop a columna (2 renglones).
- P10 OCR horario: REVISADO (sin implementar): im�genes?visi�n+structureHorarioText+HorarioImportConfirm ya existe; PDF ruta F1 no parsea horario (el OCR cae al artifact, no a structureHorarioText). Propuesta si se autoriza: en useDocumentAnalysis/analyzeFile, tras obtener rawText OCR correr structureHorarioText y abrir pendingHorarioImport igual que processImageFile.
- 3 fallos preexistentes de diario (hoyPanel.test) NO tocados.
PENDIENTE validaci�n en vivo con luis: P1 (�), P2, P3 frases, P4 (alarma a hora real), P5 nota, P6-9 visual.

## Bloque 9 (sesi�n clon 2026-09-09 ~18:00) � Tuber�a �nica de voz �9 (hitos)
Basado en AGENTS.md �9 (nueva Piedra Inamovible) + plans/plan-tuberia-unica-voz.md. Aplicado y validado (tsc -b + 358 tests acotados verdes; 3 fallos preexistentes diario NO tocados):
- H1 App respeta replaceLastRawLog del payload (eliminado re-dedup con spokenUtteranceRevision en App.tsx rawOnly; ahora reemplaza si el motor dice replace, append si no, con dedup exacto residual). Invariante: rg spokenUtteranceRevision en App.tsx = 0.
- H2 Frase can�nica �nica: helper puro resolveDisplayPhrase (audioMath.js) usado por FluAvatarVoiceBridge/FluConversationTabView/WorkspaceHub; eliminado phraseDisplay muerto en App. Invariante: sin cascadas a||b||c de transcripci�n en componentes.
- H3 Escucha centralizada: speechRecognitionLocal.js registra instancias vivas; startSpeechRecognition aborta cualquier otra activa (nunca 2 micr�fonos). Onboarding y principal comparten la exclusi�n.
- H5 Prompt anti-arrastre: gemini.js instrucci�n ahora proh�be re-ejecutar/re-mentar acciones de turnos anteriores (solo contexto).
- H4 (query = misma can�nica / web partida) NO ejecutado: requiere decisi�n de timing en motor de voz (esperar turno completo antes de BUSCAR) � validar en vivo.
PENDIENTE validaci�n en vivo con luis (micr�fono): frase unica "busca en la web como saltan los chapulines" ? 1 fila en bit�cora + 1 b�squeda completa; confirmar IA no repite turnos previos; P1-P9 visual.

## Bloque 10 (sesi�n clon 2026-09-09 ~18:43) � P1 diarizaci�n + P2 agenda + P3 est�tica
- P1 diarizaci�n (causa ra�z con evidencia): fluConfig.js roomCapture.segmentChronoSplit estaba en true CONTRADICIENDO su comentario "Desactivado: pausas no abren H2+ en la misma voz (causa H46)". El c�digo turnSpeakerCommit.js:123-148 forzaba etiqueta nueva (segment-chrono-split -> nextSpeakerLabel) en cada segmento de audio nuevo con la MISMA voz -> "Hablante N" por intervenci�n. Cambiado a false (config, sin hardcode). tsc OK + turnSpeakerCommit 16/16.
- P2 agenda: etiqueta 'Clases de hoy' -> 'Agenda de hoy'; bot�n � en tarjetas del d�a (HoyPanel, usa horario.onRemove) data-testid hoy-clase-remove-{id}; borrado por voz ya exist�a (horario.remove App:3509, con match por materia/d�a). Toda la agenda (clases Y reuniones) borrable manual y por voz.
- P3 est�tica: CSS scope .hoy-panel__horario neutraliza el chrome de .flu-settings-* y alinea tipograf�a/tokens del HorarioPizarron embebido al panel (unified.css).
- No tocado: H4 (timing motor de voz). Pendiente validaci�n en vivo usuario.
- 394 tests acotados verdes; 3 fallos preexistentes DIARIO.
