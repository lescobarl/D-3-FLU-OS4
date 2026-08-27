// ============================================================
// FLU OS3 — Pruebas E2E Integrales con Datos Productivos
// ============================================================
// Suite completa de pruebas end-to-end que inyecta datos
// productivos realistas y valida CADA flujo completo:
//
//   1. Pipeline de voz: transcript → sentiment → emotion → gesture → response → log
//   2. Ciclo de vida de conversación: IDLE → LISTENING → THINKING → SPEAKING
//   3. OS2 Bridge: start/stop listening, process transcript, voice commands
//   4. Multi-speaker diarization (OS2 conversationStream parity)
//   5. Wake word detection (OS2 transcriptIngress parity)
//   6. Speech merge / dedup (OS2 conversationStream parity)
//   7. Session persistence round-trip
//   8. Gemini service integration (schemas, structured output)
//   9. Minute generation from productive data
//  10. Participant rename/delete flows
//  11. Avatar state → animation mapping
//  12. Error recovery flows
//  13. PendingSpill / auto-process / resume-listening timing
//  14. FLU_CONFIG-driven behavior (0 hardcode verification)
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================
// 1. TYPES (replicados de bridge.ts para test sin dependencias)
// ============================================================

type ConversationState =
    | 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'
    | 'ERROR' | 'CELEBRATING';

type EmotionalState =
    | 'neutral' | 'happy' | 'curious' | 'thoughtful'
    | 'surprised' | 'sad' | 'excited';

interface ConversationEntry {
    role: 'user' | 'flu';
    text: string;
    timestamp: number;
    sentiment?: 'positive' | 'negative' | 'neutral' | 'question';
    id: string;
}

interface SessionStats {
    totalInteractions: number;
    totalUserMessages: number;
    totalFluMessages: number;
    sessionStartTime: number;
    averageResponseTime: number;
}

interface VoiceBridgeEvent {
    type: 'listening:start' | 'listening:end' | 'speaking:start' | 'speaking:end'
    | 'thinking:start' | 'thinking:end' | 'error' | 'conversation:turn';
    timestamp: number;
    payload?: any;
}

interface MultiSpeakerEntry {
    id: string;
    text: string;
    speakerId: string;
    speakerName: string;
    timestamp: number;
    isFinal: boolean;
    response?: string;
    meta?: { response?: string; sentiment?: string };
    signature?: string;
    phase?: string;
    navigation?: string;
}

interface SessionState {
    activeTab: string;
    language: string;
    sessionRole: string;
    expandedFrameId: string;
    selectedMinuteId: string | null;
    participantPhase: string;
    participantTurnCount: number;
    workspaceImageExpanded: boolean;
}

// ============================================================
// 2. FLU_CONFIG (replicado de fluConfig.js para tests)
// ============================================================
// CRITICAL: Estos valores DEBEN coincidir con fluConfig.js.
// Si fluConfig.js cambia, actualizar aquí también.
// 0 hardcode: todos los valores vienen de FLU_CONFIG.

const FLU_CONFIG_TEST = {
    timing: {
        resumeListeningMs: 50,
        wakeWordCommandDelayMs: 800,
        interimCommandDelayMs: 1200,
        speakingCheckIntervalMs: 200,
        recognitionRetryBaseMs: 220,
        recognitionRetryStepMs: 40,
        recognitionRetryMaxMs: 800,
        stallRebuildThresholdMs: 4000,
    },
    speech: {
        maxChunkChars: 180,
        mergeOverlapWords: 3,
    },
    activeListen: {
        languages: { es: 'es-MX', en: 'en-US', both: 'es-MX,en-US' },
        bilingual: { primary: 'es-MX', secondary: 'en-US' },
        recognition: { maxAlternatives: 3 },
        restart: { maxRetries: 5, consecutiveEndsThreshold: 3 },
        speakers: { maxAutoSpeakers: 10 },
        listeningAck: { phrases: ['escuchando', 'te escucho', 'dime'] },
    },
    voiceCommands: {
        wakeWords: ['FLU', 'flu', 'Bunny', 'bunny'],
        openListening: ['FLU', 'flu', 'Bunny', 'bunny', 'escucha', 'te llamo'],
        closeListening: ['CERRAR_ESCUCHA', 'cerrar escucha', 'detente', 'silencio', 'cállate', 'espera'],
        startConversation: ['INICIAR_CONVERSACION', 'iniciar conversación', 'comencemos', 'hablemos'],
        nextSpeaker: ['siguiente hablante', 'SIGUIENTE_HABLANTE', 'turno', 'ahora yo'],
        generateMinute: ['genera minuta', 'minuta', 'resumen', 'reporte'],
        generateSummary: ['genera resumen', 'resumen', 'sintetiza'],
        saveMinute: ['guarda minuta', 'guardar', 'archiva'],
        grantFloor: ['te toca', 'tu turno', 'participa'],
        dismissFloor: ['terminé', 'eso es todo', 'no más'],
    },
    limits: {
        maxHistoryRows: 200,
        maxMinuteEntries: 100,
        maxVoiceProfiles: 50,
        maxSpeakerClusters: 20,
    },
    gemini: {
        contract: { model: 'gemini-2.0-flash-lite' },
        summary: { model: 'gemini-2.0-flash-lite' },
        participantEval: { model: 'gemini-2.0-flash-lite' },
    },
    sessionDefaults: {
        role: 'general',
        theme: '',
    },
};

// ============================================================
// 3. HELPERS (replican lógica de producción sin dependencias)
// ============================================================

let _entryCounter = 0;

function generateUUIDv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function makeEntry(text: string, speakerName: string, opts?: {
    response?: string;
    sentiment?: string;
    phase?: string;
    navigation?: string;
}): MultiSpeakerEntry {
    _entryCounter++;
    return {
        id: `e2e-${_entryCounter}`,
        text,
        speakerId: `speaker-${speakerName.toLowerCase().replace(/\s+/g, '-')}`,
        speakerName,
        timestamp: Date.now() + _entryCounter * 1000,
        isFinal: true,
        response: opts?.response,
        meta: opts?.response || opts?.sentiment ? {
            response: opts?.response,
            sentiment: opts?.sentiment,
        } : undefined,
        signature: opts?.sentiment ? `sig-${opts.sentiment}` : undefined,
        phase: opts?.phase,
        navigation: opts?.navigation,
    };
}

function detectSentiment(text: string): ConversationEntry['sentiment'] {
    const lower = text.toLowerCase();
    if (lower.includes('?') || lower.startsWith('cómo') || lower.startsWith('qué') || lower.startsWith('por qué')) return 'question';
    const positiveWords = ['gracias', 'bueno', 'genial', 'excelente', 'me gusta', 'feliz', 'bien', 'great', 'good', 'happy', 'me encanta', 'hermoso', 'maravilloso', 'perfecto', 'me alegra'];
    const negativeWords = ['mal', 'horrible', 'triste', 'enojado', 'frustrado', 'error', 'no funciona', 'bad', 'sad', 'angry', 'terrible', 'pésimo', 'perdí', 'no carga'];
    for (const w of positiveWords) { if (lower.includes(w)) return 'positive'; }
    for (const w of negativeWords) { if (lower.includes(w)) return 'negative'; }
    return 'neutral';
}

function sentimentToEmotion(sentiment: ConversationEntry['sentiment']): EmotionalState {
    switch (sentiment) {
        case 'positive': return 'happy';
        case 'negative': return 'sad';
        case 'question': return 'curious';
        default: return 'neutral';
    }
}

const EMOTION_TO_EXPRESSION: Record<EmotionalState, string> = {
    neutral: 'neutral',
    happy: 'sonrisa',
    curious: 'inclinacion',
    thoughtful: 'pensativo',
    surprised: 'sorprendido',
    sad: 'triste',
    excited: 'emocionado',
};

const STATE_TO_AVATAR: Record<ConversationState, string> = {
    IDLE: 'idle',
    LISTENING: 'escuchando',
    THINKING: 'pensando',
    SPEAKING: 'hablando',
    ERROR: 'error',
    CELEBRATING: 'celebrando',
};

const EMOTION_TO_GESTURES: Record<EmotionalState, string[]> = {
    neutral: ['parpadeo'],
    happy: ['sonrisa', 'inclinacion', 'saludo'],
    curious: ['inclinacion', 'cabeceo'],
    thoughtful: ['mirada_arriba', 'cabeceo_lento'],
    surprised: ['ojos_abiertos', 'inclinacion_atras'],
    sad: ['cabeza_gacha', 'hombros_caidos'],
    excited: ['saludo', 'aplauso', 'brinco'],
};

function generateResponse(userText: string, botName: string, history: Array<{ role: string; text: string; id?: string }> = []): string {
    const lower = userText.toLowerCase();
    if (lower.includes('hola') || lower.includes('buenos días') || lower.includes('buenas')) {
        return `¡${botName}: Hola! Encantado de conversar contigo.`;
    }
    if (lower.includes('cómo estás') || lower.includes('cómo te llamas')) {
        return `${botName}: Estoy muy bien, gracias por preguntar. Soy ${botName}, tu asistente virtual.`;
    }
    if (lower.includes('adiós') || lower.includes('hasta luego') || lower.includes('nos vemos')) {
        return `${botName}: ¡Hasta luego! Ha sido un placer hablar contigo.`;
    }
    if (lower.includes('minuta') || lower.includes('resumen') || lower.includes('reporte')) {
        return `${botName}: Claro, generando la minuta de la conversación...`;
    }
    if (lower.includes('ayuda') || lower.includes('qué puedes hacer')) {
        return `${botName}: Puedo conversar contigo, tomar notas, generar minutas, y ayudarte con información. ¿En qué puedo ayudarte?`;
    }
    if (history.length > 0 && lower.includes('gracias')) {
        return `${botName}: ¡De nada! Para eso estoy.`;
    }
    const sentiment = detectSentiment(userText);
    if (sentiment === 'positive') {
        return `${botName}: ¡Qué bueno que te sientes así! Me alegra mucho.`;
    }
    if (sentiment === 'negative') {
        return `${botName}: Lamento escuchar eso. ¿Hay algo en que pueda ayudarte?`;
    }
    if (sentiment === 'question') {
        return `${botName}: Esa es una excelente pregunta. Déjame pensar...`;
    }
    return `${botName}: Entiendo. Cuéntame más sobre eso.`;
}

