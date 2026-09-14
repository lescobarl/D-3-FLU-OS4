#!/usr/bin/env node
/**
 * auditoria.mjs — CATÁLOGO COMPLETO de hallazgos + medidor + guard por hito.
 * UN SOLO ARCHIVO, sin dependencias.
 *
 *   node scripts/auditoria.mjs               -> reporte completo (HOY vs META), exit 0
 *   node scripts/auditoria.mjs --strict      -> exit 1 si ALGÚN hallazgo supera su META
 *   node scripts/auditoria.mjs --only D1     -> solo ese hallazgo (o varios: D1,V2)
 *   node scripts/auditoria.mjs --strict --only D1   -> gate de un hito
 *   node scripts/auditoria.mjs --json        -> salida JSON
 *
 * Regla: cada hallazgo tiene detector, META y severidad. Un hito es "verde" cuando
 * su(s) hallazgo(s) llegan a META sin subir ningún otro.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const TESTS = join(ROOT, 'tests')
const argv = process.argv.slice(2)
const STRICT = argv.includes('--strict')
const JSONOUT = argv.includes('--json')
const onlyArg = argv.find((a) => a.startsWith('--only'))
const ONLY = onlyArg
  ? (onlyArg.split('=')[1] || argv[argv.indexOf(onlyArg) + 1] || '').split(',').map((s) => s.trim()).filter(Boolean)
  : null

// ---------------- infra de escaneo ----------------
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) acc.push(p)
  }
  return acc
}
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/')
const srcFiles = walk(SRC)
const testFiles = walk(TESTS)
const readLines = (f) => readFileSync(f, 'utf8').split(/\r?\n/)

/** Devuelve `archivo:linea:contenido` para cada línea que matchea. */
function grep(files, re) {
  const out = []
  for (const f of files) {
    readLines(f).forEach((line, i) => {
      if (re.test(line)) out.push(`${rel(f)}:${i + 1}:${line.trim().slice(0, 90)}`)
    })
  }
  return out
}
const notDev = (f) => !rel(f).startsWith('src/dev/')

const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line)
/** grep que IGNORA comentarios (documentación no es hardcode). */
function grepCode(files, re) {
  const out = []
  for (const f of files) {
    readLines(f).forEach((line, i) => {
      if (isCommentLine(line)) return
      if (re.test(line)) out.push(`${rel(f)}:${i + 1}:${line.trim().slice(0, 90)}`)
    })
  }
  return out
}
const isConfigPath = (p) =>
  p.includes('/config/') || /(appConfig|fluConfig|visualConfig|musicCatalog)\.(ts|js)$/.test(p)
// Código que NO es config (el hardcode en config es legítimo, §2.2).
const srcCodeFiles = srcFiles.filter((f) => !isConfigPath(rel(f)))

