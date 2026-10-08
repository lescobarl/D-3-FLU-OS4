/**
 * Barrera de la regla dura de AGENTS.md seccion 5: la suite completa exige
 * autorizacion EXPRESA.
 *
 * Verifica lo unico que no se puede fingir: que el camino bloqueado lo esta de
 * verdad (proceso real, env sin autorizar) y que la via rapida existe y esta
 * documentada. Si alguien devuelve `test:full` a crudo o borra la via rapida,
 * este guard falla.
 */
import { describe, expect, it } from 'vitest'
import { runAsync, runOk } from './_asyncExec'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const authScript = path.join(root, 'scripts', 'require-full-suite-auth.mjs')

function envWithoutAuth(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    delete env.CI
    delete env.GITHUB_ACTIONS
    delete env.FLU_AUTH_FULL_SUITE
    return env
}

describe('la suite completa exige autorizacion expresa', () => {
    it('test:full pasa por la barrera de autorizacion', async () => {
        expect(pkg.scripts['test:full']).toContain('scripts/require-full-suite-auth.mjs')
    })

    it('la via rapida existe y esta documentada en AGENTS.md', async () => {
        expect(pkg.scripts['test:file']).toBeTruthy()
        expect(pkg.scripts['test:grep']).toBeTruthy()
        expect(pkg.scripts['verify:fast']).toBeTruthy()
        expect(agents).toContain('npm run test:file')
    })

    it('AGENTS.md declara la regla dura', async () => {
        expect(agents).toContain('autorizacion EXPRESA')
        expect(agents).toContain('FLU_AUTH_FULL_SUITE=1')
    })

    // P2.4: el detector no es decorativo. Se alimenta un entorno SINTETICO
    // infractor (mutacion: sin autorizacion) y se comprueba que el detector marca
    // (exit 1); y un entorno autorizado, que deja pasar. Si el detector no
    // discriminara, estos casos fallarian: por eso este guard no es teatro.
    describe('P2.4-S el detector no es decorativo (mutacion del entorno)', () => {
        it('sin autorizacion el proceso BLOQUEA (codigo 1)', async () => {
            const r = await runAsync(process.execPath, [authScript], { env: envWithoutAuth() })
            expect(r.status).toBe(1)
            expect(r.stderr).toContain('BLOQUEADO')
        })

        it('con autorizacion expresa deja pasar', async () => {
            const out = await runOk(process.execPath, [authScript], {
                env: { ...envWithoutAuth(), FLU_AUTH_FULL_SUITE: '1' },
            })
            expect(out).toContain('autorizado')
        })
    })
})