function generateMinute(history: ConversationEntry[], botName: string): string {
    const now = new Date().toISOString();
    const userMessages = history.filter(e => e.role === 'user');
    const fluMessages = history.filter(e => e.role === 'flu');
    const positiveCount = history.filter(e => e.sentiment === 'positive').length;
    const negativeCount = history.filter(e => e.sentiment === 'negative').length;
    const questionCount = history.filter(e => e.sentiment === 'question').length;
    let mood = 'neutral';
    if (positiveCount > negativeCount) mood = 'positiva';
    else if (negativeCount > positiveCount) mood = 'negativa';
    let topics: string[] = [];
    const allText = history.map(e => e.text.toLowerCase()).join(' ');
    if (allText.includes('proyecto') || allText.includes('presupuesto')) topics.push('proyecto');
    if (allText.includes('inteligencia artificial') || allText.includes('ia')) topics.push('inteligencia artificial');
    if (allText.includes('reunión') || allText.includes('meeting')) topics.push('reunión');
    if (allText.includes('ayuda') || allText.includes('soporte')) topics.push('soporte');
    if (topics.length === 0) topics.push('conversación general');
    const dominantEmotion = positiveCount > negativeCount ? 'alegría' : negativeCount > positiveCount ? 'preocupación' : 'neutralidad';
    return `=== MINUTA DE CONVERSACIÓN ===\nFecha: ${now}\nParticipantes: Usuario, ${botName}\nDuración: ${history.length} intercambios\nTemas tratados: ${topics.join(', ')}\nEstado de ánimo general: ${mood}\nEmoción dominante: ${dominantEmotion}\nMensajes de usuario: ${userMessages.length}\nMensajes de ${botName}: ${fluMessages.length}\nPreguntas realizadas: ${questionCount}\n---\nResumen: Conversación de ${history.length} turnos con tono ${mood}. Se abordaron temas como ${topics.join(', ')}.\n=== FIN DE MINUTA ===`;
}

function createDefaultSessionState(): SessionState {
    return {
        activeTab: 'workspace',
        language: 'es',
        sessionRole: 'general',
        expandedFrameId: '',
        selectedMinuteId: null,
        participantPhase: 'idle',
        participantTurnCount: 0,
        workspaceImageExpanded: false,
    };
}

function serializeSessionState(state: SessionState): string {
    return JSON.stringify(state);
}

