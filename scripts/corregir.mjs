#!/usr/bin/env node
/**
 * corregir.mjs — emite las ÓRDENES DE TRABAJO para corregir TODOS los defectos
 * detectados por scripts/auditoria.mjs, una por una, con su gate.
 *
 *   node scripts/corregir.mjs            -> plan completo (todas las órdenes)
 *   node scripts/corregir.mjs --next     -> la primera PENDIENTE (gate rojo) y su orden
 *   node scripts/corregir.mjs --id V1    -> una orden concreta
 *   node scripts/corregir.mjs --prompt   -> PROMPT maestro para la sesión ejecutora
 *
 * El gate de cada orden es:  node scripts/auditoria.mjs --strict --only <ID>
 * (rojo antes / verde después). El script NO toca src: ordena y verifica.
 */
import { spawnSync } from 'node:child_process'

// Orden recomendado: simple/seguro primero, riesgoso al final.
const ORDER = ['V9', 'V7', 'V5', 'V8', 'V1', 'V4', 'V2', 'V6', 'D5', 'D2', 'D3', 'D4', 'V3a', 'V3b', 'V3c', 'V3d', 'V3e']

const ORDERS = {
  V9: {
    title: 'Borrar/justificar residuo debug-dev',
    allow: ['src/dev/**', 'src/voice/lib/fluDebug.js', 'src/voice/lib/fluTrace.js', 'src/voice/lib/listenLog.js'],
    steps: [
      'Elimina src/dev/asrLab y los archivos fluDebug/fluTrace/listenLog si no se usan en producción.',
      'Si son intencionales, documéntalo y añádelos a una allowlist justificada en auditoria.mjs (cambio de criterio).',
    ],
    stop: 'No borres nada que tenga import vivo: comprueba con rg antes.',
  },
  V7: {
    title: 'Test e2e deshabilitado',
    allow: ['tests/e2e/comandos-usuario-luis.spec.ts'],
    steps: ['Re-habilita (quita describe.skip) o borra el test si es falso positivo confirmado.'],
    stop: 'No lo re-habilités si inyecta contract:{} y da falso positivo (debe usar Gemini real).',
  },
  V5: {
    title: 'Contenido quemado en musicPlayer (archive.org / SoundHelix)',
    allow: ['src/services/musicPlayer.ts', 'src/core/config/**', 'src/voice/lib/fluConfig.js'],
    steps: ['Mueve las URLs y SOUNDHELIX_BASE_URL a config; el código solo lee config.'],
    stop: 'No cambies las canciones; solo su origen (config).',
  },
  V8: {
    title: 'URLs de ejemplo hardcodeadas en appConfig',
    allow: ['src/core/config/appConfig.ts'],
    steps: ['Mueve la lista de conectividad ("example.com", "one.one.one.one") a config/entorno.'],
    stop: 'No cambies el comportamiento del chequeo.',
  },
  V1: {
    title: 'IDs con Date.now()+Math.random() -> UUIDv4 (§3.6)',
    allow: ['src/App.tsx', 'src/lib/goalTracker.ts', 'src/core/autonomy/backupSystem.ts', 'src/core/autonomy/autoRecovery.ts', 'src/core/autonomy/useAutonomyIntegration.ts', 'src/services/gemini.ts', 'src/services/deepseek.ts', 'src/services/videoAssembler.ts'],
    steps: ['Reemplaza cada id por crypto.randomUUID() (con fallback si el entorno lo requiere).'],
    stop: 'No cambies el formato de ids que ya se persisten (migraría datos). Solo los generados en runtime.',
  },
  V4: {
    title: 'console.log residual en src',
    allow: ['src/**'],
    steps: ['Quita los console.log sueltos. Los gateados por debug pueden quedarse (justificar).'],
    stop: 'No toques console.error/warn de diagnóstico.',
  },
  V2: {
    title: 'Catch vacíos que silencian (§2.6)',
    allow: ['src/voice/hooks/useFluVoiceAssistant.js', 'src/voice/lib/gemini.js'],
    steps: ['En teardown de audio: comenta por qué se ignora. En el resto: log + rethrow con contexto.'],
    stop: 'No silencies un error nuevo; si lo ignoras, justifícalo.',
  },
  V6: {
    title: 'Monkey-patch global THREE.PropertyBinding',
    allow: ['src/avatar/lib/masterBinding.ts', 'src/avatar/**'],
    steps: ['Sustituye el parche por la API pública de Three.js o confina la inicialización.'],
    stop: 'No rompas el binding del avatar; valida con el modelo cargando.',
  },
  D5: {
    title: 'Utils/voice duplicados (misma lógica)',
    allow: ['src/lib/textUtils.ts', 'src/voice/lib/audioMath.js', 'src/voice/lib/voiceIdentity.js', 'src/voice/lib/conversationStream.js', 'src/voice/lib/fluTranscriptPause.js', 'src/voice/lib/transcriptDelta.js', 'src/voice/lib/turnTranscript.js', 'src/voice/lib/activeListen.js', 'src/voice/lib/speechMerge.js', 'src/core/days/dayRollover.ts', 'src/core/browser/browserSession.ts'],
    steps: [
      'normalizeSpaces/cleanForSpeech: dueño src/lib/textUtils.ts; audioMath re-exporta.',
      'compareAudioSignatures: dueño en audioMath; voiceIdentity delega.',
      'countSpeechWords/getTranscriptDelta/wouldShrinkLog: elige UNO y el otro delega.',
      'dayKey: unifica a una firma (Date|number).',
    ],
    stop: 'NO reescribas lógica: delega/re-exporta. Si un par difiere de verdad, repórtalo.',
  },
  D2: {
    title: 'Participantes duplicados (lib vs voice/lib) — CANDIDATO',
    allow: ['src/lib/fluParticipant.ts', 'src/voice/lib/participantFloor.js', 'scripts/auditoria.mjs'],
    steps: [
      'PASO 1 (verificar, NO fusionar): compara par a par cada simbolo (JS vs TS/config).',
      'PASO 2: unifica SOLO los identicos (un dueno, el otro delega).',
      'PASO 3: los que difieran de verdad -> reportalos para ALLOW_COLLISION (los aplica el AUTOR).',
    ],
    stop: 'Prohibido re-exportar un par que no sea identico: seria regresion (leccion D5).',
  },
  D3: {
    title: 'Minutos: 2 idénticos (re-export)',
    allow: ['src/lib/minuteKnowledgeHelpers.ts', 'src/voice/lib/minuteKnowledge.js'],
    steps: [
      'Idénticos confirmados: parseMinuteHistoryCode y parseMinuteSequenceFromQuery.',
      'Dueño canónico: src/lib/minuteKnowledgeHelpers.ts (TS).',
      'src/voice/lib/minuteKnowledge.js RE-EXPORTA esos 2 desde el dueño. NO redefinir ni reescribir.',
      'Los otros 6 ya están en ALLOW_COLLISION (autor): no tocarlos.',
    ],
    stop: 'Solo re-export de los 2. No tocar los 6 allowlisted ni tests.',
  },
  D4: {
    title: 'Persistencia: consolidacion + migracion (AUTORIZADO con condiciones)',
    allow: ['src/core/db/fluDatabase.ts', 'src/voice/lib/fluStorage.js', 'src/hooks/useSessionPersistence.ts'],
    steps: [
      'AUTORIZADO: audit logs -> Dexie (fluDatabase); session -> localStorage (useSessionPersistence).',
      'Migracion one-shot IDEMPOTENTE desde raw IDB. NO borrar datos hasta verificar lectura.',
      'fluStorage DELEGA en el dueño (no redeclara).',
      'Test de comportamiento: escribir por API nueva, leer lo migrado, clearAuditLogs idempotente.',
    ],
    stop: 'Sin migracion idempotente + test de comportamiento verde, NO cerrar. Si dudas, DETENTE.',
  },
  V3a: { title: '`as any` appConfig -> 0', allow: ['src/core/config/appConfig.ts'], steps: ['Tipar de verdad; quitar los 24 `as any`.'], stop: 'Sin romper typecheck.' },
  V3b: { title: '`as any` App.tsx -> 0', allow: ['src/App.tsx'], steps: ['Reducir por bloques, tipando de verdad.'], stop: 'Incremental; no romper typecheck.' },
  V3c: { title: '`as any` src/components/** -> 0', allow: ['src/components/**'], steps: ['Tipar de verdad, componente por componente.'], stop: 'Incremental.' },
  V3d: { title: '`as any` src/hooks/** -> 0', allow: ['src/hooks/**'], steps: ['Tipar de verdad.'], stop: 'Incremental.' },
  V3e: { title: '`as any` resto de src -> 0', allow: ['src/**'], steps: ['Tipar de verdad (avatar/core/dev/lib/services/store).'], stop: 'Incremental; subdividir si hace falta.' },
}

