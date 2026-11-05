#!/usr/bin/env node
/**
 * REVISOR DE FUNCIONES — se corre ANTES de crear una función nueva.
 *
 * No demuestra equivalencia semántica: eso no es decidible. Lo que hace es
 * ordenar candidatos medibles (pregunta, nombre, firma y clon normalizado) y
 * obligar a declarar un veredicto antes de escribir:
 *
 *   REUSAR <archivo:linea> | EXTENDER <archivo:linea> | CREAR NUEVO
 *
 * Uso:
 *   node scripts/revisor-funciones.mjs --pregunta "..." --nombre "..." [opciones]
 *
 * Sin `--veredicto` sale con código 3: el revisor no decide por ti, pero no te
 * deja avanzar sin haber mirado los candidatos. Con veredicto sale 0 e imprime
 * los trailers para el commit.
 *
 * Puertas: el hook PreToolUse, el hook commit-msg y el paso de CI usan esta
 * misma base. Una función nueva que se parezca a una existente exige una
 * declaración visible en su JSDoc:
 *
 *   @revisor CREAR NUEVO — <justificación>
 *
 * o los trailers de commit que imprime este script.
 *
 * LÍMITE DECLARADO: si la pregunta propuesta miente, el revisor se equivoca. La
 * equivalencia semántica total sigue siendo revisión del dueño; esto caza el
 * descuido y el copiar-pegar renombrado. Un clon >= 90 % de un cuerpo de >= 24
 * tokens bloquea por sí solo, aunque el nombre no comparta palabras.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(import.meta.dirname, '..')
const CASOS_RUTA = join(ROOT, 'scripts', 'rutas-dobles-baseline.json')
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const MIN_PUNTAJE = 0.25
const LIMITE_DEFECTO = 10
const CLON_MINIMO = 0.6
const CLON_BLOQUEO = 0.9
const MIN_TOKENS_CLON = 24

const AYUDA = `Uso:
  node scripts/revisor-funciones.mjs --pregunta "..." --nombre "..." [opciones]

Opciones:
  --parametros N      firma: numero de parametros
  --tipos a,b         firma: tipos (desempate)
  --retorno T         firma: tipo de retorno
  --borrador RUTA     cuerpo propuesto; activa la deteccion de clones
  --raiz DIR          raiz a indexar (defecto: src)
  --casos RUTA        catalogo de preguntas con dueno (defecto: scripts/rutas-dobles-baseline.json)
  --sin-casos         no consultar el catalogo
  --limite N          maximo de candidatos (defecto: 10)
  --veredicto V       reusar | extender | crear
  --destino A:L       archivo:linea del dueno (reusar/extender)
  --justificacion T   por que (obligatorio en crear)
  --json              salida maquina
  --ayuda             esta ayuda

Salida:
  0 veredicto declarado; 3 falta veredicto; 2 error de uso.

Declaracion de una funcion nueva (la exigen las puertas):
  En su JSDoc:  @revisor CREAR NUEVO — justificacion
  O en el commit: Revisor-Funciones: CREAR NUEVO
                  Revisor-Motivo: justificacion

Limite: no demuestra equivalencia semantica; ordena candidatos medibles y
obliga a decidir antes de crear. Un clon >= 90% de un cuerpo de >= 24 tokens
bloquea por si solo, aunque el nombre no comparta palabras. La decision final
es del agente/dueno.`

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'a',
  'por', 'para', 'con', 'sin', 'en', 'y', 'o', 'u', 'que', 'se', 'su', 'sus',
  'es', 'son', 'ser', 'estar', 'esta', 'este', 'estos', 'estas', 'esto', 'ese',
  'esa', 'esos', 'esas', 'eso', 'como', 'cual', 'cuales', 'cuando', 'donde',
  'segun', 'lo', 'le', 'les', 'me', 'te', 'nos', 'ya', 'no', 'si', 'mas',
  'pero', 'muy', 'hay', 'ha', 'han', 'he', 'fue', 'era', 'vez', 'solo', 'sola',
  'the', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'is', 'are',
  'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its',
  'by', 'with', 'without', 'from', 'as', 'if', 'then', 'than', 'so', 'not',
  'do', 'does', 'did', 'can', 'should', 'would', 'could', 'will', 'shall',
  'may', 'might', 'must', 'when', 'where', 'which', 'who', 'whom', 'whose',
  'what', 'how', 'why',
])

const SINONIMOS = new Map(
  Object.entries({
    ultima: 'ultima', ultimo: 'ultima', ultimas: 'ultima', ultimos: 'ultima',
    reciente: 'ultima', recientes: 'ultima', recient: 'ultima',
    fila: 'fila', filas: 'fila', linea: 'fila', lineas: 'fila', row: 'fila', rows: 'fila',
    fin: 'fin', final: 'fin', finales: 'fin', termina: 'fin', terminan: 'fin',
    termino: 'fin', end: 'fin', ends: 'fin', ending: 'fin',
    audio: 'audio', audios: 'audio', sonido: 'audio', sonidos: 'audio', sound: 'audio',
    crear: 'crear', crea: 'crear', crean: 'crear', construye: 'crear',
    construir: 'crear', genera: 'crear', generar: 'crear', haz: 'crear',
    make: 'crear', create: 'crear', creates: 'crear',
    obtener: 'obtener', obtiene: 'obtener', calcula: 'obtener', calcular: 'obtener',
    calculan: 'obtener', resuelve: 'obtener', resolver: 'obtener', busca: 'obtener',
    buscar: 'obtener', encuentra: 'obtener', encontrar: 'obtener', detecta: 'obtener',
    detectar: 'obtener', get: 'obtener', find: 'obtener', resolve: 'obtener',
    texto: 'texto', textos: 'texto', frase: 'texto', frases: 'texto',
    locucion: 'texto', locuciones: 'texto', text: 'texto',
    control: 'control', comando: 'control', comandos: 'control', orden: 'control',
    ordenes: 'control', command: 'control', commands: 'control',
    escucha: 'escucha', escuchar: 'escucha', listening: 'escucha', listen: 'escucha',
    cerrar: 'cerrar', cierra: 'cerrar', cierran: 'cerrar', cerrando: 'cerrar',
    cierre: 'cerrar', cierres: 'cerrar',
    detener: 'cerrar', deten: 'cerrar', parar: 'cerrar', apagar: 'cerrar',
    close: 'cerrar', stop: 'cerrar',
    abrir: 'abrir', abre: 'abrir', abran: 'abrir', abriendo: 'abrir',
    activar: 'abrir', open: 'abrir', start: 'abrir',
    pendiente: 'pendiente', pendientes: 'pendiente', pending: 'pendiente',
    entrega: 'entrega', reentrega: 'entrega', redelivery: 'entrega',
    nombre: 'nombre', nombres: 'nombre', name: 'nombre', names: 'nombre',
    identidad: 'identidad', identity: 'identidad',
    voz: 'voz', voces: 'voz', speaker: 'voz', speakers: 'voz',
    hablante: 'voz', hablantes: 'voz',
    dueno: 'dueno', duena: 'dueno', owner: 'dueno', owners: 'dueno',
    funcion: 'funcion', funciones: 'funcion', function: 'funcion', functions: 'funcion',
  }),
)

/**
 * Recorre un directorio y devuelve las rutas absolutas de los ficheros de codigo.
 * @param {string} dir Directorio raiz.
 * @returns {string[]} Rutas absolutas.
 */