/** Cuenta definiciones `export [async] function|const|class <name>` de una lista, en todo src. */
function countExportFns(files, names) {
  const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+(${names.join('|')})\\b`)
  return grep(files, re)
}

// ---------------- catálogo de hallazgos ----------------
// REAL_DUP: misma lógica implementada en 2 archivos, ambos vivos.
const SCHEDULER = ['isDue', 'collectDue', 'collectDueOrdered']
const PARTICIPANT = [
  'FLU_PARTICIPANT_PHASES',
  'createFluParticipantState', 'buildParticipantLogWindow', 'formatParticipantLogForPrompt',
  'shouldEvaluateParticipantOnTurn', 'advanceParticipantTurnCounter', 'normalizeParticipantEvaluation',
  'applyParticipantEvaluation', 'dismissRaisedHand', 'consumeRaisedDraft', 'shouldAutoDismissRaisedHand',
  'resolveParticipantUiPresentation', 'canGrantParticipantFloor', 'shouldIgnoreParticipantFloorGrant',
  'canScheduleParticipantEvaluation',
]
const MINUTE = [
  'parseMinuteHistoryCode', 'parseMinuteSequenceFromQuery',
]
const STORAGE = ['addAuditLog', 'clearAuditLogs']

// Utils verificados como IDENTICOS (unifica solo estos).
const UTILS_INTERNAL = ['compareAudioSignatures', 'countSpeechWords', 'getTranscriptDelta']

// Debug/dev INTENCIONAL y CABLEADO (gated por env/DEV). Verificado import vivo:
// no es basura. Si se quiere eliminar, es un hito aparte (quitar el wiring).
const DEBUG_ALLOWLIST = new Set([
  'src/dev/asrLab/AsrLab.tsx',  // import dinamico en src/main.tsx gated por isAsrLab (env)
  'src/voice/lib/fluDebug.js',  // usado por useFluVoiceAssistant.js y conversationStreamCommit.js
  'src/voice/lib/fluTrace.js',  // sink de trazas referenciado por server/geminiProxy.ts
  'src/voice/lib/listenLog.js', // usado por useFluVoiceAssistant.js
])

// Nombres ya agrupados en D1..D5 (los cubre el detector catch-all D0 también).
const KNOWN_GROUPS = new Set([...SCHEDULER, ...PARTICIPANT, ...MINUTE, ...STORAGE, ...UTILS_INTERNAL])
// Colisiones de nombre verificadas como NO duplicación (dominio/forma distinta).
const ALLOW_COLLISION = new Set([
  'editableFieldsOf',        // paleta vs ambiente: distinta forma de dato
  'emptyEditableFields',     // idem
  'resolveGeminiApiKey',     // appConfig (sin arg) vs gemini.js (con arg)
  'stripDiacritics',         // gameUtils (no lowercase) vs audioMath (lowercase): distinto comportamiento
  'uncheckAll',              // ShoppingItem.checked vs Note.done: distinto dominio
  'buildGenerationPrompt',   // docs (GenerationInput) vs visual (workspace): distinto dominio
  'formatSpeakerLabel',      // activeListen (index,cfg) vs voiceIdentity (label,confidence)
  'resolveConversationSpeaker', // activeListen (strings) vs voiceIdentity (objeto con firma)
  'getAsrSegmentationCfg',   // fluTranscriptMotor (throw si falta) vs asrTurnSegmentation (default {})
  // Pares verificados como MISMO NOMBRE pero DISTINTA logica (no unificar; seria regresion):
  'normalizeForMatch',       // 3 impls (lower/collapse difieren)
  'normalizeSpaces',         // textUtils String(s||'') vs audioMath String(x): difiere en null/undefined
  'cleanForSpeech',          // idem normalizeSpaces
  'hasToken',                // regex/flag distintos
  'dayKey',                  // number (dayRollover) vs Date (browserSession)
  'wouldShrinkLog',          // activeListen (2 args) vs speechMerge (3 args + checks extra)
  // Verificados como mismo nombre pero distinta logica (D2/D3, 2026-09-14):
  'resolveFluParticipantLabel',      // fluParticipant.ts usa mapa hardcodeado; participantFloor.js lee config
  'recordParticipantIntervention',   // fluParticipant.ts (state,now) vs theoryOfMind.ts (ToMState,name,text)
  'findMinuteRecordBySequence',      // helpers ordena lexicografico; js usa compareMinuteHistoryCodeDesc
  'resolveMinuteThemeForSpeech',     // helpers stub isGenericMinuteSessionTheme (siempre false); js config-based
  'createMinuteDraftFromSummary',    // helpers tema_sesion=normalizeSpaces(theme); js usa summary?.tema_sesion||theme
  'formatMinuteDraftText',           // helpers MINUTE_FIELDS hardcodeado; js FLU_CONFIG.ui.minuteFields
  'buildMinuteKnowledgeBase2',       // helpers acepta options.diary; js no
  'formatMinuteHistoryLabel',        // useMinuteKnowledge .trim() sin fallback; js normalizeSpaces+fallback titulo
  'saveSessionState',                // useSessionPersistence (localStorage, SessionState UI) vs fluStorage (IDB voz: phase/history)
  'loadSessionState',                // idem saveSessionState
])

/** TODOS los símbolos exportados definidos en >1 archivo (catch-all). */
function duplicateExportedSymbols() {
  const re = /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/
  const map = new Map() // name -> Set(archivo)
  for (const f of srcFiles) {
    const seen = new Set()
    for (const line of readLines(f)) {
      const m = re.exec(line)
      if (!m || seen.has(m[1])) continue
      seen.add(m[1])
      if (!map.has(m[1])) map.set(m[1], new Set())
      map.get(m[1]).add(rel(f))
    }
  }
  return [...map.entries()].filter(([, fs]) => fs.size > 1)
}

const FINDINGS = [
  {
    id: 'D0', sev: 'alta', info: false, title: 'CATCH-ALL: símbolos exportados definidos en >1 archivo (no clasificados)',
    target: 0,
    detect: () =>
      duplicateExportedSymbols()
        .filter(([n]) => !KNOWN_GROUPS.has(n) && !ALLOW_COLLISION.has(n))
        .map(([n, fs]) => `${n} -> ${[...fs].join(', ')}`),
    note: 'Cualquier nombre aquí es duplicación no clasificada. Clasifícala (hito) o justifícala en ALLOW_COLLISION.',
  },
  // -------- duplicación estructural real --------
  {
    id: 'D1', sev: 'alta', title: 'Scheduler: definiciones de la lógica (isDue/collectDue/collectDueOrdered)',
    hito: 1, target: SCHEDULER.length,
    // Solo `export function` = definición real. Los adaptadores `export const` que
    // delegan en el dueño están PERMITIDOS (por eso este hallazgo ya está en META).
    detect: () => grep(srcFiles, /export\s+function\s+(isDue|collectDue|collectDueOrdered)\b/),
    note: 'Dueño: src/core/temporal/scheduleEngine.ts. reminderScheduler.ts adapta (export const) o re-exporta.',
  },
  {
    id: 'D2', sev: 'alta', title: 'Participantes duplicados (lib vs voice/lib)',
    hito: 3, target: PARTICIPANT.length,
    detect: () => countExportFns(srcFiles, PARTICIPANT),
    note: 'CANDIDATO: verificar par a par (JS vs TS/config). Solo unificar identicos; el resto a ALLOW_COLLISION.',
  },
  {
    id: 'D3', sev: 'alta', title: 'Minutos duplicados (helpers vs minuteKnowledge)',
    hito: 4, target: MINUTE.length,
    detect: () => countExportFns(srcFiles, MINUTE),
    note: 'CANDIDATO: verificar par a par antes de tocar. Duplicacion anidada (helpers importa minuteKnowledge).',
  },
  {
    id: 'D4', sev: 'muy alta', title: 'Persistencia duplicada (fluDatabase vs fluStorage)',
    hito: 5, target: STORAGE.length,
    detect: () => countExportFns(srcFiles, STORAGE),
    note: 'NO es re-export: fluDatabase (Dexie) vs fluStorage (IndexedDB) = backend distinto. Consolidacion + MIGRACION. Decision de arquitectura, no unificacion.',
  },
  {
    id: 'D5', sev: 'media', title: 'Utils identicos confirmados (un dueno por util)',
    hito: 2, target: UTILS_INTERNAL.length,
    detect: () => countExportFns(srcFiles, UTILS_INTERNAL),
    note: 'Solo verificados como IDENTICOS. Los parecidos-pero-distintos van a ALLOW_COLLISION (no se tocan).',
  },

  // -------- vicios contra AGENTS.md --------
  {
    id: 'V1', sev: 'alta', title: 'IDs con Date.now()+Math.random() (regla §3.6 UUIDv4)',
    target: 0,
    detect: () =>
      grep(srcFiles, /Math\.random\(\)/).filter((l) => /[A-Za-z_$]*[Ii][Dd]\b/.test(l)),
    note: 'Debe ser crypto.randomUUID() (conservando prefijos de id).',
  },
  {
    id: 'V2', sev: 'media', title: 'Catch vacío que silencia errores (§2.6)',
    target: 0, detect: () => grep(srcFiles, /catch\s*(\([^)]*\))?\s*\{\s*\}/),
    note: 'Teardown de audio podría ir a allowlist justificada.',
  },
  {
    id: 'V3a', sev: 'media', title: '`as any` en core/config/appConfig.ts',
    target: 0, detect: () => grep(srcFiles.filter((f) => rel(f) === 'src/core/config/appConfig.ts'), /\bas any\b/),
    note: 'Dominio pequeño; META 0.',
  },
  {
    id: 'V3b', sev: 'media', title: '`as any` en src/App.tsx',
    target: 0, detect: () => grep(srcFiles.filter((f) => rel(f) === 'src/App.tsx'), /\bas any\b/),
    note: '75 casos; por bloques.',
  },
  {
    id: 'V3c', sev: 'media', title: '`as any` en src/components/**',
    target: 0, detect: () => grep(srcFiles.filter((f) => rel(f).startsWith('src/components/')), /\bas any\b/),
    note: '53 casos.',
  },
  {
    id: 'V3d', sev: 'media', title: '`as any` en src/hooks/**',
    target: 0, detect: () => grep(srcFiles.filter((f) => rel(f).startsWith('src/hooks/')), /\bas any\b/),
    note: '29 casos.',
  },
  {
    id: 'V3e', sev: 'media', title: '`as any` resto de src (avatar/core/dev/lib/services/store/otros)',
    target: 0,
    detect: () =>
      grep(
        srcFiles.filter((f) => {
          const p = rel(f)
          return (
            p !== 'src/App.tsx' &&
            p !== 'src/core/config/appConfig.ts' &&
            !p.startsWith('src/components/') &&
            !p.startsWith('src/hooks/')
          )
        }),
        /\bas any\b/,
      ),
    note: '~29 casos; subdividir si hace falta.',
  },
  {
    id: 'V4', sev: 'baja', title: 'console.log residual en src',
    target: 0, detect: () => grep(srcFiles.filter(notDev), /console\.log/),
    note: 'Algunos gateados por debug; los sueltos se quitan.',
  },
  {
    id: 'V5', sev: 'media', title: 'Contenido quemado fuera de config (archive.org / SoundHelix)',
    target: 0, detect: () => grepCode(srcCodeFiles, /archive\.org|SOUNDHELIX_BASE_URL/),
    note: 'Debe venir de config (src/core/config). Config y comentarios no cuentan.',
  },
  {
    id: 'V6', sev: 'media', title: 'Monkey-patch global (THREE.PropertyBinding)',
    target: 0, detect: () => grep(srcFiles, /PropertyBinding\.create\s*=|masterBinding/),
    note: 'src/avatar/lib/masterBinding.ts parchea Three.js.',
  },
  {
    id: 'V7', sev: 'baja', title: 'Tests deshabilitados (.skip/.todo)',
    target: 0, detect: () => grep(testFiles, /describe\.skip|it\.skip|test\.skip|\.todo\(/),
    note: 'Re-habilitar o borrar.',
  },
  {
    id: 'V8', sev: 'baja', title: 'URLs de ejemplo hardcodeadas fuera de config',
    target: 0,
    detect: () => grepCode(srcCodeFiles, /https:\/\/example\.com|one\.one\.one\.one/),
    note: 'Si están en config y son env-overridable (VITE_*), cumplen §2.2. Config/comentarios no cuentan.',
  },
  {
    id: 'V9', sev: 'baja', title: 'Residuo de debug/dev (lab, trazas) fuera de la suite',
    target: 0,
    detect: () =>
      srcFiles
        .map(rel)
        .filter(
          (p) =>
            (p.startsWith('src/dev/') || /(fluDebug|listenLog|fluTrace)\.js$/.test(p)) &&
            !DEBUG_ALLOWLIST.has(p),
        ),
    note: 'Los intencionales y cableados están en DEBUG_ALLOWLIST (justificados). El resto: borrar.',
  },
  {
    id: 'V10', sev: 'media', title: 'Boilerplate fetch /api/gemini/contract (>=2 sitios)',
    target: 1,
    detect: () => grep(srcFiles, /fetch\('\/api\/gemini\/contract'/),
    note: 'Un helper postGeminiContract; una sola aparicion del fetch.',
  },
  {
    id: 'V11', sev: 'baja', title: 'new de dependencias dentro de la logica (§2.4)',
    target: 0,
    detect: () => grep(srcFiles, /new (DecisionEngine|BackupManager)\(/),
    note: 'Inyectar por interfaz; no instanciar dentro de la logica.',
  },

  // -------- nombres repetidos NO duplicados (no tocar) --------
  {
    id: 'N1', sev: 'info', info: true, title: 'Colisiones de nombre (distinto dominio) — NO unificar',
    target: 0, detect: () => [...ALLOW_COLLISION],
    note: 'Mismo nombre, forma de dato/dominio distinto. Se dejan. Ver ALLOW_COLLISION.',
  },
  {
    id: 'N2', sev: 'info', info: true, title: 'Deuda reconocida en comentario (analysisFallbacks.ts)',
    target: 0, detect: () => grep(srcFiles, /parches duplicados/),
    note: 'Comentario que reconoce el problema de duplicación; evidencia, no hallazgo accionable.',
  },
]

// ---------------- ejecución ----------------
const rows = ONLY ? FINDINGS.filter((f) => ONLY.includes(f.id)) : FINDINGS
const results = rows.map((f) => {
  const samples = f.detect()
  return { id: f.id, sev: f.sev, info: !!f.info, title: f.title, hito: f.hito ?? null, today: samples.length, target: f.target, note: f.note, samples }
})

if (JSONOUT) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.log(`\n[AUDITORIA] ${results.length} hallazgos · ${STRICT ? 'modo ESTRICTO' : 'reporte'}\n`)
  for (const r of results) {
    const flag = r.info ? 'ℹ️' : r.today <= r.target ? '✅' : '❌'
    console.log(`${flag} ${r.id} [${r.sev}] H${r.hito ?? '-'} HOY=${r.today} META=${r.info ? 'n/a' : r.target} — ${r.title}`)
    if (r.note) console.log(`     ${r.note}`)
    if (!r.info && r.today > r.target) {
      for (const s of r.samples.slice(0, 20)) console.log(`     - ${s}`)
      if (r.samples.length > 20) console.log(`     … (+${r.samples.length - 20} más)`)
    }
  }
  const over = results.filter((r) => !r.info && r.today > r.target)
  console.log(`\nResumen: ${results.filter((r) => !r.info).length - over.length}/${results.filter((r) => !r.info).length} hallazgos en META.`)
}

if (STRICT) {
  const over = results.filter((r) => !r.info && r.today > r.target)
  if (over.length) {
    console.error(`\n❌ ${over.length} hallazgo(s) por encima de META: ${over.map((r) => `${r.id}(${r.today}>${r.target})`).join(', ')}`)
    process.exit(1)
  }
  console.log('\n✅ Todos los hallazgos filtrados están en META.')
}
