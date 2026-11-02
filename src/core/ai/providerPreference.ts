/**
 * providerPreference — preferencia del proveedor de IA, dueño único.
 *
 * Orden: preferencia en storage → `VITE_PREFERRED_AI_PROVIDER` → default de
 * `sharedConfig`. Ningún motor relee la clave por su cuenta.
 */
import { STORAGE_KEYS } from '../config/appConfig'
import { DEFAULT_AI_PROVIDER, isAIProvider, type AIProvider } from '../config/sharedConfig'
import { localGet, localSetSafe } from '../storage/localStore'
import { logCaughtError } from '../../lib/caughtError'

/**
 * Resuelve el proveedor preferido de IA.
 * @returns Proveedor canónico.
 */
export function getPreferredAIProvider(): AIProvider {
  try {
    const stored = localGet(STORAGE_KEYS.AI_PROVIDER)
    if (isAIProvider(stored)) return stored
  } catch (e) {
    logCaughtError('[catch] src/core/ai/providerPreference.ts', e)
  }

  const envProvider = import.meta.env.VITE_PREFERRED_AI_PROVIDER
  if (isAIProvider(envProvider)) return envProvider

  return DEFAULT_AI_PROVIDER
}

/**
 * Guarda el proveedor preferido.
 * @param provider Proveedor canónico.
 */
export function setPreferredAIProvider(provider: AIProvider): void {
  localSetSafe(STORAGE_KEYS.AI_PROVIDER, provider, '[catch] src/core/ai/providerPreference.ts')
}
