// Tier 3 — a new verb, a hook handler and an expr form (§13.3).
//
// This is the only tier that needs JavaScript, and the whole point of the design is that ~90% of
// packs never reach for it. Everything registered here is namespaced to `kindled:` and runs with
// the nondeterminism traps installed: Math.random, Date.now and new Date all throw inside this
// module and inside every callback it registers.

export default function ({ ops, hooks, forms, registry, rng, log }) {
  // A new verb. Targeting, animation, the timeline and the balance harness all work on it
  // immediately, because nothing in resolve.js knows what an op does.
  ops.register('kindled:ignite', {
    schema: { power: 'number', spread: { type: 'int', default: 0 } },
    run (ctx, args, actor, targets) {
      for (const target of targets) {
        if (target.hp <= 0) continue
        const burn = Math.max(1, Math.round(args.power * ctx.rng.range(0.9, 1.1)))
        ctx.damage(target, burn, { actor, element: 'kindled:ash' })
      }
    }
  })

  // Scaled Wall's evil twin: ash damage lands harder on anything already Brittle.
  hooks.on('damage:compute', 'kindled:pyre', 60, (ev, ctx) => {
    if (ev.element === 'kindled:ash' && ctx.target?.statuses?.some((s) => s.id === 'core:brittle')) {
      ev.mul *= 1.2
    }
  })

  forms.register('kindled:isAsh', {
    arity: [1, 1],
    fn: (a, ctx) => registry.get('unit', a[0].defId).element === 'kindled:ash'
  })

  log(`loaded — ${registry.ids('unit').length} units visible, own rng stream ${rng.streamName}`)
}
