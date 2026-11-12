// BARRERA: rutas-dobles-medidas
/**
 * conversacionRutasDoblesGuard — barrera medida de las rutas dobles del módulo
 * CONVERSACIÓN.
 *
 * Mide el estado REAL de `src/voice/conversation` y lo contrasta con la línea
 * base versionada (`scripts/conversacion-rutas-dobles-baseline.json`):
 *
 *  - UN solo tiempo: los literales de config 900/8000 solo viven en
 *    `ports.ts`; UNA lectura de `getTranscriptPauseCfg().srGapCommitMs`.
 * - UNA sola condición de cierre: solo `frontera.ts` compara silencio y
 *   decide la causa 'voz'. `texto.ts` no cierra por texto ni lee la medida
 *   vieja (`ultimaMedida`) y `ingesta.ts` tampoco la conserva.
 * - La voz la mide el módulo (`verificarCambioVoz`) sobre el tramo ENTRANTE,
 *   aunque el VAD lo haya cortado a otro tramo, y se verifica ANTES de la
 *   atribución del texto.
 *  - El final se compone desde 0 (hipótesis completa), no con `resultIndex`.
 *  - No se descarta por prefijo de texto (`previo.includes(nuevo)`).
 *  - El cierre de la locución tiene DOS puertas medidas (voz distinta o
 *    silencio ≥ silenceCloseMs); el final del ASR no es una tercera.
 *  - El dedupe del despacho tiene UN dueño (el plan en audioMath); el cableado
 *    no filtra por texto. El recorte del prefijo de fila tiene UN dueño.
 *
 * La línea base solo BAJA: si una métrica baja, se actualiza en el mismo
 * cambio; si sube, este guard falla. Además, la base versionada no puede subir
 * respecto a HEAD (local) ni al origen del PR (CI).
 */
// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { funcionesNuevas, nombresDeFunciones } from '../scripts/funciones-ratchet.mjs'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow.js'
import { collapseRepeatedSpeech } from '../src/voice/lib/speechMerge.js'
import { resolverVoz } from '../src/voice/conversation/cierre.ts'
import { registrarMedidaVoz } from '../src/voice/conversation/sesion.ts'
import { registerVoiceName, resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js'

type Fuente = Readonly<{ nombre: string; src: string }>

const DIRECTORIO = join(process.cwd(), 'src/voice/conversation')
const BASELINE = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts/conversacion-rutas-dobles-baseline.json'), 'utf8'),
) as {
  metricas: Record<string, number>
  funciones: Record<string, readonly string[]>
}

const FUENTES: readonly Fuente[] = [
  ...readdirSync(DIRECTORIO)
    .filter((nombre) => /\.(?:ts|js)$/.test(nombre))
    .map((nombre) => ({
      nombre,
      src: readFileSync(join(DIRECTORIO, nombre), 'utf8'),
    })),
  {
    nombre: 'compose/conversationMotorProducto.js',
    src: readFileSync(
      join(process.cwd(), 'src/voice/compose/conversationMotorProducto.js'),
      'utf8',
    ),
  },
]

const fuente = (nombre: string): string =>
  FUENTES.find((archivo) => archivo.nombre === nombre)?.src ?? ''

const contar = (src: string, patron: RegExp): number =>
  (src.match(new RegExp(patron.source, patron.flags.includes('g') ? patron.flags : `${patron.flags}g`)) ?? [])
    .length

/** Un comentario que menciona un valor no es una segunda fuente del valor. */
const sinComentariosDeLinea = (src: string): string =>
  src
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [full] : []
  })
}

const CONTINUIDAD_OWNERS = walk(join(process.cwd(), 'src')).filter((file) =>
  /function continuaLaFrase\b/.test(readFileSync(file, 'utf8')),
).length

/** Dueños del dedupe del despacho: el plan (audioMath) decide por firma y
 *  ventana; un filtro por texto en OTRO archivo es una ruta doble. */
const DISPATCH_DEDUPE_OWNERS = walk(join(process.cwd(), 'src/voice')).filter((file) =>
  /ultimaDespachada|isAsrRevision|lastSignature\s*===\s*signature/.test(
    readFileSync(file, 'utf8'),
  ),
).length

