// ============================================================
// Voice Command Discovery — VoiceCommandHelp
// ============================================================
// A discoverable panel that shows available voice commands
// grouped by category. Helps users learn what FLU can do
// through voice.
//
// Cumple:
//   - Rule #1: NO HARDCODE
//   - React component (UI)
// ============================================================

import React, { useState, useMemo } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';

// -----------------------------------------------------------
// Types
// -----------------------------------------------------------

interface CommandGroup {
    category: string;
    commands: { phrase: string; description: string }[];
}

// -----------------------------------------------------------
// Constants
// -----------------------------------------------------------

// §9.4: la wake word mostrada se DERIVA de config, no se hardcodea.
const WAKE_PHRASE = (FLU_CONFIG.voiceCommands?.wakeWords || [])
    .slice(0, 2)
    .map((word: string) => `"${word}"`)
    .join(' / ') || 'Wake word';

const COMMAND_GROUPS: CommandGroup[] = [
    {
        category: 'Wake & Listen',
        commands: [
            { phrase: WAKE_PHRASE, description: 'Activar escucha para comando de voz' },
            { phrase: '"FLU escucha" / "FLU listen"', description: 'Abrir micrófono para escuchar' },
            { phrase: '"FLU silence" / "FLU silencio"', description: 'Cerrar micrófono temporalmente' },
        ],
    },
    {
        category: 'Conversation',
        commands: [
            { phrase: '"FLU participa" / "FLU join"', description: 'FLU se une activamente a la conversación' },
            { phrase: '"Iniciar conversación" / "Start conversation"', description: 'Iniciar una conversación con FLU' },
            { phrase: '"FLU adelante" / "FLU go ahead"', description: 'Conceder la palabra a FLU' },
        ],
    },
    {
        category: 'Minutes & Summary',
        commands: [
            { phrase: '"Generar minuta" / "Generate minutes"', description: 'Crear una minuta de la conversación' },
            { phrase: '"Guardar minuta" / "Save minutes"', description: 'Guardar la minuta actual' },
            { phrase: '"Resumir conversación" / "Summarize"', description: 'Generar resumen de la conversación' },
        ],
    },
    {
        category: 'Workspace',
        commands: [
            { phrase: '"Mostrar imagen" / "Show image"', description: 'Generar una imagen en el workspace' },
            { phrase: '"Crear diagrama" / "Create diagram"', description: 'Crear un diagrama en el workspace' },
            { phrase: '"Modelo 3D" / "3D model"', description: 'Generar un modelo 3D' },
        ],
    },
];

// -----------------------------------------------------------
// Component
// -----------------------------------------------------------

interface VoiceCommandHelpProps {
    language?: 'es' | 'en';
}

export function VoiceCommandHelp({ language = 'es' }: VoiceCommandHelpProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredGroups = useMemo(() => {
        if (!searchQuery.trim()) return COMMAND_GROUPS;

        const query = searchQuery.toLowerCase();
        return COMMAND_GROUPS
            .map((group) => ({
                ...group,
                commands: group.commands.filter(
                    (cmd) =>
                        cmd.phrase.toLowerCase().includes(query) ||
                        cmd.description.toLowerCase().includes(query),
                ),
            }))
            .filter((group) => group.commands.length > 0);
    }, [searchQuery]);

    if (!isOpen) {
        return (
            <button
                className="voice-command-help-trigger"
                onClick={() => setIsOpen(true)}
                title={language === 'es' ? 'Comandos de voz disponibles' : 'Available voice commands'}
                style={{
                    position: 'fixed',
                    bottom: 16,
                    right: 16,
                    zIndex: 1000,
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'var(--accent-color, #4a90d9)',
                    color: '#fff',
                    fontSize: 20,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
                aria-label={language === 'es' ? 'Ayuda de comandos de voz' : 'Voice command help'}
            >
                ⌨
            </button>
        );
    }

    return (
        <div
            className="voice-command-help-panel"
            style={{
                position: 'fixed',
                bottom: 72,
                right: 16,
                zIndex: 1000,
                width: 360,
                maxHeight: '70vh',
                background: 'var(--bg-color, #1e1e2e)',
                border: '1px solid var(--border-color, #444)',
                borderRadius: 12,
                boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border-color, #444)',
                }}
            >
                <h3 style={{ margin: 0, fontSize: 16 }}>
                    {language === 'es' ? 'Comandos de Voz' : 'Voice Commands'}
                </h3>
                <button
                    onClick={() => setIsOpen(false)}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-color, #ccc)',
                        cursor: 'pointer',
                        fontSize: 18,
                        padding: 4,
                    }}
                    aria-label="Close"
                >
                    ✕
                </button>
            </div>

            {/* Search */}
            <div style={{ padding: '8px 16px' }}>
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={language === 'es' ? 'Buscar comandos...' : 'Search commands...'}
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border-color, #444)',
                        background: 'var(--input-bg, #2a2a3e)',
                        color: 'var(--text-color, #eee)',
                        fontSize: 13,
                        boxSizing: 'border-box',
                    }}
                    autoFocus
                />
            </div>

            {/* Command Groups */}
            <div
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '0 16px 16px',
                }}
            >
                {filteredGroups.length === 0 ? (
                    <p style={{ color: 'var(--text-muted, #888)', textAlign: 'center', padding: 24 }}>
                        {language === 'es' ? 'No se encontraron comandos' : 'No commands found'}
                    </p>
                ) : (
                    filteredGroups.map((group) => (
                        <div key={group.category} style={{ marginTop: 12 }}>
                            <h4
                                style={{
                                    margin: '0 0 8px',
                                    fontSize: 12,
                                    textTransform: 'uppercase',
                                    color: 'var(--text-muted, #888)',
                                    letterSpacing: 1,
                                }}
                            >
                                {group.category}
                            </h4>
                            {group.commands.map((cmd) => (
                                <div
                                    key={cmd.phrase}
                                    style={{
                                        padding: '8px 12px',
                                        marginBottom: 4,
                                        borderRadius: 8,
                                        background: 'var(--item-bg, #2a2a3e)',
                                        border: '1px solid var(--border-subtle, #333)',
                                    }}
                                >
                                    <code
                                        style={{
                                            fontSize: 13,
                                            color: 'var(--accent-color, #4a90d9)',
                                            fontWeight: 600,
                                        }}
                                    >
                                        {cmd.phrase}
                                    </code>
                                    <p
                                        style={{
                                            margin: '4px 0 0',
                                            fontSize: 12,
                                            color: 'var(--text-muted, #aaa)',
                                        }}
                                    >
                                        {cmd.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
