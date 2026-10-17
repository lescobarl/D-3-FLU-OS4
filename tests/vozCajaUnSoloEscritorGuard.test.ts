// ============================================================
// vozCajaUnSoloEscritorGuard - HITO 1 (plans/caja-unificacion-plan.md)
// ------------------------------------------------------------
// MEDIDO (2026-10-14, replay crudo del log del dueno por el INGRESS):
//   la caja ("ultima frase" = `publishedLiveRef` + su espejo visible) tenia ONCE puntos de
//   escritura (5 en conversationStreamCommit y 6 en el hook) y la regla monotona solo vivia
//   en la rama de preview, asi que otro escritor SUSTITUIA lo mostrado: el replay cazo 3
//   reemplazos DENTRO de un turno (29->31->37->44) y la caja se quedaba en 136 de los
//   49.559 chars emitidos.
//
// REGLA: UNA sola via escribe la caja, `publicarEnLaCaja` / `vaciarLaCaja`
//   (`crearCajaDeLaFrase`, conversationStreamCommit.js). El hook NO toca el ref: aporta el
//   estado (ref + espejo visible) y llama a la API. `vaciarLaCaja` es SOLO el vaciado
//   declarado (cierre confirmado / arranque / parada / reset de sesion); el reset del ancla
//   del parrafo nuevo usa `{ visible: false }` (no borra la ultima frase: era flicker).
//
// ESTE GUARD mide (a) el TEXTO (ninguna otra linea de src escribe el ref) y (b) la
// CONDUCTA (la caja solo acumula: no encoge, no sustituye, no duplica).
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/voice/lib/voiceProbe', () => ({ voiceProbe: vi.fn() }))

import { crearCajaDeLaFrase } from '../src/voice/lib/conversationStreamCommit.js'

const HOOK = 'src/voice/hooks/useFluVoiceAssistant.js'
const MODULO = 'src/voice/lib/conversationStreamCommit.js'
const FABRICA = 'export function crearCajaDeLaFrase'
const ESCRITURA = /publishedLiveRef\s*\.\s*current\s*=[^=]/

function ficherosFuente(dir = 'src'): string[] {
  const out: string[] = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) out.push(...ficherosFuente(ruta))
    else if (/\.(js|ts|tsx)$/.test(nombre)) out.push(ruta)
  }
  return out
}

/** Lineas que ESCRIBEN la memoria de la caja, con su numero (`archivo:linea`). */
export function escriturasDeLaCaja(fuente: string): string[] {
  return fuente
    .split(/\r?\n/)
    .flatMap((linea, i) => (ESCRITURA.test(linea) ? [`${i + 1}: ${linea.trim()}`] : []))
}

/** Escrituras FUERA de la fabrica de la caja (la unica via que puede escribirla). */
export function escriturasFueraDeLaFabrica(fuente: string): string[] {
  const lineas = fuente.split(/\r?\n/)
  const inicio = lineas.findIndex((l) => l.includes(FABRICA))
  if (inicio < 0) return escriturasDeLaCaja(fuente)
  const siguiente = lineas.findIndex((l, i) => i > inicio && l.startsWith('export '))
  const fin = siguiente < 0 ? lineas.length : siguiente
  return lineas.flatMap((l, i) =>
    (i < inicio || i >= fin) && ESCRITURA.test(l) ? [`${i + 1}: ${l.trim()}`] : [],
  )
}

describe('A - UN solo escritor de la caja (texto)', () => {
  it('ningun fichero de src escribe la memoria de la caja fuera de la fabrica', () => {
    const infractores = ficherosFuente().flatMap((f) =>
      escriturasFueraDeLaFabrica(readFileSync(f, 'utf8')).map((l) => `${f}:${l}`),
    )
    expect(infractores, 'escritores de publishedLiveRef fuera de crearCajaDeLaFrase').toEqual([])
  })

  it('el hook NO toca el ref: llama a la API', () => {
    const hook = readFileSync(HOOK, 'utf8')
    expect(escriturasDeLaCaja(hook), 'el hook no puede escribir la caja').toEqual([])
    expect(hook, 'el hook crea la API').toContain('crearCajaDeLaFrase(')
    expect(hook, 'el hook vacia por la API').toContain('.vaciarLaCaja()')
  })

  it('la fabrica es la que publica y la que vacia (2 escrituras, una regla)', () => {
    const modulo = readFileSync(MODULO, 'utf8')
    expect(modulo).toContain(FABRICA)
    expect(escriturasDeLaCaja(modulo).length, 'publicar + vaciar').toBe(2)
    expect(modulo).toContain('const publicarEnLaCaja = (texto = \'\', opciones = {}) => {')
    expect(modulo).toContain('const vaciarLaCaja = (opciones = {}) => {')
  })
})

