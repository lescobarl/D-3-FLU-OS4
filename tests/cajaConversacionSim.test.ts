// ============================================================
// PRUEBA DE ESCRITORIO (ESPECIFICACION) - 30 hablantes / 600 filas
// ------------------------------------------------------------
// Simula el escenario del dueno PASO A PASO con la arquitectura propuesta:
//   P1 insert-only            (el texto se decide UNA vez, en el insert)
//   P2 actualizacion DIRIGIDA por ID + idempotente (si el valor no cambia, no se escribe)
//   P3 mapa O(1) de nombres (voz->nombre) + filas memoizadas por id
//   P4 cierre por LOCUCION ESTABILIZADA + persistencia por rafaga
//   P5 identidad: UNA voz = UNA clave + sin herencia sin evidencia
// Mide el TRABAJO de cada operacion (renders, copias del array, mutaciones, disco) y lo que el
// dueno VE (nombre perdido de un nombrado / nombre ajeno / filas sin resolver).
// ============================================================
import { describe, expect, it } from 'vitest'

type Clave = string
type Fila = { id: string; texto: string; clave: Clave; persona: number }

const PERSONAS = 30
const TURNOS_POR_PERSONA = 20
const FILAS = PERSONAS * TURNOS_POR_PERSONA      // 600
const EMISIONES_POR_TURNO = 6                     // 5 finales de segmento + 1 cierre real
const EMISIONES = FILAS * EMISIONES_POR_TURNO     // 3.600

type Turno = { persona: number; clave: Clave; texto: string }

/** 600 turnos. La persona 0 (Luis) tiene DOS claves (el batido medido: 'luis' y 'Hablante 1') y
 *  1 de cada 7 turnos de la persona 1 cae en la clave de Luis (arrastre del ultimo hablante). */
function escenario(): Turno[] {
  const turnos: Turno[] = []
  for (let t = 0; t < FILAS; t += 1) {
    const persona = t % PERSONAS
    let clave = `voz-${persona}`
    if (persona === 0) clave = t < FILAS / 3 ? 'voz-0-a' : 'voz-0-b'
    else if (persona === 1 && t % 7 === 1) clave = 'voz-0-a'
    turnos.push({ persona, clave, texto: `frase ${t} de la persona ${persona} con su contenido completo` })
  }
  return turnos
}

type Metrica = {
  renders: number            // trabajo de dibujo (el "re-render masivo")
  copiasDeArray: number      // reconstrucciones del array de la conversacion
  mutacionesTexto: number    // textos reescritos DESPUES del insert
  escriturasDisco: number
  filasEnDisco: number
  gapMaximo: number          // emisiones seguidas sin que la conversacion muestre nada (el "congelado")
  nombrePerdido: number      // filas de una persona NOMBRADA que no muestran su nombre ("unos Luis y otros Hablante 1")
  nombreAjeno: number        // filas que muestran el nombre de OTRA persona (el batido de la mujer)
  sinResolver: number        // filas sin evidencia suficiente: 'Hablante N' (honesto, no ajeno)
}
const cero = (): Metrica => ({
  renders: 0, copiasDeArray: 0, mutacionesTexto: 0, escriturasDisco: 0, filasEnDisco: 0,
  gapMaximo: 0, nombrePerdido: 0, nombreAjeno: 0, sinResolver: 0,
})

type Opciones = {
  insertOnly: boolean
  dirigida: boolean
  mapaO1: boolean
  cierreEstabilizado: boolean
  identidadUnaVoz: boolean
}
const HOY: Opciones = { insertOnly: false, dirigida: false, mapaO1: false, cierreEstabilizado: false, identidadUnaVoz: false }

/**
 * Motor de la simulacion: mide el trabajo REAL de cada operacion segun las piezas activas.
 * @param o piezas de la arquitectura activas
 * @returns metricas del escenario completo
 */