export function walkCodeFiles(dir) {
  const salida = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) salida.push(...walkCodeFiles(full))
    else if (CODE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) salida.push(full)
  }
  return salida
}

/**
 * Plegado ligero de una palabra: plurales, no conjugaciones.
 * @param {string} palabra Palabra ya normalizada.
 * @returns {string} Raiz ligera.
 */
function stemLigero(palabra) {
  if (palabra.length >= 6 && palabra.endsWith('es')) return palabra.slice(0, -2)
  if (palabra.length >= 5 && palabra.endsWith('s') && !palabra.endsWith('ss')) {
    return palabra.slice(0, -1)
  }
  return palabra
}

/**
 * Palabras de contenido de un texto: camelCase partido, sin tildes, minusculas,
 * sin stopwords y con sinonimos de dominio. Es una heuristica, no semantica.
 * @param {string} texto Texto libre.
 * @returns {string[]} Palabras canonicas sin repetir.
 */
export function palabras(texto) {
  const separado = String(texto || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  const crudas = separado
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const salida = []
  for (const cruda of crudas) {
    if (cruda.length < 3 || STOPWORDS.has(cruda)) continue
    const stem = stemLigero(cruda)
    const canonica = SINONIMOS.get(cruda) ?? SINONIMOS.get(stem) ?? stem
    if (canonica.length >= 3 && !STOPWORDS.has(canonica) && !salida.includes(canonica)) {
      salida.push(canonica)
    }
  }
  return salida
}

/**
 * Secuencia de tokens con identificadores y literales normalizados. Dos copias
 * renombradas producen la misma secuencia; una logica distinta, no.
 * @param {string} codigo Fuente o cuerpo de funcion.
 * @returns {string[]} Tokens normalizados.
 */
export function normalizarTokens(codigo) {
  const texto = String(codigo || '')
  if (!texto.trim()) return []
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, texto)
  const tokens = []
  let token = scanner.scan()
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.Identifier || token === ts.SyntaxKind.PrivateIdentifier) {
      tokens.push('ID')
    } else if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NumericLiteral ||
      token === ts.SyntaxKind.BigIntLiteral ||
      token === ts.SyntaxKind.RegularExpressionLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail ||
      token === ts.SyntaxKind.JsxText
    ) {
      tokens.push('LIT')
    } else {
      tokens.push(ts.tokenToString(token) ?? scanner.getTokenText())
    }
    token = scanner.scan()
  }
  return tokens
}