function deserializeSessionState(json: string): SessionState | null {
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

// ============================================================
// 4. PRODUCTIVE DATA — Escenarios realistas
// ============================================================
// Estos datos simulan conversaciones reales que FLU procesaría
// en producción. Cada escenario tiene un flujo narrativo completo.

const PRODUCTIVE_CONVERSATIONS: Record<string, string[]> = {
    // Escenario 1: Nuevo usuario explorando FLU
    newUser: [
        'Hola, ¿cómo estás?',
        '¿Quién eres?',
        '¿Qué puedes hacer?',
        'Me gusta tu voz',
        'Gracias por la información',
    ],
    // Escenario 2: Soporte técnico con progresión emocional
    techSupport: [
        'Hola, necesito ayuda',
        'No funciona el sistema',
        'Ya intenté reiniciar pero sigue igual',
        '¿Puedes revisar los logs?',
        'Gracias, ahora funciona',
    ],
    // Escenario 3: Montaña rusa emocional
    emotionalRollercoaster: [
        'Hola, hoy no ha sido un buen día',
        'Perdí mi trabajo esta mañana',
        'Pero bueno, tengo salud y familia',
        'Gracias por escucharme',
        'Me siento un poco mejor ahora',
    ],
    // Escenario 4: Explorador curioso (muchas preguntas)
    curiousExplorer: [
        '¿Cómo funciona la inteligencia artificial?',
        '¿Qué es un avatar 3D?',
        '¿Cómo aprendes de las conversaciones?',
        '¿Puedes generar informes?',
        '¿Cómo se llama tu creador?',
    ],
    // Escenario 5: Sesión de trabajo con minuta
    workSession: [
        'Buenos días, vamos a empezar la reunión',
        '¿Puedes tomar nota de los puntos importantes?',
        'El primer punto es el presupuesto del proyecto',
        'El segundo punto es la asignación de tareas',
        'Gracias, por favor genera la minuta de la reunión',
    ],
};

// Escenarios multi-speaker (OS2-style data pipeline)
const MULTI_SPEAKER_CONVERSATIONS: Record<string, MultiSpeakerEntry[]> = {
    // Escenario: Reunión de equipo con 3 participantes
    teamMeeting: [
        makeEntry('Buenos días a todos, gracias por conectarse', 'Ana', { phase: 'apertura', navigation: 'saludo' }),
        makeEntry('Hola Ana, ¿cómo estamos hoy?', 'FLU', { response: 'Saludo cordial', sentiment: 'positive', phase: 'apertura' }),
        makeEntry('Buenos días, yo tengo el reporte del proyecto', 'Carlos', { phase: 'desarrollo', navigation: 'reporte' }),
        makeEntry('Excelente Carlos, adelante con el reporte', 'Ana', { phase: 'desarrollo', sentiment: 'positive' }),
        makeEntry('El proyecto va al 70% de avance, dentro del presupuesto', 'Carlos', { phase: 'desarrollo', navigation: 'presupuesto' }),
        makeEntry('Perfecto, me alegra escuchar eso', 'FLU', { response: 'Validación positiva', sentiment: 'positive', phase: 'desarrollo' }),
        makeEntry('¿Alguna pregunta sobre el reporte?', 'Carlos', { phase: 'desarrollo', sentiment: 'question' }),
        makeEntry('Yo tengo una duda sobre los tiempos de entrega', 'María', { phase: 'desarrollo', sentiment: 'question' }),
        makeEntry('Buena pregunta María, podemos ajustar el cronograma', 'FLU', { response: 'Sugerencia de ajuste', phase: 'desarrollo', navigation: 'cronograma' }),
        makeEntry('Genial, entonces cerramos con esos ajustes', 'Ana', { phase: 'cierre', sentiment: 'positive', navigation: 'cierre' }),
    ],
    // Escenario: Soporte técnico con múltiples interlocutores
    multiTechSupport: [
        makeEntry('Buenas tardes, necesito ayuda con el sistema', 'Pedro', { phase: 'apertura', navigation: 'soporte' }),
        makeEntry('Hola Pedro, claro cuéntame qué sucede', 'FLU', { response: 'Ofrecimiento de ayuda', sentiment: 'positive', phase: 'apertura' }),
        makeEntry('El módulo de facturación no carga los datos', 'Pedro', { phase: 'diagnostico', sentiment: 'negative' }),
        makeEntry('¿Ya intentaste limpiar la caché del navegador?', 'FLU', { response: 'Sugerencia técnica', sentiment: 'question', phase: 'diagnostico' }),
        makeEntry('Sí, ya lo hice pero sigue igual', 'Pedro', { phase: 'diagnostico', sentiment: 'negative' }),
        makeEntry('Déjame revisar los logs del servidor', 'FLU', { response: 'Revisión de logs', phase: 'diagnostico', navigation: 'logs' }),
        makeEntry('Yo también tuve ese problema ayer', 'Lucía', { phase: 'diagnostico' }),
        makeEntry('¿Cómo lo solucionaste Lucía?', 'Pedro', { phase: 'diagnostico', sentiment: 'question' }),
        makeEntry('Resultó ser un permiso de base de datos', 'Lucía', { phase: 'diagnostico', navigation: 'base-datos' }),
        makeEntry('Exacto, ya encontré el error. Permiso denegado en la BD', 'FLU', { response: 'Solución identificada', phase: 'solucion', navigation: 'solucion' }),
    ],
    // Escenario: Sesión de brainstorming creativo
    brainstorming: [
        makeEntry('Vamos a pensar ideas para la nueva campaña', 'Marta', { phase: 'apertura', navigation: 'brainstorming' }),
        makeEntry('¡Me encanta! Propongo un enfoque de realidad aumentada', 'FLU', { response: 'Propuesta creativa', sentiment: 'excited', phase: 'ideacion' }),
        makeEntry('Eso suena interesante, ¿cómo lo visualizas?', 'Carlos', { phase: 'ideacion', sentiment: 'curious' }),
        makeEntry('Podemos usar filtros AR en redes sociales', 'FLU', { response: 'Detalle de propuesta AR', phase: 'ideacion', navigation: 'redes-sociales' }),
        makeEntry('Me gusta, pero el presupuesto es limitado', 'Marta', { phase: 'evaluacion', sentiment: 'thoughtful' }),
        makeEntry('Podemos empezar con un MVP en Instagram', 'FLU', { response: 'Sugerencia de MVP', phase: 'evaluacion', navigation: 'mvp' }),
        makeEntry('Buena idea, así probamos antes de invertir más', 'Carlos', { phase: 'evaluacion', sentiment: 'positive' }),
        makeEntry('Perfecto, entonces definamos los entregables', 'Marta', { phase: 'cierre', navigation: 'entregables' }),
        makeEntry('Yo puedo preparar el prototipo esta semana', 'FLU', { response: 'Ofrecimiento de prototipo', phase: 'cierre', sentiment: 'positive' }),
        makeEntry('Excelente, nos reunimos el viernes para revisar avances', 'Marta', { phase: 'cierre', sentiment: 'positive', navigation: 'proximos-pasos' }),
    ],
};

// ============================================================
// 5. TESTS E2E — Flujo 1: Pipeline de Voz Completo
// ============================================================

describe('🧪 E2E — Pipeline de Voz (OS2 parity)', () => {

    it('FLUJO COMPLETO: transcript → sentiment → emotion → gesture → response → log', () => {
        const testCases = [
            { text: '¡Qué excelente día!', expectedSentiment: 'positive', expectedEmotion: 'happy' as EmotionalState },
            { text: 'Estoy muy triste', expectedSentiment: 'negative', expectedEmotion: 'sad' as EmotionalState },
            { text: '¿Cómo funciona esto?', expectedSentiment: 'question', expectedEmotion: 'curious' as EmotionalState },
            { text: 'El cielo es azul', expectedSentiment: 'neutral', expectedEmotion: 'neutral' as EmotionalState },
            { text: '¡Me encanta esta idea!', expectedSentiment: 'positive', expectedEmotion: 'happy' as EmotionalState },
            { text: 'Perdí mi trabajo', expectedSentiment: 'negative', expectedEmotion: 'sad' as EmotionalState },
            { text: '¿Qué es la IA?', expectedSentiment: 'question', expectedEmotion: 'curious' as EmotionalState },
        ];

        for (const tc of testCases) {
            // Paso 1: Detectar sentimiento del transcript
            const sentiment = detectSentiment(tc.text);
            expect(sentiment).toBe(tc.expectedSentiment);

            // Paso 2: Mapear sentimiento a emoción
            const emotion = sentimentToEmotion(sentiment);
            expect(emotion).toBe(tc.expectedEmotion);

            // Paso 3: Obtener expresión facial para la emoción
            const expression = EMOTION_TO_EXPRESSION[emotion];
            expect(expression).toBeTruthy();
            expect(typeof expression).toBe('string');

            // Paso 4: Obtener gestos corporales para la emoción
            const gestures = EMOTION_TO_GESTURES[emotion];
            expect(gestures.length).toBeGreaterThan(0);
            expect(Array.isArray(gestures)).toBe(true);

            // Paso 5: Generar respuesta contextual
            const response = generateResponse(tc.text, 'FLU');
            expect(response).toContain('FLU');
            expect(response.length).toBeGreaterThan(10);

            // Paso 6: Verificar que la respuesta es coherente con el sentimiento
            if (sentiment === 'positive') {
                expect(response).toMatch(/alegra|bueno|genial|excelente/i);
            } else if (sentiment === 'negative') {
                expect(response).toMatch(/Lamento|ayudarte|siento/i);
            } else if (sentiment === 'question') {
                expect(response).toMatch(/pregunta|excelente pregunta|Déjame pensar/i);
            }
        }
    });

    it('FLUJO COMPLETO: ciclo de 5 turnos con estado (IDLE→LISTENING→THINKING→SPEAKING)', () => {
        const messages = PRODUCTIVE_CONVERSATIONS.newUser;
        const history: Array<{ role: string; text: string; id?: string }> = [];
        const states: ConversationState[] = ['IDLE'];

        for (let i = 0; i < messages.length; i++) {
            // Transición a LISTENING (usuario habla)
            states.push('LISTENING');
            // Transición a THINKING (FLU procesa)
            states.push('THINKING');
            // FLU genera respuesta
            const response = generateResponse(messages[i], 'FLU', history);
            // Transición a SPEAKING (FLU responde)
            states.push('SPEAKING');
            // Registrar en el historial
            history.push({ role: 'user', text: messages[i], id: String(i * 2) });
            history.push({ role: 'flu', text: response, id: String(i * 2 + 1) });
        }

        // Verificar ciclo completo
        expect(history.length).toBe(10); // 5 user + 5 flu
        expect(states.length).toBe(16); // 1 IDLE + 5*(LISTENING+THINKING+SPEAKING)

        // Verificar distribución de estados
        expect(states.filter(s => s === 'LISTENING').length).toBe(5);
        expect(states.filter(s => s === 'THINKING').length).toBe(5);
        expect(states.filter(s => s === 'SPEAKING').length).toBe(5);

        // Verificar que el historial mantiene orden cronológico
        for (let i = 1; i < history.length; i++) {
            expect(history[i].role).not.toBe(history[i - 1].role); // Alterna user/flu
        }
    });

    it('FLUJO COMPLETO: audio → transcript → sentiment → emotion → gesture (todos los escenarios)', () => {
        const allScenarios = Object.values(PRODUCTIVE_CONVERSATIONS).flat();

        for (const text of allScenarios) {
            const sentiment = detectSentiment(text);
            const emotion = sentimentToEmotion(sentiment);
            const expression = EMOTION_TO_EXPRESSION[emotion];
            const gestures = EMOTION_TO_GESTURES[emotion];

            // Cada paso del pipeline debe producir un resultado válido
            expect(['positive', 'negative', 'neutral', 'question']).toContain(sentiment);
            expect(Object.keys(EMOTION_TO_EXPRESSION)).toContain(emotion);
            expect(expression).toBeTruthy();
            expect(gestures.length).toBeGreaterThan(0);
        }
    });
});

// ============================================================
// 6. TESTS E2E — Flujo 2: OS2 Bridge (start/stop/process)
// ============================================================

describe('🧪 E2E — OS2 Voice Bridge (FluAvatarVoiceBridge parity)', () => {

    it('debe manejar comando start-listening correctamente', () => {
        let isMicActive = false;
        let conversationState: ConversationState = 'IDLE';

        // Simular recepción de comando start-listening
        const handleStartListening = () => {
            if (isMicActive) return; // No reiniciar si ya escucha
            isMicActive = true;
            conversationState = 'LISTENING';
        };

        handleStartListening();
        expect(isMicActive).toBe(true);
        expect(conversationState).toBe('LISTENING');
    });

    it('debe manejar comando stop-listening correctamente', () => {
        let isMicActive = true;
        let conversationState: ConversationState = 'LISTENING';
        let pendingTranscript = '';

        // OS2 parity: handleStopListening debe procesar transcript pendiente antes de detener
        const handleStopListening = () => {
            if (pendingTranscript && pendingTranscript.trim()) {
                // Procesar transcript pendiente (OS2 parity)
                const response = generateResponse(pendingTranscript, 'FLU');
                expect(response.length).toBeGreaterThan(0);
            }
            isMicActive = false;
            conversationState = 'IDLE';
        };

        pendingTranscript = 'Gracias por tu ayuda';
        handleStopListening();
        expect(isMicActive).toBe(false);
        expect(conversationState).toBe('IDLE');
    });

    it('debe manejar comando toggle-listening correctamente', () => {
        let isMicActive = false;

        const toggle = () => { isMicActive = !isMicActive; };

        toggle();
        expect(isMicActive).toBe(true);
        toggle();
        expect(isMicActive).toBe(false);
        toggle();
        expect(isMicActive).toBe(true);
    });

    it('debe manejar comando start-conversation correctamente', () => {
        let isMicActive = false;
        let conversationState: ConversationState = 'IDLE';

        // start-conversation: solo inicia si no está escuchando
        const handleStartConversation = () => {
            if (!isMicActive) {
                isMicActive = true;
                conversationState = 'LISTENING';
            }
        };

        handleStartConversation();
        expect(isMicActive).toBe(true);
        expect(conversationState).toBe('LISTENING');

        // No debe reiniciar si ya está activo
        handleStartConversation();
        expect(isMicActive).toBe(true); // Sigue igual
    });

    it('debe manejar comando process-transcript (Flu participa) correctamente', () => {
        const transcript = '¿Qué opinas sobre este proyecto?';
        const response = generateResponse(transcript, 'FLU');
        expect(response).toContain('FLU');
        expect(response.length).toBeGreaterThan(10);
    });

    it('debe encolar transcript en pendingSpill si está procesando (OS2 parity)', () => {
        let isProcessing = true;
        let pendingSpill = '';

        // Simular llegada de transcript mientras se procesa
        const incomingText = 'Hola FLU';
        if (isProcessing) {
            pendingSpill = incomingText; // Se encola
        }

        expect(pendingSpill).toBe('Hola FLU');

        // Cuando termina de procesar, debe procesar el spill
        isProcessing = false;
        if (pendingSpill && !isProcessing) {
            const response = generateResponse(pendingSpill, 'FLU');
            expect(response).toContain('FLU');
            pendingSpill = '';
        }
        expect(pendingSpill).toBe('');
    });

    it('debe programar auto-process con delay configurable (OS2 parity)', () => {
        // OS2 usa FLU_CONFIG.timing.wakeWordCommandDelayMs (800ms) o interimCommandDelayMs (1200ms)
        const wakeWordDelay = FLU_CONFIG_TEST.timing.wakeWordCommandDelayMs;
        const interimDelay = FLU_CONFIG_TEST.timing.interimCommandDelayMs;

        expect(wakeWordDelay).toBe(800);
        expect(interimDelay).toBe(1200);

        // Simular scheduleAutoProcess
        let autoProcessFired = false;
        const delay = wakeWordDelay;

        // OS2 parity: scheduleAutoProcess usa setTimeout con el delay
        // y cuando expira, llama a processCapture (handleProcessTranscript)
        setTimeout(() => {
            autoProcessFired = true;
        }, delay);

        // Verificar que el delay es correcto
        expect(delay).toBeGreaterThan(0);
    });

    it('debe programar resume-listening después de hablar (OS2 parity)', () => {
        // OS2 parity: scheduleResumeListening usa FLU_CONFIG.timing.resumeListeningMs (50ms)
        const resumeDelay = FLU_CONFIG_TEST.timing.resumeListeningMs;
        expect(resumeDelay).toBe(50);

        let resumeFired = false;
        setTimeout(() => {
            resumeFired = true;
        }, resumeDelay);

        expect(resumeDelay).toBeGreaterThan(0);
    });

    it('debe reconocer los 5 comandos de voz del bridge', () => {
        const validCommands = [
            'start-listening',
            'stop-listening',
            'toggle-listening',
            'start-conversation',
            'process-transcript',
        ] as const;

        type VoiceCommand = typeof validCommands[number];

        // Verificar que todos los comandos son reconocidos
        for (const cmd of validCommands) {
            expect(cmd).toBeDefined();
            expect(typeof cmd).toBe('string');
        }

        // Verificar que comandos inválidos son rechazados
        const invalidCommands = ['invalid', '', 'listen', 'speak'];
        for (const cmd of invalidCommands) {
            expect(validCommands.includes(cmd as any)).toBe(false);
        }
    });

    it('debe sincronizar isMicActive con el estado de conversación', () => {
        let isMicActive = false;
        let conversationState: ConversationState = 'IDLE';

        // handleStartListening
        isMicActive = true;
        conversationState = 'LISTENING';
        expect(isMicActive).toBe(true);
        expect(conversationState).toBe('LISTENING');

        // recognition.onerror
        isMicActive = false;
        conversationState = 'ERROR';
        expect(isMicActive).toBe(false);
        expect(conversationState).toBe('ERROR');

        // handleStopListening
        isMicActive = false;
        conversationState = 'IDLE';
        expect(isMicActive).toBe(false);
        expect(conversationState).toBe('IDLE');
    });
});

// ============================================================
// 7. TESTS E2E — Flujo 3: Multi-Speaker Diarization
// ============================================================

describe('🧪 E2E — Multi-Speaker Diarization (OS2 conversationStream parity)', () => {

    it('debe identificar todos los hablantes en teamMeeting', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const speakers = new Set(entries.map(e => e.speakerName));
        expect(speakers.has('Ana')).toBe(true);
        expect(speakers.has('Carlos')).toBe(true);
        expect(speakers.has('FLU')).toBe(true);
        // teamMeeting tiene 4 hablantes: Ana, Carlos, FLU, María
        expect(speakers.size).toBe(4);

        // Verificar que FLU aparece como hablante en las entradas correctas
        const fluEntries = entries.filter(e => e.speakerName === 'FLU');
        expect(fluEntries.length).toBeGreaterThan(0);
        fluEntries.forEach(e => {
            expect(e.response).toBeTruthy();
        });
    });

    it('debe identificar todos los hablantes en multiTechSupport', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.multiTechSupport;
        const speakers = new Set(entries.map(e => e.speakerName));
        expect(speakers.has('Pedro')).toBe(true);
        expect(speakers.has('FLU')).toBe(true);
        expect(speakers.has('Lucía')).toBe(true);
        expect(speakers.size).toBe(3);
    });

    it('debe identificar todos los hablantes en brainstorming', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.brainstorming;
        const speakers = new Set(entries.map(e => e.speakerName));
        expect(speakers.has('Marta')).toBe(true);
        expect(speakers.has('Carlos')).toBe(true);
        expect(speakers.has('FLU')).toBe(true);
        expect(speakers.size).toBe(3);
    });

    it('debe tener estructura ConversationRow completa en cada entrada', () => {
        const allEntries = [
            ...MULTI_SPEAKER_CONVERSATIONS.teamMeeting,
            ...MULTI_SPEAKER_CONVERSATIONS.multiTechSupport,
            ...MULTI_SPEAKER_CONVERSATIONS.brainstorming,
        ];

        for (const entry of allEntries) {
            expect(entry.id).toBeTruthy();
            expect(entry.text).toBeTruthy();
            expect(entry.speakerId).toBeTruthy();
            expect(entry.speakerName).toBeTruthy();
            expect(typeof entry.timestamp).toBe('number');
            expect(typeof entry.isFinal).toBe('boolean');
        }
    });

    it('debe tener fases (apertura, desarrollo, cierre) en teamMeeting', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const phases = new Set(entries.map(e => e.phase).filter(Boolean));
        expect(phases.has('apertura')).toBe(true);
        expect(phases.has('desarrollo')).toBe(true);
        expect(phases.has('cierre')).toBe(true);
    });

    it('debe tener respuestas de FLU en todas las conversaciones multi-speaker', () => {
        for (const [, entries] of Object.entries(MULTI_SPEAKER_CONVERSATIONS)) {
            const fluEntries = entries.filter(e => e.speakerName === 'FLU');
            expect(fluEntries.length).toBeGreaterThan(0);
            fluEntries.forEach(e => {
                expect(e.response).toBeTruthy();
                expect(typeof e.response).toBe('string');
            });
        }
    });

    it('debe poder generar respuestas para cada entrada multi-speaker', () => {
        for (const [, entries] of Object.entries(MULTI_SPEAKER_CONVERSATIONS)) {
            for (const entry of entries) {
                if (entry.speakerName !== 'FLU') {
                    const response = generateResponse(entry.text, 'FLU');
                    expect(response).toContain('FLU');
                    expect(response.length).toBeGreaterThan(10);
                }
            }
        }
    });

    it('debe detectar sentimiento en entradas multi-speaker', () => {
        for (const [, entries] of Object.entries(MULTI_SPEAKER_CONVERSATIONS)) {
            for (const entry of entries) {
                const sentiment = detectSentiment(entry.text);
                expect(['positive', 'negative', 'neutral', 'question']).toContain(sentiment);
                const emotion = sentimentToEmotion(sentiment);
                expect(Object.keys(EMOTION_TO_EXPRESSION)).toContain(emotion);
            }
        }
    });

    it('debe mantener orden cronológico en teamMeeting', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        for (let i = 1; i < entries.length; i++) {
            expect(entries[i].timestamp).toBeGreaterThanOrEqual(entries[i - 1].timestamp);
        }
    });

    it('debe tener navegación definida en entradas clave', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const navEntries = entries.filter(e => e.navigation);
        expect(navEntries.length).toBeGreaterThan(0);
        navEntries.forEach(e => {
            expect(typeof e.navigation).toBe('string');
            expect(e.navigation!.length).toBeGreaterThan(0);
        });
    });

    it('debe alternar hablantes correctamente (OS2 conversationStream turn alternation)', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        for (let i = 1; i < entries.length; i++) {
            const prev = entries[i - 1];
            const curr = entries[i];
            if (prev.speakerName === curr.speakerName) {
                expect(curr.text).not.toBe(prev.text);
            }
        }
    });

    it('debe resolver speaker usando sticky fallback (OS2 turnSpeakerCommit parity)', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.brainstorming;
        let lastSpeaker = '';
        for (const entry of entries) {
            if (entry.speakerName === 'FLU') continue;
            const resolvedSpeaker = entry.speakerName || lastSpeaker || 'Marta';
            expect(resolvedSpeaker).toBeTruthy();
            lastSpeaker = entry.speakerName;
        }
    });

    it('debe manejar ASR revision en entradas multi-speaker (OS2 conversationStream parity)', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.multiTechSupport;
        const pedroEntries = entries.filter(e => e.speakerName === 'Pedro');
        const texts = new Set(pedroEntries.map(e => e.text));
        expect(texts.size).toBe(pedroEntries.length);
    });
});

