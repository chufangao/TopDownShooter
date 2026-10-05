import units from './units.js'
import abilities from './abilities.js'
import statuses from './statuses.js'
import elements from './elements.js'
import { kin, roles } from './tags.js'
import synergies from './synergies.js'
import relics from './relics.js'
import anims from './anims.js'
import tuning from './tuning.js'

const byId = (list) => Object.fromEntries(list.map((d) => [d.id, d]))

export const UNITS = byId(units)
export const ABILITIES = byId(abilities)
export const STATUSES = byId(statuses)
export const ELEMENTS = byId(elements)
export const KIN = byId(kin)
export const ROLES = byId(roles)
export const RELICS = byId(relics)
export const ANIMS = byId(anims)
export const SYNERGIES = synergies
export const RELIC_LIST = relics
export const UNIT_LIST = units
export const TUNING = tuning

function lookup (map, kind) {
  return (id) => {
    const d = map[id]
    if (!d) throw new Error(`unknown ${kind} "${id}"`)
    return d
  }
}

export const unitDef = lookup(UNITS, 'unit')
export const abilityDef = lookup(ABILITIES, 'ability')
export const statusDef = lookup(STATUSES, 'status')
export const elementDef = lookup(ELEMENTS, 'element')
export const relicDef = lookup(RELICS, 'relic')
export const animDef = lookup(ANIMS, 'anim')
