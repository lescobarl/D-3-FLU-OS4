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