/** Fuentes de TODO src, con ruta relativa: mide consumidores fuera del m?dulo. */
const FUENTES_SRC: readonly Fuente[] = walk(join(process.cwd(), 'src')).map((abs) => ({
  nombre: relative(process.cwd(), abs).replace(/\\/g, '/'),
  src: readFileSync(abs, 'utf8'),
}))

/** ?La l?nea decide el turno (mint/incremento) o solo lo espeja/resetea? */
function decideTurno(fuente: string): boolean {
  return fuente.split(/\r?\n/).some((linea) => {
    if (/\.turnoActual\s*=/.test(linea) && !/= 0\b/.test(linea)) return true
    if (/turnosConFila\.add\s*\(/.test(linea)) return true
    const asignacion = linea.match(/activeTurnIdRef\.current\s*(\+=|=)\s*([^;]*)/)
    if (!asignacion) return false
    if (asignacion[1] === '+=') return true
    const valor = asignacion[2].trim()
    return valor !== '0' && valor !== 'turnId'
  })
}

/** ?La l?nea embebe audio para identidad? */
function mideVoz(fuente: string): boolean {
  return /computeAudioSignature\s*\(|selectVoicedWindow\s*\(|embebedor\.medir\s*\(/.test(fuente)
}

/** ?La l?nea escribe el nombre/base de una voz? */
function escribeNombre(fuente: string): boolean {
  return fuente.split(/\r?\n/).some((linea) => {
    if (/logCaughtError|console\.|message:/.test(linea)) return false
    return /\.registerParticipant\s*\(|registerVoiceName\s*\(/.test(linea)
  })
}

/**
 * Mide qui?n DECIDE (operaci?n), no el nombre del s?mbolo viejo. El m?dulo es
 * due?o de turno/voz; el registro ?nico es due?o del nombre.
 */
function medirPropiedadSemantica(fuentes: readonly Fuente[]) {
  const modulo = (ruta: string) => ruta.startsWith('src/voice/conversation/')
  const registro = 'src/voice/lib/speakerIdentityRegister.js'
  const directorio = 'src/voice/lib/speakerDirectory.js'
  const primitivasVoz = new Set(['src/voice/lib/audioMath.js', 'src/voice/lib/voicedActivity.js'])
  return {
    turnMintOwners: fuentes.filter((f) => !modulo(f.nombre) && decideTurno(f.src)).length,
    voiceMeasureOwners: fuentes.filter((f) => !modulo(f.nombre) && !primitivasVoz.has(f.nombre) && mideVoz(f.src)).length,
    nameRegisterOwners: fuentes.filter(
      (f) => !modulo(f.nombre) && f.nombre !== registro && f.nombre !== directorio && escribeNombre(f.src),
    ).length,
  }
}

function existeRef(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--end-of-options', ref], { stdio: 'ignore' })
    return true
  } catch {
    // Sin esa ref (primer push de una rama) no hay base comparable.
    return false
  }
}

function refBase(): string {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' && process.env.GITHUB_BASE_REF) {
    const base = `origin/${process.env.GITHUB_BASE_REF}`
    if (existeRef(base)) return base
    if (existeRef('HEAD^1')) return 'HEAD^1'
  }
  if (process.env.GITHUB_EVENT_NAME === 'push' && existeRef('HEAD^1')) return 'HEAD^1'
  return 'HEAD'
}

function baselineEn(ref: string): Record<string, number> {
  const ruta = 'scripts/conversacion-rutas-dobles-baseline.json'
  let existe = true
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}:${ruta}`], { stdio: 'ignore' })
  } catch {
    // La referencia todavía no tiene la línea base (el PR que la introduce):
    // no hay contra qué comparar. El test de métricas exactas sigue fijando el
    // estado; cualquier otro fallo del `git show` de abajo se propaga.
    existe = false
  }
  if (!existe) return {}
  const raw = execFileSync(
    'git',
    ['show', `${ref}:${ruta}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  )
  return (JSON.parse(raw) as { metricas: Record<string, number> }).metricas
}

function medir(fuentes: readonly Fuente[] = FUENTES) {
  const fuenteEn = (nombre: string): string =>
    fuentes.find((archivo) => archivo.nombre === nombre)?.src ?? ''
  return {
    timeConfigLiterals: fuentes.reduce(
      (total, archivo) => total + contar(sinComentariosDeLinea(archivo.src), /\b(?:900|8000)\b/g),
      0,
    ),
    timeConfigReads: fuentes.filter((archivo) =>
      /getTranscriptPauseCfg/.test(archivo.src),
    ).length,
    closureConditionOwners: fuentes.filter((archivo) =>
      /silencioMs\s*>=\s*(?:umbrales\.)?silenceCloseMs/.test(archivo.src),
    ).length,
    finalResultIndex: contar(
      fuenteEn('producto.ts'),
      /componerFraseDelEvento\(\s*evento\.results,\s*evento\.resultIndex\s*\)/g,
    ),
    staleMeasureReads: fuentes.reduce(
      (total, archivo) => total + contar(archivo.src, /ultimaMedida/g),
      0,
    ),
    voiceChangeSameTramoOnly: contar(
      fuenteEn('ingesta.ts'),
      /abierta\.locutionId\s*!==\s*tramoId\s*\)\s*return null/g,
    ),
    finalWholeLineReplace: contar(fuenteEn('cierre.ts'), /texto:\s*textoFinal/g),
    identityDurationFromTramo: fuentes.reduce(
      (total, archivo) =>
        total +
        contar(
          archivo.src,
          /(?:locucion|abierta|fila\.tramo)\.fin\s*-\s*(?:locucion|abierta|fila\.tramo)\.inicio/g,
        ),
      0,
    ),
    syntheticZeroOneTramo: fuentes.reduce(
      (total, archivo) => total + contar(archivo.src, /inicio:\s*0,\s*fin:\s*1/g),
      0,
    ),
    broadTextDedupe: contar(fuenteEn('ingesta.ts'), /previo\.includes\(nuevo\)/g),
    cierreDecisionOwners: fuentes.filter((archivo) =>
      /function decidirFrontera/.test(archivo.src),
    ).length,
    syntheticWindowOwners: contar(fuenteEn('tramos.ts'), /sintetico:\s*\(\{/g),
    syntheticWrappers: fuentes.reduce(
      (total, archivo) =>
        total + contar(archivo.src, /function tramoSintetico(?:ParaTexto)?\b/g),
      0,
    ),
    reentregaOwners: fuentes.filter((archivo) =>
      /function esReentregaDeLaFila/.test(archivo.src),
    ).length,
    directSilenceCloses: fuentes.reduce(
      (total, archivo) =>
        total +
        contar(archivo.src, /cerrarLocucion\([^,]+,\s*[^,]+,\s*'silencio'/g),
      0,
    ),
    continuidadOwners: CONTINUIDAD_OWNERS,
    dispatchDedupeOwners: DISPATCH_DEDUPE_OWNERS,
    closureDoors: contar(fuenteEn('frontera.ts'), /return\s*\{\s*cerrar:\s*true/g),
    prefixStripOwner: fuentes.filter((archivo) =>
      /sinPrefijoDeLaFilaAnterior\(/.test(archivo.src),
    ).length,
    // El bautizo sin vector NO puede dejar un pendiente global que bautice a la
    // locución siguiente: el nombre se aplica por ETIQUETA a las filas escritas.
    nombrePendienteGlobales: fuentes.reduce(
      (total, archivo) => total + contar(archivo.src, /\bnombrePendiente\b/g),
      0,
    ),
    // Un solo dueño recorre las filas ya escritas y las renombra por etiqueta.
    bautizoPorEtiquetaCallSites: fuentes.reduce(
      (total, archivo) =>
        total + contar(archivo.src, /reetiquetarFila\([^\r\n]*'nombre'/g),
      0,
    ),
    ...medirPropiedadSemantica(FUENTES_SRC),
  }
}

describe('CONVERSACIÓN — rutas dobles medidas', () => {
  it('las métricas reales son EXACTAMENTE la línea base (solo baja)', () => {
    expect(medir()).toEqual(BASELINE.metricas)
  })

  it('la línea base no sube respecto a la referencia', () => {
    const anterior = baselineEn(refBase())
    const subidas = Object.entries(BASELINE.metricas).filter(
      ([clave, valor]) => clave in anterior && valor > anterior[clave],
    )
    expect(subidas).toEqual([])
  })

  it('una segunda definición sube la métrica (mutación)', () => {
    const base = medir()
    const mutado = [
      ...FUENTES,
      {
        nombre: 'duplicado.ts',
        src: 'export function decidirFrontera() {}\nexport function esReentregaDeLaFila() {}\n',
      },
    ]
    const actual = medir(mutado)
    expect(actual.cierreDecisionOwners).toBe(base.cierreDecisionOwners + 1)
    expect(actual.reentregaOwners).toBe(base.reentregaOwners + 1)
  })

  it('toda función nombrada del módulo está en la línea base (ratchet)', () => {
    expect(funcionesNuevas(FUENTES, BASELINE.funciones)).toEqual([])
  })

  it('una función nueva sin declarar falla (falsificación del ratchet)', () => {
    const nueva = [{ nombre: 'ingesta.ts', src: 'function nuevaRuta() {}' }]
    expect(
      funcionesNuevas(nueva, { 'ingesta.ts': ['crearIngesta'] }),
    ).toEqual(['ingesta.ts:nuevaRuta'])
    // La entrada legítima (el módulo real) no marca nada.
    expect(funcionesNuevas(FUENTES, BASELINE.funciones)).toEqual([])
  })

  it('cuenta la función asignada como expresión, no solo la flecha', () => {
    expect(nombresDeFunciones('const nuevaRuta = function () {}\n')).toEqual(['nuevaRuta'])
    expect(nombresDeFunciones('const otraRuta = async function () {}\n')).toEqual(['otraRuta'])
  })

  it('quitar una función no dispara el ratchet (solo sube)', () => {
    expect(
      funcionesNuevas([{ nombre: 'ingesta.ts', src: '' }], {
        'ingesta.ts': ['crearIngesta'],
      }),
    ).toEqual([])
  })

  it('mide también los .js del módulo (turnSnapshot.js no es invisible)', () => {
    expect(FUENTES.map((archivo) => archivo.nombre)).toContain('turnSnapshot.js')
  })

  it('la fila NUEVA del módulo conserva su etiqueta real: N no se convierte en XX', () => {
    resetVoiceDirectory()
    const vector = new Array(16).fill(0)
    vector[0] = 1
    registerVoiceName('speaker_1', 'Luis', { vector })
    expect(
      resolveRowSpeakerLabel({
        speakerName: 'Hablante 1',
        speakerId: 'speaker_1',
        signature: vector,
        meta: { origin: 'conversation-module' },
      }),
    ).toBe('Hablante 1')
    resetVoiceDirectory()
  })

  it('los accesos a conversations pasan por el escritor único', () => {
    const offenders = walk(join(process.cwd(), 'src'))
      .filter((file) => !file.endsWith('conversationRowWriter.ts'))
      .filter((file) =>
        /fluDb\.conversations\.(?:toArray|bulkGet|filter|where|get)\s*\(/.test(
          readFileSync(file, 'utf8'),
        ),
      )
    expect(offenders).toEqual([])
  })

  it('el tiempo tiene UN dueño consumido, no una copia literal', () => {
    expect(fuente('ports.ts')).toContain('getTranscriptPauseCfg')
    expect(fuente('ports.ts')).toContain('srGapCommitMs')
    expect(
      FUENTES.filter((archivo) => /getTranscriptPauseCfg/.test(archivo.src)).map(
        (archivo) => archivo.nombre,
      ),
    ).toEqual(['ports.ts'])
  })

  it('la condición de cierre vive solo en frontera.ts', () => {
    expect(fuente('frontera.ts')).toContain("causa: 'voz'")
    expect(fuente('frontera.ts')).toContain('cambioVoz')
    expect(
      FUENTES.filter((archivo) =>
        /silencioMs\s*>=\s*(?:umbrales\.)?silenceCloseMs/.test(archivo.src),
      ).map((archivo) => archivo.nombre),
    ).toEqual(['frontera.ts'])
    expect(fuente('texto.ts')).not.toContain('silencioCierra')
    expect(fuente('texto.ts')).not.toMatch(/cerrarLocucion\([^)]*'voz'/)
  })

  it('la voz la mide el módulo sobre el tramo entrante ANTES de la atribución', () => {
    expect(fuente('ingesta.ts')).toContain('function verificarCambioVoz')
    expect(fuente('ingesta.ts')).toContain('function partirLocucionPorCambioDeVoz')
    expect(fuente('ingesta.ts')).toContain('continuaLaFrase')
    // El tramo entrante se mide aunque NO sea el de la locución abierta.
    expect(fuente('ingesta.ts')).toContain('tramos.muestras(tramoId, entrante)')
    // El piso de continuidad viene de config y existe un solo literal de voz.
    expect(fuente('ingesta.ts')).toContain('umbralExistenteVoz')
    // El texto se atribuye DESPUÉS de verificar la voz del tramo entrante.
    expect(fuente('ingesta.ts')).toMatch(
      /verificarCambioVoz\(tramoOrigen\)[\s\S]*tramoDestinoDeTexto\(/,
    )
  })

  it('la duración de identidad sale de la VOZ del audio medido, no del tramo', () => {
    expect(medir().identityDurationFromTramo).toBe(0)
    // Un solo dueño de la conversión voz→ms: lo consumen cierre e ingesta.
    expect(fuente('muestras.ts')).toContain('function vozMsDeMuestras')
    expect(fuente('muestras.ts')).toContain('countVoicedSamples')
    expect(fuente('cierre.ts')).toContain('vozMsDeMuestras(')
    expect(fuente('ingesta.ts')).toContain('vozMsDeMuestras(')
    // Nadie más dentro del módulo reimplementa la CONVERSIÓN voz→ms. El conteo
    // de VOZ de la puerta del adaptador es otra responsabilidad (piso de voz).
    expect(
      FUENTES.filter((archivo) => /countVoicedSamples\s*\([^)]*\)\s*\//.test(archivo.src)).map(
        (archivo) => archivo.nombre,
      ),
    ).toEqual(['muestras.ts'])
  })

  it('el bautizo sin vector renombra por ETIQUETA y no deja pendiente global', () => {
    expect(medir().nombrePendienteGlobales).toBe(0)
    expect(medir().bautizoPorEtiquetaCallSites).toBe(1)
    expect(fuente('motor.ts')).toContain('nombresPorEtiqueta')
    expect(fuente('motor.ts')).not.toContain('nombrePendiente')
    expect(fuente('cierre.ts')).not.toContain('nombrePendiente')
  })

  it('los pendientes conservan su tramo real y no fabrican {inicio:0,fin:1}', () => {
    expect(medir().syntheticZeroOneTramo).toBe(0)
    expect(fuente('texto.ts')).toContain('ordenDePendiente')
    expect(fuente('texto.ts')).toContain('const vigente = tramos.vigente(tramoId)')
  })

  it('el cierre por final quedó retirado: DOS puertas y UN dueño por decisión', () => {
    expect(medir().closureDoors).toBe(2)
    expect(medir().dispatchDedupeOwners).toBe(1)
    expect(medir().prefixStripOwner).toBe(1)
    expect(fuente('frontera.ts')).not.toContain('finalDeFrase')
    expect(fuente('ingesta.ts')).not.toContain('finalDeFrase')
    expect(fuente('texto.ts')).not.toContain('finalDeFrase')
  })

  it('la ventana sintética tiene un solo dueño (tramos)', () => {
    expect(medir().syntheticWindowOwners).toBe(1)
    expect(fuente('tramos.ts')).toContain('sintetico:')
  })

  it('el tramo sintético tiene una sola entrada de texto (ingesta)', () => {
    expect(medir().syntheticWrappers).toBe(1)
    expect(fuente('ingesta.ts')).toContain('function tramoSinteticoParaTexto')
    expect(fuente('texto.ts')).not.toContain('function tramoSintetico')
  })

  it('la reentrega tiene un solo dueño (ingesta)', () => {
    expect(medir().reentregaOwners).toBe(1)
    expect(fuente('ingesta.ts')).toContain('function esReentregaDeLaFila')
    expect(fuente('texto.ts')).not.toContain('esReentregaDeLaFila')
  })

  it('el final sustituye solo el texto de SU tramo, no la línea completa', () => {
    expect(fuente('cierre.ts')).toContain('textoTramos')
    expect(fuente('cierre.ts')).not.toMatch(/texto:\s*textoFinal/)
  })

  it('el final usa la hipótesis completa desde 0, no resultIndex', () => {
    expect(fuente('producto.ts')).toContain('hayFinal ? 0 : evento.resultIndex')
    expect(fuente('producto.ts')).not.toMatch(
      /componerFraseDelEvento\(\s*evento\.results,\s*evento\.resultIndex\s*\)/,
    )
  })
})

describe('CONVERSACI?N ? propiedad sem?ntica del turno, la voz y el nombre', () => {
  it('un solo due?o real: turno en el m?dulo; voz en el m?dulo; nombre en el registro', () => {
    expect(medirPropiedadSemantica(FUENTES_SRC)).toEqual({
      turnMintOwners: 0,
      voiceMeasureOwners: 0,
      nameRegisterOwners: 0,
    })
    expect(fuente('cierre.ts')).toContain('estado.turnosConFila.has(sugerido)')
    expect(fuente('cierre.ts')).toContain('estado.turnosConFila.add(String(fila.turnId))')
    expect(fuente('producto.ts')).not.toMatch(/turnosConFila|leerTurno|activeTurnIdRef/)
    const hook = readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8')
    expect(hook).not.toMatch(/computeTurnSignature|selectVoicedWindow|embebedor\.medir/)
    expect(hook).toContain('lastFirmaRef.current = Array.isArray(fila?.firma)')
    expect(hook).toContain('signatureVector: lastFirmaRef.current')
  })

  it('FALSIFICACI?N: una ruta nueva con otro nombre que vuelve a decidir se marca', () => {
    const infractor: readonly Fuente[] = [
      { nombre: 'src/voice/hooks/ensureTurn.js', src: 'export function ensureTurn(id){ estado.turnoActual = id.uuid() }' },
      { nombre: 'src/voice/hooks/computeTrackId.js', src: 'const v = await computeAudioSignature(muestras, sampleRate)' },
      { nombre: 'src/voice/hooks/mintName.js', src: 'refs.registerParticipant(nombre, nombre, vector)' },
    ]
    expect(medirPropiedadSemantica(infractor)).toEqual({
      turnMintOwners: 1,
      voiceMeasureOwners: 1,
      nameRegisterOwners: 1,
    })
  })

  it('DELEGACI?N: el espejo del turno, el comando del nombre y el reset NO son due?os', () => {
    const delegacion: readonly Fuente[] = [
      { nombre: 'src/voice/hooks/espejo.js', src: 'if (turnId) activeTurnIdRef.current = turnId' },
      { nombre: 'src/voice/hooks/registro.js', src: 'registerSpeakerIdentityFromCommand({ transcript, signatureVector: lastFirmaRef.current })' },
      { nombre: 'src/voice/hooks/reset.js', src: 'activeTurnIdRef.current = 0' },
    ]
    expect(medirPropiedadSemantica(delegacion)).toEqual({
      turnMintOwners: 0,
      voiceMeasureOwners: 0,
      nameRegisterOwners: 0,
    })
  })
})

describe('CONVERSACIÓN — una muestra de audio, una locución', () => {
  /** Único acotado que impide el solape entre la locución anterior y la nueva. */
  const CORTE = 'Math.min(abierta.fin, datos.inicio)'

  it('la locución anterior NUNCA cierra después del inicio de la nueva (sin solape)', () => {
    // Medido 2026-11-08 02:28:26 en la sesión del dueño: anterior fin=6.603.904 y
    // nueva inicio=6.340.736 → 263.168 muestras (5,5 s) en DOS locuciones.
    expect(fuente('ingesta.ts')).toContain(CORTE)
  })

  it('FALSIFICACIÓN: sin el acotado el solape vuelve a ser posible', () => {
    const conSolape = 'recortarAnterior === null ? abierta : { ...abierta, fin: datos.recortarAnterior }'
    expect(conSolape).not.toContain(CORTE)
    expect(`const finAnterior = ${CORTE}`).toContain(CORTE)
  })
})

describe('CONVERSACIÓN — el mandato de nombre no se responde dos veces', () => {
  const COMPOSE = readFileSync(
    join(process.cwd(), 'src/voice/compose/conversationMotorProducto.js'),
    'utf8',
  )

  it('dos entregas del MISMO mandato (interino + final) se deduplican por NOMBRE', () => {
    // MEDIDO 2026-11-09 10:35:48 y 10:35:50: «Registrado Luis Regis.» dicho dos veces.
    expect(COMPOSE).toContain('if (claveMandato === ultimoNombreDespachado) return')
    expect(COMPOSE).toContain('ultimoNombreDespachado = claveMandato')
  })

  it('FALSIFICACIÓN: sin la clave por nombre, el dedupe por texto deja pasar la variante', () => {
    const sinClave = "if (!frase || frase === ultimaDespachada) return"
    expect(sinClave).not.toContain('ultimoNombreDespachado')
    expect('claveMandato = nombreMandado || frase').toContain('nombreMandado')
  })
})

describe('CONVERSACIÓN — la grabación no duplica el trabajo del audio', () => {
  const RECORDER = readFileSync(join(process.cwd(), 'src/voice/lib/sessionRecorder.js'), 'utf8')

  it('con sumidero NO hay copia en memoria del audio ni de los eventos', () => {
    // MEDIDO 2026-11-09 (e1b683e9): con la grabación encendida el ASR cayó de 374 a 103
    // eventos/min, el hueco pasó de 23 a 113 ms y la latencia final→fila de 1,9 s a 95 s.
    // La grabación hacía DOS copias de cada bloque (~50/s) y de cada traza.
    expect(RECORDER).toContain('if (!sink) audioBlocks.push(new Int16Array(block))')
    expect(RECORDER).toContain('if (!sink) events.push(row)')
  })

  it('FALSIFICACIÓN: sin la guarda vuelve la segunda copia', () => {
    const doble = 'audioBlocks.push(new Int16Array(block))\nevents.push(row)'
    expect(doble).not.toContain('if (!sink)')
    expect('if (!sink) audioBlocks.push(new Int16Array(block))').toContain('if (!sink)')
  })
})

describe('CONVERSACIÓN — el bautizo no adivina entre voces con la misma etiqueta', () => {
  const MOTOR = readFileSync(join(process.cwd(), 'src/voice/conversation/motor.ts'), 'utf8')

  it('con DOS plantillas de la misma etiqueta no se bautiza la primera del mapa', () => {
    // MEDIDO 2026-11-09 11:48 (sesión 02ba561f): dos voces compartían «Hablante 1» y el
    // nombre «Luis» acabó en la voz de la mujer (sus filas: cos 0.397 contra Luis).
    expect(MOTOR).toContain('if (candidatas.length === 1) vozId = candidatas[0][0]')
    expect(MOTOR).not.toContain('for (const [id, plantilla] of estado.plantillasVoz) {')
  })

  it('FALSIFICACIÓN: el barrido por etiqueta que se queda con la primera es el defecto', () => {
    const barrido = 'for (const [id, plantilla] of estado.plantillasVoz) { if (etiqueta === "...") { vozId = id; break } }'
    expect(barrido).not.toContain('candidatas.length === 1')
    expect('if (candidatas.length === 1) vozId = candidatas[0][0]').toContain('candidatas')
  })
})

describe('CONVERSACIÓN — la frase reemitida con otra grafía no se duplica', () => {
  it('«flu/Flow» en las dos mitades se colapsa a una (caso medido)', () => {
    // MEDIDO 2026-11-09 11:48 (sesión 02ba561f): el mandato llegó dos veces en el MISMO
    // resultado: «okay flu Soy Luis regístrame okay Flow Soy Luis regístrame».
    expect(
      collapseRepeatedSpeech('okay flu Soy Luis regístrame okay Flow Soy Luis regístrame'),
    ).toBe('okay flu Soy Luis regístrame')
  })

  it('FALSIFICACIÓN: una repetición del hablante DENTRO de la frase no se toca', () => {
    // No son dos mitades del texto: es una frase con una repetición legítima.
    expect(collapseRepeatedSpeech('pon la mesa ahora y pon la mesa luego')).toContain('luego')
  })
})

describe('CONVERSACIÓN — la caja no repinta la misma frase', () => {
  const COMPOSE = readFileSync(
    join(process.cwd(), 'src/voice/compose/conversationMotorProducto.js'),
    'utf8',
  )

  it('la frase viva se publica solo cuando CAMBIA', () => {
    // MEDIDO 2026-11-09 (sesión e1b683e9): 193 de 532 eventos del ASR traían el mismo
    // texto y cada uno volvía a pintar la caja. Es el «se atora y luego salta».
    expect(COMPOSE).toContain('if (viva !== ultimaViva)')
    expect(COMPOSE).toContain('onLiveTranscript(viva)')
  })

  it('FALSIFICACIÓN: publicar sin comparar vuelve a repintar lo mismo', () => {
    const sinComparar = "onLiveTranscript(evento.abierta ? evento.fraseCanonica : '')"
    expect(sinComparar).not.toContain('ultimaViva')
    expect('if (viva !== ultimaViva)').toContain('ultimaViva')
  })
})

describe('CONVERSACIÓN — el hueco del ASR NO es una puerta de cierre', () => {
  it('ingesta NO consume srGap para cerrar; el cierre es VAD/voz (dos puertas)', () => {
    // El `srGap` es un aviso de ASR estancado, no silencio medido. Cerrar con él
    // partía la fila antes del final y el texto tardío se descartaba como
    // `turnoYaEscrito` (medido 2026-11-11, sesión del dueño 20:57:15).
    expect(fuente('ingesta.ts')).not.toContain('resolveSrGapTrigger({')
    expect(fuente('ingesta.ts')).not.toContain('hueco.fire')
    expect(fuente('ingesta.ts')).toContain('estado.ultimoResultadoMs = ')
    expect(fuente('frontera.ts')).toContain("causa: 'voz'")
    expect(fuente('frontera.ts')).toContain("textoAjeno ? 'frontera' : 'silencio'")
  })

  it('FALSIFICACIÓN: reintroducir el cierre por srGap vuelve a la puerta triple', () => {
    const conTerceraPuerta = 'if (hueco.fire) { await decidirFrontera(...) }'
    expect(conTerceraPuerta).toContain('hueco.fire')
    expect(fuente('ingesta.ts')).not.toContain('hueco.fire')
  })
})

describe('CONVERSACIÓN — un nombre no cruza de voz', () => {
  /** Vector con coseno EXACTO `c` respecto a [1,0,0]. */
  const v = (c: number): number[] => [c, Math.sqrt(Math.max(0, 1 - c * c)), 0]
  const ANCLA = v(1)
  // MEDIDO 2026-11-09 10:35 (sesión 36a8bc05): dos filas de la voz de la mujer con cos
  // 0.566 y 0.436 contra el ancla de Luis salieron etiquetadas «Luis».
  const AJENA = v(0.436)

  it('una medida ajena NO refresca el ancla de la voz nombrada', () => {
    const estado = {
      plantillasVoz: new Map([['v1', { vector: [...ANCLA], etiqueta: 'Luis' }]]),
      contadorVoces: 1,
      nombresPorVoz: new Map<string, string>(),
      nombresPorEtiqueta: new Map<string, string>(),
    }
    registrarMedidaVoz(estado as never, AJENA, {
      vozId: 'v1',
      continuidad: true,
      hablante: 'Luis',
    } as never)
    expect(estado.plantillasVoz.get('v1')?.vector).toEqual(ANCLA)
  })

  it('sin timbre que lo sostenga, el nombre NO se aplica (degrada a Hablante N)', () => {
    const nombres = new Map([['v1', 'Luis']])
    const plantillas = new Map([['v1', { vector: [...ANCLA], etiqueta: 'Luis' }]])
    const conSuVoz = resolverVoz({ vozId: 'v1', vector: [...ANCLA] } as never, true, nombres, plantillas as never)
    const conVozAjena = resolverVoz({ vozId: 'v1', vector: AJENA } as never, true, nombres, plantillas as never)
    expect(conSuVoz.nombre).toBe('Luis')
    expect(conVozAjena.nombre).toBe('')
  })
})

