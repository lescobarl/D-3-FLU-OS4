// ============================================================
// generationTopic.ts — Tema/contenido real para la generación de
// documento/video desde el estado de conversación (función pura).
// ============================================================
// Fuente única del "tema" que usan GENERATE_DOCUMENT / GENERATE_VIDEO.
// Corrige: el contenido NO debe ser la respuesta-filler del asistente
// ("Procederé a generar un video…") ni el mandato crudo ("crea un video
// …"); cuando hay un artefacto doc/video del contrato, se usa su
// contenido/tema limpiado del verbo de mando.
// ============================================================
import { cleanForSpeech } from './textUtils';

export interface GenerationConversationSlice {
    conversationHistory?: Array<{
        role?: string;
        speakerName?: string;
        text?: string;
    }>;
    lastResponse?: string;
    workspaceArtifact?: {
        tipo?: string;
        contenido?: string;
        titulo?: string;
    } | null;
}

const WAKE_LEAD = /^(?:ok\s*flu|okay\s*flow|hey\s*flu|oye\s*flu|flu|ok\s*flow)[,.\s]*/i;

const GENERATION_LEAD =
    /^\s*(?:crea|crear|creame|gen[ée]rame|genera|generar|hazme|haz|hacer|elabora|elaborar|escr[íi]beme|escribe|prepara|preparar|ponme|pon|agenda|agendar|programa|programar)\s+(?:un|una|unos|unas|el|la|los|las)?\s*(?:video|documento|carta|nota|informe|reporte|ensayo|resumen|imagen|guion|gu[íi]on|art[íi]culo|article|letter|note|essay|report|summary)\s*(?:sobre|de|acerca\s+de|acerca\s+del|para|por|con|en|del)?\s*/i;

/**
 * Extrae el TEMA real de un mandato de generación quitando la wake word,
 * el verbo y el tipo de artefacto: "ok flu crea un video de un conejo
 * saltando" → "un conejo saltando".
 */
export function cleanTopicFromCommand(text = ''): string {
    let value = cleanForSpeech(text);
    if (!value) return '';
    value = value.replace(WAKE_LEAD, ' ').trim();
    value = value.replace(GENERATION_LEAD, ' ').trim();
    value = cleanForSpeech(value);
    return value;
}

/**
 * Construye { tema, contenido } para el generador. Prioridad:
 * 1) Si hay un artefacto doc/video del contrato → su contenido/tema real,
 *    limpiado del mandato, SIN la respuesta-filler del asistente.
 * 2) Si no (generación genérica) → tema = última pregunta del usuario
 *    limpiada; contenido = pregunta + última respuesta.
 */
export function buildGenerationTopic(state: GenerationConversationSlice): { tema: string; contenido: string } {
    const history = Array.isArray(state.conversationHistory) ? state.conversationHistory : [];
    let lastUser = '';
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const entry = history[i];
        if (!entry) continue;
        const role = String(entry.role || '').toLowerCase();
        const speaker = String(entry.speakerName || '');
        if (role === 'user' || (speaker && speaker !== 'FLU' && speaker !== 'flu')) {
            lastUser = (entry.text || '').trim();
            break;
        }
    }
    const lastResp = (state.lastResponse || '').trim();
    const artifact = state.workspaceArtifact;
    const isContractGeneration =
        artifact && ['doc', 'video', 'pdf'].includes(String(artifact.tipo || '').toLowerCase());

    if (isContractGeneration && artifact) {
        const raw = (artifact.contenido || artifact.titulo || '').trim();
        const cleanedArtifact = cleanTopicFromCommand(raw);
        const cleanedUser = cleanTopicFromCommand(lastUser);
        const source = raw || lastUser;
        const tema = (cleanedArtifact || cleanedUser || lastUser || artifact.titulo || 'Documento').slice(0, 200);
        const contenido = (source || cleanedUser || cleanedArtifact || '').slice(0, 1200);
        return { tema, contenido };
    }

    const cleanedUser = cleanTopicFromCommand(lastUser);
    const tema = (cleanedUser || lastUser || artifact?.titulo || artifact?.contenido || lastResp || '').slice(0, 200);
    const contenido = [cleanedUser || lastUser, lastResp].filter(Boolean).join('\n').slice(0, 1200);
    return { tema, contenido };
}
