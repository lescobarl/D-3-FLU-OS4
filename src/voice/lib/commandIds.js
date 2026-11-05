/**
 * commandIds.js — FUENTE UNICA del vocabulario de ids de comando de voz.
 *
 * AGENTS 4 ("una etiqueta, un sitio"): un conjunto de valores que debe coincidir
 * entre subsistemas se declara UNA vez y el resto lo importa. Aqui el id se
 * reescribia como literal entrecomillado en 10 ficheros (arbitro, filtro LLM,
 * listas de comandos, rutas, getCommandSpeech y claves del catalogo de locuciones)
 * — era P8.21.
 *
 * MODULO HOJA (no importa nada) a proposito: audioMath importa de aqui y
 * voiceCommands importa de audioMath, de modo que los ids NO pueden vivir en
 * voiceCommands (seria un ciclo). Al no importar nada, todos pueden importarlos.
 *
 * El id de arranque (`INICIAR_CONVERSACION`) sigue teniendo su dueno de CONFIG
 * (`FLU_CONFIG.navigation.sessionResetCommand`), que DERIVA de aqui: asi la
 * etiqueta se declara una sola vez y el consumidor la lee del config (P8.19).
 */

/** Ids de comando de voz. Un valor por etiqueta, congelado. */
export const COMMAND_IDS = Object.freeze({
  INICIAR_CONVERSACION: 'INICIAR_CONVERSACION',
  GENERAR_RESUMEN: 'GENERAR_RESUMEN',
  GUARDAR_MINUTA: 'GUARDAR_MINUTA',
  ABRIR_ESCUCHA: 'ABRIR_ESCUCHA',
  CERRAR_ESCUCHA: 'CERRAR_ESCUCHA',
  REGISTRAR_PARTICIPANTE: 'REGISTRAR_PARTICIPANTE',
  FLU_WAKE: 'FLU_WAKE',
  FLU_ADELANTE: 'FLU_ADELANTE',
  FLU_ADELANTE_EMPTY: 'FLU_ADELANTE_EMPTY',
  FLU_ESPERA: 'FLU_ESPERA',
  ANALIZAR_DOCUMENTO: 'ANALIZAR_DOCUMENTO',
  ANALIZAR_APP: 'ANALIZAR_APP',
  GENERAR_DOCUMENTO: 'GENERAR_DOCUMENTO',
  GENERAR_VIDEO: 'GENERAR_VIDEO',
  NAVEGAR: 'NAVEGAR',
  BUSCAR: 'BUSCAR',
  CONOCER_FLU: 'CONOCER_FLU',
})
