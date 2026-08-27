# Análisis: "Pizarrón" para Digitalizar Tareas y Tutoría con FLU

## 1. ¿Qué es el "Pizarrón" actualmente?

El **Pizarrón** es el tab [`workspace`](src/App.tsx:1337) (renombrado en OS4). Actualmente:

1. **Gemini** genera un `workspace` en el contrato JSON con:
   - `tipo`: `'text'`, `'image_prompt'`, `'diagram'`, `'3d'`
   - `titulo`: Título del contenido
   - `contenido`: Texto explicativo
   - `prompt_visual`: Prompt para generar imagen vía Pollinations
   - `puntos_clave`: Lista de puntos clave

2. **Pollinations** genera una imagen desde `prompt_visual` (texto → imagen)

3. El **Workspace tab** muestra: título, contenido, puntos clave, y la imagen generada

## 2. ¿Puede FLU "leer" la imagen del Pizarrón?

**NO — actualmente NO puede.** Este es el punto crítico.

### Flujo actual (SOLO texto):
```
Usuario habla → Gemini recibe TRANSCRIPCIÓN (texto) → 
Gemini genera contrato JSON con workspace (texto) → 
Pollinations genera imagen desde prompt_visual → 
Imagen se muestra en Pizarrón (solo visual, no analizada)
```

### Lo que se necesita (texto + imagen):
```
Usuario sube/foto tarea → Imagen se guarda en Pizarrón → 
Imagen se envía a Gemini Vision (análisis multimodal) → 
Gemini extrae contenido de la imagen (problemas, texto, etc.) → 
FLU usa ese contenido para interactuar con el niño
```

### ¿Por qué NO funciona hoy?

| Componente | ¿Soporta imágenes? | Detalle |
|---|---|---|
| [`buildConversationMessages`](src/voice/lib/gemini.js:483) | ❌ | Solo pasa `text` como content. No hay campo para `inlineData` |
| [`buildUserPrompt`](src/voice/lib/gemini.js:425) | ❌ | Solo texto plano |
| [`generateFluContract`](src/voice/lib/gemini.js:983) | ❌ | No recibe ni procesa imágenes |
| [`useWorkspaceImage`](src/hooks/useWorkspaceImage.ts:44) | ❌ | Solo genera imágenes (Pollinations), no las analiza |
| [`workspaceContract.js`](src/voice/lib/workspaceContract.js:87) | ❌ | Solo normaliza texto |
| [`integrationStore`](src/store/integrationStore.ts:79) | ❌ | `workspaceArtifact` solo tiene campos de texto |
| Gemini API (`gemini.js`) | ✅ | `requestImageGeneration` ya soporta `responseModalities: ['TEXT', 'IMAGE']` |
| Gemini Vision API | ✅ | Gemini 1.5 Pro/Flash acepta `inlineData` con imágenes base64 |

## 3. ¿Qué se necesita construir?

### Fase 1: Subir imagen al Pizarrón (MÍNIMO VIABLE)

**Archivos a modificar/crear:**

| Archivo | Cambio |
|---|---|
| [`useWorkspaceImage.ts`](src/hooks/useWorkspaceImage.ts) | AGREGAR: `uploadImage(file: File)` → convierte a base64, guarda URL |
| [`App.tsx`](src/App.tsx:1336) | AGREGAR: Botón "Subir tarea" / "Tomar foto" en el Pizarrón |
| [`integrationStore.ts`](src/store/integrationStore.ts) | AGREGAR: `uploadedImageUrl: string \| null` al store |
| [`workspaceContract.js`](src/voice/lib/workspaceContract.js) | AGREGAR: Nuevo tipo `'homework'` para tareas digitalizadas |

### Fase 2: Enviar imagen a Gemini Vision para análisis

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| [`gemini.js`](src/voice/lib/gemini.js) | AGREGAR: `analyzeHomeworkImage(imageBase64, language)` → llama a Gemini Vision con `inlineData` |
| [`buildConversationMessages`](src/voice/lib/gemini.js:483) | MODIFICAR: Aceptar `inlineData` opcional en el último mensaje `user` |
| [`generateFluContract`](src/voice/lib/gemini.js:983) | MODIFICAR: Aceptar `imageBase64` opcional, pasarlo a `buildConversationMessages` |
| [`gemini.ts`](src/services/gemini.ts) | AGREGAR: Método `analyzeImage(imageBase64, mimeType)` |
| [`geminiProxy.ts`](src/server/geminiProxy.ts) | AGREGAR: Endpoint `/api/gemini/analyze-image` para análisis server-side |

### Fase 3: FLU como tutor de tareas

**Archivos a modificar:**

