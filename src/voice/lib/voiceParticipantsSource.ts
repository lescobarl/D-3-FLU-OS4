// ============================================================
// voiceParticipantsSource — DUEÑO ÚNICO de la LISTA del panel de participantes.
// ------------------------------------------------------------
// El panel de "Participantes" muestra la unión de TRES fuentes de la MISMA sesión:
//   1. el HISTORIAL de conversación (las etiquetas/nombres que ya hablaron),
//   2. la BASE de participantes (la tabla `participants`: personas registradas),
//   3. los PERFILES de voz (tabla `voiceProfiles`: voz + perfil).
//
// Defecto del dueño (2026-10-12): "Luis pareciera que vive en la base, pero no se ve en
// los participantes ... si está en base debe aparecer en participantes". El panel miraba
// solo historial + perfiles, así que un nombre REGISTRADO en la base no aparecía.
//
// Función pura: la deriva App una sola vez y el panel NO la recalcula. Una fuente, un sitio.
// ============================================================

/** Una fila del panel: etiqueta visible + perfil de voz ligado (si existe). */
export interface VoiceParticipantEntry {
    label: string;
    profileId: string | undefined;
}

/**
 * Deriva la lista del panel de participantes a partir de las tres fuentes de la sesión.
 *
 * @param history Entradas de conversación (se usa su `speakerName`).
 * @param profiles Perfiles de voz (tabla `voiceProfiles`): `label` + `id`.
 * @param baseBase Participantes de la base (tabla `participants`): `name` + `speakerLabel`.
 * @returns Etiquetas únicas, cada una ligada a su perfil de voz cuando existe.
 */
export function resolveVoiceParticipants({
    history = [],
    profiles = [],
    base = [],
}: {
    history?: readonly { speakerName?: string }[];
    profiles?: readonly { label?: string; id?: string }[];
    base?: readonly { name?: string; speakerLabel?: string }[];
} = {}): VoiceParticipantEntry[] {
    const labels = new Set<string>();
    for (let i = 0; i < history.length; i += 1) {
        const label = String(history[i]?.speakerName || '').trim();
        if (label) labels.add(label);
    }
    // Si el nombre está en la BASE, APARECE en el panel (punto del dueño).
    for (let i = 0; i < base.length; i += 1) {
        const nombre = String(base[i]?.name || '').trim();
        const etiqueta = String(base[i]?.speakerLabel || '').trim();
        if (nombre) labels.add(nombre);
        if (etiqueta) labels.add(etiqueta);
    }
    for (let i = 0; i < profiles.length; i += 1) {
        const label = String(profiles[i]?.label || '').trim();
        if (label) labels.add(label);
    }
    const result: VoiceParticipantEntry[] = [];
    for (const label of labels) {
        let profileId: string | undefined;
        for (let i = 0; i < profiles.length; i += 1) {
            if (String(profiles[i]?.label || '').trim() === label) {
                profileId = profiles[i]?.id || undefined;
                break;
            }
        }
        result.push({ label, profileId });
    }
    return result;
}