/**
 * Similitud entre dos secuencias normalizadas (n-gramas + tokens).
 * @param {string[]} a Secuencia propuesta.
 * @param {string[]} b Secuencia existente.
 * @returns {number} Similitud 0..1.
 */
export function similitudTokens(a, b) {
  if (a.length === 0 || b.length === 0) return 0
  if (a.length === b.length && a.every((token, i) => token === b[i])) return 1
  const n = Math.min(5, Math.max(2, Math.floor(Math.min(a.length, b.length) / 2)))
  const gramos = (arr) => {
    const set = new Set()
    for (let i = 0; i + n <= arr.length; i += 1) set.add(arr.slice(i, i + n).join(' '))
    return set
  }
  const A = gramos(a)
  const B = gramos(b)
  let inter = 0
  for (const gramo of A) if (B.has(gramo)) inter += 1
  const union = A.size + B.size - inter
  const jaccardGramos = union > 0 ? inter / union : 0
  const setA = new Set(a)
  const setB = new Set(b)
  let interTokens = 0
  for (const token of setA) if (setB.has(token)) interTokens += 1
  const unionTokens = setA.size + setB.size - interTokens
  const jaccardTokens = unionTokens > 0 ? interTokens / unionTokens : 0
  return Math.max(jaccardGramos, jaccardTokens)
}

/**
 * Jaccard entre dos listas de palabras.
 * @param {string[]} a Lista A.
 * @param {string[]} b Lista B.
 * @returns {number} Similitud 0..1.
 */
function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const item of A) if (B.has(item)) inter += 1
  return inter / (A.size + B.size - inter)
}

/**
 * Cobertura de A por B: cuantas palabras de la propuesta estan en el candidato.
 * @param {string[]} a Lista A.
 * @param {string[]} b Lista B.
 * @returns {number} Cobertura 0..1.
 */
function cobertura(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const item of A) if (B.has(item)) inter += 1
  return inter / Math.min(A.size, B.size)
}

/**
 * Similitud de pregunta: Jaccard, con credito parcial si la propuesta cabe
 * entera en un JSDoc mas largo.
 * @param {string[]} propuesta Palabras de la propuesta.
 * @param {string[]} candidato Palabras del candidato.
 * @returns {number} Similitud 0..1.
 */
function similitudPregunta(propuesta, candidato) {
  return Math.max(jaccard(propuesta, candidato), 0.85 * cobertura(propuesta, candidato))
}

/**
 * Tipo de script TypeScript segun la extension.
 * @param {string} archivo Nombre del archivo.
 * @returns {ts.ScriptKind} Tipo de script.
 */
