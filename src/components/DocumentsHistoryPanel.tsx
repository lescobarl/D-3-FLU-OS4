// ============================================================
// DocumentsHistoryPanel — Listado de documentos generados/cargados
// ------------------------------------------------------------
// Presentacional: muestra el historial del usuario activo (ya filtrado por
// `useDocuments`). Etiquetas vía FLU_CONFIG (sin hardcode).
// ============================================================
import { pickLabel } from '../lib/textUtils';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import type { DocumentRecord } from '../core/db/fluDatabase';

export interface DocumentsHistoryPanelProps {
  documents: DocumentRecord[];
  loading: boolean;
  onRemove?: (id: string) => void;
  language?: string;
}

/**
 * Descarga/abre el artefacto apuntado por la entrada del Historial.
 * Prioridad: `ref` (puntero a URL remota del video/imagen, o data URL) y, si
 * no hay, `contenido` (data URL del PDF o texto). Respeta data URLs base64 para
 * no corromper la descarga. Así la carta/video/imagen es recuperable aunque se
 * limpie el panel o se recargue la app.
 */
export function downloadDocumentContent(doc: DocumentRecord): void {
  const pointer = String(doc.ref || '').trim();
  const content = String(doc.contenido || '');
  const source = pointer || content;
  if (!source) return;
  // URL remota (video/imagen): se abre/descarga directo.
  if (/^https?:/i.test(source)) {
    const anchor = document.createElement('a');
    anchor.href = source;
    anchor.download = doc.nombre || doc.titulo || 'documento';
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.click();
    return;
  }
  const isDataUrl = /^data:/i.test(source);
  const href = isDataUrl
    ? source
    : URL.createObjectURL(new Blob([source], { type: doc.mime || 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = doc.nombre || doc.titulo || 'documento';
  anchor.click();
  if (!isDataUrl) setTimeout(() => URL.revokeObjectURL(href), 5000);
}

export function DocumentsHistoryPanel({
  documents,
  loading,
  onRemove,
  language = 'es',
}: DocumentsHistoryPanelProps) {
  const ui = FLU_CONFIG.documents?.ui || {};
  const title = pickLabel(ui.title, language, 'Historial');

  return (
    <section className="flu-settings-section" data-testid="documents-history">
      <div className="flu-settings-section__body">
        <h4 className="flu-reminders__heading">{title}</h4>
        {loading ? (
          <p className="flu-settings-image-config__hint">…</p>
        ) : documents.length === 0 ? (
          <p className="flu-settings-image-config__hint">
            {pickLabel(ui.empty, language, 'Sin documentos.')}
          </p>
        ) : (
          <ul className="flu-reminders-list" data-testid="documents-history-list">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flu-reminders-item"
                data-testid={`document-item-${doc.id}`}
                data-kind={doc.kind}
              >
                <div className="flu-reminders-item__info">
                  <span className="flu-reminders-item__text">
                    {doc.kind === 'generated' ? '🧩' : '📎'} {doc.titulo}
                  </span>
                  <span className="flu-reminders-item__when">
                    {doc.formato}
                    {doc.ref && /^https?:/i.test(doc.ref) ? ` · ${doc.ref.slice(0, 40)}` : ''}
                  </span>
                </div>
                {onRemove || doc.contenido || doc.ref ? (
                  <div className="flu-reminders-item__actions">
                    {doc.contenido || doc.ref ? (
                      <button
                        type="button"
                        title={pickLabel(ui.downloadTitle, language, 'Descargar')}
                        aria-label={pickLabel(ui.downloadTitle, language, 'Descargar')}
                        data-testid={`document-download-${doc.id}`}
                        onClick={() => downloadDocumentContent(doc)}
                      >
                        ⬇️
                      </button>
                    ) : null}
                    {onRemove ? (
                      <button
                        type="button"
                        title={pickLabel(ui.removeTitle, language, 'Eliminar')}
                        aria-label={pickLabel(ui.removeTitle, language, 'Eliminar')}
                        data-testid={`document-remove-${doc.id}`}
                        onClick={() => onRemove(doc.id)}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DocumentsHistoryPanel;