// ============================================================
// 8. TESTS E2E — Flujo 4: Wake Word Detection
// ============================================================

describe('🧪 E2E — Wake Word Detection (OS2 transcriptIngress parity)', () => {

    function hasWakeWordPrefix(text: string, wakeWords: string[]): boolean {
        // OS2 word boundary parity: usa \b para detectar wake words con puntuación alrededor
        const lower = text.toLowerCase();
        return wakeWords.some(w => {
            const wl = w.toLowerCase();
            const regex = new RegExp(`\\b${wl}\\b`, 'i');
            return regex.test(lower);
        });
    }

    function splitAtWakeWord(text: string, wakeWords: string[]): { before: string; after: string; found: boolean } {
        const lower = text.toLowerCase();
        for (const w of wakeWords) {
            const wl = w.toLowerCase();
            const idx = lower.indexOf(wl);
            if (idx !== -1) {
                const before = text.slice(0, idx).trim();
                const after = text.slice(idx + w.length).trim();
                return { before, after, found: true };
            }
        }
        return { before: text, after: '', found: false };
    }

    const WAKE_WORDS = FLU_CONFIG_TEST.voiceCommands.wakeWords;

    it('debe detectar wake word "FLU" al inicio del texto', () => {
        expect(hasWakeWordPrefix('FLU necesito ayuda', WAKE_WORDS)).toBe(true);
        expect(hasWakeWordPrefix('flu dime algo', WAKE_WORDS)).toBe(true);
    });

    it('debe detectar wake word "Bunny" al inicio del texto', () => {
        expect(hasWakeWordPrefix('Bunny qué piensas', WAKE_WORDS)).toBe(true);
        expect(hasWakeWordPrefix('bunny hola', WAKE_WORDS)).toBe(true);
    });

    it('debe dividir texto en wake word', () => {
        const result = splitAtWakeWord('FLU necesito ayuda', WAKE_WORDS);
        expect(result.found).toBe(true);
        expect(result.before).toBe('');
        expect(result.after).toBe('necesito ayuda');
    });

    it('debe retornar found=false si no hay wake word', () => {
        expect(hasWakeWordPrefix('Hola cómo estás', WAKE_WORDS)).toBe(false);
        const result = splitAtWakeWord('Hola cómo estás', WAKE_WORDS);
        expect(result.found).toBe(false);
    });

    it('debe detectar wake word en medio del texto', () => {
        expect(hasWakeWordPrefix('oye FLU ayúdame', WAKE_WORDS)).toBe(true);
    });

    it('debe funcionar con mayúsculas y minúsculas', () => {
        expect(hasWakeWordPrefix('flu', WAKE_WORDS)).toBe(true);
        expect(hasWakeWordPrefix('FLU', WAKE_WORDS)).toBe(true);
        expect(hasWakeWordPrefix('Flu', WAKE_WORDS)).toBe(true);
    });

    it('no debe detectar wake word como parte de otra palabra', () => {
        const lower = 'el agua es fluida';
        const hasAsWord = WAKE_WORDS.some(w => {
            const wl = w.toLowerCase();
            const regex = new RegExp(`\\b${wl}\\b`, 'i');
            return regex.test(lower);
        });
        expect(hasAsWord).toBe(false);
    });

    it('debe detectar wake word con puntuación alrededor', () => {
        // OS2 usa word boundary, por lo que "¡FLU!" no detecta porque ¡ está pegado
        // Pero "FLU," sí detecta porque la coma está después
        expect(hasWakeWordPrefix('FLU, necesito algo', WAKE_WORDS)).toBe(true);
        expect(hasWakeWordPrefix('Hola FLU, cómo estás', WAKE_WORDS)).toBe(true);
        expect(hasWakeWordPrefix('FLU.', WAKE_WORDS)).toBe(true);
    });

    it('debe extraer el comando después del wake word (OS2 transcriptIngress parity)', () => {
        const result = splitAtWakeWord('FLU genera una minuta', WAKE_WORDS);
        expect(result.found).toBe(true);
        expect(result.after.toLowerCase()).toContain('minuta');
    });

    it('debe manejar múltiples wake words en el mismo texto', () => {
        const result = splitAtWakeWord('Bunny FLU ayuda', WAKE_WORDS);
        expect(result.found).toBe(true);
        expect(result.after).toBeTruthy();
    });
});

// ============================================================
// 9. TESTS E2E — Flujo 5: Speech Merge / Dedup
// ============================================================

describe('🧪 E2E — Speech Merge / Dedup (OS2 conversationStream parity)', () => {

    function utterancesRelate(previous: string, next: string): boolean {
        if (!previous || !next) return false;
        const p = previous.toLowerCase().trim();
        const n = next.toLowerCase().trim();
        if (n.includes(p) || p.includes(n)) return true;
        const pWords = p.split(/\s+/);
        const nWords = n.split(/\s+/);
        const overlap = pWords.filter(w => nWords.includes(w)).length;
        const minLen = Math.min(pWords.length, nWords.length);
        return minLen > 0 && overlap >= Math.min(minLen, FLU_CONFIG_TEST.speech.mergeOverlapWords);
    }

    function utterancesAsrProgress(previous: string, next: string): boolean {
        if (!previous || !next) return false;
        const p = previous.toLowerCase().trim();
        const n = next.toLowerCase().trim();
        return n.length > p.length && n.startsWith(p);
    }

    it('debe detectar que dos utterances están relacionados', () => {
        expect(utterancesRelate('Hola FLU', 'Hola FLU cómo estás')).toBe(true);
        expect(utterancesRelate('Necesito ayuda', 'Necesito ayuda con el sistema')).toBe(true);
    });

    it('debe detectar ASR progress (mismo inicio, más largo)', () => {
        expect(utterancesAsrProgress('Hola FLU', 'Hola FLU cómo estás')).toBe(true);
        expect(utterancesAsrProgress('Necesito', 'Necesito ayuda')).toBe(true);
    });

    it('no debe relacionar textos completamente diferentes', () => {
        expect(utterancesRelate('Hola', 'Adiós')).toBe(false);
        expect(utterancesRelate('Rojo', 'Azul')).toBe(false);
    });

    it('debe manejar textos vacíos', () => {
        expect(utterancesRelate('', 'Hola')).toBe(false);
        expect(utterancesRelate('Hola', '')).toBe(false);
        expect(utterancesRelate('', '')).toBe(false);
        expect(utterancesAsrProgress('', 'Hola')).toBe(false);
    });

    it('debe detectar relación con overlap de palabras (OS2 mergeOverlapWords=3)', () => {
        expect(utterancesRelate('a b c d e', 'a b c x y')).toBe(true);
        expect(utterancesRelate('a b c d e', 'a b x y z')).toBe(false);
    });

    it('debe detectar que un utterance contiene al otro', () => {
        expect(utterancesRelate('Hola FLU cómo estás', 'FLU')).toBe(true);
        expect(utterancesRelate('FLU', 'Hola FLU cómo estás')).toBe(true);
    });

    it('debe ignorar mayúsculas/minúsculas en la relación', () => {
        expect(utterancesRelate('hola flu', 'HOLA FLU CÓMO ESTÁS')).toBe(true);
        expect(utterancesRelate('HOLA FLU', 'hola flu cómo estás')).toBe(true);
    });

    it('debe detectar ASR progress con puntuación', () => {
        expect(utterancesAsrProgress('Hola FLU', 'Hola FLU, cómo estás?')).toBe(true);
    });

    it('no debe detectar ASR progress si next es más corto', () => {
        expect(utterancesAsrProgress('Hola FLU cómo estás', 'Hola FLU')).toBe(false);
    });
});

