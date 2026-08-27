/**
 * Snapshot exacto de SpeechRecognition.onresult (sin mutar transcripts).
 */
export function snapshotChromeSpeechResult(event) {
  if (!event || !event.results) return null

  const resultIndex = Number(event.resultIndex) || 0
  const newResults = []

  for (let index = resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index]
    const alternatives = []
    const altCount = result?.length ?? 0

    for (let alt = 0; alt < altCount; alt += 1) {
      const item = result[alt]
      alternatives.push({
        transcript: item?.transcript ?? null,
        confidence: typeof item?.confidence === 'number' ? item.confidence : null,
      })
    }

    newResults.push({
      index,
      isFinal: Boolean(result?.isFinal),
      alternatives,
    })
  }

  return {
    resultIndex,
    resultsLength: event.results.length,
    newResults,
  }
}
