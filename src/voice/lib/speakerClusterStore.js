import { listStoreRecords, saveStoreRecord } from './fluStorage.js'
import { ensureClusterSpeakerId } from './conversationRow.js'

const CLUSTER_RECORD_ID = 'current'

function normalizeCluster(cluster = {}) {
  const base = ensureClusterSpeakerId({
    label: String(cluster?.label || '').trim(),
    speakerId: cluster?.speakerId,
  })
  const label = base.label
  const signature = Array.isArray(cluster?.signature)
    ? cluster.signature.map((value) => Number(value || 0))
    : []
  const signatureHistory = Array.isArray(cluster?.signatureHistory)
    ? cluster.signatureHistory
        .filter((entry) => Array.isArray(entry) && entry.length)
        .map((entry) => entry.map((value) => Number(value || 0)))
        .slice(-3)
    : signature.length
      ? [signature]
      : []
  return { label, speakerId: base.speakerId, signature, signatureHistory }
}

export async function loadSpeakerClustersFromDb() {
  const rows = await listStoreRecords('speaker_clusters')
  const current = rows.find((row) => String(row?.id || '') === CLUSTER_RECORD_ID) || null
  if (!current || !Array.isArray(current.clusters)) return []
  return current.clusters.map(normalizeCluster).filter((cluster) => cluster.label && cluster.signature.length)
}

export async function saveSpeakerClustersToDb(clusters = []) {
  const payload = {
    id: CLUSTER_RECORD_ID,
    clusters: clusters.map(normalizeCluster).filter((c) => c.label && c.signature.length),
    updatedAt: new Date().toISOString(),
  }
  return saveStoreRecord('speaker_clusters', payload)
}

export async function clearSpeakerClustersInDb() {
  return saveSpeakerClustersToDb([])
}
