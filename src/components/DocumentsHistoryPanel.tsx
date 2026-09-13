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
 * Descarga el artefacto REAL guardado de un documento/carta generado.
 * Los serializadores binarios (PDF/DOCX/XLSX/PPTX) devuelven el archivo como
 * data URL base64 en `contenido`; los de texto plano devuelven el texto con un
 * `blob:` URL. Aquí se respetan ambos casos para no corromper la descarga.
 * Así la carta es recuperable aunque se limpie el panel o se recargue la app.
 */
function downloadDocumentContent(doc: DocumentRecord): void {
  const content = String(doc.contenido || '');
  if (!content) return;
  const isDataUrl = /^data:/i.test(content);
  const href = isDataUrl
    ? content
    : URL.createObjectURL(new Blob([content], { type: doc.mime || 'text/plain;charset=utf-8' }));
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
  const ui = (FLU_CONFIG as any).documents?.ui || {};
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
                    {doc.ref ? ` · ${doc.ref}` : ''}
                  </span>
                </div>
                {onRemove || doc.contenido ? (
                  <div className="flu-reminders-item__actions">
                    {doc.contenido ? (
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
