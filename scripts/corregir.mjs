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
const ORDER = ['V9', 'V7', 'V5', 'V8', 'V1', 'V4', 'V2', 'V6', 'D5', 'D2', 'D3', 'D4', 'V3']

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
    title: 'Participantes duplicados (lib vs voice/lib)',
    allow: ['src/lib/fluParticipant.ts', 'src/voice/lib/participantFloor.js'],
    steps: ['Dueño src/lib/fluParticipant.ts; participantFloor.js delega/re-exporta. OJO: un componente importa ambos.'],
    stop: 'No cambies el comportamiento del floor/evaluación. Tests existentes intactos.',
  },
  D3: {
    title: 'Minutos duplicados (helpers vs minuteKnowledge)',
    allow: ['src/lib/minuteKnowledgeHelpers.ts', 'src/voice/lib/minuteKnowledge.js'],
    steps: ['Elige dueño (uno de los dos) y haz que el otro re-exporte. Rompe la duplicación anidada.'],
    stop: 'No toques tests existentes.',
  },
  D4: {
    title: 'Persistencia duplicada (RIESGO ALTO)',
    allow: ['src/core/db/fluDatabase.ts', 'src/voice/lib/fluStorage.js', 'src/hooks/useSessionPersistence.ts'],
    steps: ['Define UN dueño de persistencia. Requiere migración explícita y test de comportamiento.'],
    stop: 'PROHIBIDO tocar datos sin migración aprobada. Si hay duda, DETENTE.',
  },
  V3: {
    title: '`as any` masivo (214)',
    allow: ['src/**'],
    steps: ['Reduce por dominio (empezando por App.tsx y appConfig), tipando de verdad.'],
    stop: 'Incremental: no es un hito único; baja de a poco sin romper tipos.',
  },
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
  console.log(`PROMPT PARA LA SESIÓN EJECUTORA (un hallazgo por vez, en este orden):

Reglas duras:
- Un (1) hallazgo por turno, en el orden indicado. No agrupar. No "de paso".
- Para cada uno: corre el gate, debe salir ROJO; implementa; corre el gate, debe salir VERDE.
- Prohibido editar tests existentes, el catálogo (scripts/auditoria.mjs), guards o frozen.
- Prohibido reescribir lógica en las unificaciones: el otro archivo DELEGA/re-exporta.
- Hallazgo fuera de alcance: anótalo y sigue.
- Cierra con la salida cruda del gate (antes roja / después verde). Sin "listo/hecho".

Orden y órdenes:
`)
  for (const id of ORDER) console.log(orderText(id))
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
