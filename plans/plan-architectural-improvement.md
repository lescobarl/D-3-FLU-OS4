# Plan de Mejora Arquitectónica — OS4

## Diagnóstico Actual

### Problemas Identificados

#### 1. `App.tsx` (2709 líneas) — Monolito crítico
- **Config persistence**: 6 pares de `useState` + `useCallback` para API keys, modelos, URLs (líneas 325-365). Lógica duplicada de `localStorage.getItem`/`setItem` con try/catch.
- **Workspace image**: 7 refs + 5 estados + 3 efectos + 2 callbacks (líneas 1176-1262). Toda la lógica de generación, timeout, retry, overlay está inline.
- **Navigation commands**: Switch de 6 comandos con lógica de auditoría duplicada (líneas 963-1070).
- **Minute/Summary handlers**: 4 handlers grandes con lógica de auditoría, speech, y persistencia (líneas 1397-1578).
- **Transcript post-processing**: `TRANSCRIPT_ACTION_MAP`, `TRANSCRIPT_EMOTION_MAP`, `detectActionInTranscript`, `detectEmotionInTranscript` (líneas 199-278) — lógica de dominio mezclada con UI.
- **Render tree**: 870 líneas de JSX con settings UI, tabs, panels, image overlay.

#### 2. `FluAvatarVoiceBridge.tsx` (496 líneas) — Prop drilling excesivo
- 20+ props pasadas desde App.tsx, muchas de las cuales son simplemente delegadas.
- `onParticipantEmotionRef` y `onContextualEmotionRef` son patrones de ref-sharing frágiles.
- Voice props (voiceStatus, voiceError, liveTranscript, etc.) se pasan a través del bridge sin necesidad.

#### 3. `integrationStore.ts` (696 líneas) — Store sobrecargado
- Mezcla estado de UI (isMicActive, isFluSpeaking) con estado de dominio (conversationHistory, config).
- `pendingEmotionAnims` es un mecanismo de comunicación entre App.tsx y useAvatarVoiceSync que debería ser más explícito.

#### 4. `useAvatarVoiceSync.ts` (501 líneas) — Hook con múltiples responsabilidades
- Sincronización de estado, aplicación de emociones, micro-expresiones idle, reactividad emocional, triggers de participante.
- Dependencia directa de `bunnyStore` y `integrationStore` sin abstracción.

---

## Plan de Refactorización por Fases

### Fase 1: `useConfigPersistence` — Extraer lógica de configuración
**Archivos**: `src/hooks/useConfigPersistence.ts`
**Impacto**: -80 líneas en App.tsx

Extraer:
- `apiKey`, `textModel`, `textApiUrl`, `imageApiKey`, `imageModel`, `imageApiUrl`
- `language`, `sessionRole`
- Todos los handlers `handle*Commit`
- Efectos de persistencia a localStorage

```typescript
// API
interface ConfigPersistence {
  apiKey: string;
  textModel: string;
  textApiUrl: string;
  imageApiKey: string;
  imageModel: string;
  imageApiUrl: string;
  language: 'es' | 'en' | 'both';
  sessionRole: string;
  voices: SpeechSynthesisVoice[];
  handleTextApiKeyCommit: (key: string) => void;
  handleTextModelCommit: (model: string) => void;
  handleTextApiUrlCommit: (url: string) => void;
  handleImageApiKeyCommit: (key: string) => void;
  handleImageModelCommit: (model: string) => void;
  handleImageApiUrlCommit: (url: string) => void;
  setLanguage: (lang: 'es' | 'en' | 'both') => void;
  setSessionRole: (role: string) => void;
}
```

### Fase 2: `useWorkspaceImage` — Extraer lógica de imagen de workspace
**Archivos**: `src/hooks/useWorkspaceImage.ts`
**Impacto**: -100 líneas en App.tsx

Extraer:
- Todos los refs (workspaceImageUrlRef, workspaceImageRequestRef, etc.)
- Estados (workspaceImage, workspaceImageLoading, etc.)
- `handleRetryWorkspaceImage`
- Efectos de timeout, cleanup, escape key
- Lógica de generación de imagen desde contract

```typescript
interface WorkspaceImageState {
  imageUrl: string | null;
  isLoading: boolean;
  isFailed: boolean;
  isExpanded: boolean;
  retry: () => void;
  expand: () => void;
  close: () => void;
  generateFromContract: (contract: any, promptVisual: string, tipo: string | null) => Promise<void>;
  clear: () => void;
}
```

### Fase 3: `useNavigationCommands` — Extraer manejo de comandos de navegación
**Archivos**: `src/hooks/useNavigationCommands.ts`
**Impacto**: -110 líneas en App.tsx

Extraer:
- Switch de comandos (FLU_WAKE, INICIAR_CONVERSACION, CERRAR_ESCUCHA, etc.)
- Lógica de auditoría asociada
- `getCommandSpeech`, `scheduleResumeListening`, `speakFlu`

