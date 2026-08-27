# Plan de Optimización de Latencia - Prioridad Alta

## Objetivo
Implementar las tres mejoras de prioridad alta de manera autónoma y coordinada:
1. **Optimizar system prompt** (condensar bloque idioma, mover catálogo a demanda, reducir tamaño)
2. **Añadir indicador visual de procesamiento** (feedback inmediato al usuario)
3. **Reducir timers de settle** (acortar latencia artificial previa a IA)

## 1. Optimización del System Prompt

### Análisis actual:
- **Bloque IDIOMA**: ~1200 caracteres en español, ~1100 en inglés (líneas 377-378)
- **buildConfiguracionPrompt**: enumera 44 opciones + 8 no soportadas con valores (~800 caracteres)
- **buildCapabilitiesPrompt**: lista capacidades + playlist completa + reglas (~600 caracteres)
- **buildAnimPrompt**: tamaño moderado (~200 caracteres)
- **Total estimado**: ~2800-3000 tokens de prefill por turno

### Cambios propuestos:

#### 1.1 Condensar bloque IDIOMA
**Actual**: Párrafo extenso con ejemplos y reglas detalladas
**Nuevo**: Versión concisa que mantiene la semántica pero reduce 70%
```text
IDIOMA: Responde en el idioma configurado. Si el usuario pide otro idioma, responde ENTERAMENTE en ese idioma sin anunciarlo. Para traducciones, traduce el contenido previo al idioma pedido. Nunca mezcles idiomas.
```

#### 1.2 Configuración bajo demanda
**Actual**: `buildConfiguracionPrompt` siempre incluido
**Nuevo**: Solo incluir cuando `intent.comando` sea de configuración o transcript contenga palabras clave ("configura", "ajusta", "cambia", "set", "pon")
- Crear función `shouldIncludeConfigPrompt(transcript, intent)`
- Mover `configPrompt` a condicional

#### 1.3 Capacidades resumidas
**Actual**: Lista completa de capacidades + playlist
**Nuevo**: Versión resumida sin playlist (la playlist se puede mantener en KB)
- Mantener solo reglas críticas (música obligatoria, honestidad)
- Referenciar capacidades sin enumerar todas

#### 1.4 Prefijo estable
**Actual**: Variables como `recentMemory`, `agendaText`, `startupPrompt` en system prompt
**Nuevo**: Mover estas variables al user message para mantener system prompt byte-idéntico entre turnos
- Aprovechar prompt caching de OpenRouter/OpenAI

### Archivos a modificar:
- `src/voice/lib/gemini.js` (`buildSystemPrompt`, `buildUserPrompt`)
- `src/services/capabilities.ts` (`buildCapabilitiesPrompt`)
- `src/core/config/voiceConfigCatalog.ts` (`buildConfiguracionPrompt`)

## 2. Indicador Visual de Procesamiento

### Análisis actual:
- No hay feedback visual durante `postChatCompletion` (2-8s de silencio)
- El usuario no sabe si FLU está "pensando" o congelado

### Cambios propuestos:

#### 2.1 Estado `thinking` en integrationStore
- Añadir campo `isThinking: boolean` a `UIState`
- Acción `setThinking(isThinking: boolean)`

#### 2.2 Hook `useThinkingIndicator`
- Observar cambios en `conversationState` y `isThinking`
- Mostrar overlay/spinner/animation cuando `isThinking === true`

#### 2.3 Integración en flujo IA
- En `generateFluContract`, antes de `postChatCompletion`: `setThinking(true)`
- Después de obtener respuesta: `setThinking(false)`
- Manejar errores (si falla, también `setThinking(false)`)

#### 2.4 Componente visual
- Overlay semitransparente con spinner y texto "FLU está pensando..."
- Posicionado cerca del avatar o centro de pantalla
- Animación sutil (pulsar)

### Archivos a modificar:
- `src/store/integrationStore.ts` (añadir campo y acción)
- `src/voice/lib/gemini.js` (`generateFluContract`)
- `src/hooks/useThinkingIndicator.ts` (nuevo hook)
- `src/App.tsx` (integrar componente)

## 3. Reducción de Timers de Settle

### Análisis actual (fluConfig.js):
- `transcriptSettleMaxMs: 500` (máximo asentamiento de transcript)
- `conversationSettleStableMs: 120` (estabilidad de conversación)
- `scheduleAutoProcessDelayMs: 450` (retraso antes de procesar)
- **Total**: ~1070ms de latencia artificial antes de llamar a IA

### Cambios propuestos:

#### 3.1 Reducir valores conservadoramente
- `transcriptSettleMaxMs`: 500 → 300 (40% reducción)
- `conversationSettleStableMs`: 120 → 80 (33% reducción)
- `scheduleAutoProcessDelayMs`: 450 → 250 (44% reducción)
- **Nuevo total**: ~630ms (reducción de 440ms)

#### 3.2 Validar que no rompa funcionalidad
- Los tests E2E deben seguir pasando
- No afectar reconocimiento de comandos wake word
- Mantener estabilidad en conversaciones rápidas

### Archivos a modificar:
- `src/voice/lib/fluConfig.js` (timing section)
- Tests relacionados (si fallan, ajustar)

## Orden de Ejecución

1. **Optimización system prompt** (más fácil, impacto inmediato)
2. **Reducción timers** (simple, bajo riesgo)
3. **Indicador visual** (requiere cambios en store y UI)

Cada paso incluye:
- Modificación de código
- Validación con tests existentes
- Commit y verificación de funcionalidad

## Métricas de Éxito

1. **Reducción tokens system prompt**: Objetivo 50% menos (de ~3000 a ~1500)
2. **Reducción latencia artificial**: Objetivo 400ms menos (de ~1070ms a ~670ms)
3. **Feedback visual**: Tiempo entre usuario habla y spinner < 200ms

## Riesgos y Mitigación

- **Prompt demasiado corto**: Podría perder instrucciones críticas → mantener reglas esenciales y testear con casos edge
- **Timers demasiado agresivos**: Podría causar procesamiento prematuro → reducir gradualmente y monitorear tests
- **Performance UI**: Spinner podría afectar render → usar CSS optimizado y lazy rendering

## Siguientes Pasos

1. Ejecutar optimización de system prompt
2. Ejecutar reducción de timers
3. Implementar indicador visual
4. Validar conjunto con pruebas E2E
5. Documentar cambios y métricas obtenidas