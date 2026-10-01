import { pickLabel } from './textUtils';

/**
 * uiStrings — FUENTE UNICA de las cadenas de UI bilingues (Anexo B8).
 *
 * Antes cada componente elegia idioma con un ternario propio
 * (`lang === 'en' ? 'EN' : 'ES'`), repetido fichero a fichero: el mismo texto
 * vivia en varios sitios y la eleccion de idioma se re-implementaba en cada uno.
 * Aqui vive el texto; quien resuelve el idioma es pickLabel
 * (src/lib/textUtils.ts), el resolutor canonico de rotulos { es, en }.
 *
 * Guard: tests/uiStringsSingleOwnerGuard.test.ts.
 */
export const UI_STRINGS = {
    actualizado: { es: 'Actualizado.', en: 'Updated.' },
    ambos: { es: 'Ambos', en: 'English' },
    api_key_configurada: { es: 'API key configurada', en: 'API key configured' },
    api_key_opcional: { es: 'API Key (opcional)', en: 'API Key (optional)' },
    api_key_opcional_para_servicio_de_imagen: { es: 'API key opcional para servicio de imagen', en: 'Optional API key for image service' },
    bailar: { es: 'bailar', en: 'dance' },
    bajar_las_orejas_orejas_hacia_atras: { es: 'bajar las orejas / orejas hacia atrás', en: 'lower ears / ears back' },
    calendario_pendiente: { es: 'Calendario pendiente', en: 'Pending calendar' },
    caminar: { es: 'caminar', en: 'walk' },
    caminar_sigilosamente: { es: 'caminar sigilosamente', en: 'sneaky walk' },
    clave_api_de_fal_ai: { es: 'Clave API de fal.ai', en: 'fal.ai API key' },
    conversacion_vacia: { es: '(conversación vacía)', en: '(empty conversation)' },
    correr: { es: 'correr', en: 'run' },
    ese_evento_ya_existe: { es: 'Ese evento ya existe.', en: 'That item already exists.' },
    gemini_acceso_denegado_403: { es: 'Gemini: acceso denegado (403).', en: 'Gemini: access denied (403).' },
    gemini_api_key_dedicada: { es: 'Gemini API Key (dedicada)', en: 'Gemini API Key (dedicated)' },
    gemini_cuota_agotada_429: { es: 'Gemini: cuota agotada (429).', en: 'Gemini: quota exceeded (429).' },
    gemini_falta_la_api_key: { es: 'Gemini: falta la API key.', en: 'Gemini: missing API key.' },
    gemini_respuesta_invalida: { es: 'Gemini: respuesta inválida.', en: 'Gemini: invalid response.' },
    limpiar_cache_y_recargar: { es: 'Limpiar caché y recargar', en: 'Clear cache & reload' },
    listo_borre_todas_tus_notas: { es: 'Listo, borré todas tus notas.', en: 'Done, I cleared all your notes.' },
    listo_lo_agregue_a_las_notas: { es: 'Listo, lo agregué a las notas.', en: 'Done, I added it to your notes.' },
    listo_lo_quite_de_las_notas: { es: 'Listo, lo quité de las notas.', en: 'Done, I removed it from your notes.' },
    listo_vacie_tu_agenda: { es: 'Listo, vacié tu agenda.', en: 'Done, cleared your agenda.' },
    minuta_de_conversacion: { es: 'Minuta de conversacion', en: 'Conversation minutes' },
    modelo: { es: 'Modelo', en: 'Model' },
    modelo_de_video_fal_ai: { es: 'Modelo de video (fal.ai)', en: 'Video model (fal.ai)' },
    mostrar_ocultar: { es: 'Mostrar/Ocultar', en: 'Show/Hide' },
    no_encontre_esa_nota: { es: 'No encontré esa nota.', en: 'I couldn\'t find that note.' },
    no_encontre_nada_que_cambiar: { es: 'No encontré nada que cambiar.', en: 'Nothing to update.' },
    no_encontre_nada_que_cancelar: { es: 'No encontré nada que cancelar.', en: 'Nothing to cancel.' },
    no_habia_nada_que_borrar: { es: 'No había nada que borrar.', en: 'There\'s nothing to clear.' },
    no_habia_nada_que_vaciar: { es: 'No había nada que vaciar.', en: 'There\'s nothing to clear.' },
    no_pude_actualizar_la_nota: { es: 'No pude actualizar la nota.', en: 'I couldn\'t update the note.' },
    no_pude_crearlo: { es: 'No pude crearlo.', en: 'I couldn\'t create it.' },
    opcional_gemini_api_key_nativa: { es: 'Opcional: Gemini API key nativa', en: 'Optional: Gemini native API key' },
    opcional_openrouter_api_key: { es: 'Opcional: OpenRouter API key', en: 'Optional: OpenRouter API key' },
    orejas_hacia_adelante_orejas_arriba: { es: 'orejas hacia adelante / orejas arriba', en: 'ears forward / ears up' },
    parpadeo_cerrar_los_ojos: { es: 'parpadeo / cerrar los ojos', en: 'blink / close eyes' },
    recordatorio: { es: 'Recordatorio', en: 'Reminder' },
    recordatorios_pendientes: { es: 'Recordatorios pendientes', en: 'Pending reminders' },
    registre_las_entradas_del_horario: { es: 'Registré las entradas del horario.', en: 'I registered the schedule entries.' },
    responde_unicamente_en_espanol: { es: 'Responde únicamente en español.', en: 'Respond in English only.' },
    saltar_en_su_lugar: { es: 'saltar en su lugar', en: 'jump in place' },
    saltar_mientras_corre: { es: 'saltar mientras corre', en: 'jump while running' },
    url_de_api: { es: 'URL de API', en: 'API URL' },
} as const;

export type UiStringKey = keyof typeof UI_STRINGS;

/** Texto de UI en el idioma activo. */
export function pickText(language: string, key: UiStringKey): string {
    const labels = UI_STRINGS[key];
    return pickLabel(labels, language, labels.es);
}