| Archivo | Cambio |
|---|---|
| [`gemini.js`](src/voice/lib/gemini.js:312) | AGREGAR: En `buildSystemPrompt`, reglas de tutoría cuando hay tarea en Pizarrón |
| [`gemini.js`](src/voice/lib/gemini.js:983) | AGREGAR: Contexto de la tarea (texto extraído por Vision) en el prompt |
| [`App.tsx`](src/App.tsx:364) | AGREGAR: En `onContractResolved`, inyectar contexto de tarea al diálogo |
| [`fluConfig.js`](src/voice/lib/fluConfig.js) | AGREGAR: Config para modo tutor (límites, prompts, etc.) |

### Fase 4: Interfaz de usuario completa

| Archivo | Cambio |
|---|---|
| [`App.tsx`](src/App.tsx:1336) | AGREGAR: Botón "Subir foto" + "Cámara" + indicador "Tarea digitalizada" |
| CSS | AGREGAR: Estilos para botones de carga, indicador de análisis, overlay de tarea |

## 4. Flujo completo propuesto

```
1. Usuario hace clic en "Subir tarea" en el Pizarrón
2. Cámara/selección de archivo se abre
3. Imagen se muestra en el Pizarrón (reemplazando Pollinations)
4. Imagen se envía a Gemini Vision:
   - "Analiza esta tarea escolar. Extrae: materia, problemas, instrucciones."
5. Gemini devuelve: { materia, problemas[], instrucciones, nivel }
6. El análisis se guarda en integrationStore.homeworkContext
7. FLU ahora TIENE CONTEXTO de la tarea en cada turno
8. Cuando el niño pide ayuda, FLU:
   - Explica conceptos (no da respuestas directas)
   - Guía paso a paso
   - Usa el Pizarrón para mostrar ejemplos similares
   - Mantiene el rol de tutor, no de resolvedor
```

## 5. ¿Qué NO necesita cambiarse?

| Componente | ¿Se toca? | Razón |
|---|---|---|
| [`useFluParticipant.js`](src/voice/hooks/useFluParticipant.js) | ❌ | No relacionado |
| [`useAvatarVoiceSync.ts`](src/hooks/useAvatarVoiceSync.ts) | ❌ | No relacionado |
| [`FluAvatarVoiceBridge.tsx`](src/components/FluAvatarVoiceBridge.tsx) | ❌ | No relacionado |
| [`expressionRegistry.ts`](src/core/anim/expressionRegistry.ts) | ❌ | No relacionado |
| [`conversationStreamCommit.js`](src/voice/lib/conversationStreamCommit.js) | ❌ | No relacionado |
| [`systemEventLog.ts`](src/lib/systemEventLog.ts) | ❌ | No relacionado |
| [`fluParticipant.js`](src/voice/lib/fluParticipant.js) | ❌ | No relacionado |
| [`fluParticipantConfig.js`](src/voice/lib/fluParticipantConfig.js) | ❌ | No relacionado |

## 6. Dependencias externas

| Recurso | ¿Se necesita? | Alternativa |
|---|---|---|
| Gemini API Key | ✅ **SÍ** — Vision requiere API key | Misma que ya usa la app |
| Cámara (navegador) | ✅ `navigator.mediaDevices.getUserMedia` | Ya soportado en navegadores modernos |
| File API | ✅ `<input type="file">` | API estándar del navegador |
| Pollinations | ❌ **NO** — Se reemplaza con imagen real | La imagen subida reemplaza a la generada |
| Librerías externas | ❌ **NO** — Todo es nativo del navegador | FileReader + fetch + canvas |

## 7. Resumen de esfuerzo

| Fase | Archivos | Cambios | Esfuerzo |
|---|---|---|---|
| 1. Subir imagen | 3-4 | Agregar UI + store | 1-2 horas |
| 2. Gemini Vision | 4-5 | Agregar análisis multimodal | 2-3 horas |
| 3. FLU tutor | 4-5 | Modificar prompts + contexto | 2-3 horas |
| 4. UI completa | 2 | Estilos + botones + overlay | 1-2 horas |
| **Total** | **~15 archivos** | **~6-10 horas** | |

## 8. Respondiendo a tu pregunta

> "al tenerlo en el work space flu puede leerlo e interactuar con su ia, correcto?"

**Hoy: NO.** FLU solo "ve" texto (la transcripción del usuario). La imagen del Pizarrón es generada por Pollinations y solo se muestra visualmente — FLU no tiene acceso a ella.

**Con los cambios propuestos: SÍ.** La imagen se envía a Gemini Vision, que extrae el contenido textual (problemas, instrucciones, materia), y ese contenido se inyecta en el contexto de la conversación. FLU/Gemini puede entonces:
- Saber qué materia es (matemáticas, español, ciencias)
- Leer los problemas específicos
- Guiar al niño sin darle la respuesta
- Usar el Pizarrón para mostrar ejemplos o diagramas de apoyo

**¿Qué opinas? ¿Procedemos con la implementación?**
