# PLAN DE ACCIÓN: Solución para Sobre-Interpretación en Comandos "di en [idioma]"

## Objetivo
Distinguir entre comandos de repetición ("di en [idioma] [frase]") y comandos de traducción ("traduce a [idioma] lo que hablaste") para evitar sobre-interpretación.

## Lista de Tareas (Todo List)

### Fase 1: Análisis y Diseño Detallado
- [ ] **Analizar patrones existentes** en `fluConfig.js` para entender configuración actual
- [ ] **Diseñar algoritmo de extracción de frases** para comandos de repetición
- [ ] **Definir estructura de datos** para intención de repetición vs traducción
- [ ] **Crear diagrama de flujo** del proceso mejorado
- [ ] **Documentar casos de prueba** específicos para validación

### Fase 2: Implementación de Detección de Intenciones
- [ ] **Crear función `detectRepetitionIntent()`** en `gemini.js`
  - Detectar patrones: "di en", "vi en", "say in", "repeat in"
  - Extraer frase después del marcador de idioma
  - Identificar idioma destino usando `languageAliases` existente
  - Retornar estructura: `{ detected, type: 'repetition', targetLanguage, phrase }`
- [ ] **Modificar `detectTranslationIntent()`** para excluir casos de repetición
  - Agregar chequeo previo para patrones de repetición
  - Si es repetición, retornar `{ detected: false }` para que sea manejado por nueva función
- [ ] **Actualizar `fluConfig.js`** con nuevos marcadores
  - Agregar sección `repetitionIntent.markers`
  - Definir patrones específicos para repetición
  - Mantener compatibilidad con configuración existente

### Fase 3: Implementación de Procesamiento de Repetición
- [ ] **Crear función `buildRepetitionOverrideBlock()`** en `gemini.js`
  - Generar instrucciones estrictas para solo repetir frase traducida
  - Incluir validaciones para evitar texto conversacional adicional
  - Soporte para múltiples idiomas (usar `languageNames` existente)
- [ ] **Modificar `generateFluContract()`** para manejar ambos tipos de intención
  - Llamar primero a `detectRepetitionIntent()`
  - Si es repetición, usar `buildRepetitionOverrideBlock()`
  - Si es traducción, mantener flujo actual
  - Asegurar que `translationTarget` solo se establezca para traducción real
- [ ] **Implementar extracción robusta de frases**
  - Algoritmo para separar comando de frase a repetir
  - Manejo de puntuación, espacios y variaciones
  - Detección de idioma fuente (opcional, para traducción más precisa)

### Fase 4: Pruebas Unitarias
- [ ] **Crear tests para `detectRepetitionIntent()`**
  - Casos positivos: "di en chino Hola cómo estás", "vi en inglés hello world"
  - Casos negativos: "traduce a español lo que hablaste", "habla en chino"
  - Casos edge: frases vacías, idiomas no soportados, comandos mal formados
- [ ] **Crear tests para `buildRepetitionOverrideBlock()`**
  - Verificar que las instrucciones prohíban texto conversacional
  - Validar formato para diferentes idiomas destino
  - Comprobar que incluya la frase exacta a traducir
- [ ] **Actualizar tests existentes en `translationIntent.test.ts`**
  - Asegurar que no haya regresiones en detección de traducción
  - Agregar tests para distinguir repetición vs traducción
- [ ] **Crear tests de integración en `translationAntiEcho.test.ts`**
  - Validar flujo completo para comandos de repetición
  - Verificar que las respuestas sean solo la frase traducida

### Fase 5: Validación y Pruebas de Integración
- [ ] **Crear script de validación específico** para repetición
  - Probar con ejemplos reales del problema
  - Medir precisión de extracción de frases
  - Verificar calidad de respuestas (sin texto adicional)
- [ ] **Ejecutar pruebas end-to-end** con servidor local
  - Probar comandos de voz reales
  - Validar experiencia completa de usuario
- [ ] **Realizar pruebas de regresión**
  - Asegurar que comandos existentes sigan funcionando
  - Verificar que "habla en [idioma]" no sea afectado
  - Comprobar que traducción multi-turno siga funcionando

### Fase 6: Refinamiento y Optimización
- [ ] **Optimizar algoritmo de extracción de frases**
  - Mejorar manejo de casos edge
  - Agregar soporte para más variaciones de comandos
  - Mejorar detección de límites de frase
- [ ] **Mejorar mensajes de error y manejo de casos fallidos**
  - Respuestas apropiadas cuando no se detecta idioma
  - Manejo elegante de frases vacías
  - Feedback útil para el usuario