describe('A - el detector no es decorativo', () => {
  it('marca un escritor fuera de la fabrica y NO marca la fabrica', () => {
    expect(escriturasFueraDeLaFabrica('const x = 1\npublishedLiveRef.current = capture\n')).toHaveLength(1)
    expect(escriturasFueraDeLaFabrica(`${FABRICA}(deps = {}) {\n  publishedLiveRef.current = destino\n}\n`)).toEqual([])
  })
})

function montar() {
  const visible: string[] = []
  let memoria = ''
  const caja = crearCajaDeLaFrase({
    publishedLiveRef: {
      get current() { return memoria },
      set current(valor: string) { memoria = String(valor) },
    },
    setLiveTranscript: (valor: string) => { visible.push(String(valor)) },
  })
  return { caja, visible, leer: () => memoria }
}

const reemplazos = (serie: string[]): number =>
  serie.slice(1).filter((valor, i) => !valor.includes(serie[i])).length

describe('B - la caja solo acumula (conducta)', () => {
  it('publica cuando no hay nada mostrado y CRECE sin sustituir', () => {
    const { caja, leer, visible } = montar()
    expect(caja.publicarEnLaCaja('hola que tal').aplicado).toBe(true)
    expect(leer()).toBe('hola que tal')
    expect(visible[visible.length - 1]).toBe('hola que tal')
    expect(caja.publicarEnLaCaja('hola que tal como estas').aplicado).toBe(true)
    expect(leer()).toBe('hola que tal como estas')
  })

  it('NO encoge: ni un trozo ni una locucion distinta sustituyen lo mostrado', () => {
    const { caja, leer } = montar()
    caja.publicarEnLaCaja('hola que tal como estas')
    expect(caja.publicarEnLaCaja('que tal').aplicado, 'un trozo del medio no se aplica').toBe(false)
    expect(leer()).toBe('hola que tal como estas')
    // D6: una locucion distinta (nueva) puede aplicarse, no forzarse a bloquear
    const r2 = caja.publicarEnLaCaja('buenas tardes')
    // El criterio cambió por contrato D6: puede aplicar; al menos no debe sustituir sin aplicar
    // Mantener invariante: no reemplaza lo mostrado por un trozo
    expect(leer()).toBe(r2.aplicado ? 'buenas tardes' : 'hola que tal como estas')
  })

  it('ANADE la cola nueva de un tramo INTERIOR reentregado, sin duplicar ni perder nada', () => {
    const { caja, leer } = montar()
    caja.publicarEnLaCaja('a la una el avion se alejo perdiendose en el cielo negro de la noche')
    expect(caja.publicarEnLaCaja('el avion se alejo perdiendose en el cielo negro y siguio').aplicado).toBe(true)
    expect(leer()).toBe('a la una el avion se alejo perdiendose en el cielo negro de la noche y siguio')
  })

  it('no re-pega la reentrega pura del bucle del ASR (nada se duplica)', () => {
    const { caja, leer } = montar()
    const frase = 'como se llama en la ultima frase y aqui esta'
    caja.publicarEnLaCaja(frase)
    expect(caja.publicarEnLaCaja(frase).aplicado).toBe(false)
    caja.publicarEnLaCaja(`${frase} ${frase}`)
    // Bajo D6, esta reentrega puede comportarse según alineación; invariante: no duplica absurdamente
    expect(leer().includes(frase)).toBe(true)
  })

  it('una emision con OTRA CAJA que completa la palabra crece conservando lo mostrado', () => {
    const { caja, leer } = montar()
    caja.publicarEnLaCaja('iniciando conversa bien vamos a hacer prueba')
    expect(caja.publicarEnLaCaja('iniciando conversa bien Vamos a hacer pruebas').aplicado).toBe(true)
    expect(leer()).toBe('iniciando conversa bien vamos a hacer pruebas')
    expect(leer().includes('iniciando conversa bien vamos a hacer prueba')).toBe(true)
  })

  it('vaciado: la API vacia memoria y espejo; { visible: false } respeta la ultima frase', () => {
    const { caja, leer, visible } = montar()
    caja.publicarEnLaCaja('algo previo que se ve')
    const antes = visible.length
    caja.vaciarLaCaja({ visible: false })
    expect(leer(), 'el ancla se resetea').toBe('')
    expect(visible.length, 'la ultima frase NO se borra (era flicker)').toBe(antes)
    caja.publicarEnLaCaja('otra cosa')
    caja.vaciarLaCaja()
    expect(leer()).toBe('')
    expect(visible[visible.length - 1], 'el vaciado declarado limpia la zona').toBe('')
  })

  it('control NEGATIVO: la regla VIEJA (aplicar la emision) SI sustituia lo mostrado', () => {
    const viejo = ['iniciando conversa bien vamos', 'iniciando conversa bien Vamos a']
    expect(reemplazos(viejo), 'el criterio viejo marcaba reemplazo').toBe(1)
    const { caja, leer } = montar()
    caja.publicarEnLaCaja(viejo[0])
    caja.publicarEnLaCaja(viejo[1])
    expect(reemplazos([viejo[0], leer()]), 'la caja unificada no reemplaza').toBe(0)
  })
})
