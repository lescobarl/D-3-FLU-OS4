import { writeFileSync } from 'node:fs'

/**
 * REPORTE UNICO del replay: `report.json` + tabla de consola.
 *
 * El reporte lleva lo necesario para reproducir el veredicto sin volver a correr: sesion y
 * su fidelidad, eventos aplicados, MARCAS (grabadas vs inferidas), checks con su diff y la
 * clasificacion de la caja (perdida / duplicacion). El exit code lo decide el CLI.
 */

/** Marca de exito/diferencia para la tabla. */
const MARCA = { ok: 'OK  ', mismatch: 'DIFF' }

/**
 * Construye el reporte.
 * @param {object} input
 * @returns {object}
 */
export function buildReport(input) {
  const { checks = [], classification = {} } = input.comparison || {}
  const boxTrace = input.observed?.boxTrace || []
  return {
    schemaVersion: 1,
    scenario: input.scenario,
    mode: input.mode,
    status: input.status,
    exitCode: input.exitCode,
    approved: input.expected?.approved === true,
    session: {
      dir: input.session?.dir || '',
      commit: input.fidelity?.appCommit || 'unknown',
      configHash: input.fidelity?.configHash || 'unknown',
      modelIds: input.fidelity?.modelIds || [],
      language: input.fidelity?.language || '',
      sampleRate: input.fidelity?.sampleRate || 0,
      events: input.session?.events?.length || 0,
      turns: input.session?.turns?.length || 0,
      fidelityWarnings: input.fidelityWarnings || [],
    },
    thresholds: {
      boxStallMs: Number(input.boxStallMs) || 0,
      dupBlockWords: Number(input.dupBlockWords) || 0,
      variantWords: Number(input.variantWords) || 0,
      locucionSimilitud: Number(input.locucionSimilitud) || 0,
      timeoutMs: Number(input.timeoutMs) || 0,
    },
    expected: input.expectedPath,
    applied: input.observed?.applied || {},
    marks: input.observed?.marks || {},
    errors: input.observed?.errors || [],
    checks: checks.map(({ name, ok, detail }) => ({ name, ok, detail: detail || '' })),
    diffs: checks.flatMap((check) => check.diffs || []),
    // HABLANTES (modo `vectors`): lo unico que se valida ahi. `covered` dice si hubo
    // evidencia suficiente; sin ella el reporte NO puede decir OK.
    speakers: input.vectors
      ? {
          covered: input.vectors.conclusive === true,
          partial: input.vectors.conclusive === true && Number(input.vectors.evaluated || 0) < Number(input.vectors.commits || 0),
          coverage:
            Number(input.vectors.commits || 0) > 0
              ? Number((Number(input.vectors.evaluated || 0) / Number(input.vectors.commits)).toFixed(3))
              : 0,
          evaluated: input.vectors.evaluated,
          matches: input.vectors.speakerMatches,
          mismatches: input.vectors.speakerMismatches,
          skipped: input.vectors.skipped,
          notConclusive: input.vectors.notConclusive,
          avisos: input.vectors.avisos || [],
          commits: input.vectors.commits,
          reconstructed: input.vectors.reconstructed,
          detalle: input.vectors.turns,
        }
      : null,
    // FILAS FUENTE vs REPLAY: la fuente no es golden; se reporta la clasificacion.
    sourceRows: Number(input.comparison?.source?.sourceRows) || 0,
    observedRows: Number(input.observed?.rows?.length) || 0,
    sourceDuplicates: Number(input.comparison?.source?.sourceDuplicates) || 0,
    missingUnique: Number(input.comparison?.source?.missingUnique?.length) || 0,
    extraAceptadas: Number(input.comparison?.source?.extraAceptadas?.length) || 0,
    extraUnique: Number(input.comparison?.source?.extraUnique?.length) || 0,
    textVariants: Number(input.comparison?.source?.textVariants?.length) || 0,
    sourceDiff: input.comparison?.source
      ? {
          sourceUnique: input.comparison.source.sourceUnique,
          missing: input.comparison.source.missingUnique,
          extraAceptadas: input.comparison.source.extraAceptadas,
          extraUnique: input.comparison.source.extraUnique,
          variants: input.comparison.source.textVariants,
        }
      : null,
    classification: {
      perdidas: (classification.perdidas || []).length,
      duplicadas: (classification.duplicadas || []).length,
      detallePerdidas: classification.perdidas || [],
      detalleDuplicadas: classification.duplicadas || [],
    },
    notCovered: input.notCovered || input.comparison?.notCovered || [],
    boxStall: input.observed?.boxStall || null,
    box: {
      actualizaciones: boxTrace.length,
      valores: (input.observed?.box || []).length,
      primera: boxTrace[0] ? { t: boxTrace[0].t, text: String(boxTrace[0].text || '').slice(0, 120) } : null,
      ultima: boxTrace.length ? { t: boxTrace[boxTrace.length - 1].t, text: String(boxTrace[boxTrace.length - 1].text || '').slice(0, 120) } : null,
    },
    observed: {
      rows: input.observed?.rows || [],
      commits: input.observed?.commits || [],
      boxAtCommit: input.observed?.boxAtCommit || [],
      boxTrace,
      // DECISIONES de la caja (que se pidio, que se aplico): sin ellas una union de mas y
      // una emision legitima se ven igual en la traza. Textos recortados por el runner.
      boxDecisions: input.observed?.boxDecisions || [],
    },
    startedAt: input.startedAt,
    durationMs: input.durationMs,
  }
}

