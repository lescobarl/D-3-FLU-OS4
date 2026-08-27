// ============================================================
// VoiceAssistantBarWrapper — OS3 Local Override (Simplified)
// ============================================================
// Simplified bar: session buttons aligned right, no chips,
// no green "Abrir escucha" button. Chips moved to app-header.
// Preserves "Cerrar escucha" (when listening), geminiError,
// fluParticipant, listeningAck, listenParity.
// ============================================================

import { FLU_CONFIG } from '../voice/lib/fluConfig';

interface VoiceAssistantBarWrapperProps {
    status: string;
    geminiError?: { show: boolean; message: string; hint?: string; detail?: string } | null;
    listeningAck?: string | null;
    listenParity?: { level: string; message: string } | null;
    onToggle: () => void;
    onStartConversation: () => void;
    isSupported: boolean;
    knowledgeBaseLabel?: string | null;
    participantEnabled?: boolean;
    fluParticipantPresentation?: { show?: boolean; label?: string; tone?: string; reason?: string } | null;
    fluParticipantCanGrant?: boolean;
    onFluParticipa?: () => void;
}

export function VoiceAssistantBarWrapper({
    status,
    geminiError = null,
    listeningAck,
    listenParity = null,
    onToggle,
    onStartConversation,
    isSupported,
    knowledgeBaseLabel,
    participantEnabled = false,
    fluParticipantPresentation = null,
    fluParticipantCanGrant = false,
    onFluParticipa,
}: VoiceAssistantBarWrapperProps) {
    const isListening = status === 'listening';
    const isProcessing = status === 'processing';

    const showFluParticipant =
        participantEnabled && fluParticipantPresentation && fluParticipantPresentation.show !== false;

    return (
        <section className={`flu-voice-bar ${status}`}>
            <div className="flu-voice-bar__top">
                <div className="flu-voice-bar__clusters">
                    {/* Chips (Escuchando, KB, STT) removed — moved to app-header */}

                    {listeningAck ? (
                        <div className="flu-voice-bar__cluster flu-voice-bar__cluster--listen" aria-label="Estado de escucha">
                            <div className="flu-status-chip flu-status-chip--ack">
                                <span className="flu-status-chip__dot" />
                                <span>{listeningAck}</span>
                            </div>
                            {listenParity?.level === 'warn' ? (
                                <div
                                    className="flu-status-chip flu-status-chip--parity-warn"
                                    title={listenParity.message}
                                >
                                    <span className="flu-status-chip__dot" />
                                    <span>Captura desincronizada</span>
                                </div>
                            ) : null}
                        </div>
                    ) : listenParity?.level === 'warn' ? (
                        <div className="flu-voice-bar__cluster flu-voice-bar__cluster--listen" aria-label="Estado de escucha">
                            <div
                                className="flu-status-chip flu-status-chip--parity-warn"
                                title={listenParity.message}
                            >
                                <span className="flu-status-chip__dot" />
                                <span>Captura desincronizada</span>
                            </div>
                        </div>
                    ) : null}

                    {showFluParticipant ? (
                        <div className="flu-voice-bar__cluster flu-voice-bar__cluster--flu" aria-label="Participación Flu">
                            <div
                                className={[
                                    'flu-status-chip',
                                    'flu-status-chip--flu-participant',
                                    fluParticipantPresentation.tone === 'raised'
                                        ? 'flu-status-chip--flu-hand-raised'
                                        : fluParticipantPresentation.tone === 'evaluating'
                                            ? 'flu-status-chip--flu-hand-evaluating'
                                            : 'flu-status-chip--flu-hand-idle',
                                ].join(' ')}
                                title={fluParticipantPresentation.reason || undefined}
                                aria-live="polite"
                            >
                                <span className="flu-status-chip__dot" />
                                <span>{fluParticipantPresentation.label}</span>
                            </div>
                            <button
                                type="button"
                                className={[
                                    'flu-btn',
                                    'flu-btn--participant',
                                    fluParticipantCanGrant ? 'flu-btn--participant-ready' : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                                onClick={onFluParticipa}
                                disabled={!isSupported || typeof onFluParticipa !== 'function'}
                                title={
                                    fluParticipantCanGrant
                                        ? 'Ceder la palabra a Flu (equivalente a «ok flu adelante»)'
                                        : 'Flu evaluará la conversación y hablará si tiene un aporte válido'
                                }
                            >
                                {FLU_CONFIG.ui.buttons.fluParticipa}
                            </button>
                        </div>
                    ) : null}

                    {/* Session buttons — inline with chips */}
                    <div className="flu-voice-bar__cluster flu-voice-bar__cluster--session">
                        <button
                            type="button"
                            className="flu-btn flu-btn--ghost"
                            onClick={onStartConversation}
                            disabled={!isSupported}
                        >
                            {FLU_CONFIG.ui.buttons.startConversation}
                        </button>
                        <button
                            type="button"
                            className={[
                                'flu-btn',
                                isListening ? 'flu-btn--danger' : 'flu-btn--toggle',
                            ].join(' ')}
                            onClick={onToggle}
                            disabled={!isSupported || isProcessing}
                        >
                            {isListening
                                ? FLU_CONFIG.ui.buttons.closeListening
                                : FLU_CONFIG.ui.buttons.openListening}
                        </button>
                    </div>
                </div>
            </div>

            {geminiError?.show ? (
                <div className="flu-error-block">
                    <p className="flu-error">{geminiError.message}</p>
                    {geminiError?.hint ? <p className="flu-error-hint">{geminiError.hint}</p> : null}
                    {geminiError?.detail && geminiError.detail !== geminiError?.message ? (
                        <p className="flu-error-detail">{geminiError.detail}</p>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
