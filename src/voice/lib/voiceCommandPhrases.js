/**
 * Bloques de frases de `FLU_CONFIG.voiceCommands` que viven fuera de fluConfig.
 *
 * Motivo: fluConfig.js es un god-file con trinquete shrink-only (P6.6) y no puede
 * crecer. fluConfig importa estos bloques y los expone en `voiceCommands`, de modo
 * que siguen siendo la UNICA fuente para el resolver por voz, el catalogo humano
 * (selfKnowledge) y las pruebas.
 */

/**
 * Frases del comando 'restablecer colores del avatar'. Union de las formas ya
 * soportadas mas las declaradas: ninguna se pierde y ninguna vive en dos sitios.
 */
export const RESET_AVATAR_COLOR_PHRASES = [
  'restablecer colores',
  'restablecer colores del avatar',
  'restablecer colores de flu',
  'restablecer los colores del avatar',
  'restablece los colores',
  'restablece los colores del avatar',
  'resetear colores',
  'resetear colores del avatar',
  'resetea los colores del avatar',
  'reset avatar colors',
  'reset flu colors',
  'colores por defecto',
  'default colors',
]
