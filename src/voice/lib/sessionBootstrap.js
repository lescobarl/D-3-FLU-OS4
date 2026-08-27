/**
 * Sesión limpia en cada carga completa de página (sin historial ni clusters previos).
 */
import { FLU_CONFIG } from './fluConfig.js'
import { saveSessionState } from './fluStorage.js'
import { clearSpeakerClustersInDb } from './speakerClusterStore.js'

export async function bootstrapPageSession() {
  await clearSpeakerClustersInDb()
  await saveSessionState({
    id: 'current',
    history: [],
    phase: 'CONFIGURACION',
    role: FLU_CONFIG.sessionDefaults?.role || '',
    theme: FLU_CONFIG.sessionDefaults?.theme || '',
  })
}
