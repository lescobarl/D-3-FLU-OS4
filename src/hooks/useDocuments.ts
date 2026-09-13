// ============================================================
// useDocuments — Historial de documentos/imágenes por usuario
// ------------------------------------------------------------
// Expone la lista del usuario activo y agrega/elimina registros. Toda fila se
// sella con `personId` del alcance, de modo que un usuario no vea lo de otro.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { fluDb, type DocumentRecord } from '../core/db/fluDatabase';
import {
  createDocumentsService,
  type DocumentsService,
  type NewDocumentInput,
} from '../core/documents/documentsService';

export interface UseDocumentsOptions {
  /** Usuario activo: aísla el historial por usuario. */
  participantId?: string;
}

export interface UseDocumentsResult {
  documents: DocumentRecord[];
  loading: boolean;
  refresh: () => Promise<void>;
  add: (input: NewDocumentInput) => Promise<DocumentRecord | null>;
  remove: (id: string) => Promise<boolean>;
  service: DocumentsService;
}

export function useDocuments({ participantId }: UseDocumentsOptions = {}): UseDocumentsResult {
  const serviceRef = useRef<DocumentsService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createDocumentsService({ db: fluDb.documents, now: () => Date.now() });
  }
  const service = serviceRef.current;
  const scope = participantId || 'global';

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setDocuments(await service.list(scope));
    } catch (err) {
      console.error('[useDocuments] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service, scope]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const add = useCallback(
    async (input: NewDocumentInput): Promise<DocumentRecord | null> => {
      const record = await service.add({
        ...input,
        personId: input.personId || (scope !== 'global' ? scope : undefined),
      });
      if (record) await refresh();
      return record;
    },
    [service, refresh, scope],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const ok = await service.remove(id);
      if (ok) await refresh();
      return ok;
    },
    [service, refresh],
  );

  return { documents, loading, refresh, add, remove, service };
}
