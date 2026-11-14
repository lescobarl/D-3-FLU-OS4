/**
 * CLIENTE del SIDECAR local de transcripción (faster-whisper).
 *
 * Decisión del dueño 2026-11-14 (opción c, modalidad medida): small en CPU
 * int8, beam 1, 8 hilos, ventanas de 12 s, SECUENCIAL. El proceso nativo (Python
 * + faster-whisper) corre FUERA del navegador como servicio local; este módulo
 * es el ÚNICO cliente que lo habla y no contiene ninguna URL: el endpoint vive
 * en `FLU_CONFIG.transcript.localFinal.sidecarUrl` (la auditoría de hardcodes
 * exige que las URLs estén en config).
 *
 * CONTRATO del sidecar (lo implementa el servicio; quedó escrito en
 * docs/CONTRATO-ASR-LOCAL.md §5-octies):
 *  - `GET {url}/salud` → 2xx = disponible. Cualquier otro estado, un fallo de
 *    red o el tope agotado = NO disponible (la fila se queda con Chrome).
 *  - `POST {url}/transcribir` con JSON
 *    `{ muestras: <base64 de float32 LE>, sampleRate, idioma, formato: 'f32le' }`
 *    → JSON `{ texto: string }`. Sin streaming ni lotes: UNA ventana por
 *    petición, en serie (el cierre espera antes de construir la fila).
 *
 * El tope de espera se impone con `AbortController` (dueño único del transporte):
 * la promesa SIEMPRE resuelve — con texto o con el motivo (`timeout`/`fallo`).
 * Así un sidecar colgado no congela el cierre: la sesión sigue con Chrome.
 */

/** Entrada de una ventana al sidecar (PCM ya remuestreado al rate del ASR). */
export type EntradaTranscripcionSidecar = Readonly<{
  /** PCM mono de la ventana. */
  muestras: Float32Array
  /** Frecuencia del PCM (la del modelo; el adaptador remuestrea antes). */
  sampleRate: number
  /** Idioma vigente de la locución (`es` / `en`). */
  idioma: string
  /** Tope de espera de ESTA petición (ms). */
  timeoutMs: number
}>

/** Resultado del transporte: texto del sidecar o el motivo por el que no lo hay. */
export type RespuestaTranscripcionSidecar = Readonly<
  | { texto: string; motivo: null }
  | { texto: ''; motivo: 'timeout' | 'fallo'; error?: unknown }
>

/** Cliente del sidecar: sonda de salud y transcripción de UNA ventana. */
export interface ClienteSidecar {
  /** ¿El servicio responde en `/salud` dentro de `probeMs`? Nunca rechaza. */
  salud(): Promise<boolean>
  /** Transcribe una ventana; nunca rechaza (el motivo viaja en el resultado). */
  transcribir(entrada: EntradaTranscripcionSidecar): Promise<RespuestaTranscripcionSidecar>
}

/** Bytes por trozo de la conversión a base64 (evita el límite de argumentos). */
const BYTES_POR_TROZO = 0x8000

/**
 * Codifica PCM float32 como base64 LITTLE-ENDIAN, que es el formato del
 * contrato del sidecar (`formato: 'f32le'`). Se escribe byte a byte con
 * `DataView` para no depender del endianness de la máquina.
 * @param muestras PCM mono de la ventana.
 * @returns Base64 del float32 LE.
 * @revisor CREAR NUEVO — único codificador del transporte; el contrato exige LE
 *   explícito (un buffer nativo big-endian sonaría a ruido en el sidecar).
 */
export function pcmFloat32ABase64(muestras: Float32Array): string {
  const bytes = new Uint8Array(muestras.length * 4)
  const vista = new DataView(bytes.buffer)
  for (let indice = 0; indice < muestras.length; indice += 1) {
    vista.setFloat32(indice * 4, muestras[indice], true)
  }
  let binario = ''
  for (let inicio = 0; inicio < bytes.length; inicio += BYTES_POR_TROZO) {
    binario += String.fromCharCode(
      ...bytes.subarray(inicio, Math.min(inicio + BYTES_POR_TROZO, bytes.length)),
    )
  }
  return btoa(binario)
}

/**
 * Crea el cliente del sidecar. Sin URL o sin `fetch` el servicio es NO
 * disponible: `salud()` responde `false` sin tocar la red y la fila se queda
 * con Chrome (el cliente no inventa un endpoint local).
 * @param opciones URL del servicio (de config), tope de la sonda y `fetch` inyectable.
 * @returns Cliente del sidecar listo para el adaptador del producto.
 * @revisor CREAR NUEVO — no existía cliente del servicio nativo; su dueño de
 *   transporte es este módulo (el adaptador solo remuestrea y aplica la puerta).
 */
export function crearSidecarTranscripcion({
  url,
  probeMs,
  fetchImpl,
}: {
  url: string
  probeMs: number
  fetchImpl?: typeof fetch
}): ClienteSidecar {
  const base = String(url || '').replace(/\/+$/, '')
  const pedir = fetchImpl ?? (typeof fetch === 'function' ? fetch : null)
  const alcanzable = base.length > 0 && pedir !== null

  return {
    /**
     * Sonda de disponibilidad con tope `probeMs`. Un servicio apagado es el
     * caso normal (Chrome manda), no un error: se informa `false`, sin log.
     * @returns `true` solo si `/salud` respondió 2xx dentro del tope.
     */
    async salud(): Promise<boolean> {
      if (!alcanzable || !pedir) return false
      const controlador = new AbortController()
      const temporizador = setTimeout(() => controlador.abort(), probeMs)
      try {
        const respuesta = await pedir(`${base}/salud`, {
          method: 'GET',
          signal: controlador.signal,
        })
        return Boolean(respuesta?.ok)
      } catch {
        // Sidecar apagado, red caída o tope agotado: no disponible.
        return false
      } finally {
        clearTimeout(temporizador)
      }
    },

    /**
     * Transcribe UNA ventana con tope `timeoutMs`. El cuerpo se serializa antes
     * de la petición: el tope cubre también la codificación.
     * @param entrada PCM de la ventana, frecuencia, idioma y tope.
     * @returns `{ texto }` o `{ motivo: 'timeout' | 'fallo' }` (nunca rechaza).
     */
    async transcribir(
      entrada: EntradaTranscripcionSidecar,
    ): Promise<RespuestaTranscripcionSidecar> {
      if (!alcanzable || !pedir) {
        return { texto: '', motivo: 'fallo', error: 'sidecar no configurado' }
      }
      const controlador = new AbortController()
      const temporizador = setTimeout(() => controlador.abort(), entrada.timeoutMs)
      try {
        const respuesta = await pedir(`${base}/transcribir`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            muestras: pcmFloat32ABase64(entrada.muestras),
            sampleRate: entrada.sampleRate,
            idioma: entrada.idioma,
            formato: 'f32le',
          }),
          signal: controlador.signal,
        })
        if (!respuesta?.ok) {
          return { texto: '', motivo: 'fallo', error: `HTTP ${Number(respuesta?.status) || 0}` }
        }
        const datos = (await respuesta.json()) as { texto?: unknown } | null
        const texto = typeof datos?.texto === 'string' ? datos.texto : ''
        return { texto, motivo: null }
      } catch (error) {
        // Tope agotado o transporte caído: la fila cae al texto de Chrome.
        return controlador.signal.aborted
          ? { texto: '', motivo: 'timeout' }
          : { texto: '', motivo: 'fallo', error }
      } finally {
        clearTimeout(temporizador)
      }
    },
  }
}
