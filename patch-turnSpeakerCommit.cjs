const fs = require('fs')
const p = 'src/voice/lib/turnSpeakerCommit.js'
let s = fs.readFileSync(p, 'utf8')
const nl = s.includes('\r\n') ? '\r\n' : '\n'

// 1) Import del dueno de etiquetas por voz.
s = s.replace(
  "import { normalizeSpeakerLabel } from './voiceIdentity.js'",
  "import { normalizeSpeakerLabel, findLabelsWithSharedVoice } from './voiceIdentity.js'",
)

// 2) Captura de la etiqueta ANTERIOR antes de pisarla con el nombre.
const anchorA = "  const name = normalizeSpeakerLabel(resolved?.speakerName)" + nl + '  if (!name) return'
if (!s.includes(anchorA)) throw new Error('anchorA no encontrado')
s = s.replace(
  anchorA,
  anchorA + nl + "  const previous = normalizeSpeakerLabel(refs.lastLoggedSpeakerRef?.current || refs.lastSpeakerRef?.current || '')",
)

// 3) Renombre de TODA la participacion previa cuando el nombre entra por TEXTO.
const anchorB = [
  '  if (resolved.workingClusters?.length) {',
  '    if (typeof refs.setSpeakerClusters === \'function\') {',
  '      refs.setSpeakerClusters(resolved.workingClusters)',
  '    } else if (refs.speakerClustersRef) {',
  '      refs.speakerClustersRef.current = resolved.workingClusters',
  '    }',
  '  }',
].join(nl)
if (!s.includes(anchorB)) throw new Error('anchorB no encontrado')
const rename = [
  '  // #8 (requisito del dueno; NO depende del microfono): identificado el hablante',
  '  // (soy Luis lo detecta el TEXTO), TODA su participacion previa lleva su nombre.',
  '  // Etiquetas: la que ese hablante venia usando (fila anterior) MAS las que el',
  '  // dueno de clusters sabe que son la MISMA voz.',
  "  if (resolved?.source === 'wake-intro' && typeof refs.renameSpeakerRows === 'function') {",
  '    const clusters = refs.speakerClustersRef?.current || []',
  '    const labels = [previous, ...findLabelsWithSharedVoice(clusters, name)].filter(Boolean)',
  '    refs.renameSpeakerRows(labels, name)',
  '  }',
].join(nl)
s = s.replace(anchorB, anchorB + nl + rename)

fs.writeFileSync(p, s)
console.log('ok', nl === '\r\n' ? 'CRLF' : 'LF')