- [ ] **Ajustar configuración basada en resultados**
  - Refinar patrones basado en testing
  - Optimizar umbrales de detección
  - Mejorar experiencia de usuario

### Fase 7: Documentación y Despliegue
- [ ] **Actualizar documentación del sistema**
  - Documentar nuevos comandos de repetición
  - Explicar diferencia entre repetición y traducción
  - Actualizar guías de usuario si es necesario
- [ ] **Crear changelog** de los cambios realizados
- [ ] **Preparar para despliegue**
  - Revisar todos los cambios de código
  - Ejecutar suite completa de pruebas
  - Verificar métricas de performance

## Archivos Críticos a Modificar

### 1. `src/voice/lib/fluConfig.js`
- Agregar configuración para `repetitionIntent`
- Mantener compatibilidad con `translationIntent` existente

### 2. `src/voice/lib/gemini.js`
- Nuevas funciones: `detectRepetitionIntent()`, `buildRepetitionOverrideBlock()`
- Modificaciones: `detectTranslationIntent()`, `generateFluContract()`
- Funciones auxiliares: `extractPhraseFromCommand()`, `normalizeForRepetition()`

### 3. `tests/translationIntent.test.ts`
- Agregar tests para repetición
- Actualizar tests existentes para nueva lógica

### 4. `tests/translationAntiEcho.test.ts`
- Agregar tests de integración para repetición
- Validar flujo completo

### 5. `scripts/validate-multiturn-translation.mjs` (o nuevo script)
- Extender o crear nuevo script para validar repetición

## Criterios de Aceptación

### Funcionales
1. **"di en chino Hola cómo estás"** → Respuesta: `你好，你好吗？` (solo la frase traducida)
2. **"vi en chino papá"** → Respuesta: `爸爸` (solo la palabra traducida)
3. **"traduce a español lo que hablaste"** → Mantiene comportamiento actual (traduce respuesta anterior)
4. **"habla en chino"** → Mantiene comportamiento actual (cambio de idioma)
5. **Comandos mal formados** → Respuesta apropiada o solicitud de clarificación

### No Funcionales
1. **Sin regresiones**: Comportamiento existente no afectado
2. **Performance**: Sin impacto significativo en tiempo de respuesta
3. **Precisión**: ≥95% de comandos clasificados correctamente
4. **Calidad**: 100% de respuestas sin texto conversacional adicional

## Consideraciones de Diseño

### 1. Prioridad de Detección
- Primero verificar si es repetición (tiene frase explícita)
- Luego verificar si es traducción (referencia a respuesta anterior)
- Finalmente verificar si es cambio de idioma

### 2. Extracción de Frase
Algoritmo propuesto:
```
1. Normalizar texto (minúsculas, sin acentos)
2. Encontrar patrón "di en [idioma]" o similar
3. Extraer idioma destino
4. Todo lo que sigue después del idioma es la frase
5. Limpiar espacios extras y puntuación al inicio/final
```

### 3. Manejo de Variaciones
- "di en chino" → "dí en chino" → "di en chino"
- "vi en" (variante de "di en" en algunos acentos)
- "say in english" → compatible con "di en inglés"
- "repeat in french" → compatible con "repite en francés"

## Timeline Estimado
- **Fase 1-2**: 2 días (diseño e implementación core)
- **Fase 3-4**: 2 días (pruebas unitarias y refinamiento)
- **Fase 5-6**: 1-2 días (validación y optimización)
- **Fase 7**: 1 día (documentación y despliegue)

**Total estimado**: 6-7 días de trabajo

## Riesgos y Mitigaciones

### Riesgo 1: Extracción incorrecta de frases
- **Mitigación**: Algoritmo robusto con múltiples estrategias de fallback
- **Pruebas**: Extensivo testing con variaciones reales

### Riesgo 2: Confusión con comandos existentes
- **Mitigación**: Mantener lógica de detección clara y prioridades definidas
- **Validación**: Pruebas exhaustivas de regresión

### Riesgo 3: Impacto en experiencia de usuario
- **Mitigación**: Respuestas elegantes para casos edge
- **Feedback**: Probar con usuarios reales durante desarrollo

## Siguientes Pasos Inmediatos

1. **Cambiar a modo Code** para comenzar implementación
2. **Implementar `detectRepetitionIntent()`** como primer componente
3. **Crear tests básicos** para validar funcionalidad
4. **Iterar** basado en resultados de pruebas

---

*Este plan será actualizado a medida que se descubran nuevos requisitos durante la implementación.*