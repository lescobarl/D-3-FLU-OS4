// ============================================================
// ErrorBoundary — Captura errores de renderizado en el árbol
// de componentes de React, evitando que un crash en un
// componente hijo derribe toda la aplicación.
// ============================================================

import React, { Component } from 'react';

interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('[ErrorBoundary] Error capturado:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="app-error-boundary">
                    <h1>⚠️ Error de Renderizado</h1>
                    <div className="app-error-boundary__details">
                        <pre className="app-error-boundary__message">
                            {this.state.error?.message || 'Error desconocido'}
                        </pre>
                        <pre className="app-error-boundary__stack">
                            {this.state.error?.stack || ''}
                        </pre>
                    </div>
                    <button
                        className="app-error-boundary__reload"
                        onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
                    >
                        🔄 Recargar página
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
