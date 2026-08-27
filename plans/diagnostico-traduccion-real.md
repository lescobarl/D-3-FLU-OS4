# Diagnóstico: Discrepancia entre validación y aplicación real

## Problema observado
- **Script de validación**: 9/9 escenarios pasan, incluyendo ZH→ES con "traduce a español lo que hablaste"
- **Aplicación real**: Usuario dice "Okay Flow traduce lo que dijiste a español" → FLU responde con el mismo chino (no traduce)

## Hipótesis principales

### 1. Cache del proxy
Los logs muestran `[FLU-DEBUG-PROXY] handleContract cache HIT for transcript: okay flow habla chino`. El proxy middleware (`src/proxy/geminiProxy.js` o similar) podría estar cacheando respuestas por transcripción exacta.

**Impacto**: Si la cache devuelve la respuesta anterior (chino) sin pasar por `generateFluContract`, el override no se aplica.

**Evidencia**: 
- El log `[FLU-DEBUG] translation intent detected` aparece, lo que sugiere que `generateFluContract` SÍ se ejecutó.
- Pero la respuesta final es la misma que antes.

### 2. Diferencia en el historial de conversación
El script de validación construye historial artificial:
```js
history: [
  { role: 'assistant', text: '好的，我们现在用中文交流。' },
  { role: 'user', text: 'traduce a español lo que hablaste' }
]
```

La aplicación real podría estar usando:
- Historial vacío (si no se guardó el turno anterior)
- Historial con formato diferente (campo `response` vs `text`)
- Historial con speaker labels que afectan la detección

### 3. Diferencia en la detección de intención
La frase del usuario: "Okay Flow traduce lo que dijiste a español"
- Contiene "traduce" (verbo traducir) ✓
- Contiene "dijiste" (referencia a respuesta anterior) ✓
- Debería detectarse como traducción.

Pero `detectTranslationIntent` podría tener reglas que filtran "Okay Flow" como prefijo.

### 4. Modelo diferente
- Script usa `google/gemini-2.5-flash-lite` (default de OpenRouter)
- Aplicación podría usar otro modelo si hay configuración en localStorage

## Pasos de investigación

1. **Examinar middleware de proxy** para entender la cache
2. **Verificar historial real** que envía la aplicación
3. **Probar frase exacta del usuario** con script modificado
4. **Comparar logs** entre script y aplicación

## Comandos para diagnóstico

```bash
# 1. Probar frase exacta del usuario
node -e "
const fetch = require('node-fetch');
async function test() {
  const base = 'http://localhost:5174';
  const key = process.env.VITE_OPENROUTER_API_KEY;
  
  // Turno 1: habla chino
  const t1 = await fetch(base + '/api/gemini/contract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: 'habla chino',
      language: 'es',
      history: []
    })
  });
  const r1 = await t1.json();
  console.log('T1:', r1.contract.respuesta_voz);
  
  // Turno 2: frase exacta del usuario
  const t2 = await fetch(base + '/api/gemini/contract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: 'traduce lo que dijiste a español',
      language: 'es',
      history: [
        { role: 'assistant', text: r1.contract.respuesta_voz },
        { role: 'user', text: 'habla chino' }
      ]
    })
  });
  const r2 = await t2.json();
  console.log('T2:', r2.contract.respuesta_voz);
  console.log('¿Es traducción?', !r2.contract.respuesta_voz.includes('你好'));
}
test();
"

# 2. Buscar código de cache
grep -r "cache HIT" src/ --include="*.js" --include="*.ts"

# 3. Verificar configuración de modelo
node -e "console.log('Modelo localStorage:', localStorage.getItem('flu-text-model'))"
```

## Posibles soluciones

### Si es problema de cache:
- Deshabilitar cache para requests de traducción
- Incluir timestamp o nonce en la transcripción para evitar hits

### Si es problema de historial:
- Asegurar que la aplicación guarde y envíe el historial correctamente
- Verificar formato de entries (`role`, `text`, `response`)

### Si es problema de detección:
- Ajustar `detectTranslationIntent` para reconocer "dijiste" como referencia anterior
- Agregar "dijiste" a `previousRefWords` en `FLU_CONFIG.translationIntent.markers`

## Prioridad
El usuario está validando (paso 4 del mandato) y encontró un fallo. Esto requiere **solución inmediata** antes de proceder.