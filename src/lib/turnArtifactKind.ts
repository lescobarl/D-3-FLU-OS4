// ============================================================
// turnArtifactKind — Tipo de objeto que PRODUCE un turno en el Pizarrón
// ------------------------------------------------------------
// Dueño único del criterio. Lo consumen dos cosas que deben coincidir:
//   1. La limpieza por turno: el turno solo reemplaza el objeto del tipo que
//      él mismo produce; un turno de otro tipo NO borra el último objeto de
//      los demás (video / imagen / todo).
//   2. El foco del feed: la pestaña a la que salta el resultado del turno.
// Mientras vivió recopiado dentro de App, editar una copia hacía divergir el
// foco de la limpieza en silencio.
//
// 'text' = respuesta conversacional: no tiene objeto propio (el Pizarrón la
// pinta desde `latestResponse`), así que no reemplaza a ningún otro tipo.
// ============================================================
import { isVisualWorkspaceTipo } from '../core/config/sharedConfig';

export type TurnArtifactKind = 'video' | 'doc' | 'image' | 'text';

/** `workspaceTipo` = tipo del contrato de Gemini; `navComando` = comando de
 *  navegación determinista (GENERAR_VIDEO / GENERAR_DOCUMENTO), que produce
 *  el tipo sin contrato. Prioridad: video > doc > visual > texto. */
export function resolveTurnArtifactKind(
    workspaceTipo?: unknown,
    navComando?: unknown,
): TurnArtifactKind {
    const tipo = String(workspaceTipo || '').trim().toLowerCase();
    const comando = String(navComando || '').toUpperCase();
    if (tipo === 'video' || comando === 'GENERAR_VIDEO') return 'video';
    if (tipo === 'doc' || comando === 'GENERAR_DOCUMENTO') return 'doc';
    if (isVisualWorkspaceTipo(tipo)) return 'image';
    return 'text';
}
