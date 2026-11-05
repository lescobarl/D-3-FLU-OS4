/**
 * proxyDeps — dependencias compartidas de los proxies del dev-server.
 *
 * Dueño único del conjunto de imports que repetían `browserProxy` y
 * `searchProxy`. Los proxies conservan su lógica propia; solo comparten
 * este punto de dependencia.
 */
export { acceptLanguageHeader } from '../core/search/searchLanguage.ts'
export { REQUEST_TIMEOUT_DEFAULTS } from '../core/config/sharedConfig.ts'
export { logCaughtError } from '../lib/caughtError.ts'
export { parseAllowlist } from './allowlist.ts'
export { proxyFetchError, type ProxyFetchError } from './proxyFetchError.ts'
export { parseRequestUrl } from './requestUrl.ts'