```typescript
interface NavigationCommands {
  executeCommand: (navegacion: any, transcript: string, speakerName: string, phase: string) => Promise<void>;
  speakFlu: (text: string, lang: string) => Promise<void>;
  scheduleResumeListening: () => void;
}
```

### Fase 4: `useMinuteHandlers` — Extraer handlers de minutas/resúmenes
**Archivos**: `src/hooks/useMinuteHandlers.ts`
**Impacto**: -200 líneas en App.tsx

Extraer:
- `handleGenerateMinute`, `handleGenerateSummary`, `handleSaveMinute`
- `handleSelectMinuteHistory`
- Estados `isGeneratingMinute`, `isSummarizing`, `minuteDraft`, `selectedMinuteId`

```typescript
interface MinuteHandlers {
  minuteDraft: any;
  selectedMinuteId: string | null;
  isGeneratingMinute: boolean;
  isSummarizing: boolean;
  minutePanelRef: React.RefObject<{ save: () => void }>;
  handleGenerateMinute: () => Promise<void>;
  handleGenerateSummary: (opts?: { announce?: boolean }) => Promise<void>;
  handleSaveMinute: (draftOverride?: any, opts?: { announce?: boolean }) => Promise<void>;
  handleSelectMinuteHistory: (entry: any) => void;
  setMinuteDraft: (draft: any) => void;
  setSelectedMinuteId: (id: string | null) => void;
}
```

### Fase 5: `transcriptProcessor` — Servicio de post-procesamiento de transcripts
**Archivos**: `src/lib/transcriptProcessor.ts`
**Impacto**: -80 líneas en App.tsx

Extraer:
- `TRANSCRIPT_ACTION_MAP`, `TRANSCRIPT_EMOTION_MAP`
- `detectActionInTranscript`, `detectEmotionInTranscript`
- `resolveEmotionAnims` (lógica de búsqueda en EXPRESSION_MAP)

```typescript
interface TranscriptProcessor {
  detectAction: (transcript: string) => string | null;
  detectEmotion: (transcript: string) => string | null;
  resolveEmotionAnims: (emotionLabel: string) => BunnyAnimation[] | undefined;
}
```

### Fase 6: `FluBridgeContext` — Contexto para props del bridge
**Archivos**: `src/context/FluBridgeContext.tsx`
**Impacto**: Eliminar prop drilling, ~20 props simplificadas

Crear un contexto React que agrupe:
- Voice state (voiceStatus, voiceError, liveTranscript)
- Voice actions (onStartListening, onStopListening, onToggleListening)
- Bridge refs (onParticipantEmotionRef, onContextualEmotionRef)

### Fase 7: Refinar `integrationStore` — Separar concerns
**Impacto**: Store más enfocado, menos acoplamiento

- Mover `pendingEmotionAnims` a un mecanismo más explícito (callback directo en syncAvatarToState)
- Separar `isMicActive`, `isFluSpeaking` en un sub-estado de UI
- Mantener `conversationHistory`, `config`, `emotionalState` como estado de dominio

---

## Dependencias entre Fases

```
Fase 1 (Config) ──→ Fase 6 (Context) ──→ Fase 7 (Store)
Fase 2 (Image)   ──→ Fase 6 (Context)
Fase 3 (Nav)     ──→ Fase 6 (Context)
Fase 4 (Minute)  ──→ Fase 6 (Context)
Fase 5 (Transcript) ──→ Se usa en Fase 3 (onContractResolved)
```

**Orden de implementación**: 1 → 5 → 2 → 3 → 4 → 6 → 7

Cada fase debe:
1. No romper tests existentes
2. Mantener compatibilidad total con OS2 components (JS)
3. Preservar personalidad, estados, animaciones y reacciones de FLU
4. Ejecutar `npm test` después de cada cambio

---

## Riesgos y Mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Romper `onContractResolved` (560 líneas, corazón del flujo) | No tocar hasta Fase 3-4, cambios graduales |
| Perder estado de sesión entre recargas | Mantener claves de localStorage existentes |
| Romper compatibilidad con componentes JS de OS2 | Usar `as any` casts donde sea necesario |
| Perder animaciones/expresiones del avatar | No modificar `useAvatarVoiceSync.ts`, `emotionEngine.ts`, `expressionRegistry.ts` |
| Tests de integración fallan | Ejecutar después de cada fase y corregir |

---

## Estado Actual del Proyecto (Pre-Refactor)

- **TypeScript**: 0 errores
- **Unit tests**: 785/785 pasan
- **E2E tests**: Todos los escenarios de validación funcional OS3 vs OS4 completados
- **Gaps corregidos**: MouthMove/Palabra FBX, SLEEPING state, greeting/wave/alert/sleep animations, pitch/volume controls, indigenous language support