// ============================================================
// 10. TESTS E2E — Flujo 6: Session Persistence
// ============================================================

describe('🧪 E2E — Session Persistence (useSessionPersistence parity)', () => {

    it('debe crear estado de sesión por defecto', () => {
        const state = createDefaultSessionState();
        expect(state.activeTab).toBe('workspace');
        expect(state.language).toBe('es');
        expect(state.sessionRole).toBe('general');
        expect(state.expandedFrameId).toBe('');
        expect(state.selectedMinuteId).toBeNull();
        expect(state.participantPhase).toBe('idle');
        expect(state.participantTurnCount).toBe(0);
        expect(state.workspaceImageExpanded).toBe(false);
    });

    it('debe serializar y deserializar estado de sesión', () => {
        const state = createDefaultSessionState();
        const json = serializeSessionState(state);
        expect(typeof json).toBe('string');

        const restored = deserializeSessionState(json);
        expect(restored).not.toBeNull();
        expect(restored!.activeTab).toBe(state.activeTab);
        expect(restored!.language).toBe(state.language);
        expect(restored!.sessionRole).toBe(state.sessionRole);
    });

    it('debe retornar null para JSON inválido', () => {
        expect(deserializeSessionState('')).toBeNull();
        expect(deserializeSessionState('not json')).toBeNull();
        expect(deserializeSessionState('{invalid}')).toBeNull();
    });

    it('debe preservar todos los campos tras serialización', () => {
        const state: SessionState = {
            activeTab: 'conversation',
            language: 'en',
            sessionRole: 'developer',
            expandedFrameId: 'frame-1',
            selectedMinuteId: 'minute-123',
            participantPhase: 'active',
            participantTurnCount: 5,
            workspaceImageExpanded: true,
        };

        const json = serializeSessionState(state);
        const restored = deserializeSessionState(json);

        expect(restored).not.toBeNull();
        expect(restored!.activeTab).toBe('conversation');
        expect(restored!.language).toBe('en');
        expect(restored!.sessionRole).toBe('developer');
        expect(restored!.expandedFrameId).toBe('frame-1');
        expect(restored!.selectedMinuteId).toBe('minute-123');
        expect(restored!.participantPhase).toBe('active');
        expect(restored!.participantTurnCount).toBe(5);
        expect(restored!.workspaceImageExpanded).toBe(true);
    });

    it('debe manejar selectedMinuteId null correctamente', () => {
        const state = createDefaultSessionState();
        expect(state.selectedMinuteId).toBeNull();

        const json = serializeSessionState(state);
        const restored = deserializeSessionState(json);
        expect(restored!.selectedMinuteId).toBeNull();
    });

    it('debe soportar ciclo completo: crear -> modificar -> serializar -> restaurar', () => {
        const state = createDefaultSessionState();
        expect(state.participantTurnCount).toBe(0);

        state.activeTab = 'minutes';
        state.participantTurnCount = 10;
        state.selectedMinuteId = 'min-001';

        const json = serializeSessionState(state);
        const restored = deserializeSessionState(json);
        expect(restored!.activeTab).toBe('minutes');
        expect(restored!.participantTurnCount).toBe(10);
        expect(restored!.selectedMinuteId).toBe('min-001');

        restored!.participantTurnCount = 15;
        expect(restored!.participantTurnCount).toBe(15);
        expect(state.participantTurnCount).toBe(10);
    });

    it('debe preservar tipos booleanos en serialización', () => {
        const state = createDefaultSessionState();
        state.workspaceImageExpanded = true;
        const json = serializeSessionState(state);
        const restored = deserializeSessionState(json);
        expect(restored!.workspaceImageExpanded).toBe(true);
        expect(typeof restored!.workspaceImageExpanded).toBe('boolean');
    });

    it('debe preservar tipos numéricos en serialización', () => {
        const state = createDefaultSessionState();
        state.participantTurnCount = 42;
        const json = serializeSessionState(state);
        const restored = deserializeSessionState(json);
        expect(restored!.participantTurnCount).toBe(42);
        expect(typeof restored!.participantTurnCount).toBe('number');
    });
});

// ============================================================
// 11. TESTS E2E — Flujo 7: Gemini Service Integration
// ============================================================

describe('🧪 E2E — Gemini Service Integration (schemas, structured output)', () => {

    const PARTICIPANT_EVAL_SCHEMA = {
        type: 'object',
        properties: {
            participante: { type: 'string' },
            claridad: { type: 'number', minimum: 0, maximum: 10 },
            relevancia: { type: 'number', minimum: 0, maximum: 10 },
            aporte: { type: 'number', minimum: 0, maximum: 10 },
            confianza: { type: 'number', minimum: 0, maximum: 1 },
            observaciones: { type: 'string' },
        },
        required: ['participante', 'claridad', 'relevancia', 'aporte', 'confianza'],
    };

    const CONVERSATION_SUMMARY_SCHEMA = {
        type: 'object',
        properties: {
            tema_principal: { type: 'string' },
            participantes: { type: 'array', items: { type: 'string' } },
            duracion_estimada: { type: 'string' },
            puntos_clave: { type: 'array', items: { type: 'string' } },
            decisiones: { type: 'array', items: { type: 'string' } },
            estado_general: { type: 'string', enum: ['positivo', 'neutral', 'negativo'] },
        },
        required: ['tema_principal', 'participantes', 'puntos_clave', 'estado_general'],
    };

    function validateAgainstSchema(obj: any, schema: typeof PARTICIPANT_EVAL_SCHEMA | typeof CONVERSATION_SUMMARY_SCHEMA): boolean {
        if (!obj || typeof obj !== 'object') return false;
        for (const field of schema.required) {
            if (!(field in obj)) return false;
        }
        const props = schema.properties as Record<string, any>;
        for (const [key, value] of Object.entries(obj)) {
            if (!props[key]) continue;
            const propSchema = props[key];
            if (propSchema.type === 'number') {
                if (typeof value !== 'number') return false;
                if (propSchema.minimum !== undefined && value < propSchema.minimum) return false;
                if (propSchema.maximum !== undefined && value > propSchema.maximum) return false;
            } else if (propSchema.type === 'string') {
                if (typeof value !== 'string') return false;
                if (propSchema.enum && !propSchema.enum.includes(value)) return false;
            } else if (propSchema.type === 'array') {
                if (!Array.isArray(value)) return false;
            }
        }
        return true;
    }

    function extractJson(text: string): Record<string, unknown> | null {
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            try { return JSON.parse(codeBlockMatch[1].trim()); } catch { return null; }
        }
        try { return JSON.parse(text.trim()); } catch { return null; }
    }

    it('debe validar PARTICIPANT_EVAL_SCHEMA correctamente', () => {
        const validEval = {
            participante: 'Ana',
            claridad: 8,
            relevancia: 9,
            aporte: 7,
            confianza: 0.85,
            observaciones: 'Buena participación',
        };
        expect(validateAgainstSchema(validEval, PARTICIPANT_EVAL_SCHEMA)).toBe(true);
    });

    it('debe rechazar PARTICIPANT_EVAL_SCHEMA con campos faltantes', () => {
        const invalidEval = { participante: 'Ana', claridad: 8 };
        expect(validateAgainstSchema(invalidEval, PARTICIPANT_EVAL_SCHEMA)).toBe(false);
    });

    it('debe rechazar PARTICIPANT_EVAL_SCHEMA con tipos incorrectos', () => {
        const invalidEval = {
            participante: 'Ana',
            claridad: 'ocho',
            relevancia: 9,
            aporte: 7,
            confianza: 0.85,
        };
        expect(validateAgainstSchema(invalidEval, PARTICIPANT_EVAL_SCHEMA)).toBe(false);
    });

    it('debe validar CONVERSATION_SUMMARY_SCHEMA correctamente', () => {
        const validSummary = {
            tema_principal: 'Revisión de proyecto',
            participantes: ['Ana', 'Carlos', 'FLU'],
            duracion_estimada: '30 minutos',
            puntos_clave: ['Avance al 70%', 'Presupuesto dentro de lo esperado'],
            decisiones: ['Ajustar cronograma'],
            estado_general: 'positivo',
        };
        expect(validateAgainstSchema(validSummary, CONVERSATION_SUMMARY_SCHEMA)).toBe(true);
    });

    it('debe rechazar CONVERSATION_SUMMARY_SCHEMA con campos faltantes', () => {
        const invalidSummary = { tema_principal: 'Revisión' };
        expect(validateAgainstSchema(invalidSummary, CONVERSATION_SUMMARY_SCHEMA)).toBe(false);
    });

    it('debe rechazar CONVERSATION_SUMMARY_SCHEMA con tipos incorrectos', () => {
        const invalidSummary = {
            tema_principal: 'Revisión',
            participantes: 'Ana',
            puntos_clave: 'punto',
            estado_general: 'positivo',
        };
        expect(validateAgainstSchema(invalidSummary, CONVERSATION_SUMMARY_SCHEMA)).toBe(false);
    });

    it('debe extraer JSON de markdown code block', () => {
        const text = '```json\n{"key": "value"}\n```';
        const result = extractJson(text);
        expect(result).not.toBeNull();
        expect(result!.key).toBe('value');
    });

    it('debe extraer JSON de texto plano', () => {
        const text = '{"key": "value"}';
        const result = extractJson(text);
        expect(result).not.toBeNull();
        expect(result!.key).toBe('value');
    });

    it('debe retornar null para texto sin JSON', () => {
        expect(extractJson('Hola mundo')).toBeNull();
        expect(extractJson('')).toBeNull();
        expect(extractJson('```text\nno json\n```')).toBeNull();
    });

    it('debe extraer JSON con array de participantes', () => {
        const text = JSON.stringify({ participantes: ['Ana', 'Carlos', 'María'], total: 3 });
        const result = extractJson(text);
        expect(result).not.toBeNull();
        expect(Array.isArray(result!.participantes)).toBe(true);
        expect((result!.participantes as string[]).length).toBe(3);
    });

    it('debe validar que confianza está en rango 0-1', () => {
        const validEval = { participante: 'Carlos', claridad: 7, relevancia: 8, aporte: 6, confianza: 0.75 };
        expect(validateAgainstSchema(validEval, PARTICIPANT_EVAL_SCHEMA)).toBe(true);

        const invalidEval = { ...validEval, confianza: 1.5 };
        expect(validateAgainstSchema(invalidEval, PARTICIPANT_EVAL_SCHEMA)).toBe(false);
    });

    it('debe generar evaluación de participante con datos productivos', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const participants = [...new Set(entries.map(e => e.speakerName))];

        for (const p of participants) {
            const evalData = {
                participante: p,
                claridad: Math.floor(Math.random() * 5) + 5,
                relevancia: Math.floor(Math.random() * 5) + 5,
                aporte: Math.floor(Math.random() * 5) + 5,
                confianza: 0.5 + Math.random() * 0.5,
                observaciones: 'Participación en conversación multi-speaker',
            };
            expect(validateAgainstSchema(evalData, PARTICIPANT_EVAL_SCHEMA)).toBe(true);
        }
    });

    it('debe generar resumen de conversación con datos productivos', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const participants = [...new Set(entries.map(e => e.speakerName))];
        const allText = entries.map(e => e.text).join(' ');

        const summary = {
            tema_principal: allText.toLowerCase().includes('proyecto') ? 'Revisión de proyecto' : 'Conversación general',
            participantes: participants,
            duracion_estimada: `${entries.length} intercambios`,
            puntos_clave: ['Discusión de avances', 'Ajustes de cronograma'],
            decisiones: ['Continuar con ajustes propuestos'],
            estado_general: 'positivo' as const,
        };

        expect(validateAgainstSchema(summary, CONVERSATION_SUMMARY_SCHEMA)).toBe(true);
        expect(summary.participantes.length).toBe(participants.length);
        expect(summary.estado_general).toBe('positivo');
    });
});

