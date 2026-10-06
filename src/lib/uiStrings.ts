import { pickLabel } from './textUtils';

/**
 * uiStrings — FUENTE UNICA de las cadenas de UI bilingues (Anexo B8).
 *
 * Antes cada modulo elegia idioma con su propio ternario
 * (`lang === 'en' ? 'EN' : 'ES'`), escrito de una linea o partido en tres,
 * repetido fichero a fichero: el mismo texto vivia en varios sitios y la
 * eleccion de idioma se re-implementaba en cada uno. Aqui vive el texto; quien
 * resuelve el idioma es pickLabel (src/lib/textUtils.ts), el resolutor canonico
 * de rotulos { es, en }.
 *
 * Guard: tests/uiStringsSingleOwnerGuard.test.ts.
 */
export const UI_STRINGS = {
    actualizado: { es: 'Actualizado.', en: 'Updated.' },
    ambos: { es: 'Ambos', en: 'English' },
    analiza_esta_imagen_de_una_tarea_escolar_e: { es: 'Analiza esta imagen de una tarea escolar. Extrae en formato JSON:\\n- materia: la materia (matematicas, espanol, ciencias, etc.)\\n- problemas: lista de problemas o preguntas\\n- instrucciones: instrucciones generales de la tarea\\n- nivel: nivel educativo (primaria, secundaria, preparatoria)\\n- texto_extraido: todo el texto que puedas leer en la imagen\\n\\nResponde SOLO con el JSON, sin markdown ni explicaciones.', en: 'Analyze this homework image. Extract in JSON format:\\n- materia: subject (math, science, etc.)\\n- problemas: list of problems/questions\\n- instrucciones: general instructions\\n- nivel: education level (elementary, middle, high)\\n- texto_extraido: all readable text\\n\\nRespond with ONLY the JSON, no markdown.' },
    analiza_esta_imagen_extrae_en_formato_json: { es: 'Analiza esta imagen. Extrae en formato JSON:\\n- materia: tema o área principal\\n- problemas: lista de objetivos o metas\\n- instrucciones: observaciones de coaching\\n- nivel: nivel o etapa actual\\n- texto_extraido: todo el texto legible\\n\\nResponde SOLO con el JSON, sin markdown ni explicaciones.', en: 'Analyze this image. Extract in JSON format:\\n- materia: main topic or theme\\n- problemas: list of goals or objectives\\n- instrucciones: coaching observations\\n- nivel: current level or stage\\n- texto_extraido: all readable text\\n\\nRespond with ONLY the JSON, no markdown.' },
    analiza_este_documento_imagen_laboral_extr: { es: 'Analiza este documento/imagen laboral. Extrae en formato JSON:\\n- materia: tipo de documento (reporte, contrato, etc.)\\n- problemas: lista de puntos clave o acciones requeridas\\n- instrucciones: resumen de acciones necesarias\\n- nivel: nivel de prioridad\\n- texto_extraido: todo el texto legible\\n\\nResponde SOLO con el JSON, sin markdown ni explicaciones.', en: 'Analyze this work document/image. Extract in JSON format:\\n- materia: document type (report, contract, etc.)\\n- problemas: list of key points or action items\\n- instrucciones: summary of required actions\\n- nivel: priority level\\n- texto_extraido: all readable text\\n\\nRespond with ONLY the JSON, no markdown.' },
    api_key_configurada: { es: 'API key configurada', en: 'API key configured' },
    api_key_no_configurada_configurala_en_el_p: { es: 'API key no configurada. Configúrala en el panel de ajustes.', en: 'API key not configured. Set it in the settings panel.' },
    api_key_opcional: { es: 'API Key (opcional)', en: 'API Key (optional)' },
    api_key_opcional_para_servicio_de_imagen: { es: 'API key opcional para servicio de imagen', en: 'Optional API key for image service' },
    bailar: { es: 'bailar', en: 'dance' },
    bajar_las_orejas_orejas_hacia_atras: { es: 'bajar las orejas / orejas hacia atrás', en: 'lower ears / ears back' },
    barato_fal_ai_wan_25_preview_text_to_video: { es: 'Barato: fal-ai/wan-25-preview/text-to-video ($0.05/s). Veo3 cuesta $0.40/s.', en: 'Cheap: fal-ai/wan-25-preview/text-to-video ($0.05/s). Veo3 costs $0.40/s.' },
    cadena_de_busqueda_web_tavily_openrouter_w: { es: 'Cadena de búsqueda web: Tavily → OpenRouter → Wikipedia. Las claves se guardan en la configuración del buscador (misma fuente que el Centro de Control).', en: 'Web search chain: Tavily → OpenRouter → Wikipedia. Keys are stored in the search settings (same source as the Search Control Center).' },
    calendario_pendiente: { es: 'Calendario pendiente', en: 'Pending calendar' },
    caminar: { es: 'caminar', en: 'walk' },
    caminar_sigilosamente: { es: 'caminar sigilosamente', en: 'sneaky walk' },
    clave_api_de_fal_ai: { es: 'Clave API de fal.ai', en: 'fal.ai API key' },
    clave_api_de_openrouter_busqueda_web: { es: 'Clave API de OpenRouter (búsqueda web)', en: 'OpenRouter API key (web search)' },
    conversacion_vacia: { es: '(conversación vacía)', en: '(empty conversation)' },
    correr: { es: 'correr', en: 'run' },
    ej_comportate_mas_expresivo_usa_estas_anim: { es: 'Ej: compórtate más expresivo, usa estas animaciones, sé amable...', en: 'e.g. Be more expressive, use animations, be kind...' },
    eres_flu_un_asistente_de_generacion_de_doc: { es: 'Eres FLU, un asistente de generación de documentos. Produce contenido preciso y ejecutivo siguiendo exactamente el formato solicitado.', en: 'You are FLU, a document-generation assistant. Produce precise, executive content following the requested format exactly.' },
    eres_un_analista_de_documentos_responde_un: { es: 'Eres un analista de documentos. Responde únicamente en español.', en: 'You are a document analyst. Respond in English only.' },
    eres_un_analista_de_documentos_responde_un_2: { es: 'Eres un analista de documentos. Responde únicamente en español. Devuelve JSON válido.', en: 'You are a document analyst. Respond in English only. Return valid JSON.' },
    ese_evento_ya_existe: { es: 'Ese evento ya existe.', en: 'That item already exists.' },
    estas_instrucciones_se_inyectan_en_el_prom: { es: 'Estas instrucciones se inyectan en el prompt del sistema de Gemini al inicio de cada sesión.', en: 'These instructions are injected into Gemini\'s system prompt at the start of each session.' },
    formato_invalido_responde_solo_con_un_obje: { es: 'FORMATO INVÁLIDO. Responde SOLO con un objeto JSON que incluya el campo "respuesta_voz" (texto no vacío). Sin texto fuera del JSON.', en: 'INVALID FORMAT. Reply with ONLY a JSON object that includes a non-empty "respuesta_voz" string. No text outside the JSON.' },
    gemini_acceso_denegado_403: { es: 'Gemini: acceso denegado (403).', en: 'Gemini: access denied (403).' },
    gemini_api_key_dedicada: { es: 'Gemini API Key (dedicada)', en: 'Gemini API Key (dedicated)' },
    gemini_cuota_agotada_429: { es: 'Gemini: cuota agotada (429).', en: 'Gemini: quota exceeded (429).' },
    gemini_el_servicio_de_ia_tardo_demasiado_e: { es: 'Gemini: el servicio de IA tardó demasiado en responder. Espera un momento y reintenta.', en: 'Gemini: the AI service took too long to respond. Wait a moment and retry.' },
    gemini_falta_la_api_key: { es: 'Gemini: falta la API key.', en: 'Gemini: missing API key.' },
    gemini_la_conexion_con_el_servicio_de_ia_s: { es: 'Gemini: la conexión con el servicio de IA se interrumpió. Verifica que el servidor esté activo (npm run dev), reintenta y revisa la API key en ajustes.', en: 'Gemini: the connection to the AI service was interrupted. Check that the dev server is running (npm run dev), retry, and verify the API key in settings.' },
    gemini_no_se_pudo_conectar_con_el_servidor: { es: 'Gemini: no se pudo conectar con el servidor de IA. Si acabas de reiniciarlo, recarga la página (F5) para reconectar.', en: 'Gemini: could not reach the AI server. If you just restarted it, reload the page (F5) to reconnect.' },
    gemini_respuesta_invalida: { es: 'Gemini: respuesta inválida.', en: 'Gemini: invalid response.' },
    generado_sin_ia_respaldo_sin_conexion: { es: 'Generado sin IA (respaldo sin conexión).', en: 'Generated without AI (offline fallback).' },
    la_minuta_es_un_acta_de_acuerdos_no_una_re: { es: 'La minuta es un acta de acuerdos, no una respuesta al usuario.', en: 'The summary is a meeting minute, not a reply to the user.' },
    la_transcripcion_sigue_funcionando_revisa_: { es: 'La transcripción sigue funcionando. Revisa la API key, la cuota y la consola del navegador (F12).', en: 'Voice capture still works. Check your API key, quota, and browser console (F12).' },
    limpiar_cache_de_la_app_y_recargar_se_cons: { es: '¿Limpiar caché de la app y recargar? Se conservarán tu API key y ajustes esenciales.', en: 'Clear app cache and reload? Your API key and essential settings will be kept.' },
    limpiar_cache_y_recargar: { es: 'Limpiar caché y recargar', en: 'Clear cache & reload' },
    listo_borre_todas_tus_notas: { es: 'Listo, borré todas tus notas.', en: 'Done, I cleared all your notes.' },
    listo_hablame_cuando_quieras: { es: '¡Listo! Háblame cuando quieras.', en: 'Done! Talk to me whenever you want.' },
    listo_he_guardado_tu_entrada_del_diario: { es: 'Listo, he guardado tu entrada del diario.', en: 'Done, I saved your diary entry.' },
    listo_lo_agregue_a_las_notas: { es: 'Listo, lo agregué a las notas.', en: 'Done, I added it to your notes.' },
    listo_lo_quite_de_las_notas: { es: 'Listo, lo quité de las notas.', en: 'Done, I removed it from your notes.' },
    listo_vacie_tu_agenda: { es: 'Listo, vacié tu agenda.', en: 'Done, cleared your agenda.' },
    listo_ya_tengo_los_resultados_los_tenes_en: { es: 'Listo, ya tengo los resultados. Los tenés en la pestaña Buscar.', en: 'Done, I already have the results. They are in the Search tab.' },
    minuta_de_conversacion: { es: 'Minuta de conversacion', en: 'Conversation minutes' },
    modelo: { es: 'Modelo', en: 'Model' },
    modelo_de_openrouter_busqueda_web: { es: 'Modelo de OpenRouter (búsqueda web)', en: 'OpenRouter model (web search)' },
    modelo_de_video_fal_ai: { es: 'Modelo de video (fal.ai)', en: 'Video model (fal.ai)' },
    mostrar_ocultar: { es: 'Mostrar/Ocultar', en: 'Show/Hide' },
    no_encontre_esa_nota: { es: 'No encontré esa nota.', en: 'I couldn\'t find that note.' },
    no_encontre_nada_que_cambiar: { es: 'No encontré nada que cambiar.', en: 'Nothing to update.' },
    no_encontre_nada_que_cancelar: { es: 'No encontré nada que cancelar.', en: 'Nothing to cancel.' },
    no_habia_nada_que_borrar: { es: 'No había nada que borrar.', en: 'There\'s nothing to clear.' },
    no_habia_nada_que_vaciar: { es: 'No había nada que vaciar.', en: 'There\'s nothing to clear.' },
    no_pude_actualizar_la_nota: { es: 'No pude actualizar la nota.', en: 'I couldn\'t update the note.' },
    no_pude_crear_la_nota: { es: 'No pude crear la nota.', en: 'I couldn\'t create the note.' },
    no_pude_crearlo: { es: 'No pude crearlo.', en: 'I couldn\'t create it.' },
    no_pude_guardar_la_entrada_del_diario: { es: 'No pude guardar la entrada del diario.', en: 'I couldn\'t save the diary entry.' },
    opcional_gemini_api_key_nativa: { es: 'Opcional: Gemini API key nativa', en: 'Optional: Gemini native API key' },
    opcional_openrouter_api_key: { es: 'Opcional: OpenRouter API key', en: 'Optional: OpenRouter API key' },
    orejas_hacia_adelante_orejas_arriba: { es: 'orejas hacia adelante / orejas arriba', en: 'ears forward / ears up' },
    para_cuando_te_lo_recuerdo_dime_la_hora_po: { es: '¿Para cuándo te lo recuerdo? Dime la hora, por favor.', en: 'When should I remind you? Tell me the time, please.' },
    parpadeo_cerrar_los_ojos: { es: 'parpadeo / cerrar los ojos', en: 'blink / close eyes' },
    recordatorio: { es: 'Recordatorio', en: 'Reminder' },
    recordatorios_pendientes: { es: 'Recordatorios pendientes', en: 'Pending reminders' },
    registre_las_entradas_del_horario: { es: 'Registré las entradas del horario.', en: 'I registered the schedule entries.' },
    responde_solo_en_json_valido_sin_markdown_: { es: 'Responde SOLO en JSON valido sin markdown, sin viñetas y sin texto adicional.', en: 'Respond ONLY in valid JSON, without markdown, bullet points or any extra text.' },
    responde_unicamente_en_espanol: { es: 'Responde únicamente en español.', en: 'Respond in English only.' },
    revisa_que_la_api_key_sea_correcta: { es: 'Revisa que la API key sea correcta.', en: 'Check that your API key is correct.' },
    saltar_en_su_lugar: { es: 'saltar en su lugar', en: 'jump in place' },
    saltar_mientras_corre: { es: 'saltar mientras corre', en: 'jump while running' },
    se_conciso_factual_y_fiel_al_registro_de_c: { es: 'Se conciso, factual y fiel al registro de conversacion. No inventes participantes ni acuerdos.', en: 'Be concise, factual and grounded in the conversation log. Do not invent participants or agreements.' },
    si_esta_vacia_se_usa_la_api_key_de_openrou: { es: 'Si está vacía, se usa la API key de OpenRouter. La imagen se genera via OpenRouter con el modelo más barato (google/gemini-2.5-flash-image) y se activa automáticamente cuando hay una clave configurada.', en: 'If empty, falls back to the OpenRouter key. Image fallback is generated via OpenRouter using the cheapest model (google/gemini-2.5-flash-image) and activates automatically when a key is set.' },
    sin_clave_la_generacion_de_video_produce_s: { es: 'Sin clave, la generación de video produce solo guion/storyboard (no video real).', en: 'Without a key, video generation produces only script/storyboard.' },
    tu_lista_de_compras_esta_vacia: { es: 'Tu lista de compras está vacía.', en: 'Your shopping list is empty.' },
    url_de_api: { es: 'URL de API', en: 'API URL' },
    actualice_label: { es: 'Actualicé "{label}".', en: 'Updated "{label}".' },
    cancelado_scoped: { es: 'Cancelado{scoped}.', en: 'Cancelled{scoped}.' },
    contexto_de_documento_subido_por_el_usua: { es: '[Contexto de documento subido por el usuario: {texto_extraido}]', en: '[Document context uploaded by user: {texto_extraido}]' },
    contexto_de_documento_subido_por_el_usua_2: { es: '[Contexto de documento subido por el usuario: {ctx}]', en: '[Document context uploaded by user: {ctx}]' },
    contexto_de_imagen_subida_por_el_usua: { es: '[Contexto de imagen subida por el usuario: {ctx}]', en: '[Image context uploaded by user: {ctx}]' },
    contexto_de_documento_generado_por_flu: { es: '[Documento generado por FLU: {ctx}]', en: '[Document generated by FLU: {ctx}]' },
    de_nivel_nivel: { es: 'de nivel {nivel}', en: 'at {nivel} level' },
    el_dd_mm_yyyy_a_las_time: { es: 'el {dd}/{mm}/{yyyy} a las {time}', en: 'on {yyyy}-{mm}-{dd} at {time}' },
    encontre_length_elementos: { es: 'Encontré {length} elementos.', en: 'I found {length} items.' },
    error_http_de_gemini_status: { es: 'Error HTTP de Gemini ({status}).', en: 'Gemini HTTP error {status}.' },
    hoy_a_las_time: { es: 'hoy a las {time}', en: 'today at {time}' },
    label_no_esta_en_la_lista_de_compras: { es: '"{label}" no está en la lista de compras.', en: '"{label}" is not on the shopping list.' },
    lista_de_compras_lines: { es: 'Lista de compras: {lines}', en: 'Shopping list: {lines}' },
    listo_guarde_en_tu_diario_content: { es: 'Listo, guardé en tu diario: "{content}".', en: 'Done, I saved your diary entry: "{content}".' },
    listo_quite_item_de_la_lista: { es: 'Listo, quité {item} de la lista.', en: 'Done, I removed {item} from the list.' },
    manana_a_las_time: { es: 'mañana a las {time}', en: 'tomorrow at {time}' },
    no_encontre_item_en_la_lista: { es: 'No encontré "{item}" en la lista.', en: 'I couldn\'t find "{item}" in the list.' },
    no_tengo_a_name_en_tus_contactos: { es: 'No tengo a {name} en tus contactos.', en: 'I don\'t have {name} in your contacts.' },
    no_tengo_correo_de_name: { es: 'No tengo correo de {name}.', en: 'I don\'t have an email for {name}.' },
    no_tengo_telefono_de_name: { es: 'No tengo teléfono de {name}.', en: 'I don\'t have a phone number for {name}.' },
    quite_label_de_la_lista_de_compras: { es: 'Quité "{label}" de la lista de compras.', en: 'Removed "{label}" from the shopping list.' },
    sobre_materia: { es: 'sobre {materia}', en: 'about {materia}' },
} as const;

export type UiStringKey = keyof typeof UI_STRINGS;

/** Texto de UI en el idioma activo. Soporta marcadores {nombre} via params. */
export function pickText(
    language: string,
    key: UiStringKey,
    params?: Record<string, string | number>,
): string {
    const labels = UI_STRINGS[key];
    const texto: string = pickLabel(labels, language, labels.es);
    if (!params) return texto;
    return texto.replace(/\{(\w+)\}/g, (marcador, nombre) =>
        nombre in params ? String(params[nombre]) : marcador,
    );
}
