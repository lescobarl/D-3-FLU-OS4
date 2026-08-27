# Acción inmediata: Diagnosticar discrepancia traducción ZH→ES

## Objetivo
Reproducir el fallo que el usuario observó: "Okay Flow traduce lo que dijiste a español" devuelve el mismo chino.

## Hipótesis principal
El script de validación pasa (9/9) porque:
1. Usa frase exacta "traduce a español lo que hablaste"
2. Construye historial artificial con formato específico
3. No tiene cache (o la cache está fría)

La aplicación real falla porque:
1. El usuario dijo "traduce lo que dijiste a español" (sin "hablaste")
2. El historial real podría tener formato diferente
3. La cache podría estar devolviendo respuesta anterior
4. El modelo podría estar recibiendo override pero ignorándolo

## Pasos de diagnóstico

### 1. Probar frase exacta del usuario
Crear script que reproduzca exactamente lo que hace la aplicación:

```javascript
// test-user-phrase.mjs
import { readFileSync } from 'fs';
import { join } from 'path';

const envRaw = readFileSync(join(process.cwd(), '.env'), 'utf8');
const keyMatch = envRaw.match(/^VITE_OPENROUTER_API_KEY=(.+)$/m);
const KEY = keyMatch ? keyMatch[1].trim() : '';

async function test() {
  const base = 'http://localhost:5174';
  
  // Turno 1: igual que la aplicación
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
  console.log('T1 respuesta:', r1.contract.respuesta_voz);
  
  // Turno 2: frase EXACTA del usuario
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
  console.log('T2 respuesta:', r2.contract.respuesta_voz);
  console.log('¿Es traducción?', !r2.contract.respuesta_voz.includes('你好'));
}

test();
```

### 2. Verificar logs del proxy
Monitorear logs para ver si hay cache HIT en el segundo turno.

### 3. Comparar historial
Comparar el historial que envía la aplicación real vs el script de validación.

### 4. Deshabilitar cache temporalmente
Modificar `geminiProxy.ts` para excluir requests de traducción de la cache:

```typescript
// En handleContract, antes del cache check
if (mode === 'contract' && body?.transcript) {
  const hasTranslationIntent = detectTranslationIntent(body.transcript).detected;
  if (hasTranslationIntent) {
    // Skip cache for translation requests
    console.log('[FLU-DEBUG-PROXY] Skipping cache for translation intent');
  } else {
    // Normal cache logic...
  }
}
```

### 5. Fortalecer override
Si el modelo ignora el override, aumentar la severidad del bloque de traducción.

## Plan de implementación (prioridad)

1. **Ejecutar diagnóstico** (paso 1) para confirmar el fallo
2. **Si falla**, verificar logs y cache
3. **Implementar solución**:
   - Deshabilitar cache para traducciones
   - Asegurar historial correcto
   - Reforzar override si necesario

4. **Validar** con el usuario (paso 4 del mandato)

## Riesgos
- Deshabilitar cache podría afectar performance
- Cambios en el override podrían romper otros flujos

## Timeline
Inmediato: El usuario está validando ahora y encontró un fallo crítico.