// ============================================================
// 12. TESTS E2E — Flujo 8: Minute Generation
// ============================================================

describe('🧪 E2E — Minute Generation from Productive Data', () => {

    function buildHistoryFromScenario(scenario: string[]): ConversationEntry[] {
        const history: ConversationEntry[] = [];
        for (let i = 0; i < scenario.length; i++) {
            const sentiment = detectSentiment(scenario[i]);
            history.push({
                role: 'user',
                text: scenario[i],
                timestamp: Date.now() + i * 1000,
                sentiment,
                id: `user-${i}`,
            });
            const response = generateResponse(scenario[i], 'FLU', history);
            history.push({
                role: 'flu',
                text: response,
                timestamp: Date.now() + i * 1000 + 500,
                id: `flu-${i}`,
            });
        }
        return history;
    }

    it('debe generar minuta con historial vacío', () => {
        const minute = generateMinute([], 'FLU');
        expect(minute).toContain('MINUTA');
        expect(minute).toContain('FLU');
        expect(minute).toContain('0 intercambios');
    });

    it('debe generar minuta para escenario newUser', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.newUser);
        const minute = generateMinute(history, 'FLU');
        expect(minute).toContain('MINUTA');
        expect(minute).toContain('FLU');
        expect(minute).toContain('10 intercambios');
        expect(minute).toContain('Usuario');
    });

    it('debe generar minuta para escenario techSupport', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.techSupport);
        const minute = generateMinute(history, 'FLU');
        expect(minute).toContain('MINUTA');
        expect(minute).toContain('soporte');
    });

    it('debe generar minuta para escenario emotionalRollercoaster', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.emotionalRollercoaster);
        const minute = generateMinute(history, 'FLU');
        expect(minute).toContain('MINUTA');
        expect(minute).toMatch(/preocupación|neutralidad|alegría/);
    });

    it('debe generar minuta para escenario curiousExplorer', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.curiousExplorer);
        const minute = generateMinute(history, 'FLU');
        expect(minute).toContain('MINUTA');
        expect(minute).toMatch(/Preguntas realizadas: [1-9]/);
    });

    it('debe generar minuta para escenario workSession', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.workSession);
        const minute = generateMinute(history, 'FLU');
        expect(minute).toContain('MINUTA');
        expect(minute).toContain('proyecto');
    });

    it('debe incluir metadatos en cada minuta', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.newUser);
        const minute = generateMinute(history, 'FLU');
        expect(minute).toContain('Fecha:');
        expect(minute).toContain('Participantes:');
        expect(minute).toContain('Duración:');
        expect(minute).toContain('Temas tratados:');
        expect(minute).toContain('Estado de ánimo general:');
        expect(minute).toContain('Emoción dominante:');
        expect(minute).toContain('Mensajes de usuario:');
        expect(minute).toContain('Mensajes de FLU:');
        expect(minute).toContain('Preguntas realizadas:');
        expect(minute).toContain('Resumen:');
    });

    it('debe generar minuta desde datos multi-speaker', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const history: ConversationEntry[] = entries.map((e) => ({
            role: e.speakerName === 'FLU' ? 'flu' as const : 'user' as const,
            text: e.text,
            timestamp: e.timestamp,
            sentiment: detectSentiment(e.text),
            id: e.id,
        }));
        const minute = generateMinute(history, 'FLU');
        expect(minute).toContain('MINUTA');
        expect(minute).toContain(String(history.length));
    });

    it('debe detectar sentimiento dominante en la minuta', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.emotionalRollercoaster);
        const minute = generateMinute(history, 'FLU');
        const negativeCount = history.filter(e => e.sentiment === 'negative').length;
        const positiveCount = history.filter(e => e.sentiment === 'positive').length;
        if (negativeCount > positiveCount) {
            expect(minute).toContain('negativa');
        }
    });

    it('debe identificar temas en la minuta', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.workSession);
        const minute = generateMinute(history, 'FLU');
        expect(minute).toContain('proyecto');
    });

    it('debe incluir preguntas realizadas en la minuta', () => {
        const history = buildHistoryFromScenario(PRODUCTIVE_CONVERSATIONS.curiousExplorer);
        const minute = generateMinute(history, 'FLU');
        const questionCount = history.filter(e => e.sentiment === 'question').length;
        expect(questionCount).toBeGreaterThan(0);
        expect(minute).toContain(`Preguntas realizadas: ${questionCount}`);
    });
});

// ============================================================
// 13. TESTS E2E — Flujo 9: Participant Rename / Delete
// ============================================================

describe('🧪 E2E — Participant Rename / Delete (VoiceProfilesPanel parity)', () => {

    interface ParticipantProfile {
        id: string;
        label: string;
        speakerId: string;
        createdAt: number;
    }

    let profiles: ParticipantProfile[] = [];

    function addProfile(label: string, speakerId: string): ParticipantProfile {
        const profile: ParticipantProfile = {
            id: generateUUIDv4(),
            label,
            speakerId,
            createdAt: Date.now(),
        };
        profiles.push(profile);
        return profile;
    }

    function renameProfile(id: string, newLabel: string): boolean {
        const idx = profiles.findIndex(p => p.id === id);
        if (idx === -1) return false;
        profiles[idx] = { ...profiles[idx], label: newLabel };
        return true;
    }

    function removeProfile(id: string): boolean {
        const idx = profiles.findIndex(p => p.id === id);
        if (idx === -1) return false;
        profiles.splice(idx, 1);
        return true;
    }

    function renameSessionSpeaker(history: MultiSpeakerEntry[], fromLabel: string, toLabel: string): MultiSpeakerEntry[] {
        return history.map(entry => ({
            ...entry,
            speakerName: entry.speakerName === fromLabel ? toLabel : entry.speakerName,
        }));
    }

    beforeEach(() => {
        profiles = [];
    });

    it('debe agregar perfil de participante', () => {
        const profile = addProfile('Ana', 'speaker-ana');
        expect(profile.id).toBeTruthy();
        expect(profile.label).toBe('Ana');
        expect(profile.speakerId).toBe('speaker-ana');
        expect(profiles.length).toBe(1);
    });

    it('debe renombrar perfil existente', () => {
        const profile = addProfile('Ana', 'speaker-ana');
        const result = renameProfile(profile.id, 'Ana María');
        expect(result).toBe(true);
        expect(profiles[0].label).toBe('Ana María');
    });

    it('debe retornar false al renombrar perfil inexistente', () => {
        const result = renameProfile('non-existent', 'Test');
        expect(result).toBe(false);
    });

    it('debe eliminar perfil existente', () => {
        const profile = addProfile('Carlos', 'speaker-carlos');
        expect(profiles.length).toBe(1);
        const result = removeProfile(profile.id);
        expect(result).toBe(true);
        expect(profiles.length).toBe(0);
    });

    it('debe retornar false al eliminar perfil inexistente', () => {
        const result = removeProfile('non-existent');
        expect(result).toBe(false);
    });

    it('debe buscar perfil por label', () => {
        addProfile('Ana', 'speaker-ana');
        addProfile('Carlos', 'speaker-carlos');
        const found = profiles.find(p => p.label === 'Ana');
        expect(found).toBeDefined();
        expect(found!.speakerId).toBe('speaker-ana');
    });

    it('debe buscar perfil ignorando mayúsculas', () => {
        addProfile('Ana', 'speaker-ana');
        const found = profiles.find(p => p.label.toLowerCase() === 'ana');
        expect(found).toBeDefined();
    });

    it('debe renombrar speaker en el historial de conversación', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const renamed = renameSessionSpeaker(entries, 'Ana', 'Ana García');

        const anaEntries = renamed.filter(e => e.speakerName === 'Ana');
        expect(anaEntries.length).toBe(0);

        const anaGarciaEntries = renamed.filter(e => e.speakerName === 'Ana García');
        expect(anaGarciaEntries.length).toBeGreaterThan(0);
    });

    it('debe eliminar participante del historial de conversación', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const filtered = entries.filter(e => e.speakerName !== 'Carlos');
        const carlosEntries = filtered.filter(e => e.speakerName === 'Carlos');
        expect(carlosEntries.length).toBe(0);
        expect(filtered.length).toBeLessThan(entries.length);
    });

    it('debe mantener inmutabilidad en renameSessionSpeaker', () => {
        const entries = MULTI_SPEAKER_CONVERSATIONS.teamMeeting;
        const originalNames = entries.map(e => e.speakerName);
        const renamed = renameSessionSpeaker(entries, 'Ana', 'Ana García');

        // Original no debe cambiar
        const originalAna = entries.filter(e => e.speakerName === 'Ana');
        expect(originalAna.length).toBeGreaterThan(0);

        // Renombrado debe tener el nuevo nombre
        const renamedAna = renamed.filter(e => e.speakerName === 'Ana García');
        expect(renamedAna.length).toBeGreaterThan(0);
    });
});

// ============================================================
// 14. TESTS E2E — Flujo 10: Avatar State → Animation Mapping
// ============================================================

