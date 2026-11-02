/**
 * BunnyAnimator — prueba del flujo de acción principal (§8.5).
 *
 * Fija el comportamiento observable antes de unificar la preparación de la
 * acción principal entre `playBlendedList` y `crossFadeToBlended`.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BunnyAnimator } from '../src/avatar/model/bunnyAnimator'

type Internals = {
  currentAction: THREE.AnimationAction | null
  blendActions: THREE.AnimationAction[]
  clips: Map<string, THREE.AnimationClip>
}

function createAnimator(): { anim: BunnyAnimator; internals: Internals } {
  const anim = new BunnyAnimator(new THREE.Group())
  const internals = anim as unknown as Internals
  internals.clips.set('Idle_1', new THREE.AnimationClip('Idle_1', 1, []))
  internals.clips.set('Idle_2', new THREE.AnimationClip('Idle_2', 1, []))
  return { anim, internals }
}

describe('BunnyAnimator — acción principal', () => {
  it('playBlendedList deja UNA acción principal y las de blend', () => {
    const { anim, internals } = createAnimator()
    expect(anim.playBlendedList(['Idle_1', 'Idle_2'])).toBe(true)
    expect(internals.currentAction).not.toBeNull()
    expect(internals.blendActions).toHaveLength(1)
  })

  it('crossFadeToBlended reemplaza principal y blend', () => {
    const { anim, internals } = createAnimator()
    expect(anim.playBlendedList(['Idle_1', 'Idle_2'])).toBe(true)
    expect(anim.crossFadeToBlended(['Idle_1'], 0.2)).toBe(true)
    expect(internals.currentAction).not.toBeNull()
    expect(internals.blendActions).toHaveLength(0)
  })
})
