/**
 * ESPERA POR LA FILA DE UN TURNO — dueño único.
 *
 * La fila la commitea el MÓDULO (`row.committed`, con SU turnId). El hook no
 * inventa el turnId ni lee la fila por otra ruta: publica cada fila aquí y la
 * petición a la IA espera la de SU turno. Una revisión de la MISMA locución
 * (mismo turnId) también la commitea y libera la espera vigente; una espera
 * repetida del mismo turno comparte la misma promesa (no se orfana). Sin fila
 * dentro del tope (texto descartado, ASR mudo) la espera resuelve null y la
 * petición responde con la frase del ASR en vez de bloquear el turno.
 *
 * Vive en el módulo (no en la tubería vieja): el guard de arquitectura prohíbe
 * archivos nuevos en `src/voice/lib/**`. Consumidor ÚNICO:
 * `src/voice/hooks/useFluVoiceAssistant.js` (publica en `row.committed` y
 * espera antes de pedir el contrato a la IA).
 *
 * Guard: tests/conversacionTurnoIaGuard.test.ts.
 */
import type { Fila } from './ports.ts'

/** Tope por defecto si la configuración no declara uno válido. */
const ESPERA_POR_DEFECTO_MS = 4000

/** Espera en curso de un turno: su promesa, su liberación y su temporizador. */
type EsperaDeTurno = {
  promesa: Promise<Fila | null>
  liberar: (fila: Fila | null) => void
  temporizador: ReturnType<typeof setTimeout>
}

/**
 * Crea el registro de esperas por turno.
 * @param topeMs Tope de espera en ms (se lee en cada espera).
 * @returns Registro con `publicar` y `esperar`.
 * @revisor CREAR NUEVO — la espera por la fila del turno sale del hook a su
 *   módulo; el original se elimina en este mismo cambio.
 */
export function crearEsperaDeFilaDeTurno(
  topeMs: () => number = () => ESPERA_POR_DEFECTO_MS,
): {
  publicar: (fila: Fila) => void
  esperar: (turnId: string | number) => Promise<Fila | null>
} {
  /** Última fila commiteada por el módulo: responde sin esperar si es del turno. */
  let ultima: Fila | null = null
  /** Esperas en curso, una por turnId. */
  const esperas = new Map<string, EsperaDeTurno>()

  /**
   * Publica la fila commiteada del turno: la guarda como última y libera la
   * espera vigente (si la hay) para que resuelva con ESA fila.
   * @param fila Fila commiteada del módulo (`row.committed`).
   * @revisor CREAR NUEVO — único punto de publicación de la fila; el hook ya
   *   no guarda copia ni libera esperas por su cuenta.
   */
  const publicar = (fila: Fila): void => {
    if (!fila) return
    ultima = fila
    const clave = String(fila.turnId ?? '').trim()
    if (!clave) return
    const espera = esperas.get(clave)
    if (!espera) return
    esperas.delete(clave)
    clearTimeout(espera.temporizador)
    espera.liberar(fila)
  }

  /**
   * Espera la FILA del turno antes de pedir el contrato a la IA.
   * @param turnId Turno ABIERTO en el módulo al despachar.
   * @returns Fila del turno o null si no llega a tiempo.
   * @revisor CREAR NUEVO — única espera por la fila; una segunda espera del
   *   mismo turno comparte la misma promesa (no se orfana).
   */
  const esperar = (turnId: string | number): Promise<Fila | null> => {
    const clave = String(turnId ?? '').trim()
    if (!clave) return Promise.resolve(null)
    if (ultima && String(ultima.turnId ?? '').trim() === clave) {
      return Promise.resolve(ultima)
    }
    const enCurso = esperas.get(clave)
    if (enCurso) return enCurso.promesa
    let liberar: (fila: Fila | null) => void = () => undefined
    const promesa = new Promise<Fila | null>((resolve) => {
      liberar = resolve
    })
    const temporizador = setTimeout(() => {
      esperas.delete(clave)
      liberar(null)
    }, Number(topeMs()) || ESPERA_POR_DEFECTO_MS)
    esperas.set(clave, { promesa, liberar, temporizador })
    return promesa
  }

  return { publicar, esperar }
}