/**
 * Imprime la tabla del reporte.
 * @param {object} report
 * @param {{ print?: (line: string) => void }} [io]
 */
export function printReport(report, io = {}) {
  const print = io.print || ((line) => console.log(line))
  print('')
  const esEvents = report.mode === 'events'
  const sufijo = report.approved ? '' : esEvents ? ' (expected NO aprobado)' : ' (compara contra la fuente)'
  print(`replay ${report.mode} · ${report.scenario} · ${report.status.toUpperCase()}${sufijo}`)
  print(`  sesion   ${report.session.dir}`)
  print(`  commit   ${report.session.commit} · config ${report.session.configHash} · ${report.session.language || '??'} · ${report.session.sampleRate} Hz`)
  print(`  modelos  ${report.session.modelIds.length ? report.session.modelIds.join(', ') : '(sin modelos en la grabacion)'}`)
  if (esEvents) {
    print(`  eventos  ${report.session.events} · aplicados ${JSON.stringify(report.applied)}`)
    print(`  marcas   grabadas ${report.marks.recorded ?? 0} · inferidas ${report.marks.inferred ?? 0} (sr-gap ${report.marks.srGapInferred ?? 0}, onend ${report.marks.endInferred ?? 0})`)
    print(`  caja     ${report.box.actualizaciones} actualizacion(es) · ${report.box.valores} valor(es)`)
  }
  if (report.speakers) {
    const s = report.speakers
    print(
      s.covered
        ? `  hablantes ${s.matches} acierto(s) · ${s.mismatches} mismatch(s) · ` +
            `${s.skipped.length}/${s.commits} sin evidencia (cobertura ${Math.round((s.coverage || 0) * 100)}%)` +
            (s.partial ? ' · PARTIAL: no es validacion completa' : '')
        : `  hablantes NO CONCLUYENTE: ${(s.notConclusive || []).join(', ') || 'sin evidencia'} (${s.skipped.length} turno(s) sin evidencia evaluable)`,
    )
    if (s.avisos?.length) print(`  AVISO    hablantes: ${s.avisos.join(', ')}`)
    if (s.covered && s.skipped?.length) {
      const porMotivo = s.skipped.reduce((acc, turn) => {
        acc[turn.motivo] = (acc[turn.motivo] || 0) + 1
        return acc
      }, {})
      print(`  omitidos ${Object.entries(porMotivo).map(([motivo, veces]) => `${motivo} ${veces}`).join(' · ')} (sin evidencia para evaluar)`)
    }
  }
  if (report.sourceRows) {
    print(
      `  fuente   ${report.sourceRows} commit(s) · replay ${report.observedRows} fila(s) · ` +
        `duplicadas en la fuente ${report.sourceDuplicates} · faltan ${report.missingUnique} · ` +
        `sobran ${report.extraAceptadas + report.extraUnique} (${report.extraAceptadas} aceptada(s) como repeticion, ` +
        `${report.extraUnique} sin justificar) · variantes ${report.textVariants}`,
    )
  }
  if (report.session.fidelityWarnings?.length) {
    print(`  AVISO    sesion SIN fidelidad completa: ${report.session.fidelityWarnings.join('; ')}`)
  }
  print('')
  print('  check                     estado  detalle')
  print('  ------------------------- ------  ----------------------------------------')
  for (const check of report.checks) {
    print(`  ${check.name.padEnd(25)} ${MARCA[check.ok ? 'ok' : 'mismatch']}    ${check.detail}`)
  }
  if (report.sourceDiff && (report.missingUnique || report.extraUnique || report.extraAceptadas || report.textVariants)) {
    print('')
    print('  diff con la FUENTE (la fuente no es golden):')
    for (const fila of report.sourceDiff.missing.slice(0, 3)) print(`   - falta:    "${String(fila.text).slice(0, 100)}"`)
    for (const fila of report.sourceDiff.extraUnique.slice(0, 3)) {
      print(`   - sobra SIN justificar: "${String(fila.text).slice(0, 100)}"`)
    }
    for (const fila of report.sourceDiff.extraAceptadas.slice(0, 3)) {
      print(
        `   - sobra aceptada (la fuente repite esa locucion ${fila.vecesEnFuente} veces, similitud ${fila.similitud}): ` +
          `"${String(fila.text).slice(0, 70)}" ~ "${String(fila.repiteDe).slice(0, 70)}"`,
      )
    }
    for (const par of report.sourceDiff.variants.slice(0, 3)) {
      print(`   - variante: fuente "${String(par.source).slice(0, 70)}" ↔ replay "${String(par.observed).slice(0, 70)}"`)
    }
  }
  if (report.notCovered?.length) {
    print('')
    print(`  NO CUBIERTO en mode ${report.mode}: ${report.notCovered.join(', ')}`)
  }
  if (esEvents && (report.classification.perdidas || report.classification.duplicadas)) {
    print('')
    print(`  caja: ${report.classification.perdidas} perdida(s) · ${report.classification.duplicadas} duplicacion(es)`)
  }
  if (report.errors.length) {
    print('')
    print(`  ERRORES (${report.errors.length}):`)
    for (const error of report.errors.slice(0, 10)) print(`   - ${error}`)
  }
  print('')
}

/**
 * Escribe el reporte en disco.
 * @param {string} file
 * @param {object} report
 */
export function writeReport(file, report) {
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8')
}