function correr(o: Opciones): Metrica {
  const m = cero()
  const filas: Fila[] = []
  const directorio = new Map<Clave, string>()   // dueno unico: clave de VOZ -> nombre
  let id = 0
  let nombreAnterior: string | null = null
  let rachaMuda = 0
  let rafagaPendiente = false
  for (const turno of escenario()) {
    // "ok soy luis": el nombre se registra contra la VOZ que estaba ACTIVA en ese momento. HOY eso
    // es UNA de las dos claves del batido (la otra sigue sin nombre = "unos Luis y otros Hablante 1").
    if (turno.persona === 0 && !directorio.has(o.identidadUnaVoz ? 'voz-0' : 'voz-0-a')) {
      directorio.set(o.identidadUnaVoz ? 'voz-0' : 'voz-0-a', 'Luis')
    }
    // P5: UNA voz = UNA clave (sus dos clusters se pliegan) y un turno sin evidencia NO hereda
    // el nombre de nadie (queda 'Hablante N').
    const clave = !o.identidadUnaVoz
      ? turno.clave
      : (turno.persona === 0 ? 'voz-0' : (turno.clave === 'voz-0-a' ? 'sin-evidencia' : turno.clave))
    let filaDelTurno: Fila | null = null
    for (let e = 0; e < EMISIONES_POR_TURNO; e += 1) {
      const cierra = o.cierreEstabilizado ? e === 1 : e === EMISIONES_POR_TURNO - 1
      if (!filaDelTurno && !cierra) {
        // Emision que NO cierra y aun sin fila: esto es lo que el dueno ve como "congelado".
        rachaMuda += 1
        if (rachaMuda > m.gapMaximo) m.gapMaximo = rachaMuda
        // Emision que NO cierra: HOY reconstruye el array y redibuja la lista entera (aunque el
        // valor del hablante no cambie). Con P2 el valor es identico -> no se escribe nada.
        if (!o.dirigida) { m.copiasDeArray += 1; m.renders += filas.length }
        if (!o.insertOnly && id % 5 === 0) m.mutacionesTexto += 1   // HOY: "recompone" el texto
        continue
      }
      const actual: Fila | null = filaDelTurno
      if (actual) {
        if (o.dirigida) {
          if (actual.clave !== clave) {
            const cambiada: Fila = { id: actual.id, texto: actual.texto, clave, persona: actual.persona }
            filaDelTurno = cambiada
            m.renders += 1
          }
        } else {
          m.copiasDeArray += 1
          m.renders += filas.length
          actual.clave = clave
        }
        continue
      }
      if (!o.dirigida) { m.copiasDeArray += 1; m.renders += filas.length }  // HOY tambien al cerrar
      rachaMuda = 0
      // INSERT: el texto entra UNA vez (P1) y la fila nace con su hablante resuelto por MAPA (P3).
      filaDelTurno = { id: `f${id}`, texto: turno.texto, clave, persona: turno.persona }
      filas.push(filaDelTurno)
      id += 1
      m.renders += o.mapaO1 ? 1 : filas.length         // fila memoizada vs lista entera
      // Persistencia: HOY un put del registro entero por insercion; P4 por rafaga.
      if (o.cierreEstabilizado) rafagaPendiente = true
      else { m.escriturasDisco += 1; m.filasEnDisco += filas.length }
    }
    if (rafagaPendiente) {
      rafagaPendiente = false
      m.escriturasDisco += 1
      m.filasEnDisco += o.mapaO1 ? 1 : filas.length
    }
    // Etiqueta que se VE: resuelta por CLAVE (hoy) o por MAPA con clave plegada (P5).
    const etiqueta = directorio.get(o.identidadUnaVoz ? (clave === 'sin-evidencia' ? 'sin-evidencia' : (turno.persona === 0 ? 'voz-0' : clave)) : clave)
    const nombre = etiqueta ?? (o.identidadUnaVoz ? 'Hablante N' : 'Hablante 1')
    nombreAnterior = nombre
    void nombreAnterior
    if (nombre === 'Luis') {
      if (turno.persona !== 0) m.nombreAjeno += 1                  // le pusieron el nombre de Luis
    } else if (nombre.startsWith('Hablante')) {
      if (turno.persona === 0) m.nombrePerdido += 1                // a Luis se le perdio el nombre
      else m.sinResolver += 1
    }
  }
  const nombreRealDeLuis = directorio.get('voz-0-a') === 'Luis' || directorio.get('voz-0') === 'Luis'
  if (!nombreRealDeLuis) throw new Error('el escenario debe registrar el nombre de Luis')
  return m
}

