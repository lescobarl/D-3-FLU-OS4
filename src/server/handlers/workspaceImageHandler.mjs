import { buildWorkspaceImageArtifact } from '../../src/lib/imageGeneration.js'

/**
 * @param {Map<string, { bytes: Buffer, contentType: string }>} cache
 */
export function createWorkspaceImageCache() {
  return new Map()
}

/**
 * Resuelve POST /api/workspace-image (origen único para Express y tests).
 * @param {{ workspace?: object, language?: string }} payload
 * @param {Map<string, { bytes: Buffer, contentType: string }>} cache
 */
export async function handleWorkspaceImageRequest(payload = {}, cache = createWorkspaceImageCache()) {
  const { workspace = {}, language = 'es' } = payload || {}
  const artifact = await buildWorkspaceImageArtifact(workspace, language)

  if (!artifact?.trace?.hasImage || !artifact.image_url) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'workspace_image_not_available' }),
      binary: false,
    }
  }

  if (artifact.trace?.provider !== 'pollinations') {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: artifact.image_url,
        trace: artifact.trace,
      }),
      binary: false,
    }
  }

  const cacheKey = artifact.trace.prompt || artifact.image_url
  const cached = cache.get(cacheKey)
  if (cached?.bytes) {
    return {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
      body: cached.bytes,
      binary: true,
    }
  }

  const upstream = await fetch(artifact.image_url, { redirect: 'follow' })
  if (!upstream.ok) {
    const bodyText = await upstream.text().catch((error) => error?.message || '')
    return {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: bodyText || upstream.statusText || 'workspace_image_upstream_error',
        status: upstream.status,
      }),
      binary: false,
    }
  }

  const contentType = upstream.headers.get('content-type') || 'image/jpeg'
  const bytes = Buffer.from(await upstream.arrayBuffer())
  if (!bytes.length) {
    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'workspace_image_empty_body' }),
      binary: false,
    }
  }

  cache.set(cacheKey, { bytes, contentType })

  return {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, immutable',
    },
    body: bytes,
    binary: true,
  }
}

/**
 * @param {import('http').ServerResponse} res
 * @param {{ status: number, headers: Record<string, string>, body: string | Buffer, binary: boolean }} result
 */
export function sendWorkspaceImageResponse(res, result) {
  res.status(result.status)
  Object.entries(result.headers).forEach(([key, value]) => {
    res.setHeader(key, value)
  })
  if (result.binary) {
    res.send(result.body)
    return
  }
  res.send(result.body)
}
