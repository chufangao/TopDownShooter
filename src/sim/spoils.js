// 1-of-3 rewards after a win or at a treasure node. Skip is always allowed (pickSpoil(run, null)).
import { TUNING, RELIC_LIST, unitDef } from '../content/index.js'
import { createRng } from './rng.js'
import { join, setLevel, medianLevel, spawnPool } from './run.js'

const TYPES = ['relic', 'drill', 'rest', 'recruit']

function offer (type, rng, run, relics) {
  const s = run.state
  if (type === 'relic') {
    const r = relics.shift()
    return r && { type, id: r.id, name: r.name, desc: r.desc }
  }
  if (type === 'drill') return { type, name: 'Drill', desc: 'Every unit gains a level.' }
  if (type === 'rest') {
    const t = TUNING.run
    return { type, name: 'Rest', desc: `Heal everyone to at least ${t.restHeal * 100}% and revive the fallen at ${t.restRevive * 100}%.` }
  }
  const { units, weights } = spawnPool(s.floor)
  const def = rng.weighted(units, weights)
  const lvl = medianLevel(s.party)
  return { type, id: def.id, name: def.name, desc: `${def.name} (${def.kin}, ${def.role}) joins at level ${lvl}.` }
}

export function rollOffers (run, { kind = 'fight' } = {}) {
  const s = run.state
  const rng = createRng(s.seed).stream(`spoils|${s.floor}|${s.at}`)
  const relics = rng.shuffle(RELIC_LIST.filter((r) => !s.relics.includes(r.id)))
  const out = []
  const add = (o) => o && out.push(o)
  if (kind === 'treasure') for (let i = 0; i < 3; i++) add(offer('relic', rng, run, relics))
  if (kind === 'elite') add(offer('relic', rng, run, relics))
  let types = TYPES.filter((t) => !out.some((o) => o.type === t))
  while (out.length < 3 && types.length) {
    const type = rng.weighted(types, types.map((t) => TUNING.spoils[t]))
    types = types.filter((t) => t !== type)
    add(offer(type, rng, run, relics))
  }
  return out
}

export function applyOffer (run, o) {
  const s = run.state
  const t = TUNING.run
  if (o.type === 'relic') {
    if (!s.relics.includes(o.id)) s.relics.push(o.id)
  } else if (o.type === 'drill') {
    for (const u of s.party) setLevel(u, u.lvl + 1)
  } else if (o.type === 'rest') {
    for (const u of s.party) u.hp = u.hp > 0 ? Math.max(u.hp, Math.ceil(u.maxHp * t.restHeal)) : Math.ceil(u.maxHp * t.restRevive)
  } else if (o.type === 'recruit') {
    unitDef(o.id)
    join(run, o.id)
  } else {
    throw new Error(`unknown offer "${o.type}"`)
  }
}
