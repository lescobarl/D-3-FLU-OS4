/**
 * C13 - catchSilencioso: ningun catch traga el error sin registrarlo CON su excepcion.
 *
 * ENDURECIDO (P2.1). La regla anterior aceptaba `logCaughtError('contexto')` a secas:
 * registraba el HECHO pero perdia la EXCEPCION. Medido antes del cambio: 124 llamadas
 * de 1 argumento, 117 catch sin binding y 19 catch que solo hacian console.warn.
 * Un guard que da por bueno eso no discrimina. Criterio nuevo:
 *   1. `ignorado: <motivo>` -> omision deliberada declarada, SOLO si va en un
 *      COMENTARIO y CON motivo. Antes bastaba con que el texto apareciera en el
 *      cuerpo: el mensaje de un console.warn que decia "teardown ignorado:" se
 *      colaba como "declaracion" siendo una CADENA; y una declaracion sin motivo
 *      tambien pasaba. (P7.9)
 *   2. propaga (throw / reject( / emit* / setError / onError / reportError) -> ok.
 *   3. si no, REGISTRA en el registro central Y lleva la excepcion:
 *      - el catch debe DECLARAR un binding (no vale `catch {`);
 *      - debe existir una llamada DIRECTA a logCaughtError;
 *      - cada llamada debe tener >= 2 argumentos y referenciar el binding.
 *   4. `.catch(handler)` tambien: es un trago silencioso si el handler no registra,
 *      no propaga y ni siquiera usa el rechazo. Antes solo miraba el handler VACIO,
 *      asi que `.catch(() => undefined)` o `.catch(() => '')` (que tragan igual)
 *      pasaban sin decir nada. (P7.9)
 *
 * El analisis es por AST (TypeScript), no por regex: no confunde `catch` dentro de
 * comentarios o cadenas y distingue los catch ANIDADOS.
 *
 * El segundo describe comprueba el propio detector: un guard de conteo que nunca puede
 * fallar no es una barrera (AGENTS.md 0.12). Si el detector no marca una entrada
 * infractora sintetica, el guard es decorativo.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const PROP = /\b(throw|reject\s*\(|emit\w*\s*\(|setError|onError|reportError)\b/
/** Omision DECLARADA: `ignorado:` en un COMENTARIO y con motivo. Una cadena que
 *  contenga el texto no declara nada (era el agujero de P7.9). */
