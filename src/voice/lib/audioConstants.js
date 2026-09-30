// Origen unico de los parametros de audio compartidos por el pipeline de voz.
// Modulo HOJA (no importa nada) para poder usarse como valor por defecto en las
// firmas sin arriesgar ciclos: fluConfig.audio.sampleRate deriva de aqui.
export const DEFAULT_SAMPLE_RATE = 48000

/**
 * Tasa objetivo del pipeline a 16 kHz: STT streaming + embeddings de voz.
 * Mismo valor para las dos ramas, asi que vive una sola vez: antes estaba
 * quemado en cinco modulos de voz (P7.93).
 */
export const DEFAULT_TARGET_SAMPLE_RATE = 16000
