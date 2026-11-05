/**
 * Selector de participante de los paneles de ajustes.
 *
 * Dueño único de ese control: etiqueta, opción vacía y lista de opciones. Antes
 * estaba copiado en ContactsPanel y MateriaGrisPanel.
 */
export interface ParticipantSelectProps {
    /** Id seleccionado ('' = ninguno). */
    value: string;
    /** Cambio de selección. */
    onChange: (id: string) => void;
    /** Participantes disponibles. */
    participants: readonly { id: string; name: string }[];
    /** Etiquetas del panel (`FLU_CONFIG...ui`). */
    ui: { participantLabel?: string; participantEmpty?: string };
    /** Identificador estable para los tests. */
    testId: string;
    /** Deshabilita el control mientras hay una acción en curso. */
    disabled?: boolean;
    /** Texto de la opción vacía cuando `ui.participantEmpty` no existe. */
    emptyFallback: string;
}

/** Fila etiqueta + select de participante. */
export function ParticipantSelect({
    value,
    onChange,
    participants,
    ui,
    testId,
    disabled,
    emptyFallback,
}: ParticipantSelectProps) {
    const label = ui.participantLabel || 'Participante';
    return (
        <label className="flu-settings-image-config__field flu-settings-image-config__field--stacked">
            <span>{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-label={label}
                data-testid={testId}
                disabled={disabled}
            >
                <option value="">{ui.participantEmpty || emptyFallback}</option>
                {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.name}
                    </option>
                ))}
            </select>
        </label>
    );
}
