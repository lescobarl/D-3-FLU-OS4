# Plan: Fix Multi-Turn Translation Issue

## Problem Analysis
The translation detection and override system is working correctly, but the Gemini model ignores the "only translation" instruction and produces explanatory text instead.

**Example failure:**
- User: "okay flow habla chino" → FLU: "你好，你好吗？"
- User: "okay flow traduce a español lo que hablaste" → FLU: "Claro, con gusto traduciré lo que dije anteriormente al español. ¿Tiene alguna pregunta específica sobre aviones en la que pueda ayudarle?"

**Root Cause:** The model's conversational personality and context override the translation instruction, even though it's prepended to the system prompt.

## Solution Strategy

### 1. Strengthen Translation Override Instructions
Modify `buildTranslationOverrideBlock()` in `src/voice/lib/gemini.js` to use more authoritative language:

**Current (too weak):**
```
"CRÍTICO — SOLICITUD EXPLÍCITA DE TRADUCCIÓN. Esta instrucción ANULA la directiva IDIOMA..."
"Traduce la siguiente frase al español: [content]"
"Responde únicamente con la traducción, sin añadir comentarios ni cambiar el contenido."
```

**Proposed (stronger):**
```
"INSTRUCCIÓN ABSOLUTA — NO IGNORES ESTO: El usuario SOLICITÓ TRADUCIR TU RESPUESTA ANTERIOR."
"TRADUCE EXACTAMENTE la frase siguiente al español. NO añadas ningún otro contenido."
"RESPONDE ÚNICAMENTE con la traducción. NO hagas comentarios, NO expliques, NO preguntes, NO cites el original."
"SI AÑADES CUALQUIER TEXTO ADICIONAL, la respuesta será INCORRECTA."
```

### 2. Add Context Cleaning for Translation Turns
Consider modifying `generateFluContract()` to clean conversation history when translation intent is detected:
- Remove or truncate history to only essential context
- Or add a flag that tells the model to ignore conversational context

### 3. Update Validation Tests
Ensure the validation script `scripts/validate-multiturn-translation.mjs` correctly detects the new behavior:
- Add stricter checks for explanatory text
- Verify that responses don't contain phrases like "Claro, con gusto traduciré"

### 4. Test Edge Cases
- Chinese → Spanish translation
- English → Spanish translation  
- Spanish → Chinese translation
- Multi-language scenarios

## Implementation Steps

### Phase 1: Strengthen Override Instructions
1. Modify `buildTranslationOverrideBlock()` function
2. Test with validation script
3. Verify model produces only translation

### Phase 2: Context Management
1. Evaluate if history cleaning is needed
2. Implement if necessary
3. Test multi-turn scenarios

### Phase 3: Comprehensive Testing
1. Run all translation tests
2. Test with different languages
3. Verify no regressions in normal conversation

## Success Criteria
1. When user says "traduce a español lo que hablaste", FLU responds ONLY with the Spanish translation
2. No explanatory text, no meta-commentary, no questions
3. Works for all language pairs (zh→es, en→es, es→zh, etc.)
4. Normal conversation flow remains unaffected

## Files to Modify
1. `src/voice/lib/gemini.js` - `buildTranslationOverrideBlock()` function
2. `src/voice/lib/gemini.js` - `generateFluContract()` function (if context cleaning needed)
3. `scripts/validate-multiturn-translation.mjs` - Update validation patterns
4. `tests/translationIntent.test.ts` - Update unit tests

## Timeline
Immediate implementation needed - this is blocking human-like functionality.