function scriptKindDe(archivo) {
  if (/\.tsx$/i.test(archivo)) return ts.ScriptKind.TSX
  if (/\.jsx$/i.test(archivo)) return ts.ScriptKind.JSX
  if (/\.(js|mjs|cjs)$/i.test(archivo)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * Nombre legible de una propiedad de objeto.
 * @param {ts.PropertyName} nombre Nodo del nombre.
 * @param {ts.SourceFile} sf Fuente.
 * @returns {string} Nombre.
 */
function nombreDePropiedad(nombre, sf) {
  if (ts.isIdentifier(nombre) || ts.isPrivateIdentifier(nombre)) return nombre.text
  if (ts.isStringLiteral(nombre) || ts.isNumericLiteral(nombre)) return nombre.text
  return nombre.getText(sf)
}

/**
 * Texto del JSDoc que precede a un nodo.
 * @param {ts.Node} ancla Nodo de anclaje.
 * @param {ts.SourceFile} sf Fuente.
 * @returns {string} JSDoc limpio, o ''.
 */
function leerJsdoc(ancla, sf) {
  const rangos = ts.getLeadingCommentRanges(sf.text, ancla.getFullStart()) || []
  for (let i = rangos.length - 1; i >= 0; i -= 1) {
    const rango = rangos[i]
    if (rango.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    const crudo = sf.text.slice(rango.pos, rango.end)
    if (!crudo.startsWith('/**')) continue
    return crudo
      .replace(/^\/\*\*|\*\/$/g, '')
      .split('\n')
      .map((linea) => linea.replace(/^\s*\*\s?/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return ''
}

/**
 * ¿El nodo declara `export`?
 * @param {ts.Node} nodo Nodo con modificadores.
 * @returns {boolean} Exportado.
 */
function tieneExport(nodo) {
  return Boolean(
    nodo.modifiers?.some((modificador) => modificador.kind === ts.SyntaxKind.ExportKeyword),
  )
}

/**
 * Indexa las funciones de una fuente: declaraciones, arrows/funciones en
 * variables, metodos y propiedades de objeto. Incluye las anidadas.
 * @param {string} fuente Texto fuente.
 * @param {string} archivo Ruta para el informe.
 * @returns {object[]} Funciones indexadas.
 */
export function indexarFunciones(fuente, archivo = 'memoria.ts') {
  const texto = String(fuente || '')
  if (!texto.trim()) return []
  const sf = ts.createSourceFile(
    archivo,
    texto,
    ts.ScriptTarget.Latest,
    false,
    scriptKindDe(archivo),
  )
  const funciones = []

  const registrar = (nodo, completo, meta) => {
    const cuerpo = nodo.body
    if (!cuerpo) return
    const params = nodo.parameters ?? []
    const jsdoc = leerJsdoc(meta.ancla, sf)
    const linea = sf.getLineAndCharacterOfPosition(nodo.getStart(sf)).line + 1
    const textoCuerpo = cuerpo.getText(sf)
    funciones.push({
      archivo,
      linea,
      nombre: completo.split('.').pop(),
      nombreCompleto: completo,
      exportada: meta.exportada ?? tieneExport(nodo),
      params: params.length,
      tipos: params.map((param) => (param.type ? param.type.getText(sf) : '')),
      retorno: nodo.type ? nodo.type.getText(sf) : meta.tipo ? meta.tipo.getText(sf) : '',
      jsdoc,
      cuerpo: textoCuerpo,
      tokens: normalizarTokens(textoCuerpo),
    })
  }

  const visitar = (nodo, padre) => {
    if (ts.isFunctionDeclaration(nodo) && nodo.name) {
      const nombre = nodo.name.getText(sf)
      const completo = padre ? `${padre}.${nombre}` : nombre
      registrar(nodo, completo, { ancla: nodo })
      ts.forEachChild(nodo, (hijo) => visitar(hijo, completo))
      return
    }

    if (ts.isMethodDeclaration(nodo) && nodo.name) {
      const nombre = nombreDePropiedad(nodo.name, sf)
      const completo = padre ? `${padre}.${nombre}` : nombre
      registrar(nodo, completo, { ancla: nodo })
      ts.forEachChild(nodo, (hijo) => visitar(hijo, completo))
      return
    }

    if (ts.isClassDeclaration(nodo) && nodo.name) {
      const nombre = nodo.name.getText(sf)
      const completo = padre ? `${padre}.${nombre}` : nombre
      ts.forEachChild(nodo, (hijo) => visitar(hijo, completo))
      return
    }

    if (ts.isVariableStatement(nodo)) {
      const exportada = tieneExport(nodo)
      for (const decl of nodo.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) {
          if (decl.initializer) visitar(decl.initializer, padre)
          continue
        }
        const nombre = decl.name.getText(sf)
        const completo = padre ? `${padre}.${nombre}` : nombre
        const init = decl.initializer
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          registrar(init, completo, { ancla: nodo, exportada, tipo: decl.type })
        }
        if (init) visitar(init, completo)
      }
      return
    }

    if (ts.isPropertyAssignment(nodo) && nodo.name) {
      const nombre = nombreDePropiedad(nodo.name, sf)
      const completo = padre ? `${padre}.${nombre}` : nombre
      if (ts.isArrowFunction(nodo.initializer) || ts.isFunctionExpression(nodo.initializer)) {
        registrar(nodo.initializer, completo, { ancla: nodo })
      }
      visitar(nodo.initializer, completo)
      return
    }

    ts.forEachChild(nodo, (hijo) => visitar(hijo, padre))
  }

  ts.forEachChild(sf, (nodo) => visitar(nodo, ''))
  return funciones
}

/**
 * Indexa un arbol de codigo.
 * @param {string} [raiz] Raiz a indexar (defecto: src).
 * @param {string} [raizRelativa] Base de las rutas del informe (defecto: cwd).
 * @returns {object[]} Funciones de todos los ficheros.
 */
export function indexarRepo(raiz = join(ROOT, 'src'), raizRelativa = process.cwd()) {
  const absoluta = resolve(raiz)
  const base = resolve(raizRelativa)
  const funciones = []
  for (const abs of walkCodeFiles(absoluta)) {
    const fuente = readFileSync(abs, 'utf8')
    const rel = relative(base, abs).replace(/\\/g, '/')
    funciones.push(...indexarFunciones(fuente, rel))
  }
  return funciones
}

/**
 * Interpreta el catalogo de casos desde su texto JSON.
 * @param {string} texto Contenido del catalogo.
 * @returns {object[]} Casos.
 */
export function parseCasosRuta(texto) {
  try {
    const data = JSON.parse(texto)
    return Array.isArray(data.cases) ? data.cases : []
  } catch (error) {
    console.error(`[revisor-funciones] catalogo ilegible: ${error.message}`)
    return []
  }
}

/**
 * Carga los casos del guard de rutas dobles (preguntas ya declaradas con dueno).
 * @param {string} [ruta] Ruta del catalogo.
 * @returns {object[]} Casos.
 */
export function loadCasosRuta(ruta = CASOS_RUTA) {
  try {
    return parseCasosRuta(readFileSync(ruta, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error(`[revisor-funciones] no se pudo leer ${ruta}: ${error.message}`)
    }
    return []
  }
}

/**
 * Puntua una funcion contra la propuesta.
 * @param {object} propuesta Propuesta.
 * @param {object} funcion Funcion indexada.
 * @param {string[]} palabrasPregunta Palabras de la pregunta.
 * @param {string[]} palabrasNombre Palabras del nombre.
 * @param {string[]|null} tokensBorrador Borrador normalizado.
 * @returns {{puntaje: number, motivos: string[]}} Puntaje y motivos.
 */
function puntuarFuncion(propuesta, funcion, palabrasPregunta, palabrasNombre, tokensBorrador) {
  const doc = palabras(`${funcion.nombreCompleto} ${funcion.jsdoc}`)
  const pregunta = similitudPregunta(palabrasPregunta, doc)
  const nombreDoc = palabras(funcion.nombre)
  const nombreNorm = palabrasNombre.join(' ')
  const nombreFuncion = nombreDoc.join(' ')
  const contencionNombre =
    nombreNorm && nombreFuncion && (nombreFuncion.includes(nombreNorm) || nombreNorm.includes(nombreFuncion))
  const nombre = contencionNombre ? Math.max(jaccard(palabrasNombre, nombreDoc), 0.9) : jaccard(palabrasNombre, nombreDoc)
  const partes = [
    { valor: pregunta, peso: 0.6, motivo: null },
    { valor: nombre, peso: 0.3, motivo: null },
  ]
  const comunesPregunta = [...new Set(palabrasPregunta)].filter((palabra) => doc.includes(palabra))
  if (pregunta >= 0.3 && comunesPregunta.length > 0) {
    partes[0].motivo = `pregunta: ${comunesPregunta.slice(0, 5).join(', ')}`
  }
  const comunesNombre = [...new Set(palabrasNombre)].filter((palabra) => nombreDoc.includes(palabra))
  if (nombre >= 0.3 && comunesNombre.length > 0) {
    partes[1].motivo = `nombre: ${comunesNombre.slice(0, 5).join(', ')}`
  }
  if (propuesta.firma && Number.isInteger(propuesta.firma.parametros)) {
    const diff = Math.abs(funcion.params - propuesta.firma.parametros)
    const valor = diff === 0 ? 1 : diff === 1 ? 0.5 : 0
    partes.push({
      valor,
      peso: 0.1,
      motivo:
        diff === 0
          ? `firma: ${funcion.params} parametro(s)`
          : `firma distinta: ${funcion.params} vs ${propuesta.firma.parametros}`,
    })
  }
  let clon = 0
  if (tokensBorrador && tokensBorrador.length > 0) {
    clon = similitudTokens(tokensBorrador, funcion.tokens)
    partes.push({
      valor: clon,
      peso: 0.4,
      motivo: clon >= CLON_MINIMO ? `clon: ${Math.round(clon * 100)}% de tokens normalizados` : null,
    })
  }
  const pesoTotal = partes.reduce((total, parte) => total + parte.peso, 0)
  const promedio = partes.reduce((total, parte) => total + parte.valor * parte.peso, 0) / pesoTotal
  // Un clon casi exacto de un cuerpo sustancial no se diluye con el promedio:
  // un nombre distinto no lo salva. Los cuerpos diminutos no activan la regla.
  const puntaje =
    clon >= CLON_BLOQUEO && funcion.tokens.length >= MIN_TOKENS_CLON
      ? Math.max(promedio, clon)
      : promedio
  return {
    puntaje,
    clon,
    motivos: partes.map((parte) => parte.motivo).filter(Boolean),
  }
}

/**
 * Busca candidatos para una propuesta: funciones indexadas + casos declarados.
 * @param {object} propuesta Propuesta.
 * @param {object[]} [funciones] Funciones indexadas.
 * @param {object} [opciones] Opciones: casos, limite.
 * @returns {object[]} Candidatos ordenados.
 */
export function buscarCandidatos(propuesta, funciones = [], opciones = {}) {
  const pregunta = String(propuesta?.pregunta || '')
  const nombre = String(propuesta?.nombre || '')
  if (!pregunta && !nombre) return []
  const palabrasPregunta = palabras(pregunta)
  const palabrasNombre = palabras(nombre)
  const tokensBorrador = propuesta?.borrador ? normalizarTokens(propuesta.borrador) : null
  const limite =
    Number.isInteger(opciones.limite) && opciones.limite > 0 ? opciones.limite : LIMITE_DEFECTO
  const candidatosFuncion = []

  for (const funcion of funciones) {
    if (!funcion || !funcion.nombre) continue
    const { puntaje, clon, motivos } = puntuarFuncion(
      propuesta,
      funcion,
      palabrasPregunta,
      palabrasNombre,
      tokensBorrador,
    )
    if (puntaje < MIN_PUNTAJE) continue
    candidatosFuncion.push({
      origen: 'funcion',
      archivo: funcion.archivo,
      linea: funcion.linea,
      nombre: funcion.nombre,
      nombreCompleto: funcion.nombreCompleto,
      puntaje: Math.round(puntaje * 1000) / 1000,
      clon: Math.round(clon * 1000) / 1000,
      motivos,
    })
  }

  const candidatosCaso = []
  for (const caso of opciones.casos ?? []) {
    if (!caso || !caso.owner) continue
    const doc = palabras(`${caso.id || ''} ${caso.description || ''} ${caso.owner}`)
    const puntajePregunta = similitudPregunta(palabrasPregunta, doc)
    const puntajeNombre = jaccard(palabrasNombre, doc)
    const puntaje = 0.7 * puntajePregunta + 0.3 * puntajeNombre
    if (puntaje < MIN_PUNTAJE) continue
    const comunes = [...new Set(palabrasPregunta)].filter((palabra) => doc.includes(palabra))
    candidatosCaso.push({
      origen: 'caso',
      id: caso.id,
      owner: caso.owner,
      descripcion: caso.description,
      puntaje: Math.round(puntaje * 1000) / 1000,
      motivos: comunes.length > 0 ? [`pregunta: ${comunes.slice(0, 5).join(', ')}`] : [],
    })
  }

  const ordenar = (a, b) =>
    b.puntaje - a.puntaje ||
    String(a.archivo ?? a.owner ?? '').localeCompare(String(b.archivo ?? b.owner ?? ''))
  candidatosFuncion.sort(ordenar)
  candidatosCaso.sort(ordenar)

  // Si un caso visible nombra a su funcion duena en la descripcion, esa
  // funcion no puede quedar tapada por coincidencias lexicas genericas.
  const nombrados = new Map()
  for (const caso of candidatosCaso) {
    for (const identificador of String(caso.descripcion || '').match(/[A-Za-z_$][\w$]*/g) ?? []) {
      if (identificador.length >= 4) nombrados.set(identificador, caso)
    }
  }
  for (const candidato of candidatosFuncion) {
    const caso = nombrados.get(candidato.nombre)
    if (!caso || candidato.archivo !== caso.owner) continue
    candidato.puntaje = Math.max(candidato.puntaje, 0.9)
    if (!candidato.motivos.some((motivo) => motivo.startsWith('caso:'))) {
      candidato.motivos.push(`caso: ${caso.id} lo nombra`)
    }
  }
  candidatosFuncion.sort(ordenar)

  // Un caso declarado es una pregunta con dueno ya decidida: si pasa el
  // umbral, se muestra aunque el ruido lexico de las funciones lo supere.
  const casosVisibles = candidatosCaso.slice(0, limite)
  const cupoFunciones = Math.max(0, limite - casosVisibles.length)
  return [...casosVisibles, ...candidatosFuncion.slice(0, cupoFunciones)].sort(ordenar)
}

/**
 * Informe legible para el agente.
 * @param {object} propuesta Propuesta.
 * @param {object[]} candidatos Candidatos.
 * @param {number} totalFunciones Funciones indexadas.
 * @returns {string} Informe.
 */
export function formatearInforme(propuesta, candidatos, totalFunciones) {
  const lineas = [
    `[revisor-funciones] propuesta: «${propuesta.nombre}» — pregunta: «${propuesta.pregunta}»`,
    `[revisor-funciones] indice: ${totalFunciones} funciones.`,
  ]
  const casos = candidatos.filter((candidato) => candidato.origen === 'caso')
  const funciones = candidatos.filter((candidato) => candidato.origen === 'funcion')
  if (casos.length > 0) {
    lineas.push('', 'CASOS DECLARADOS QUE RESPONDEN LA MISMA PREGUNTA:')
    for (const caso of casos) {
      lineas.push(`  - ${caso.id} -> dueno ${caso.owner} (${caso.puntaje})`)
      if (caso.descripcion) lineas.push(`    ${caso.descripcion}`)
    }
  }
  if (funciones.length > 0) {
    lineas.push('', 'FUNCIONES CANDIDATAS:')
    funciones.forEach((candidato, indice) => {
      lineas.push(
        `  ${indice + 1}. ${candidato.archivo}:${candidato.linea} ${candidato.nombreCompleto} — ${candidato.puntaje}`,
      )
      for (const motivo of candidato.motivos) lineas.push(`     - ${motivo}`)
    })
  }
  if (candidatos.length === 0) {
    lineas.push('', 'No hay candidatos por encima del umbral.')
  }
  lineas.push(
    '',
    'VEREDICTO OBLIGATORIO: reusar | extender | crear. Sin veredicto, el revisor sale con codigo 3.',
  )
  return lineas.join('\n')
}

/**
 * Trailer de declaracion para el commit.
 * @param {object} args Argumentos validados.
 * @returns {string} Declaracion.
 */
function formatearDeclaracion(args) {
  const veredicto = args.veredicto === 'crear' ? 'CREAR NUEVO' : args.veredicto.toUpperCase()
  const destino = args.veredicto === 'crear' ? '' : ` ${args.destino}`
  const lineas = [`Revisor-Funciones: ${veredicto}${destino}`]
  if (args.justificacion) lineas.push(`Revisor-Motivo: ${args.justificacion}`)
  return lineas.join('\n')
}

/**
 * Lee los argumentos de la linea de comandos.
 * @param {string[]} argv Argumentos sin node ni script.
 * @returns {object} Argumentos.
 */
function parseArgs(argv) {
  const args = { limite: LIMITE_DEFECTO, raiz: join(ROOT, 'src'), casos: CASOS_RUTA }
  for (let i = 0; i < argv.length; i += 1) {
    const actual = argv[i]
    const siguiente = () => {
      i += 1
      return argv[i]
    }
    switch (actual) {
      case '--pregunta':
        args.pregunta = siguiente()
        break
      case '--nombre':
        args.nombre = siguiente()
        break
      case '--parametros':
        args.parametros = Number(siguiente())
        break
      case '--tipos':
        args.tipos = String(siguiente() || '')
          .split(',')
          .map((tipo) => tipo.trim())
          .filter(Boolean)
        break
      case '--retorno':
        args.retorno = siguiente()
        break
      case '--borrador':
        args.borradorRuta = siguiente()
        break
      case '--raiz':
        args.raiz = resolve(String(siguiente() || ''))
        break
      case '--casos':
        args.casos = resolve(String(siguiente() || ''))
        break
      case '--sin-casos':
        args.sinCasos = true
        break
      case '--limite':
        args.limite = Number(siguiente())
        break
      case '--veredicto':
        args.veredicto = String(siguiente() || '').toLowerCase()
        break
      case '--destino':
        args.destino = siguiente()
        break
      case '--justificacion':
        args.justificacion = siguiente()
        break
      case '--json':
        args.json = true
        break
      case '--ayuda':
      case '-h':
      case '--help':
        args.ayuda = true
        break
      default:
        if (actual.startsWith('--')) args.error = `argumento desconocido: ${actual}`
    }
  }
  return args
}

/**
 * Ejecuta el revisor.
 * @param {string[]} [argv] Argumentos.
 * @returns {number} Codigo de salida.
 */
export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.ayuda) {
    console.log(AYUDA)
    return 0
  }
  if (args.error) {
    console.error(`[revisor-funciones] ${args.error}`)
    return 2
  }
  if (!args.pregunta || !args.nombre) {
    console.error('[revisor-funciones] faltan --pregunta y --nombre')
    return 2
  }
  if (args.parametros !== undefined && (!Number.isInteger(args.parametros) || args.parametros < 0)) {
    console.error('[revisor-funciones] --parametros debe ser un entero >= 0')
    return 2
  }
  if (!Number.isInteger(args.limite) || args.limite <= 0) {
    console.error('[revisor-funciones] --limite debe ser un entero > 0')
    return 2
  }
  if (args.veredicto && !['reusar', 'extender', 'crear'].includes(args.veredicto)) {
    console.error('[revisor-funciones] --veredicto debe ser reusar | extender | crear')
    return 2
  }
  if (args.veredicto === 'crear' && !String(args.justificacion || '').trim()) {
    console.error('[revisor-funciones] crear exige --justificacion')
    return 2
  }
  if (
    (args.veredicto === 'reusar' || args.veredicto === 'extender') &&
    !/^.+:\d+$/.test(String(args.destino || ''))
  ) {
    console.error('[revisor-funciones] reusar/extender exigen --destino archivo:linea')
    return 2
  }

  let borrador = ''
  if (args.borradorRuta) {
    try {
      borrador = readFileSync(args.borradorRuta, 'utf8')
    } catch (error) {
      console.error(`[revisor-funciones] no se pudo leer el borrador: ${error.message}`)
      return 2
    }
  }

  let funciones
  try {
    funciones = indexarRepo(args.raiz, ROOT)
  } catch (error) {
    console.error(`[revisor-funciones] no se pudo indexar ${args.raiz}: ${error.message}`)
    return 2
  }

  const casos = args.sinCasos ? [] : loadCasosRuta(args.casos)
  const propuesta = {
    pregunta: args.pregunta,
    nombre: args.nombre,
    firma: {
      parametros: args.parametros,
      tipos: args.tipos,
      retorno: args.retorno,
    },
    borrador,
  }
  const candidatos = buscarCandidatos(propuesta, funciones, { casos, limite: args.limite })
  const declaracion = args.veredicto ? formatearDeclaracion(args) : null

  if (args.json) {
    console.log(
      JSON.stringify(
        { propuesta, totalFunciones: funciones.length, candidatos, declaracion },
        null,
        2,
      ),
    )
  } else {
    console.log(formatearInforme(propuesta, candidatos, funciones.length))
    if (declaracion) {
      console.log('')
      console.log('DECLARACION:')
      console.log(declaracion)
    } else {
      console.log('')
      console.log('Sin veredicto: vuelve a correr con --veredicto reusar|extender|crear.')
    }
  }
  return args.veredicto ? 0 : 3
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
