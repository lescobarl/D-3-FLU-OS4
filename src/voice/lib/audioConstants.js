// Origen unico de los parametros de audio compartidos por el pipeline de voz.
// Modulo HOJA (no importa nada) para poder usarse como valor por defecto en las
// firmas sin arriesgar ciclos: fluConfig.audio.sampleRate deriva de aqui.
export const DEFAULT_SAMPLE_RATE = 48000