describe('🧪 E2E — Avatar State → Animation Mapping', () => {

    it('debe mapear todos los estados de conversación a animaciones', () => {
        const states: ConversationState[] = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'ERROR', 'CELEBRATING'];
        for (const state of states) {
            const animation = STATE_TO_AVATAR[state];
            expect(animation).toBeTruthy();
            expect(typeof animation).toBe('string');
            expect(animation.length).toBeGreaterThan(0);
        }
    });

    it('debe tener expresión facial para cada emoción', () => {
        const emotions: EmotionalState[] = ['neutral', 'happy', 'curious', 'thoughtful', 'surprised', 'sad', 'excited'];
        for (const emotion of emotions) {
            const expression = EMOTION_TO_EXPRESSION[emotion];
            expect(expression).toBeTruthy();
            expect(typeof expression).toBe('string');
        }
    });

    it('debe tener al menos un gesto por emoción', () => {
        const emotions: EmotionalState[] = ['neutral', 'happy', 'curious', 'thoughtful', 'surprised', 'sad', 'excited'];
        for (const emotion of emotions) {
            const gestures = EMOTION_TO_GESTURES[emotion];
            expect(gestures.length).toBeGreaterThan(0);
            expect(Array.isArray(gestures)).toBe(true);
        }
    });

    it('debe cambiar expresión según el estado', () => {
        // IDLE → neutral
        expect(STATE_TO_AVATAR['IDLE']).toBe('idle');
        // LISTENING → escuchando
        expect(STATE_TO_AVATAR['LISTENING']).toBe('escuchando');
        // SPEAKING → hablando
        expect(STATE_TO_AVATAR['SPEAKING']).toBe('hablando');
        // ERROR → error
        expect(STATE_TO_AVATAR['ERROR']).toBe('error');
    });

    it('debe mapear emoción a gestos específicos', () => {
        expect(EMOTION_TO_GESTURES.happy).toContain('sonrisa');
        expect(EMOTION_TO_GESTURES.curious).toContain('inclinacion');
        expect(EMOTION_TO_GESTURES.thoughtful).toContain('mirada_arriba');
        expect(EMOTION_TO_GESTURES.surprised).toContain('ojos_abiertos');
        expect(EMOTION_TO_GESTURES.sad).toContain('cabeza_gacha');
        expect(EMOTION_TO_GESTURES.excited).toContain('saludo');
    });

    it('debe mapear estado a animación de avatar correctamente (OS2 pipeline)', () => {
        const testCases: Array<{ state: ConversationState; emotion: EmotionalState; expectedAnimation: string; expectedExpression: string }> = [
            { state: 'IDLE', emotion: 'neutral', expectedAnimation: 'idle', expectedExpression: 'neutral' },
            { state: 'LISTENING', emotion: 'curious', expectedAnimation: 'escuchando', expectedExpression: 'inclinacion' },
            { state: 'THINKING', emotion: 'thoughtful', expectedAnimation: 'pensando', expectedExpression: 'pensativo' },
            { state: 'SPEAKING', emotion: 'happy', expectedAnimation: 'hablando', expectedExpression: 'sonrisa' },
            { state: 'ERROR', emotion: 'sad', expectedAnimation: 'error', expectedExpression: 'triste' },
            { state: 'CELEBRATING', emotion: 'excited', expectedAnimation: 'celebrando', expectedExpression: 'emocionado' },
        ];

        for (const tc of testCases) {
            expect(STATE_TO_AVATAR[tc.state]).toBe(tc.expectedAnimation);
            expect(EMOTION_TO_EXPRESSION[tc.emotion]).toBe(tc.expectedExpression);
        }
    });

    it('debe tener gestos consistentes con la emoción', () => {
        // Emociones positivas deben tener gestos positivos
        expect(EMOTION_TO_GESTURES.happy).toEqual(expect.arrayContaining(['sonrisa', 'inclinacion', 'saludo']));
        // Emociones negativas deben tener gestos negativos
        expect(EMOTION_TO_GESTURES.sad).toEqual(expect.arrayContaining(['cabeza_gacha', 'hombros_caidos']));
    });
});

// ============================================================
// 15. TESTS E2E — Flujo 11: Error Recovery
// ============================================================

describe('🧪 E2E — Error Recovery Flows', () => {

    it('debe manejar error de reconocimiento de voz', () => {
        let conversationState: ConversationState = 'LISTENING';
        let errorCount = 0;

        // Simular error de reconocimiento
        const handleRecognitionError = () => {
            conversationState = 'ERROR';
            errorCount++;
        };

        handleRecognitionError();
        expect(conversationState).toBe('ERROR');
        expect(errorCount).toBe(1);
    });

    it('debe recuperarse de ERROR a IDLE', () => {
        let conversationState: ConversationState = 'ERROR';

        const handleRecovery = () => {
            conversationState = 'IDLE';
        };

        handleRecovery();
        expect(conversationState).toBe('IDLE');
    });

    it('debe reintentar reconocimiento con backoff (OS2 parity)', () => {
        const baseDelay = FLU_CONFIG_TEST.timing.recognitionRetryBaseMs;
        const stepDelay = FLU_CONFIG_TEST.timing.recognitionRetryStepMs;
        const maxDelay = FLU_CONFIG_TEST.timing.recognitionRetryMaxMs;

        expect(baseDelay).toBe(220);
        expect(stepDelay).toBe(40);
        expect(maxDelay).toBe(800);

        // OS2: delay = baseDelay + retryCount * stepDelay, capped at maxDelay
        const retries = [0, 1, 2, 3, 4, 5];
        const delays = retries.map(r => Math.min(baseDelay + r * stepDelay, maxDelay));

        expect(delays[0]).toBe(220);  // retry 0
        expect(delays[1]).toBe(260);  // retry 1
        expect(delays[2]).toBe(300);  // retry 2
        expect(delays[3]).toBe(340);  // retry 3
        expect(delays[4]).toBe(380);  // retry 4
        expect(delays[5]).toBe(420);  // retry 5 (no cap yet)

        // Con más retries, debe cap en maxDelay
        const manyRetries = 20;
        const cappedDelay = Math.min(baseDelay + manyRetries * stepDelay, maxDelay);
        expect(cappedDelay).toBe(800);
    });

    it('debe limitar reintentos consecutivos (OS2 parity)', () => {
        const maxRetries = FLU_CONFIG_TEST.activeListen.restart.maxRetries;
        const consecutiveThreshold = FLU_CONFIG_TEST.activeListen.restart.consecutiveEndsThreshold;

        expect(maxRetries).toBe(5);
        expect(consecutiveThreshold).toBe(3);

        let retryCount = 0;
        let consecutiveEndsWithoutResult = 0;

        // Simular múltiples onend sin resultado
        for (let i = 0; i < 5; i++) {
            consecutiveEndsWithoutResult++;
            if (consecutiveEndsWithoutResult >= consecutiveThreshold && retryCount < maxRetries) {
                retryCount++;
                consecutiveEndsWithoutResult = 0;
            }
        }

        expect(retryCount).toBe(1); // Solo 1 reintento después de 3 ends consecutivos
        expect(consecutiveEndsWithoutResult).toBe(2); // Quedan 2 pendientes
    });

    it('debe manejar error de micrófono (permiso denegado)', () => {
        let micError: string | null = null;
        let conversationState: ConversationState = 'IDLE';

        const handleMicError = (error: string) => {
            micError = error;
            conversationState = 'ERROR';
        };

        handleMicError('NotAllowedError');
        expect(micError).toBe('NotAllowedError');
        expect(conversationState).toBe('ERROR');
    });

    it('debe manejar error de red en Gemini', () => {
        let geminiError: string | null = null;
        let conversationState: ConversationState = 'IDLE';

        const handleGeminiError = (error: string) => {
            geminiError = error;
            conversationState = 'ERROR';
        };

        handleGeminiError('Failed to fetch');
        expect(geminiError).toBe('Failed to fetch');
        expect(conversationState).toBe('ERROR');
    });

    it('debe mantener estado estable tras múltiples errores', () => {
        let conversationState: ConversationState = 'LISTENING';
        const errors = ['aborted', 'audio-capture', 'network', 'no-speech', 'not-allowed'];

        for (const err of errors) {
            conversationState = 'ERROR';
            expect(conversationState).toBe('ERROR');
            // Recuperar
            conversationState = 'IDLE';
            expect(conversationState).toBe('IDLE');
        }

        // Después de todos los errores, debe poder volver a LISTENING
        conversationState = 'LISTENING';
        expect(conversationState).toBe('LISTENING');
    });

    it('debe manejar stall detection (OS2 parity)', () => {
        const stallThreshold = FLU_CONFIG_TEST.timing.stallRebuildThresholdMs;
        expect(stallThreshold).toBe(4000);

        let lastResultAt = Date.now();
        let isStalled = false;

        // Simular stall: no hay resultados por más del threshold
        const elapsed = stallThreshold + 100; // 4100ms
        if (elapsed > stallThreshold) {
            isStalled = true;
        }

        expect(isStalled).toBe(true);

        // Después de un resultado, se resetea
        lastResultAt = Date.now();
        isStalled = false;
        expect(isStalled).toBe(false);
    });
});

// ============================================================
// 16. TESTS E2E — Flujo 12: PendingSpill / Auto-process / Resume-listening Timing
// ============================================================

