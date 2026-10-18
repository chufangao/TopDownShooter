// The battle's chrome: the strip over the board and the panel beside it (the Monarch's HP, the selected piece's
// orders, both sides' synergies, End Turn and the playback's controls).
import { relicTip, tileText, hpBar, relicIcon, actText, theirText } from '../codex.js'
import { unitDef, relicDef } from '../content.js'
import { h, fill, icon, portrait, say } from '../dom.js'
import { kw } from '../keywords.js'
import { sfx } from '../sfx.js'
import { roll, muteButton, musicButton } from './chrome.js'

// ── the battle's chrome ──────────────────────────────────────────────────────────────────────────

// The battle keeps the Field's layout, so the board does not move as one fades into the other: a thin strip over the
// board (room, turn, waves, essence carried; no clock) and the slim panel beside it. Pause and skip change only the playback.
export function battleChrome ({ onHelp = null } = {}) {
  let scene = null
  let st = { paused: false, over: false, essence: 0, wave: 1, waves: 1, turn: 1, next: null, busy: true, panel: null }
  let carried = 0
  const noFocus = (e) => e.preventDefault()
  const btn = (attrs, ...kids) => h('button', { tabindex: '-1', onmousedown: noFocus, ...attrs }, ...kids)
  const pause = btn({ class: 'pause-btn', onclick: () => scene?.togglePause(), tip: () => 'Pause or resume the playback. (Space)' })
  const skip = btn({
    class: 'skip', 'data-sfx': 'none', onclick: () => scene?.skip(),
    tip: () => st.over ? 'On to what comes next. (S)' : 'Hurry the playback: what is playing shows at once. (S)'
  })
  // Names in a line, each kind once, ×n for more: "Grave Ghoul ×2, Bone Chanter".
  const group = (names) => {
    const m = new Map()
    for (const n of names) m.set(n, (m.get(n) ?? 0) + 1)
    return [...m].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ')
  }
  const count = h('b', null, '0')
  // The purse's card, as the playback has shown the battle: what the slain carry, the relics' share, what a win adds.
  const purseTip = () => {
    const t = scene?.tally()
    return h('div', { class: 'syn-tip' }, h('b', null, 'Essence'), t && [
      h('p', null, h('b', null, `+${t.owed}`), ` from ${t.slain} ${t.slain === 1 ? 'foe' : 'foes'} slain. A win adds it to your `, h('b', null, `${t.bank}`), '.'),
      t.bonus > 0 && h('p', null, `The elite pays +${t.bonus} more on a win.`),
      t.court && h('p', null, `Hollow Court: +${t.court.essence} more if ${t.court.n === 1 ? 'its shadow stands' : `its ${t.court.n} shadows stand`} at the win.`),
      t.gain !== 1 && h('p', { class: 'dim' }, `Your relics make each foe pay ×${+t.gain.toFixed(2)}, counted in.`)])
  }
  const purse = h('span', { class: 'purse', tip: purseTip }, icon('soul', 20), h('span', { class: 'purse-plus' }, '+'), count)
  const title = h('b', { class: 'bt-title' })
  // The panel's words: the Monarch's HP, their synergies and yours, a rule's name a moment as it strikes.
  const hpText = h('b', { class: 'bs-hp-n' })
  const hpFill = h('span')
  const crown = h('div', { class: 'bs-crown' },
    h('div', { class: 'bs-crown-top' }, h('span', { class: 'bs-name' }, icon('crown', 18), 'The Monarch'), hpText),
    h('div', { class: 'bs-hpbar' }, hpFill))
  const theirs = h('div', { class: 'bs-syns foe' })
  const mine = h('div', { class: 'bs-syns' })
  const theirRules = h('div', { class: 'bs-rules foe' })
  const myRules = h('div', { class: 'bs-rules' })
  // A side's synergies: each its name and rule; its text and the pieces it counts on hover.
  const list = (box, syns, foe = false) => fill(box, syns.length
    ? syns.map((x) => h('span', {
      class: 'bs-syn rule',
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, `${x.name}: ${x.rule}`), ' ', foe ? theirText(x.text) : x.text, x.members && h('p', { class: 'dim' }, `Counted: ${x.members}.`))
    }, `${x.name} · `, h('b', null, x.rule)))
    : h('span', { class: 'dim' }, 'none'))
  const stage = h('div', { class: 'battle-stage' }, h('div', { class: 'pause-veil', 'aria-hidden': 'true' }, h('span', null, icon('pause', 26), 'Paused')))
  // The turn and the wave counter: counts, never a clock; on hover, yours still to act, the foes standing, the next wave.
  const turnN = h('b')
  const coming = () => (st.next ? `${st.next.size ? `${st.next.size} more` : 'more'} on turn ${st.next.turn}` : 'no more to come')
  const turnEl = h('span', {
    class: 'turn-n',
    tip: () => {
      const t = scene?.tally()
      const r = st.roster
      return h('div', { class: 'syn-tip' }, h('b', null, `Turn ${st.turn}`),
        st.over ? ' · the battle is over' : [r && ` · ${r.ready.length} of ${r.total} of yours still to act`, t && ` · ${t.foes} ${t.foes === 1 ? 'foe' : 'foes'} standing, ${coming()}`])
    }
  }, icon('turn', 18), turnN)
  const waveT = h('b')
  const waveNext = h('span', { class: 'dim' })
  const waveTurn = h('span', {
    class: 'wave-n',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Wave ${st.wave} of ${st.waves}`), ' ',
      !st.next ? 'No more come.'
        : st.next.size ? ['The next ', kw('wave'), `: ${st.next.size} ${st.next.size === 1 ? 'foe enters' : 'foes enter'} over the far edge as turn ${st.next.turn} begins.`]
          : ['The next ', kw('wave'), ` enters over the far edge as turn ${st.next.turn} begins.`])
  }, icon('wave', 18), waveT, waveNext)
  const selBox = h('div', { class: 'bs-sel' })
  // End Turn's card: what each of yours still to act does as it is pressed (the sim's own reckoning); never the foes'.
  const laid = (list) => list.length > 0 && h('span', { class: 'dim' }, `, ${list.join(', ')}`)
  const endLine = (x) => h('li', null, x.name, x.shadow && h('span', { class: 'dim' }, ' (shadow)'),
    x.hexed ? h('span', { class: 'warn' }, ': Hexed, its act is lost')
      : [' → ', x.hits.length ? x.hits.map((t, i) => [i > 0 && '; ', t.name, t.n > 0 && h('b', { class: 'n-dmg' }, ` −${t.n}`), t.falls && h('b', { class: 'n-falls' }, ', falls'), laid(t.laid)])
        : x.heals.length ? x.heals.map((t, i) => [i > 0 && '; ', t.name, h('b', { class: 'n-heal' }, ` +${t.n}`), laid(t.laid)])
          : [x.target ?? x.act, x.missed && h('span', { class: 'dim' }, ': misses')]],
    x.counter > 0 && h('span', { class: 'n-counter' }, ` · takes −${x.counter} back${x.fell ? ', falls' : ''}`),
    x.lost.length > 0 && h('span', { class: 'n-falls' }, ` · ${x.lost.join(', ')} ${x.lost.length === 1 ? 'falls' : 'fall'}`))
  const endTip = () => {
    const info = scene?.endInfo()
    const head = [h('b', null, 'End Turn'), say(' (E)', '')]
    if (st.over || !info) return h('div', { class: 'syn-tip' }, head, h('p', { class: 'dim' }, st.over ? 'The battle is over.' : 'The turn plays out…'))
    // Those with nothing to do are one line, after the rest, in order.
    const n = info.acts.length
    const idle = info.acts.filter((x) => !x.hexed && !x.act).map((x) => (x.shadow ? `${x.name} (shadow)` : x.name))
    return h('div', { class: 'syn-tip act-tip' }, head,
      n ? [h('p', null, `${n} still to act ${n === 1 ? 'uses its' : 'use their'} basic:`),
        h('ul', { class: 'act-targets' }, info.acts.filter((x) => x.hexed || x.act).map(endLine), idle.length > 0 && h('li', { class: 'dim' }, `Nothing in reach: ${group(idle)}`)),
        h('p', { class: 'dim' }, info.won ? 'The last foe falls: the battle is won.' : 'Then the foes\' turn.')]
        : h('p', null, 'All yours have acted. The foes\' turn next.'))
  }
  const endBtn = btn({ class: 'primary big end-turn', onclick: () => scene?.endTurn(), tip: endTip }, icon('play', 20), ' End Turn')
  const el = h('div', { class: 'battle-screen' },
    h('header', { class: 'battle-top' }, title, turnEl, waveTurn, h('span', { class: 'grow' }), purse,
      h('div', { class: 'top-btns' }, musicButton(), muteButton(),
        onHelp && btn({ class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play: the battle waits while it is open. (H)' }, icon('help', 22)))),
    h('div', { class: 'battle-main' },
      stage,
      h('aside', { class: 'battle-panel' },
        crown,
        selBox,
        h('div', { class: 'bs-syn-box' },
          h('div', { class: 'bs-k foe' }, 'Their synergies'), theirs, theirRules,
          h('div', { class: 'bs-k' }, 'Yours'), mine, myRules),
        h('div', { class: 'bs-controls' }, endBtn, h('div', { class: 'bs-row' }, pause, skip)))))

  // The selected piece's orders: name, HP, Move left, relic; an act a button (a skill with its cooldown pip); Undo.
  function selection () {
    const p = st.panel
    // With none selected: how many of yours may still act, and which.
    if (!p) {
      const r = st.roster
      return fill(selBox, h('p', { class: 'bs-hint dim' }, st.over ? 'The battle is over.' : st.busy || !r ? 'The turn plays out…'
        : r.ready.length ? [`${r.ready.length} of ${r.total} still to act: ${group(r.ready)}. `, say('Click', 'Tap'), ' one, or ', h('b', null, 'End Turn'), '.']
          : [!r.total ? 'None of yours takes orders: ' : r.total === 1 ? 'Yours has acted: ' : `All ${r.total} have acted: `, h('b', null, 'End Turn'), '.']))
    }
    const d = unitDef(p.id)
    const pip = (a) => a.skill && h('span', { class: 'cd-pip' + (a.rest > 0 ? ' rest' : ''), 'aria-label': a.rest > 0 ? 'resting' : 'ready' })
    // An act's card: what it does with this piece's numbers, its rest, and what it would do now to each in reach.
    const turns = (n) => `${n} turn${n === 1 ? '' : 's'}`
    const target = (x) => h('li', null, x.self ? 'Itself' : x.name,
      x.by && h('span', { class: 'dim' }, `: the ${x.by} in the way takes it`),
      x.damage > 0 && h('b', { class: 'n-dmg' }, ` −${x.damage}`), x.falls && h('b', { class: 'n-falls' }, ' falls'),
      x.heal > 0 && h('b', { class: 'n-heal' }, ` +${x.heal}`), x.counter > 0 && h('span', { class: 'n-counter' }, ` · takes −${x.counter} back`))
    const actTip = (a) => () => {
      const info = scene?.actInfo(a.id)
      return h('div', { class: 'syn-tip act-tip' },
        h('b', null, a.name),
        a.skill && h('span', { class: 'dim' }, a.rest > 0 ? ` · ready in ${turns(a.rest)}` : a.rests > 0 ? ` · rests ${turns(a.rests)} after use` : ' · ready again next turn'),
        info && actText(info.a, info.st, info),
        !a.can ? (p.acted ? h('p', { class: 'warn' }, 'Already acted this turn.') : p.hexed ? h('p', { class: 'warn' }, 'Hexed: it cannot act this turn.')
          : a.rest > 0 ? null : h('p', { class: 'dim' }, a.heal ? 'No ally in reach needs it.' : 'Not usable now.'))
          : info?.now.length ? [h('p', { class: 'act-k' }, a.arise ? 'Corpses in reach:' : 'In reach now:'), h('ul', { class: 'act-targets' }, info.now.map(target))]
            : info?.later.length ? h('p', null, `Nothing in reach from here. Moving first brings in: ${group(info.later)}.`)
              : h('p', { class: 'dim' }, 'Nothing it can reach this turn.'))
    }
    const acts = p.acts.map((a) => btn({
      class: 'act-btn' + (a.armed ? ' armed' : '') + (a.skill ? ' skill' : '') + (a.arise ? ' arise' : ''), 'aria-pressed': a.armed ? 'true' : 'false',
      'aria-disabled': a.can ? null : 'true', onclick: () => a.can && scene?.arm(a.id), tip: actTip(a)
    }, pip(a), h('span', { class: 'act-name' }, a.name), h('span', { class: 'act-kind' }, a.skill ? 'skill' : 'basic')))
    const armed = p.acts.find((a) => a.armed)
    // The armed act with nothing to take from here: why, and who a move brings in reach, or that none would.
    const moves = p.move > p.moved
    const later = !st.busy && armed?.can && !armed.targets ? scene?.actInfo(armed.id)?.later ?? [] : []
    const none = armed?.arise ? 'No corpse' : 'Nothing'
    const stuck = !armed || st.busy || armed.targets ? null
      : !armed.can ? (armed.rest > 0 ? `${armed.name} rests ${turns(armed.rest)} more.` : armed.heal ? `No ally in reach needs ${armed.name}.` : `${armed.name} cannot be used now.`)
        : later.length ? `${none} in reach of ${armed.name} from here: moving brings in ${group(later)}.`
          : moves ? `${none} in reach of ${armed.name} this turn, even after a move.` : `${none} in reach of ${armed.name} from here, and no Move left.`
    const line = p.hexed && !p.acted ? h('span', { class: 'warn' }, 'Hexed: it loses its act.')
      : p.acted ? h('span', { class: 'dim' }, 'Acted this turn.')
        : p.aim ? h('b', { class: 'aim-line' }, armed?.arise ? say('Click it again to raise it.', 'Tap it again to raise it.') : say('Click it again to strike.', 'Tap it again to strike.'),
          p.screen && [' ', h('span', { class: 'screened' }, 'Screened'), `: the ${p.screen} on its `, kw('line', 'line of fire'), ' takes it.'])
          : armed?.arise && armed.targets ? h('span', { class: 'dim' }, [say('Click', 'Tap'), ' a corpse ringed in green, again to raise it.'])
            : h('span', { class: 'dim' }, moves && armed?.targets ? [say('Click', 'Tap'), ' a lit tile to move, a ringed target to aim.']
              : armed?.targets ? [say('Click', 'Tap'), ' a ringed target to aim.']
                : [stuck, stuck && moves && ' ', moves && [say('Click', 'Tap'), ' a lit tile to move.']])
    fill(selBox,
      h('div', { class: 'sel-head' }, portrait(p.id, 38),
        h('div', { class: 'sel-id' },
          h('b', { class: 'sel-name' }, d.name),
          h('div', { class: 'sel-nums' },
            h('span', { class: 'sel-hp' }, hpBar(p.hp, p.maxHp), `${p.hp}/${p.maxHp}`),
            h('span', { class: 'sel-move', tip: () => `Move: ${p.move - p.moved} of ${p.move} tiles left this turn.` }, `Move ${Math.max(0, p.move - p.moved)}/${p.move}`)),
          p.relics.length > 0 && h('div', { class: 'sel-relic' }, p.relics.map((id) => h('span', { class: `rs-relic rt-${relicDef(id).tier}`, tip: () => relicTip(id) }, icon(relicIcon(id), 14), relicDef(id).name))))),
      acts.length > 0 && h('div', { class: 'sel-acts' }, acts),
      p.undo && h('div', { class: 'sel-acts' },
        btn({ class: 'undo-btn', onclick: () => scene?.undo(), tip: () => `Back to ${tileText(p.from)}, Move ${p.move}/${p.move} again. (U)` }, icon('undo', 18), 'Undo move')),
      h('div', { class: 'sel-line' }, line))
  }

  function render () {
    fill(pause, icon(st.paused ? 'play' : 'pause', 20), st.paused ? ' Resume' : ' Pause')
    fill(skip, icon('skip', 22), st.over ? ' Continue' : ' Skip', h('kbd', null, 'S'))
    el.classList.toggle('paused', st.paused && !st.over)
    el.classList.toggle('over', !!st.over)
    turnN.textContent = `Turn ${st.turn}`
    waveT.textContent = `${st.wave}/${st.waves}`
    waveNext.textContent = st.next ? ` · next on turn ${st.next.turn}` : ''
    waveTurn.hidden = st.waves < 2
    endBtn.setAttribute('aria-disabled', st.busy || st.paused || st.over ? 'true' : 'false')
    el.classList.toggle('busy', !!st.busy)
    selection()
    const e = st.essence ?? 0
    if (Math.round(e) !== Math.round(carried)) roll(count, carried, e, purse)
    carried = e
  }
  render()

  return {
    el,
    // Where the board goes, in viewport px.
    stage: () => stage.getBoundingClientRect(),
    hud: {
      start ({ title: t, monarch }) {
        title.textContent = t
        crown.hidden = !monarch
      },
      // Each side's synergies as the battle holds them now: a fall or a rise may change them.
      synergies ({ theirs: th, mine: m }) {
        list(theirs, th, true)
        list(mine, m)
      },
      hp (hp, max) {
        const f = max ? Math.max(0, hp / max) : 0
        hpText.textContent = `${hp} / ${max}`
        hpFill.style.width = `${f * 100}%`
        crown.classList.toggle('low', f < 0.35)
      },
      announce (text, side) {
        const box = side ? myRules : theirRules
        const line = h('div', { class: 'bs-rule' }, text)
        box.append(line)
        while (box.children.length > 2) box.firstChild.remove()
        setTimeout(() => line.classList.add('out'), 1400)
        setTimeout(() => line.remove(), 1900)
      }
    },
    attach (s) { scene = s; s.purseAt = () => count.getBoundingClientRect() },
    update (next) { st = { ...st, ...next }; render() },
    key (e) {
      if (!scene) return
      // Esc lets go of the selected piece; it skips nothing.
      if (e.code === 'KeyE') { e.preventDefault(); return scene.endTurn() }
      if (e.code === 'KeyU') { e.preventDefault(); return scene.undo() }
      if (e.code === 'Escape') { e.preventDefault(); return scene.select(null) }
      if (e.code === 'KeyS') { e.preventDefault(); return scene.skip() }
      if (e.code !== 'Space') return
      scene.togglePause()
      sfx.play('click')
      e.preventDefault()
    }
  }
}