const IGN_DECL = /\/\*[\s\S]*?ignorado:\s*\S[\s\S]*?\*\/|\/\/[^\n]*ignorado:\s*\S/
export type Violation = { line: number; kind: string; detail: string }
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) acc.push(p)
  }
  return acc
}
function kindOf(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.ts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}
function contains(n: ts.Node, pos: number): boolean {
  return n.pos <= pos && pos < n.end
}
function bindingOf(c: ts.CatchClause): string {
  const d = c.variableDeclaration
  return d && ts.isIdentifier(d.name) ? d.name.text : ''
}
function countArgs(inner: string): number {
  if (inner.trim() === '') return 0
  let d = 0
  let n = 0
  for (const ch of inner) {
    if ('([{'.includes(ch)) d += 1
    else if (')]}'.includes(ch)) d -= 1
    else if (ch === ',' && d === 0) n += 1
  }
  return n + 1
}
/** Detecta las infracciones de C13 en un fuente dado. */
export function findViolations(src: string, fileName = 'synthetic.ts'): Violation[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, kindOf(fileName))
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1
  const log: ts.CallExpression[] = []
  const cat: ts.CatchClause[] = []
  const gather = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'logCaughtError') log.push(n)
    if (ts.isCatchClause(n)) cat.push(n)
    ts.forEachChild(n, gather)
  }
  gather(sf)
  // Las llamadas de un catch anidado pertenecen al catch INTERNO, no al externo.
  const direct = (c: ts.CatchClause, nodes: ts.CallExpression[]): ts.CallExpression[] =>
    nodes.filter(
      (n) =>
        contains(c.block, n.pos) &&
        !cat.some(
          (o) => o !== c && contains(c.block, o.block.pos) && o.block.end <= c.block.end && contains(o.block, n.pos),
        ),
    )
  const out: Violation[] = []
  for (const c of cat) {
    const body = src.slice(c.block.getStart(sf), c.block.end)
    if (IGN_DECL.test(body)) continue
    if (PROP.test(body)) continue
    const calls = direct(c, log)
    if (calls.length === 0) {
      out.push({ line: line(c.getStart(sf)), kind: 'sinRegistro', detail: 'catch sin registro ni propagacion' })
      continue
    }
    const binding = bindingOf(c)
    if (!binding) {
      out.push({ line: line(c.getStart(sf)), kind: 'sinBinding', detail: 'catch {} no puede registrar la excepcion' })
      continue
    }
    for (const call of calls) {
      const t = src.slice(call.getStart(sf), call.getEnd())
      const inner = t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))
      const hasBind = new RegExp('\\b' + binding + '\\b').test(inner)
      if (countArgs(inner) < 2 || !hasBind) {
        out.push({ line: line(call.getStart(sf)), kind: 'sinExcepcion', detail: 'logCaughtError sin la excepcion' })
      }
    }
  }
  // `.catch(() => {})`: handler vacio = error tragado.
  // REGLA P7.9: un handler de .catch() traga el rechazo si no lo registra, no lo
  // propaga y ni siquiera lo usa. Antes solo miraba el handler VACIO, asi que
  // `.catch(() => undefined)` o `.catch(() => '')` pasaban sin decir nada.
  const registra = (cuerpo: string): boolean =>
    /logCaughtError\s*\(/.test(cuerpo) || /\bthrow\b/.test(cuerpo)
  const scanCatch = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'catch' &&
      n.arguments.length === 1
    ) {
      const a = n.arguments[0]
      if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) {
        const cuerpo = a.body.getText(sf)
        if (!IGN_DECL.test(cuerpo) && !registra(cuerpo)) {
          const p = a.parameters[0]
          const usa = !!p && ts.isIdentifier(p.name) && new RegExp('\\b' + p.name.text + '\\b').test(cuerpo)
          if (!usa) {
            out.push({ line: line(n.getStart(sf)), kind: 'catchPromesa', detail: '.catch() no registra el rechazo' })
          }
        }
      }
    }
    ts.forEachChild(n, scanCatch)
  }
  scanCatch(sf)
  return out
}
describe('C13 catchSilencioso - todo catch registra la excepcion con su contexto', () => {
  it('no hay bloques catch que traguen el error ni registren sin la excepcion', () => {
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      const rel = relative(ROOT, f).replace(/\\/g, '/')
      for (const v of findViolations(readFileSync(f, 'utf8'), f)) {
        offenders.push(`${rel}:${v.line}: ${v.detail}`)
      }
    }
    expect(
      offenders,
      `Catches que pierden la excepcion (N=${offenders.length}):\n  ${offenders.slice(0, 40).join('\n  ')}${
        offenders.length > 40 ? '\n  ...' : ''
      }`,
    ).toEqual([])
  })
})
describe('C13 catchSilencioso - el detector no es decorativo', () => {
  it('marca un catch que solo hace console.warn (el hecho sin la excepcion)', () => {
    expect(findViolations('try { f() } catch (e) { console.warn("x", e) }')).toHaveLength(1)
  })
  it('marca logCaughtError sin la excepcion (la regla vieja lo daba por bueno)', () => {
    expect(findViolations("try { f() } catch (e) { logCaughtError('x') }")).toHaveLength(1)
  })
  it('marca un catch sin binding, que no puede aportar la excepcion', () => {
    expect(findViolations("try { f() } catch { logCaughtError('x', 1) }")).toHaveLength(1)
  })
  it('marca un handler .catch vacio', () => {
    expect(findViolations('p.catch(() => {})')).toHaveLength(1)
  })
  it('no marca un catch que registra contexto + excepcion', () => {
    expect(findViolations("try { f() } catch (e) { logCaughtError('x', e) }")).toHaveLength(0)
  })
  it('no marca un catch que propaga', () => {
    expect(findViolations('try { f() } catch (e) { throw new Error(String(e)) }')).toHaveLength(0)
  })
  it('marca el agujero viejo: el texto en una CADENA no declara omision (P7.9)', () => {
    expect(findViolations("try { f() } catch (err) { console.warn('teardown ignorado:', err) }")).toHaveLength(1)
  })
  it('marca una declaracion sin motivo', () => {
    expect(findViolations('try { f() } catch (e) { /* ignorado: */ }')).toHaveLength(1)
  })
  it('marca .catch con handler NO vacio que traga el rechazo (P7.9)', () => {
    expect(findViolations('p.catch(() => undefined)')).toHaveLength(1)
    expect(findViolations("p.catch(() => '')")).toHaveLength(1)
    expect(findViolations('p.catch(function () {})')).toHaveLength(1)
    expect(findViolations('p.catch(() => { setReady(true) })')).toHaveLength(1)
  })
  it('no marca .catch que usa el rechazo (lenidad deliberada: evita falsos positivos)', () => {
    // Asimetria a proposito: el bloque `catch` debe ir al registro CENTRAL, pero un
    // handler de .catch que al menos usa el rechazo no se marca, para no ensuciar
    // los reporters propios (setError, warn contextual, ...).
    expect(findViolations('p.catch((e) => { console.warn(e) })')).toHaveLength(0)
  })
  it('no marca .catch que registra, propaga o usa el rechazo', () => {
    expect(findViolations("p.catch((e) => { logCaughtError('x', e) })")).toHaveLength(0)
    expect(findViolations('p.catch((e) => { throw e })')).toHaveLength(0)
    expect(findViolations('p.catch((e) => { reportar(e) })')).toHaveLength(0)
  })
  it('no marca .catch con omision declarada', () => {
    expect(findViolations('p.catch(() => { /* ignorado: arranque del SW */ })')).toHaveLength(0)
  })
  it('no marca un catch con omision declarada', () => {
    expect(findViolations('try { f() } catch { /* ignorado: caso esperado */ }')).toHaveLength(0)
  })
  it('no confunde un catch anidado con el externo', () => {
    const src =
      "try { f() } catch (e) { try { g() } catch (e2) { logCaughtError('y', e2) } logCaughtError('x', e) }"
    expect(findViolations(src)).toHaveLength(0)
    const bad =
      "try { f() } catch (e) { try { g() } catch (e2) { logCaughtError('y') } logCaughtError('x', e) }"
    expect(findViolations(bad)).toHaveLength(1)
  })
  it('no se deja enganar por la palabra catch dentro de un comentario', () => {
    expect(findViolations("// catch (e) { logCaughtError('x') }\nconst a = 1")).toHaveLength(0)
  })
})