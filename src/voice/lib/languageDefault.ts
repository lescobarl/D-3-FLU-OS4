/**
 * IDIOMA POR DEFECTO del producto — **UNICO** para todo `src/voice`.
 *
 * Mandato del dueno (2026-10-23): si el idioma es configuracion, no puede haber un `'es'`
 * local por funcion. Antes cada modulo repetia `language = 'es'` (46 defaults en `src/voice`):
 * cambiar el idioma en Ajustes no movia esos defaults y dos rutas podian discrepar.
 *
 * FUENTE: `UI_DEFAULTS.LANGUAGE` (`src/core/config/appConfig.ts`), el mismo dato que alimenta
 * el selector de idioma de la cabecera. Este modulo NO guarda una segunda copia: solo lo lee.
 *
 * Devuelve `string` a proposito: los parametros que lo consumen son de modulos JS y tiparlos
 * como `'es'|'en'` estrecharia sus firmas (los llamadores pasan `'both'` o un `string`).
 *
 * `both` (la UI muestra los dos idiomas) usa `es` como idioma PRIMARIO de una operacion
 * concreta que exige uno solo; es la misma prioridad declarada del producto.
 *
 * NO es el idioma DETECTADO del texto (`detectLanguage`/`resolveAppLanguage`): ese se calcula
 * del contenido y sigue teniendo su propio dueno.
 */
import { UI_DEFAULTS } from '../../core/config/appConfig.ts'

/**
 * Idioma configurado del producto.
 * @returns `'en'` si la configuracion es inglesa; `'es'` en cualquier otro caso (incluido `both`)
 */
export function defaultLanguage() {
  const valor = String((UI_DEFAULTS as { LANGUAGE?: string })?.LANGUAGE || '').trim().toLowerCase()
  if (valor === 'en') return 'en'
  return 'es'
}