describe('PRUEBA DE ESCRITORIO (especificacion) - 30 hablantes / 600 filas', () => {
  it('paso a paso: cada pieza elimina su defecto y la aritmetica lo demuestra', () => {
    const pasos: Array<[string, Opciones]> = [
      ['HOY (base)', HOY],
      ['P1 insert-only', { ...HOY, insertOnly: true }],
      ['P2 dirigida+idempotente', { ...HOY, insertOnly: true, dirigida: true }],
      ['P3 + mapa O(1) + memo', { ...HOY, insertOnly: true, dirigida: true, mapaO1: true }],
      ['P4 cierre estabilizado', { ...HOY, insertOnly: true, dirigida: true, mapaO1: true, cierreEstabilizado: true }],
      ['P5 una voz = una clave', { insertOnly: true, dirigida: true, mapaO1: true, cierreEstabilizado: true, identidadUnaVoz: true }],
    ]
    const r: Record<string, Metrica> = {}
    for (const [nombre, opciones] of pasos) {
      r[nombre] = correr(opciones)
      const x = r[nombre]
      console.log(
        `[paso] ${nombre.padEnd(24)} renders=${String(x.renders).padStart(7)} copiasArray=${String(x.copiasDeArray).padStart(5)}` +
        ` mutTexto=${String(x.mutacionesTexto).padStart(3)} gapMax=${x.gapMaximo}` +
        ` disco=${String(x.escriturasDisco).padStart(4)} filasEnDisco=${String(x.filasEnDisco).padStart(7)}` +
        ` nombrePerdido=${String(x.nombrePerdido).padStart(3)} nombreAjeno=${String(x.nombreAjeno).padStart(3)} sinResolver=${x.sinResolver}`,
      )
    }
    const hoy = r['HOY (base)']
    const fin = r['P5 una voz = una clave']
    console.log(
      `[aritmetica] N=${FILAS} filas, E=${EMISIONES} emisiones | renders hoy=${hoy.renders} = E·N/2 -> propuesta=${fin.renders} = N -> ${(hoy.renders / fin.renders).toFixed(0)}x menos` +
      ` | disco hoy=${hoy.filasEnDisco} filas escritas -> propuesta=${fin.filasEnDisco} -> ${(hoy.filasEnDisco / Math.max(1, fin.filasEnDisco)).toFixed(0)}x menos`,
    )
    expect(hoy.nombrePerdido, 'HOY: a Luis se le pierde el nombre en la mitad de sus filas').toBeGreaterThan(0)
    expect(hoy.nombreAjeno, 'HOY: hay filas con el nombre de Luis que no son suyas').toBeGreaterThan(0)
    expect(r['P1 insert-only'].mutacionesTexto, 'P1: cero mutaciones de texto').toBe(0)
    expect(r['P2 dirigida+idempotente'].copiasDeArray, 'P2: cero copias del array').toBe(0)
    expect(r['P3 + mapa O(1) + memo'].renders, 'P3: un render por fila insertada').toBe(FILAS)
    expect(r['P4 cierre estabilizado'].gapMaximo, 'P4: la conversacion deja de quedarse muda en bloque').toBe(1)
    expect(fin.nombrePerdido, 'P5: cero nombres perdidos (una voz = una clave)').toBe(0)
    expect(fin.nombreAjeno, 'P5: cero nombres ajenos (sin herencia sin evidencia)').toBe(0)
    expect(hoy.renders / fin.renders, 'los re-renders masivos caen >100x').toBeGreaterThan(100)
    expect(fin.mutacionesTexto + fin.copiasDeArray, 'la conversacion no se reconstruye ni se reescribe').toBe(0)
  })
})
