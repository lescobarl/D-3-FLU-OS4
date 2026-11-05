// ============================================================
// wakeWords — resolución ÚNICA de las wake words efectivas del sistema.
// ------------------------------------------------------------
// Ajustes puede proveerlas como lista o como texto multilínea; sin provisión,
// rige el default de FLU_CONFIG. Los consumidores no reimplementan el criterio.
// ============================================================
import { FLU_CONFIG } from './fluConfig.js'

export function resolveWakeWords(wakeWords) {
  const configured = Array.isArray(wakeWords)
    ? wakeWords.filter(Boolean)
    : String(wakeWords || '')
        .split('\n')
        .map((word) => word.trim())
        .filter(Boolean)
  return configured.length ? configured : FLU_CONFIG.voiceCommands.wakeWords
}