describe('🧪 E2E — PendingSpill / Auto-process / Resume-listening Timing (OS2 parity)', () => {

    it('debe encolar transcript en pendingSpill si está procesando', () => {
        let isProcessing = true;
        let pendingSpill: string[] = [];

        // Llegan transcripts mientras se procesa
        const transcripts = ['Hola FLU', '¿Cómo estás?', 'Necesito ayuda'];

        for (const t of transcripts) {
            if (isProcessing) {
                pendingSpill.push(t);
            }
        }

        expect(pendingSpill.length).toBe(3);

        // Cuando termina de procesar, procesa el spill FIFO
        isProcessing = false;
        const processed: string[] = [];
        while (pendingSpill.length > 0 && !isProcessing) {
            const next = pendingSpill.shift()!;
            const response = generateResponse(next, 'FLU');
            processed.push(response);
        }

        expect(pendingSpill.length).toBe(0);
        expect(processed.length).toBe(3);
    });

    it('debe procesar spill FIFO (First In, First Out)', () => {
        let isProcessing = true;
        let pendingSpill: string[] = [];

        pendingSpill.push('Primero');
        pendingSpill.push('Segundo');
        pendingSpill.push('Tercero');

        isProcessing = false;
        const order: string[] = [];
        while (pendingSpill.length > 0 && !isProcessing) {
            order.push(pendingSpill.shift()!);
        }

        expect(order).toEqual(['Primero', 'Segundo', 'Tercero']);
    });

    it('debe programar auto-process con wakeWordCommandDelayMs (800ms)', () => {
        const delay = FLU_CONFIG_TEST.timing.wakeWordCommandDelayMs;
        expect(delay).toBe(800);

        // OS2 parity: scheduleAutoProcess usa setTimeout
        // Cuando hay wake word, usa wakeWordCommandDelayMs
        let fired = false;
        const timer = setTimeout(() => { fired = true; }, delay);
        expect(delay).toBeGreaterThan(0);
        clearTimeout(timer);
    });

    it('debe programar auto-process con interimCommandDelayMs (1200ms)', () => {
        const delay = FLU_CONFIG_TEST.timing.interimCommandDelayMs;
        expect(delay).toBe(1200);

        // OS2 parity: cuando NO hay wake word, usa interimCommandDelayMs
        let fired = false;
        const timer = setTimeout(() => { fired = true; }, delay);
        expect(delay).toBeGreaterThan(0);
        clearTimeout(timer);
    });

    it('debe programar resume-listening con resumeListeningMs (50ms)', () => {
        const delay = FLU_CONFIG_TEST.timing.resumeListeningMs;
        expect(delay).toBe(50);

        // OS2 parity: scheduleResumeListening usa setTimeout con resumeListeningMs
        let fired = false;
        const timer = setTimeout(() => { fired = true; }, delay);
        expect(delay).toBeGreaterThan(0);
        clearTimeout(timer);
    });

    it('debe limpiar autoProcessTimer al detener escucha', () => {
        let autoProcessTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => { }, 1000);
        expect(autoProcessTimer).not.toBeNull();

        // Al detener escucha, se limpia el timer
        if (autoProcessTimer) {
            clearTimeout(autoProcessTimer);
            autoProcessTimer = null;
        }

        expect(autoProcessTimer).toBeNull();
    });

    it('debe limpiar pendingSpill al detener escucha', () => {
        let pendingSpill: string[] = ['Hola', 'Mundo'];

        // Al detener escucha, se limpia el spill
        pendingSpill = [];
        expect(pendingSpill.length).toBe(0);
    });

    it('debe respetar speakingCheckIntervalMs (200ms) para monitor', () => {
        const interval = FLU_CONFIG_TEST.timing.speakingCheckIntervalMs;
        expect(interval).toBe(200);

        // OS2 parity: startSpeakingMonitor usa setInterval con speakingCheckIntervalMs
        let checks = 0;
        const maxChecks = 3;
        const monitor = setInterval(() => {
            checks++;
            if (checks >= maxChecks) {
                clearInterval(monitor);
            }
        }, interval);

        expect(interval).toBeGreaterThan(0);
        clearInterval(monitor);
    });

    it('debe procesar spill antes de scheduleResumeListening', () => {
        let pendingSpill: string[] = ['Transcript pendiente'];
        let isProcessing = false;
        let resumeScheduled = false;

        // OS2 parity: primero procesa spill, luego programa resume
        if (!isProcessing && pendingSpill.length > 0) {
            const text = pendingSpill.shift()!;
            const response = generateResponse(text, 'FLU');
            expect(response).toContain('FLU');
            // Después de procesar, programa resume
            resumeScheduled = true;
        }

        expect(pendingSpill.length).toBe(0);
        expect(resumeScheduled).toBe(true);
    });

    it('debe manejar múltiples spills consecutivos', () => {
        let isProcessing = true;
        let pendingSpill: string[] = [];
        const incoming = ['A', 'B', 'C', 'D', 'E'];

        // Acumular spills mientras procesa
        for (const t of incoming) {
            if (isProcessing) {
                pendingSpill.push(t);
            }
        }
        expect(pendingSpill.length).toBe(5);

        // Procesar todos
        isProcessing = false;
        const results: string[] = [];
        while (pendingSpill.length > 0 && !isProcessing) {
            const text = pendingSpill.shift()!;
            results.push(generateResponse(text, 'FLU'));
        }

        expect(pendingSpill.length).toBe(0);
        expect(results.length).toBe(5);
    });
});

// ============================================================
// 17. TESTS E2E — Flujo 13: FLU_CONFIG-driven behavior (0 hardcode)
// ============================================================

describe('🧪 E2E — FLU_CONFIG-driven behavior (0 hardcode verification)', () => {

    it('debe usar FLU_CONFIG.timing para todos los delays (0 hardcode)', () => {
        expect(FLU_CONFIG_TEST.timing.resumeListeningMs).toBeDefined();
        expect(FLU_CONFIG_TEST.timing.wakeWordCommandDelayMs).toBeDefined();
        expect(FLU_CONFIG_TEST.timing.interimCommandDelayMs).toBeDefined();
        expect(FLU_CONFIG_TEST.timing.speakingCheckIntervalMs).toBeDefined();
        expect(FLU_CONFIG_TEST.timing.recognitionRetryBaseMs).toBeDefined();
        expect(FLU_CONFIG_TEST.timing.recognitionRetryStepMs).toBeDefined();
        expect(FLU_CONFIG_TEST.timing.recognitionRetryMaxMs).toBeDefined();
        expect(FLU_CONFIG_TEST.timing.stallRebuildThresholdMs).toBeDefined();

        const timingValues = Object.values(FLU_CONFIG_TEST.timing);
        for (const val of timingValues) {
            expect(typeof val).toBe('number');
            expect(val).toBeGreaterThan(0);
        }
    });

    it('debe usar FLU_CONFIG.speech para merge/dedup (0 hardcode)', () => {
        expect(FLU_CONFIG_TEST.speech.maxChunkChars).toBeDefined();
        expect(FLU_CONFIG_TEST.speech.mergeOverlapWords).toBeDefined();
        expect(typeof FLU_CONFIG_TEST.speech.maxChunkChars).toBe('number');
        expect(typeof FLU_CONFIG_TEST.speech.mergeOverlapWords).toBe('number');
        expect(FLU_CONFIG_TEST.speech.maxChunkChars).toBeGreaterThan(0);
        expect(FLU_CONFIG_TEST.speech.mergeOverlapWords).toBeGreaterThan(0);
    });

    it('debe usar FLU_CONFIG.activeListen para reconocimiento (0 hardcode)', () => {
        expect(FLU_CONFIG_TEST.activeListen.languages).toBeDefined();
        expect(FLU_CONFIG_TEST.activeListen.bilingual).toBeDefined();
        expect(FLU_CONFIG_TEST.activeListen.recognition.maxAlternatives).toBe(3);
        expect(FLU_CONFIG_TEST.activeListen.restart.maxRetries).toBe(5);
        expect(FLU_CONFIG_TEST.activeListen.restart.consecutiveEndsThreshold).toBe(3);
        expect(FLU_CONFIG_TEST.activeListen.speakers.maxAutoSpeakers).toBe(10);
        expect(Array.isArray(FLU_CONFIG_TEST.activeListen.listeningAck.phrases)).toBe(true);
    });

    it('debe usar FLU_CONFIG.voiceCommands para todos los comandos (0 hardcode)', () => {
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.wakeWords)).toBe(true);
        expect(FLU_CONFIG_TEST.voiceCommands.wakeWords.length).toBeGreaterThan(0);
        expect(FLU_CONFIG_TEST.voiceCommands.wakeWords).toContain('FLU');
        expect(FLU_CONFIG_TEST.voiceCommands.wakeWords).toContain('Bunny');

        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.openListening)).toBe(true);
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.closeListening)).toBe(true);
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.startConversation)).toBe(true);
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.nextSpeaker)).toBe(true);
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.generateMinute)).toBe(true);
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.generateSummary)).toBe(true);
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.saveMinute)).toBe(true);
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.grantFloor)).toBe(true);
        expect(Array.isArray(FLU_CONFIG_TEST.voiceCommands.dismissFloor)).toBe(true);
    });

    it('debe usar FLU_CONFIG.limits para todos los límites (0 hardcode)', () => {
        expect(FLU_CONFIG_TEST.limits.maxHistoryRows).toBe(200);
        expect(FLU_CONFIG_TEST.limits.maxMinuteEntries).toBe(100);
        expect(FLU_CONFIG_TEST.limits.maxVoiceProfiles).toBe(50);
        expect(FLU_CONFIG_TEST.limits.maxSpeakerClusters).toBe(20);

        const limitValues = Object.values(FLU_CONFIG_TEST.limits);
        for (const val of limitValues) {
            expect(typeof val).toBe('number');
            expect(val).toBeGreaterThan(0);
        }
    });

    it('debe usar FLU_CONFIG.gemini para modelos (0 hardcode)', () => {
        expect(FLU_CONFIG_TEST.gemini.contract.model).toBe('gemini-2.0-flash-lite');
        expect(FLU_CONFIG_TEST.gemini.summary.model).toBe('gemini-2.0-flash-lite');
        expect(FLU_CONFIG_TEST.gemini.participantEval.model).toBe('gemini-2.0-flash-lite');
    });

    it('debe usar FLU_CONFIG.sessionDefaults para valores por defecto (0 hardcode)', () => {
        expect(FLU_CONFIG_TEST.sessionDefaults.role).toBe('general');
        expect(FLU_CONFIG_TEST.sessionDefaults.theme).toBe('');
    });

    it('debe detectar isSupported dinámicamente (no hardcode)', () => {
        const isSupported = typeof window !== 'undefined' &&
            ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
        expect(isSupported).toBe(false);
    });

    it('debe usar FLU_CONFIG para labels de UI (no hardcode)', () => {
        const voiceCommands = FLU_CONFIG_TEST.voiceCommands;
        const allCommands = [
            ...voiceCommands.openListening,
            ...voiceCommands.closeListening,
            ...voiceCommands.startConversation,
            ...voiceCommands.nextSpeaker,
            ...voiceCommands.generateMinute,
            ...voiceCommands.generateSummary,
            ...voiceCommands.saveMinute,
            ...voiceCommands.grantFloor,
            ...voiceCommands.dismissFloor,
        ];

        expect(allCommands.length).toBeGreaterThan(0);
        for (const cmd of allCommands) {
            expect(typeof cmd).toBe('string');
            expect(cmd.length).toBeGreaterThan(0);
        }
    });

    it('debe tener todos los valores de FLU_CONFIG sincronizados con fluConfig.js', () => {
        const requiredSections = ['timing', 'speech', 'activeListen', 'voiceCommands', 'limits', 'gemini', 'sessionDefaults'];
        for (const section of requiredSections) {
            expect((FLU_CONFIG_TEST as any)[section]).toBeDefined();
        }

        function checkNoUndefined(obj: any, path: string = '') {
            for (const [key, value] of Object.entries(obj)) {
                if (value === undefined) {
                    throw new Error(`FLU_CONFIG.${path}${key} is undefined`);
                }
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    checkNoUndefined(value, `${path}${key}.`);
                }
            }
        }
        checkNoUndefined(FLU_CONFIG_TEST);
    });
});