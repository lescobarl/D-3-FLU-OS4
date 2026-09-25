import { describe, it, expect } from 'vitest'
import { planE2E, filtrarSpecs } from '../scripts/e2e-scope.mjs'

const allow = [
    'src/App.tsx',
    'src/core/agenda/domainScopedIntent.ts',
    'tests/e2e/auditoria-acciones-llm.spec.ts',
    'plans/ledger.json',
]
const e2eScope = {
    'src/App.tsx': ['tests/e2e/auditoria-acciones-llm.spec.ts'],
    'src/core/agenda/domainScopedIntent.ts': ['tests/e2e/auditoria-acciones-llm.spec.ts'],
}

describe('planE2E - la corrida se acota al bloque modificado', () => {
    it('un spec modificado se corre', () => {
        const r = planE2E({ cambios: ['tests/e2e/auditoria-acciones-llm.spec.ts'], allow, e2eScope })
        expect(r.specs).toEqual(['tests/e2e/auditoria-acciones-llm.spec.ts'])
        expect(r.sinDeclarar).toEqual([])
    })

    it('un fichero de src declarado corre los specs que el contrato le asigna', () => {
        const r = planE2E({ cambios: ['src/core/agenda/domainScopedIntent.ts'], allow, e2eScope })
        expect(r.specs).toEqual(['tests/e2e/auditoria-acciones-llm.spec.ts'])
    })

    it('src sin spec declarado NO se corre a ciegas: se reporta', () => {
        const r = planE2E({
            cambios: ['src/App.tsx', 'src/nuevo/modulo.ts'],
            allow: [...allow, 'src/nuevo/modulo.ts'],
            e2eScope,
        })
        expect(r.sinDeclarar).toEqual(['src/nuevo/modulo.ts'])
    })

    it('no repite un spec declarado a la vez que modificado', () => {
        const r = planE2E({
            cambios: ['src/App.tsx', 'tests/e2e/auditoria-acciones-llm.spec.ts'],
            allow,
            e2eScope,
        })
        expect(r.specs).toEqual(['tests/e2e/auditoria-acciones-llm.spec.ts'])
    })

    it('lo que no esta en el alcance no arrastra specs', () => {
        const r = planE2E({ cambios: ['docs/notas.md', 'plans/ledger.json'], allow, e2eScope })
        expect(r.specs).toEqual([])
        expect(r.sinDeclarar).toEqual([])
    })

    it('el filtro acota el plan sin inventarse specs de fuera', () => {
        const plan = ['tests/e2e/auditoria-acciones-llm.spec.ts', 'tests/e2e/video-config.spec.ts']
        expect(filtrarSpecs(plan, 'auditoria-acciones')).toEqual([
            'tests/e2e/auditoria-acciones-llm.spec.ts',
        ])
        expect(filtrarSpecs(plan, '')).toEqual(plan)
        expect(filtrarSpecs(plan, 'no-existe')).toEqual([])
    })
})