const argv = process.argv.slice(2)
const idArg = argv.find((a) => a.startsWith('--id'))
const ID = idArg ? (idArg.split('=')[1] || argv[argv.indexOf(idArg) + 1]) : null
const PROMPT = argv.includes('--prompt')
const NEXT = argv.includes('--next')

const gateOf = (id) => `node scripts/auditoria.mjs --strict --only ${id}`
const gateFails = (id) => spawnSync(gateOf(id), { shell: true, encoding: 'utf8' }).status !== 0

function orderText(id) {
  const o = ORDERS[id]
  if (!o) return `(sin orden para ${id})`
  return [
    `### ${id} — ${o.title}`,
    `Gate (rojo antes / verde después):  ${gateOf(id)}`,
    `Archivos permitidos: ${(o.allow || ['(decidir)']).join(', ')}`,
    'Pasos:',
    ...o.steps.map((s) => `  - ${s}`),
    `PARAR SI: ${o.stop}`,
    '',
  ].join('\n')
}

if (PROMPT) {
  const status = ORDER.map((id) => ({ id, pending: gateFails(id) }))
  const pending = status.filter((s) => s.pending).map((s) => s.id)
  const done = status.filter((s) => !s.pending).map((s) => s.id)
  console.log(`PROMPT PARA LA SESIÓN EJECUTORA (un hallazgo por vez, en este orden):

Reglas duras:
- Un (1) hallazgo por turno, en el orden indicado. No agrupar. No "de paso".
- Para cada uno: corre el gate, debe salir ROJO; implementa; corre el gate, debe salir VERDE.
- Prohibido editar tests existentes, el catálogo (scripts/auditoria.mjs), guards o frozen.
- Prohibido reescribir lógica en las unificaciones: el otro archivo DELEGA/re-exporta.
- Hallazgo fuera de alcance: anótalo y sigue.
- Cierra con la salida cruda del gate (antes roja / después verde). Sin "listo/hecho".

Ya en META (OMITIDOS, no tocar): ${done.join(', ') || '(ninguno)'}
Pendientes (${pending.length}):
`)
  for (const id of pending) console.log(orderText(id))
  console.log(`\nEmpieza por la primera pendiente:  node scripts/corregir.mjs --next`)
} else if (ID) {
  console.log(orderText(ID))
} else if (NEXT) {
  const pending = ORDER.find((id) => gateFails(id))
  if (!pending) console.log('✅ No hay defectos pendientes en el catálogo.')
  else {
    console.log(`Siguiente pendiente: ${pending}\n`)
    console.log(orderText(pending))
  }
} else {
  console.log(`\n[ORDEN DE TRABAJO] ${ORDER.length} defectos (${ORDER.length} hitos).\n`)
  for (const id of ORDER) {
    const o = ORDERS[id]
    console.log(`— ${id}: ${o.title}   (gate: auditoria --strict --only ${id})`)
  }
  console.log(`\nDetalle:  node scripts/corregir.mjs --id <ID>   |   Prompt:  node scripts/corregir.mjs --prompt`)
}
