/**
 * downloadFile.ts — DUENO UNICO de "descargar un Blob o una URL por un enlace temporal".
 *
 * POR QUE EXISTE (auditoria 2026-10-09, P9.43): el patron completo (Blob + createObjectURL +
 * <a download> + click + revoke) estaba escrito en dos componentes, cada uno con su propio
 * revoke (uno inmediato, otro con retardo).
 *
 * AMPLIADO (auditoria 2026-11-01): las ramas de URL remota/data URL tambien vivian
 * duplicadas en DocumentsHistoryPanel y GenerationProgressPanel. `downloadUrl` es el
 * dueño de ese ancla; ningun consumidor vuelve a asignar `.download`.
 */

/**
 * Descarga un Blob con el nombre indicado.
 * @param blob contenido a guardar
 * @param fileName nombre del fichero
 * @param revokeDelayMs si se pasa, revoca la URL con ese retardo (descargas grandes)
 */
export function downloadBlob(blob: Blob, fileName: string, revokeDelayMs?: number): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  if (revokeDelayMs === undefined) {
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
}

/** Opciones del ancla de descarga por URL. */
export interface DownloadUrlOptions {
  /** Abre en pestaña nueva (URL remota): target=_blank + rel=noopener. */
  newTab?: boolean;
}

/**
 * Descarga una URL ya resuelta (remota o data URL) con un ancla temporal.
 * Dueno unico del ancla de descarga por URL; no crea object URLs.
 * @param href URL remota o data URL
 * @param fileName nombre de descarga
 * @param options `newTab` para abrir una URL remota en pestaña nueva
 */
export function downloadUrl(href: string, fileName: string, options: DownloadUrlOptions = {}): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  if (options.newTab) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  link.click();
}
