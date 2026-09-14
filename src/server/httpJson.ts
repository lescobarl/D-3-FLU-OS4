// ============================================================
// httpJson — Escritura JSON segura para los proxies de Vite
// ============================================================
// Dueño único del patrón "responder JSON sin tumbar el dev server":
// si el socket ya se cerró (el cliente navegó/recargó a mitad de
// petición), writeHead/end lanzan; como sendJson suele llamarse en un
// catch, ese throw se convertiría en una unhandled rejection. Nunca
// propagamos errores de escritura.
// ============================================================
import type { ServerResponse } from 'node:http';

/**
 * Responde `data` como JSON con `status`, tolerando sockets cerrados.
 * @param res Respuesta HTTP del middleware.
 * @param status Código HTTP a enviar.
 * @param data Cuerpo serializable a JSON.
 * @param label Prefijo de log si la escritura falla (preserva el origen).
 * @param contentType Content-Type a declarar (por defecto UTF-8).
 */
export function sendJson(
    res: ServerResponse,
    status: number,
    data: unknown,
    label: string,
    contentType: string = 'application/json; charset=utf-8',
): void {
    try {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, { 'Content-Type': contentType });
        res.end(JSON.stringify(data));
    } catch (err: any) {
        console.warn(label, err?.message || err);
    }
}
