# Translation Flow Analysis and Fix

## Current Problem Flow
```mermaid
graph TD
    A[User: traduce a español lo que hablaste] --> B[detectTranslationIntent]
    B --> C{Translation Detected?}
    C -->|Yes| D[findLastAssistantResponse]
    D --> E[buildTranslationOverrideBlock]
    E --> F[buildSystemPrompt with translationTarget]
    F --> G[Prepend override to system prompt]
    G --> H[Send to Gemini API]
    H --> I[Model sees: 1. Override 2. System prompt 3. History 4. Personality]
    I --> J[Model produces explanatory text]
    J --> K[FAIL: Contains Claro, con gusto traduciré...]
    
    C -->|No| L[Normal processing]
    L --> M[Success]
```

## Proposed Solution Flow
```mermaid
graph TD
    A[User: traduce a español lo que hablaste] --> B[detectTranslationIntent]
    B --> C{Translation Detected?}
    C -->|Yes| D[findLastAssistantResponse]
    D --> E[buildSTRONGTranslationOverrideBlock]
    E --> F[Clean conversation history if needed]
    F --> G[buildSystemPrompt with translationTarget]
    G --> H[Prepend STRONG override to system prompt]
    H --> I[Send to Gemini API]
    I --> J[Model sees: 1. ABSOLUTE instruction 2. Clean context 3. System prompt]
    J --> K[Model produces ONLY translation]
    K --> L[SUCCESS: Pure translation output]
    
    C -->|No| M[Normal processing]
    M --> N[Success]
```

## Key Changes Needed

### 1. Stronger Override Instructions
```
BEFORE (too weak):
"CRÍTICO — SOLICITUD EXPLÍCITA DE TRADUCCIÓN..."
"Traduce la siguiente frase al español: [content]"
"Responde únicamente con la traducción..."

AFTER (authoritative):
"INSTRUCCIÓN ABSOLUTA — NO IGNORES ESTO"
"TRADUCE EXACTAMENTE la frase siguiente al español"
"RESPONDE ÚNICAMENTE con la traducción"
"NO hagas comentarios, NO expliques, NO preguntes"
"SI AÑADES TEXTO ADICIONAL, la respuesta será INCORRECTA"
```

### 2. Context Cleaning (Optional)
- Remove conversational history for translation turns
- Or add explicit instruction to ignore context
- Keep only the previous response to translate

### 3. Validation Enhancement
- Add detection for explanatory text patterns
- Stricter checks for meta-commentary
- Verify pure translation output