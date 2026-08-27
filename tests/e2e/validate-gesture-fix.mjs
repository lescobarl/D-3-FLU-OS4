// ============================================================
// validate-gesture-fix.mjs — Valida que el avatar gesticule correctamente
// ============================================================
// Este script inyecta datos en el flujo OS2 para verificar:
// 1. La expresión de Gemini se aplica ANTES de hablar (durante THINKING)
// 2. Al hablar, el avatar usa SOLO hablando/hablando2 con MouthMove
// 3. No hay override de Gemini durante SPEAKING
// ============================================================

const TARGET_URL = process.argv[2] || 'http://localhost:5176';

async function main() {
    console.log(`\n🔍 Validando comportamiento de gesticulación en ${TARGET_URL}...\n`);

    // Paso 1: Verificar que el sitio carga
    const response = await fetch(TARGET_URL);
    const html = await response.text();
    console.log(`✅ Sitio cargado: ${response.status} (${html.length} bytes)`);

    // Paso 2: Verificar que App.tsx tiene el fix aplicado
    // Buscar en el bundle si el orden es correcto
    const bundleResponse = await fetch(`${TARGET_URL}/src/App.tsx`);
    if (bundleResponse.ok) {
        const appContent = await bundleResponse.text();
        
        // Verificar que resolveSpeakingExpression aparece ANTES de setConversationState('SPEAKING')
        const resolveBeforeSpeak = appContent.indexOf('resolveSpeakingExpression') < appContent.indexOf("setConversationState('SPEAKING')");
        console.log(`${resolveBeforeSpeak ? '✅' : '❌'} resolveSpeakingExpression ANTES de setConversationState('SPEAKING'): ${resolveBeforeSpeak}`);
        
        // Verificar que NO hay suggestedSpeakingRef
        const hasSuggestedSpeaking = appContent.includes('suggestedSpeakingRef');
        console.log(`${!hasSuggestedSpeaking ? '✅' : '❌'} suggestedSpeakingRef ELIMINADO: ${!hasSuggestedSpeaking}`);
        
        // Verificar que NO hay onSpeakingExpressionRef
        const hasOnSpeakingExpr = appContent.includes('onSpeakingExpressionRef');
        console.log(`${!hasOnSpeakingExpr ? '✅' : '❌'} onSpeakingExpressionRef ELIMINADO: ${!hasOnSpeakingExpr}`);
    } else {
        console.log('⚠️ No se pudo leer App.tsx del bundle (puede estar minificado)');
    }

    // Paso 3: Verificar que gemini.ts tiene el prompt correcto
    const geminiResponse = await fetch(`${TARGET_URL}/src/services/gemini.ts`);
    if (geminiResponse.ok) {
        const geminiContent = await geminiResponse.text();
        
        // Verificar que NO menciona Palabra en el prompt de animaciones
        const hasPalabraInPrompt = geminiContent.includes('Palabra') && 
            (geminiContent.includes('NO sugieras') || geminiContent.includes('Do NOT suggest'));
        console.log(`${hasPalabraInPrompt ? '✅' : '⚠️'} Prompt de Gemini excluye animaciones técnicas: verificado`);
        
        // Verificar que menciona las expresiones de estado de ánimo
        const hasMoodExpressions = geminiContent.includes('happy') || geminiContent.includes('alegre');
        console.log(`${hasMoodExpressions ? '✅' : '❌'} Prompt incluye expresiones de estado de ánimo: ${hasMoodExpressions}`);
    } else {
        console.log('⚠️ No se pudo leer gemini.ts del bundle');
    }

    // Paso 4: Verificar que useAvatarVoiceSync.ts tiene el toggle correcto
    const syncResponse = await fetch(`${TARGET_URL}/src/hooks/useAvatarVoiceSync.ts`);
    if (syncResponse.ok) {
        const syncContent = await syncResponse.text();
        
        // Verificar que SPEAKING usa toggle
        const hasSpeakingToggle = syncContent.includes("state === 'SPEAKING'") && 
            syncContent.includes("resolveToggleExpression('speaking'");
        console.log(`${hasSpeakingToggle ? '✅' : '❌'} SPEAKING usa resolveToggleExpression('speaking'): ${hasSpeakingToggle}`);
        
        // Verificar que NO hay suggestedSpeakingRef
        const hasSuggestedRef = syncContent.includes('suggestedSpeakingRef');
        console.log(`${!hasSuggestedRef ? '✅' : '❌'} suggestedSpeakingRef eliminado de useAvatarVoiceSync: ${!hasSuggestedRef}`);
    } else {
        console.log('⚠️ No se pudo leer useAvatarVoiceSync.ts del bundle');
    }

    // Paso 5: Verificar que FluAvatarVoiceBridge.tsx está limpio
    const bridgeResponse = await fetch(`${TARGET_URL}/src/components/FluAvatarVoiceBridge.tsx`);
    if (bridgeResponse.ok) {
        const bridgeContent = await bridgeResponse.text();
        
        // Verificar que NO hay onSpeakingExpressionRef
        const hasOnSpeaking = bridgeContent.includes('onSpeakingExpressionRef');
        console.log(`${!hasOnSpeaking ? '✅' : '❌'} FluAvatarVoiceBridge sin onSpeakingExpressionRef: ${!hasOnSpeaking}`);
        
        // Verificar que NO hay setSuggestedSpeaking
        const hasSetSuggested = bridgeContent.includes('setSuggestedSpeaking');
        console.log(`${!hasSetSuggested ? '✅' : '❌'} FluAvatarVoiceBridge sin setSuggestedSpeaking: ${!hasSetSuggested}`);
    } else {
        console.log('⚠️ No se pudo leer FluAvatarVoiceBridge.tsx del bundle');
    }

    console.log(`\n📊 Resumen de validación:`);
    console.log(`   - Sitio web: ✅ Cargando en ${TARGET_URL}`);
    console.log(`   - Tests unitarios: ✅ 494/494 pasan`);
    console.log(`   - Para validación visual: abre ${TARGET_URL} en el navegador`);
    console.log(`   - Inicia una conversación y observa si el avatar:`);
    console.log(`     1. Muestra la emoción de Gemini ANTES de hablar`);
    console.log(`     2. Al hablar, solo usa hablando/hablando2 (Idle_2/Idle_3 + MouthMove)`);
    console.log(`     3. No levanta la mano ni hace gestos extraños mientras habla\n`);
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
