/**
 * downloadFile.ts — DUENO UNICO de "descargar un Blob por un enlace temporal".
 *
 * POR QUE EXISTE (auditoria 2026-10-09, P9.43): el patron completo (Blob + createObjectURL +
 * <a download> + click + revoke) estaba escrito en dos componentes, cada uno con su propio
 * revoke (uno inmediato, otro con retardo).
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
