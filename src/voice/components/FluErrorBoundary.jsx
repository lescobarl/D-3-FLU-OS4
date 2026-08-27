import { Component } from 'react'

export class FluErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[Flu][ui-boundary]', error, info?.componentStack)
    }
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flu-shell flu-shell--error">
          <header className="flu-shell__hero">
            <h1 style={{ margin: 0, fontSize: '1.1rem' }}>Flu Voz encontró un error de interfaz</h1>
            <p style={{ margin: '8px 0 0', color: 'var(--text-soft)' }}>
              La sesión no se borró por completo. Recarga la página (Ctrl+Shift+R) e intenta de nuevo.
            </p>
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                background: 'rgba(0,0,0,0.35)',
                overflow: 'auto',
                fontSize: '0.78rem',
              }}
            >
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <button
              type="button"
              className="voice-bar__button"
              style={{ marginTop: 12 }}
              onClick={() => window.location.reload()}
            >
              Recargar
            </button>
          </header>
        </main>
      )
    }
    return this.props.children
  }
}
