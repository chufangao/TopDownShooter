// The Field: the camp and the ossuary on the battle's own board, and the selected piece's panel beside them.
import { board } from '../board.js'
import {
  unitCard, partyMods, synergyTracker, synergyGroups, relicTip, realmOf, MONARCH_TEXT, MONARCH_RULE, tileText,
  fieldRule, ROMAN, alsoOf, reachText, reachRule, standing, abilityBlocks, auraBlock, hpBar, hpAt, summonText,
  relicIcon, ariseFor, statTip, tally, releaseText
} from '../codex.js'
import { unitDef, relicDef, KIN, ROLES, FUSION_LIST } from '../content.js'
import { h, fill, icon, portrait, showTip, hideTip, pinTip, hold, HOLD, touchy, say } from '../dom.js'
import { frame, toLocal } from '../frame.js'
import { kw } from '../keywords.js'
import { sfx } from '../sfx.js'
import { field } from '../sim/field.js'
import {
  fieldCap, rosterCap, fielded, inOssuary, souls, isMonarch, monarchOf, OSSUARY, canAdvance, tierCost, canPlace,
  canFuse, levelOf, swapWith, releaseRefund, unheld, canHold
} from '../sim/run.js'
import {
  COLS, CAMP_ROWS, slotAt, rowOf, isWall, LANES, DEPTH, tileAt, deployTile, wallTiles, onField, tileX, tileY, statsOf,
  tracksOf, canTrack, sizeOf, footprint, footprintSlots, campOpen, isMonarchCell, distanceBetween, summonsOf, reachOf,
  baseStats
} from '../sim/unit.js'
import { TUNING } from '../tuning.js'
import { relicChips } from './cards.js'
import { done, learnt } from './chrome.js'

// ── the Field ────────────────────────────────────────────────────────────────────────────────────

// The selected piece's panel (the Monarch's with none) beside the board. onChange runs after every action it sends.
// The gestures, the same by mouse and by touch, none needing hover:
//   tap a piece              select it; again, or empty ground (or Escape), for the Monarch's panel
//   drag a piece or a soul   onto open ground, onto another piece (they swap, never two, nor the Monarch's seat), or
//                            onto the bench; the Monarch never moves. Tap a bench soul, then a tile, places it too
//   tap a relic, then a soul give it (one holding swaps); long press (touch): the card there, pinned

export function fieldEditor ({ run, act, onChange = null }) {
  const s = run.state
  const el = h('div', { class: 'retinue' })
  // The selection: { uid } a soul of yours or the Monarch, or null: the Monarch's panel.
  let sel = null
  let error = ''
  // A synergy whose chip was pressed: its pieces glow bright, until pressed again.
  let focusSyn = null
  // A piece relic tapped in the Relics strip, waiting for the soul to give it to (null: none).
  let giving = null
  // A battle refused for want of a soul on the field: the hint says so and the cells a soul may take ring, until one stands.
  let wanting = false
  const stage = h('div', { class: 'board-stage', 'aria-label': 'The board. Tap a piece to select it; drag a piece to move it. Keys: the arrows move a cursor, Enter taps, Escape lets go.' })
  const hintEl = h('div', { class: 'board-hint', role: 'status' })
  const stageWrap = h('div', { class: 'stage-wrap' }, stage)
  const benchEl = h('div', { class: 'bench-strip' })
  const relicEl = h('div', { class: 'relic-strip' })
  const panelBody = h('div', { class: 'tab-body' })
  const errEl = h('p', { class: 'warn panel-err' })
  const panelEl = h('div', { class: 'tray' }, errEl, panelBody)
  const sideEl = h('div', { class: 'side-col' }, hintEl, panelEl, benchEl, relicEl)
  el.append(stageWrap, sideEl)
  let shown = ''
  // Tooltips by tile; the tile hovered; a press (a drag past a few pixels); the drag; a bench click to swallow after one.
  let tips = new Map()
  let hover = null
  let press = null
  let drag = null
  let swallow = false
  let keeping = false

  const soulOf = (uid) => s.party.find((u) => u.uid === uid)
  const selected = () => sel?.uid != null ? soulOf(sel.uid) ?? null : null
  // A fielded piece's board tiles (four for a 2×2), and the piece whose footprint covers tile t.
  const cellsOf = (u) => footprint(deployTile('party', u.slot), sizeOf(u)) ?? [deployTile('party', u.slot)]
  const pieceAt = (t) => typeof t === 'number' ? fielded(s.party).find((u) => cellsOf(u).includes(t)) ?? null : null
  // A piece's camp cells; the fielded piece but `except` covering camp cell `slot`; the cells all but `except` hold.
  const slotsOf = (x) => footprintSlots(x.slot, sizeOf(x)) ?? [x.slot]
  const coverAt = (slot, except = null) => fielded(s.party).find((x) => x !== except && slotsOf(x).includes(slot)) ?? null
  const heldBut = (...except) => new Set(fielded(s.party).filter((x) => !except.includes(x)).flatMap(slotsOf))
  // The camp slot of a board tile, or null past the camp.
  const slotOfTile = (t) => typeof t === 'number' && tileY(t) < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t)) : null
  const full = () => fielded(souls(s.party)).length >= fieldCap(run)
  const fullText = (u) => `The field is full (${fieldCap(run)} pieces): drop ${unitDef(u.id).name} onto one of yours to swap them, put one in the ossuary first, or take a Command relic.`

  // Every action keeps the selection but a move's: a purchase leaves it where it is.
  function send (action) {
    error = act(action) ?? ''
    render()
    onChange?.()
    return !error
  }
  function refuse (why) {
    error = why
    sfx.play('poor')
    render()
  }
  // By touch a purchase is read first: the first tap pins its text with a `label` button (if `ok()`), a second makes it.
  let reading = null
  function twice (e, tip, label, ok, go) {
    const el = e.currentTarget
    if (!touchy() || reading === el) { reading = null; return go(e) }
    reading = el
    el.classList.add('chosen')
    pinTip(el, () => [tip(), ok() && h('button', { class: 'primary small tip-act', onclick: () => { hideTip(); reading = null; go(e) } }, label)], {
      keep: true,
      onHide: () => { el.classList.remove('chosen'); if (reading === el) reading = null }
    })
  }
  function select (next) {
    sel = next
    error = ''
    if (next) learnt('select')
    render()
  }

  // The gesture to learn next, if one is left, for the pill atop the panel; while a relic waits to be given, what to tap.
  function hint () {
    const p = selected()
    const tap = say('Click', 'Tap')
    if (giving) return [h('b', null, tap), ' a soul to give it ', h('b', { class: `c-${relicDef(giving).tier}` }, relicDef(giving).name), ' · again to cancel']
    if (wanting) return [h('b', null, 'A soul must stand on the field'), ' to enter a battle']
    if (!done('select')) return [h('b', null, tap), ' a piece to select it · ', h('b', null, 'drag'), ' one to move it']
    if (!done('place') && inOssuary(souls(s.party)).some((u) => u.hp > 0) && !full()) return [h('b', null, 'Drag'), ' a soul from the ossuary onto the camp to field it']
    const ready = !done('fuse') && FUSION_LIST.find((f) => canFuse(run, f.id))
    if (ready) return [h('b', null, ready.name), ' can be made: open the ', h('b', null, 'Shop'), ' tab, then ', h('b', null, 'Fuse')]
    return null
  }

  // ── the picture ──

  // The selected soul's reach round its footprint, as its card tells it; none for the Monarch, the ossuary or a drag.
  function reachNow (picked) {
    const r = picked && !drag && onField(picked) && !isMonarch(picked) && picked.hp > 0 ? reachOf(picked) : 0
    return r > 0 ? { centre: deployTile('party', picked.slot), size: sizeOf(picked), r } : null
  }

  // Arise's reach round the soul holding it where it starts the battle: the selected one, else the first fielded holder.
  function domainNow (picked) {
    const holder = [picked, ...fielded(souls(s.party))].find((u) => u && onField(u) && u.hp > 0 && ariseFor(s, u))
    return holder ? { centre: deployTile('party', holder.slot), size: sizeOf(holder), r: ariseFor(s, holder).domain } : null
  }

  function render () {
    // A Release armed on one soul is let go of once another is selected.
    if (arming != null && selected()?.uid !== arming) arming = null
    if (wanting && fielded(souls(s.party)).some((u) => u.hp > 0)) wanting = false
    const fieldNow = fielded(s.party)
    const m = monarchOf(s)
    const mTile = deployTile('party', m.slot)
    const walls = wallTiles(s.camp)
    const groups = synergyGroups(souls(standing(run)), alsoOf)
    const picked = selected()
    if (sel && !picked) sel = null
    // Who glows bright: the selected piece's partners in every synergy it counts toward, or a pressed chip's.
    const lit = new Set(groups.filter((g) => (focusSyn ? g.key === focusSyn : picked && g.uids.has(picked.uid))).flatMap((g) => [...g.uids]))
    const units = []
    tips = new Map()
    const roads = field({ root: mTile, walls })
    for (const u of fieldNow) {
      const tile = deployTile('party', u.slot)
      units.push({
        key: `s${u.uid}`, id: u.id, tile, size: sizeOf(u), side: 'party', hp: u.hp, maxHp: u.maxHp, lvl: u.lvl, tracks: u.tracks, relics: u.relics ?? [], monarch: isMonarch(u),
        fallen: u.hp <= 0, sel: sel?.uid === u.uid, glow: groups.filter((g) => g.uids.has(u.uid)).map((g) => g.colour), lit: lit.has(u.uid),
        offer: !!giving && canHold(s, giving, u), flies: !!unitDef(u.id).flies
      })
      for (const t of cellsOf(u)) tips.set(t, () => pieceTip(u))
    }
    // Empty ground: what it is, whether Arise reaches it (told only while a holder is fielded), its road to the Monarch.
    const dom = domainNow(picked)
    for (let t = 0; t < LANES * DEPTH; t++) {
      if (tips.has(t)) continue
      const wall = walls.includes(t)
      const d = roads.dist[t]
      tips.set(t, () => h('div', { class: 'syn-tip tile-tip' },
        h('div', null, h('b', null, wall ? 'Wall' : sentence(tileText(t))), dom && [' · ', distanceBetween(dom.centre, dom.size, t, 1) <= dom.r ? 'within Arise\'s reach' : h('span', { class: 'dim' }, 'beyond Arise\'s reach')]),
        h('div', { class: 'dim' }, wall ? 'It blocks walking, not shots: the roads bend round it.'
          : Number.isFinite(d) ? `Its road runs ${d} step${d === 1 ? '' : 's'} to the Monarch.` : 'No road runs from here.')))
    }
    const moving = drag ? soulOf(drag.uid) : null
    const open = !moving && wanting ? readyCells() : null
    const picture = {
      walls, units, domain: dom, reach: reachNow(picked), roads: roads.arrow, seat: mTile,
      drop: open ? open.tiles : dropTiles(moving), dropSize: open ? open.size : moving ? sizeOf(moving) : 1,
      selKey: picked && onField(picked) ? `s${picked.uid}` : null
    }
    stage.className = 'board-stage' + (drag ? ' dragging' : '') + (keyed ? ' kb' : '')
    const teach = hint()
    hintEl.className = 'board-hint' + (wanting ? ' want' : '')
    fill(hintEl, teach)
    hintEl.hidden = !teach || !!drag
    fill(benchEl, benchStrip())
    fill(relicEl, relicStrip())
    relicEl.hidden = !unheld(s).length
    keeping = document.activeElement === stage
    if (keeping && stage.isConnected) stage.focus({ preventScroll: true })
    keeping = false
    errEl.textContent = error
    errEl.hidden = !error
    const now = picked ? `s${picked.uid}` : 'monarch'
    fill(panelBody, picked && !isMonarch(picked) ? soulPanel(picked) : monarchPanel())
    if (now !== shown) panelBody.scrollTop = 0
    shown = now
    board.show(stage, picture)
    if (hover != null && !drag && tips.has(hover)) tileTip(hover)
  }

  // ── the bench ──

  // Under the board: your souls in the ossuary, each a cell to drag onto the camp; a piece dropped on it goes there.
  function benchStrip () {
    const bench = inOssuary(s.party)
    const moving = drag ? soulOf(drag.uid) : null
    const target = moving && onField(moving) && !isMonarch(moving)
    return [
      h('div', {
        class: 'bench-label',
        tip: () => {
          const kept = inOssuary(souls(s.party))
          const fallen = kept.filter((u) => u.hp <= 0).map((u) => unitDef(u.id).name)
          return h('div', { class: 'syn-tip' },
            h('b', null, `Ossuary · ${kept.length ? `${kept.length} kept: ${kept.length - fallen.length} ready${fallen.length ? `, ${fallen.length} fallen (${tally(fallen)})` : ''}` : 'empty'}`),
            h('p', null, `Field ${fielded(souls(s.party)).length}/${fieldCap(run)}, ${fieldRule(run)} · souls ${souls(s.party).length}/${rosterCap(run)}.`),
            h('p', { class: 'dim' }, 'Drag a soul from here onto the camp, or a piece from the camp onto here.'))
        }
      }, h('b', null, 'Ossuary'), h('span', { class: 'dim' }, `${bench.length ? `${bench.length} kept` : 'empty'} · field ${fielded(souls(s.party)).length}/${fieldCap(run)}`)),
      (bench.length || target) && h('div', { class: 'bench' + (target ? ' target' : '') + (drag?.target?.bench && drag.target.ok ? ' over' : '') },
        bench.length
          ? bench.map((u) => h('button', {
            class: 'cell has' + (sel?.uid === u.uid ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : '') + (giving && canHold(s, giving, u) ? ' gift' : ''),
            'data-uid': u.uid,
            onpointerdown: (e) => pressBench(e, u),
            onclick: () => { if (swallow) { swallow = false; return } if (giving) return give(u); select(sel?.uid === u.uid ? null : { uid: u.uid }) },
            tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run, live: benchLead(u), notes: [u.hp > 0 && !full() && 'Drag it onto an open tile of the camp to field it.'] })
          }, portrait(u.id, 46, u.hp <= 0), u.maxHp && u.hp > 0 && hpBar(u.hp, u.maxHp), relicMark(u)))
          : h('span', { class: 'dim empty-bench' }, 'Drop it here to keep it in the ossuary.'))]
  }

  // A soul in the ossuary, its card's lead: whether the field has room for it.
  function benchLead (u) {
    const f = `${fielded(souls(s.party)).length}/${fieldCap(run)}`
    return full() ? `In the ossuary · field ${f}, full: drop it on a piece to swap` : `In the ossuary · field ${f}: room for it`
  }

  // ── relics ──

  // The unheld piece relics: a tap readies one, the souls that may take it light up, and a soul tapped then takes it.
  function relicStrip () {
    return relicChips(run, giving, (id) => { giving = giving === id ? null : id; error = ''; sfx.play('select'); render() })
  }

  // The relic readied (giving) goes to soul `u`, swapping out what it holds; refused in words where it cannot.
  function give (u, relic = giving) {
    if (!relic) return
    if (!u || isMonarch(u)) return refuse('The Monarch holds no relic: give it to a soul.')
    if (!canHold(s, relic, u)) return refuse(`${unitDef(u.id).name} already holds ${relicDef(relic).name}.`)
    giving = null
    if (send({ type: 'hold', relic, uid: u.uid })) sfx.play('buy')
  }

  function relicSection (u) {
    const held = u.relics ?? []
    const full = held.length >= TUNING.relic.perPiece
    const ids = [...new Set(unheld(s))].filter((id) => canHold(s, id, u))
    return h('div', { class: 'uc-relic' },
      h('div', { class: 'uc-sec' }, kw('relic', 'Relic'), h('span', { class: 'dim' }, ` · ${held.length}/${TUNING.relic.perPiece}`)),
      h('div', { class: 'rs-row' },
        held.map((id) => [h('span', { class: `rs-relic rt-${relicDef(id).tier}`, tip: () => relicTip(id, run) }, icon(relicIcon(id), 18), relicDef(id).name),
          h('button', { class: 'ghost small', onclick: () => send({ type: 'unhold', uid: u.uid, relic: id }), tip: () => `Take ${relicDef(id).name} back: it waits unheld, to give again.` }, 'Take back')]),
        !full && h('span', { class: 'rs-empty dim' }, ids.length ? '◇ Empty: give it one' : '◇ Empty: buy a piece relic in the Shop')),
      ids.length > 0 && h('div', { class: 'rs-give' }, ids.map((id) => h('button', {
        class: `give-relic small rt-${relicDef(id).tier}` + (giving === id ? ' on' : ''),
        onclick: () => give(u, id),
        tip: () => h('div', null, relicTip(id, run), h('p', { class: 'dim' }, full ? `Swap it for ${held.map((x) => relicDef(x).name).join(', ')}, which waits unheld.` : `Give it to ${unitDef(u.id).name}.`))
      }, icon(relicIcon(id), 16), full ? `Swap: ${relicDef(id).name}` : relicDef(id).name))))
  }

  // ── the panels ──

  function shake (e) {
    const t = e?.currentTarget
    if (!t?.classList) return
    t.classList.remove('shake')
    void t.offsetWidth
    t.classList.add('shake')
  }

  function pieceHead (u, mods) {
    const d = unitDef(u.id)
    const st = statsOf(u, mods)
    const [hp, maxHp] = hpAt(u, st)
    const stat = (ico, v) => h('span', { class: 'uc-stat s-' + ico, tip: () => statTip(run, u, ico) }, icon(ico, 18), h('b', null, v))
    return [h('div', { class: 'uc-head' },
      h('div', { class: 'uc-art', tip: () => unitCard(u, { mods, realm: realmOf(run), run }) }, portrait(u.id, 56, u.hp <= 0), relicMark(u)),
      h('div', { class: 'uc-id' },
        h('div', { class: 'uc-name' }, d.name),
        h('div', { class: 'uc-sub dim' }, `Lv ${u.lvl} · ${d.kin ? `${KIN[d.kin].name} ` : ''}${ROLES[d.role].name}`))),
    h('div', { class: 'uc-stats' },
      stat('hp', hp < maxHp ? `${hp}/${maxHp}` : maxHp),
      stat('atk', Math.round(st.atk)), stat('def', Math.round(st.def)), stat('move', Math.round(st.move))),
    h('div', { class: 'uc-reach', tip: () => reachRule(u) }, icon('reach', 18), h('span', null, reachText(u)))]
  }

  const abilities = (u, st) => h('div', { class: 'uc-abs' }, abilityBlocks(u, st, realmOf(run)), auraBlock(u))

  function soulPanel (u) {
    const mods = partyMods(run, u)
    const on = onField(u)
    return h('div', { class: 'uc' },
      pieceHead(u, mods),
      relicSection(u),
      summonsOf(u) > 0 && h('p', { class: 'uc-note uc-summons' }, summonText(u, statsOf(u, mods), mods)),
      !on && h('p', { class: 'dim uc-note' }, full() ? fullText(u) : say('In the ossuary. Drag it onto an open tile of the camp, or click one.', 'In the ossuary. Drag it onto an open tile of the camp, or tap one.')),
      tierPanel(u),
      h('div', { class: 'uc-sec' }, 'Abilities'),
      abilities(u, statsOf(u, mods)),
      h('div', { class: 'uc-acts' },
        on && h('button', { class: 'ghost small', onclick: () => place(u, OSSUARY), tip: () => `Keep ${unitDef(u.id).name} out of battle, in the ossuary.` }, icon('bone', 18), 'To the ossuary'),
        releaseButton(u)))
  }

  // Release for good, for a share of its price back; never the last soul standing. One press arms it, a second releases.
  let arming = null
  function releaseButton (u) {
    const all = souls(s.party)
    if (all.length < 2 || !all.some((x) => x !== u && x.hp > 0)) return null
    const armed = arming === u.uid
    return h('button', {
      class: armed ? 'danger small' : 'ghost small',
      onclick: () => {
        if (!armed) { arming = u.uid; return render() }
        arming = null
        if (sel?.uid === u.uid) sel = null
        send({ type: 'release', uid: u.uid })
      },
      tip: () => `Release ${unitDef(u.id).name} forever, ${releaseText(run, u)}. Press twice: it can't be undone.`
    }, icon('release', 16), armed ? 'Release for good' : 'Release', h('span', { class: 'price' }, icon('soul', 14), `+${releaseRefund(run, u)}`))
  }

  // Soul `u`'s two tracks of tiers I–IV, its own; once one passes II the other stops there.
  function tierPanel (u) {
    const name = unitDef(u.id).name
    const tracks = tracksOf(u.id)
    const lvl = u.lvl
    // The level one tier more gives (either track's: a tier is a tier).
    const up = levelOf({ tracks: [u.tracks[0] + 1, u.tracks[1]] })
    const rise = up > lvl ? `Level ${lvl} → ${up}.` : `Level stays ${lvl}.`
    const row = (tr, t) => {
      const have = u.tracks[t]
      const can = canAdvance(s, u, t)
      const blocked = !can && have < 4
      const cost = can ? tierCost(run, u, t) : 0
      const next = tr.tiers[have]
      const other = tracks[1 - t]
      const lockText = `Locked: ${other.name} has passed II, so ${tr.name} stops at II.`
      const node = (tier, i) => {
        const lock = i >= have && !canTrack(u.tracks.map((v, j) => (j === t ? i : v)), t)
        const state = i < have ? 'own' : i === have && can ? (s.essence < cost ? 'next poor' : 'next') : lock ? 'lock' : 'later'
        const tip = () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${tr.name} ${ROMAN[i]}: `), tier.desc),
          i < have ? null : lock ? h('p', { class: 'warn' }, lockText) : i > have ? h('p', { class: 'dim' }, `After ${ROMAN[i - 1]}.`)
            : s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}. ${rise}`) : h('p', { class: 'dim' }, `${cost} essence, for this ${name}. ${rise}`))
        const press = (e) => { if (i === have && can) return buyTier(e, u, t, cost); if (i >= have) { sfx.play('poor'); shake(e) } }
        return h('button', {
          class: `tnode ${state}` + (tier.size === 2 ? ' colossus' : ''), 'aria-label': `${tr.name} ${ROMAN[i]}`, 'aria-disabled': i === have && can && s.essence >= cost ? null : 'true',
          onclick: (e) => (i < have ? null : twice(e, tip, `Buy ${ROMAN[i]} ▸`, () => i === have && can && s.essence >= cost, press)),
          tip
        }, h('span', { class: 'tnum' }, ROMAN[i]), tier.size === 2 && h('span', { class: 'tbadge', 'aria-label': '2×2' }, icon('big', 14)))
      }
      return h('div', { class: 'track' + (have ? ' held' : '') + (t ? ' second' : '') },
        h('div', {
          class: 'track-head',
          tip: () => h('div', { class: 'syn-tip' }, h('b', null, `${tr.name} ${have}/${tr.tiers.length}`), ' ', tr.desc,
            h('p', { class: blocked ? 'warn' : 'dim' }, have >= tr.tiers.length ? 'Complete.' : blocked ? lockText
              : `Next: ${ROMAN[have]} for ${cost}${s.essence < cost ? `; you have ${s.essence}` : ''}. ${rise}`))
        }, h('b', null, tr.name), h('span', { class: 'track-desc dim' }, tr.desc)),
        h('div', { class: 'nodes' }, tr.tiers.map((tier, i) => [i > 0 && h('span', { class: 'tlink' + (i < have ? ' on' : '') }), node(tier, i)]),
          can && h('span', { class: 'tprice' + (s.essence < cost ? ' poor' : '') }, icon('soul', 16), cost)),
        h('div', { class: 'track-next' + (blocked ? ' warn' : '') }, have >= 4 ? 'Complete.' : blocked ? lockText : [h('b', null, `${ROMAN[have]} `), next.desc]))
    }
    return h('div', { class: 'uc-tiers' },
      h('div', { class: 'uc-sec' }, 'Its tiers'),
      h('div', {
        class: 'uc-level',
        tip: () => levelTip(u, lvl, up)
      }, icon('levelup', 20), h('b', null, 'Level ', h('span', { class: 'num' }, lvl)), h('span', { class: 'dim' }, ' · rises with its tiers')),
      tracks.length === 2 && h('div', { class: 'tracks' }, tracks.map(row)))
  }
  // Soul `u`'s level in its stats: what it gives the soul now (`lvl`), what the next tier's (`up`) adds.
  function levelTip (u, lvl, up) {
    const name = unitDef(u.id).name
    const [now, next] = [baseStats(u.id, lvl), baseStats(u.id, up)]
    const r = (st) => ({ hp: Math.round(st.hp), atk: Math.round(st.atk), def: Math.round(st.def) })
    const [a, b] = [r(now), r(next)]
    const gain = [['HP', 'hp'], ['ATK', 'atk'], ['DEF', 'def']].filter(([, k]) => b[k] !== a[k]).map(([w, k]) => `+${b[k] - a[k]} ${w}`).join(', ')
    const more = canAdvance(s, u, 0) || canAdvance(s, u, 1)
    return h('div', { class: 'syn-tip' },
      h('p', null, h('b', null, `Level ${lvl}: `), `HP ${a.hp}, ATK ${a.atk}, DEF ${a.def} for this ${name}.`),
      h('p', { class: 'dim' }, !more ? 'No tier left to buy.' : up > lvl ? `Next tier: Level ${up}${gain ? `, ${gain}` : ''}.` : `Next tier: level stays ${lvl}.`))
  }
  // A Colossus tier sends the soul to the ossuary where it no longer fits 2×2 where it stood: said.
  function buyTier (e, u, track, cost) {
    if (s.essence < cost) { sfx.play('poor'); return shake(e) }
    const stood = onField(u)
    if (!send({ type: 'upgrade', uid: u.uid, track })) return
    sfx.play('buy')
    if (!stood || onField(soulOf(u.uid))) return
    error = `The ${unitDef(u.id).name} no longer fits 2×2 where it stood: in the ossuary until you place it again.`
    render()
  }

  function monarchPanel () {
    const m = monarchOf(s)
    const stat = (k) => {
      const t = MONARCH_TEXT[k]
      return h('div', {
        class: 'mc-col',
        tip: () => h('div', { class: 'syn-tip' }, t.rule(run).filter(Boolean).map((line, i) => h('p', { class: i ? 'dim' : null }, i ? line : [h('b', null, `${t.name}: `), line])))
      },
      h('div', { class: 'mc-ico' }, icon(t.icon, 20)),
      h('div', { class: 'mc-name' }, t.name),
      h('div', { class: 'mc-val' }, t.value(run)),
      h('div', { class: 'mc-now' }, t.now(run)))
    }
    // Compact, so it shows whole in the slim panel: the head one line, the numbers two by two.
    return [h('div', { class: 'mc' },
      h('div', { class: 'uc-head' },
        h('div', { class: 'uc-art', tip: () => unitCard(m, { mods: partyMods(run, m), realm: realmOf(run), notes: ['Its seat is the camp\'s, marked by the crown: it never moves, and the roads run to it.'] }) }, portrait(m.id, 44, m.hp <= 0),
          h('span', { class: 'uc-ins crown' }, icon('crown', 14))),
        h('div', { class: 'uc-id' },
          h('div', { class: 'uc-name', tip: () => MONARCH_RULE }, 'The Monarch'),
          h('div', { class: 'mc-hp' }, hpBar(m.hp, m.maxHp), h('span', null, `${m.hp}/${m.maxHp}`)))),
      h('div', { class: 'mc-cols' }, ['hp', 'command'].map(stat))),
    h('div', { class: 'uc-sec' }, kw('synergy', 'Synergies'), h('span', { class: 'dim' }, say(' · click one to light its pieces', ' · tap one to light its pieces'))),
    synergyTracker(souls(standing(run)), alsoOf, { focus: focusSyn, onFocus: (key) => { focusSyn = focusSyn === key ? null : key; render() } }),
    h('div', { class: 'uc-sec' }, 'The board'),
    h('ul', { class: 'legend-list dim' },
      h('li', null, h('i', { class: 'lg-road' }), kw('road', 'Roads'), ': the arrows the foes walk to the Monarch.'),
      h('li', null, h('i', { class: 'lg-seat' }), 'The crown: the Monarch\'s seat, the camp\'s own. It never moves.'),
      domainNow(null) && h('li', null, h('i', { class: 'lg-dom' }), 'Arise\'s reach, round the soul holding it as the battle begins: the corpses it may raise.'))]
  }

  // ── tooltips ──

  // A fielded soul's card leads with where it starts, its reach and Move, and its synergies, unless it holds Arise.
  const pieceTip = (u) => {
    const at = !isMonarch(u) && [sentence(tileText(deployTile('party', u.slot)).replace(/^your camp, /, '')), reachText(u),
      ...synergyGroups(souls(standing(run)), alsoOf).filter((g) => g.uids.has(u.uid)).map((g) => g.name)].join(' · ')
    return unitCard(u, {
      mods: partyMods(run, u), realm: realmOf(run), run,
      live: isMonarch(u) ? 'If it falls, the run ends' : ariseFor(s, u) ? `Holds Arise: corpses within ${ariseFor(s, u).domain} tiles` : at,
      notes: [isMonarch(u) ? 'Its seat is the camp\'s, marked by the crown: it never moves.' : ariseFor(s, u) && at]
    })
  }
  function tileTip (t) {
    const r = t != null && tips.has(t) && board.rectOf(t)
    if (r) showTip(r, tips.get(t))
    else hideTip()
  }

  // ── acting ──

  // A soul to a camp slot (its footprint's anchor), or OSSUARY; the rules' refusals said in words before it is sent.
  function place (u, slot) {
    if (slot === u.slot) return render()
    if (isMonarch(u)) return refuse('The Monarch keeps the seat the camp gives it: it never moves.')
    if (slot !== OSSUARY && !canPlace(run, u, slot)) return refuse(placeRefusal(u, slot))
    const fresh = !onField(u) && slot !== OSSUARY
    if (sel?.uid === u.uid && fresh) sel = null
    if (send({ type: 'place', uid: u.uid, slot }) && fresh) learnt('place')
  }

  // Why piece u cannot stand anchored at camp cell `slot`, in words. Its footprint is read whole: off the camp, the seat,
  // a wall, two pieces under it (a move swaps with one, never two), the one under it with no room, last a full field.
  function placeRefusal (u, slot) {
    const name = unitDef(u.id).name
    const cells = footprintSlots(slot, sizeOf(u))
    if (!cells) return `${name} is 2×2: its four cells must all lie in the camp.`
    if (cells.some((c) => isMonarchCell(s.camp, c))) return 'The Monarch\'s seat is its own: nothing else stands on it.'
    if (cells.some((c) => isWall(s.camp, c))) return sizeOf(u) > 1 ? `A wall stands under ${name}'s four cells: a piece stands on open ground.` : 'A wall stands there: a piece stands on open ground.'
    const under = [...new Set(cells.map((c) => coverAt(c, u)).filter(Boolean))]
    if (under.length > 1) return `${name}'s footprint there covers ${under.length} pieces (${under.map((x) => unitDef(x.id).name).join(', ')}): a move swaps with one piece, never two.`
    const other = under[0]
    if (other && onField(u)) return `${unitDef(other.id).name} has no room where ${name} stands now, so they cannot swap.`
    if (!other && !onField(u) && full()) return fullText(u)
    return `${name} does not fit there.`
  }

  // The anchor a piece of u's size takes to cover camp cell `slot`: the first footprint over it that fits, else the cell.
  function anchorFor (u, slot) {
    if (sizeOf(u) === 1) return slot
    const [r, c] = [rowOf(slot), slot % COLS]
    const ways = [[r, c], [r, c - 1], [r + 1, c], [r + 1, c - 1]].filter(([y, x]) => y < CAMP_ROWS && x >= 0).map(([y, x]) => slotAt(y, x))
    return ways.find((a) => canPlace(run, u, a)) ?? slot
  }

  // A tap: a piece selects it (or lets it go); an open camp tile places a selected ossuary soul; else the Monarch's panel.
  function tapTile (t) {
    const o = pieceAt(t)
    // A relic readied: the soul tapped takes it; anywhere else lets it go.
    if (giving) { if (o) return give(o); giving = null; return render() }
    if (t == null) return select(null)
    if (o) return select(sel?.uid === o.uid ? null : { uid: o.uid })
    const p = selected()
    const slot = slotOfTile(t)
    if (p && !onField(p) && slot != null && !isWall(s.camp, slot)) return place(p, anchorFor(p, slot))
    select(null)
  }

  // ── the board under the pointer ──
  // A press is a tap unless it moves past a few pixels; the tooltip follows the mouse, a finger's comes by a long press.

  stage.addEventListener('pointermove', (e) => {
    if (press || drag || e.pointerType === 'touch') return
    const t = board.tileAt(e.clientX, e.clientY)
    if (t === hover && (t == null || document.querySelector('.tip.on'))) return
    hover = t
    board.hover(t)
    tileTip(t)
  })
  stage.addEventListener('pointerleave', (e) => {
    if (press || drag || e.pointerType === 'touch') return
    hover = null
    board.hover(null)
    hideTip()
  })
  stage.addEventListener('contextmenu', (e) => e.preventDefault())
  // The keyboard: the board takes focus; the arrows move a cursor (from the Monarch's tile), Enter or Space taps.
  let cursor = null
  let keyed = false
  stage.tabIndex = 0
  const keys = (on) => { keyed = on; stage.classList.toggle('kb', on) }
  const point = (t) => { cursor = t; hover = t; board.focus(t); board.hover(t); tileTip(t); keys(true) }
  const home = () => deployTile('party', monarchOf(s).slot)
  stage.addEventListener('focus', () => { if (!keeping && !drag && !press && stage.matches(':focus-visible')) point(cursor ?? home()) })
  stage.addEventListener('blur', () => { if (keeping || cursor == null) return; board.focus(null); board.hover(null); hover = null; hideTip() })
  stage.addEventListener('keydown', (e) => {
    if (drag || e.metaKey || e.ctrlKey || e.altKey) return
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]
    if (step && cursor == null) point(home())
    else if (step) {
      const [x, y] = [tileX(cursor) + step[0], tileY(cursor) + step[1]]
      if (x >= 0 && x < LANES && y >= 0 && y < DEPTH) point(tileAt(x, y))
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor != null) tapTile(cursor)
    else return
    e.preventDefault()
    e.stopPropagation()
  })
  stage.addEventListener('pointerdown', (e) => {
    swallow = false
    if (cursor != null) { cursor = null; board.focus(null) }
    keys(false)
    if (e.button !== 0) return
    const t = board.tileAt(e.clientX, e.clientY)
    const o = pieceAt(t)
    // The Monarch never moves: a press on it is only ever a tap.
    begin(e, { tile: t, uid: o && !isMonarch(o) ? o.uid : null })
    // A finger held still on a tile pins its tooltip; it is then no tap.
    const q = press
    if (e.pointerType === 'touch' && e.isPrimary) {
      q.hold = hold(e, () => {
        if (press !== q || drag) return
        q.long = true
        const r = t != null && tips.has(t) && board.rectOf(t)
        if (!r) return
        board.hover(t)
        pinTip(r, tips.get(t), { onHide: () => { if (!drag) board.hover(null) } })
      })
    }
  })

  function pressBench (e, u) {
    swallow = false
    if (e.button !== 0) return
    begin(e, { uid: u.uid, bench: true })
  }

  function begin (e, p) {
    press = { x: e.clientX, y: e.clientY, e, t0: performance.now(), touch: e.pointerType === 'touch', ...p }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function end () {
    press?.hold?.cancel()
    press = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  // The screen changed under a press: it is let go of, and nothing it would do is done.
  function release () {
    end()
    if (drag) cancelDrag(false)
    hover = null
  }

  // A finger on a soul in the bench scrolls the strip only when it holds more than it shows, the finger sets off
  // sideways (within 25° of it) before a long press, and it stays over the strip: any other way the soul lifts.
  const FLAT = Math.tan(25 * Math.PI / 180)
  const over = (list, e) => { const r = list.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom }
  function onMove (e) {
    if (!el.isConnected) return release()
    if (!press || e.pointerId !== press.e.pointerId) return
    const [dx, dy] = [e.clientX - press.x, e.clientY - press.y]
    const far = Math.hypot(dx, dy) > 6
    if (press.scroll) {
      const { list, left } = press.scroll
      if (over(list, e)) { list.scrollLeft = left - dx / frame.k; return }
      press.scroll = null
    } else if (!drag && far && press.bench) {
      const list = press.touch && performance.now() - press.t0 < HOLD && el.querySelector('.bench')
      if (list && list.scrollWidth > list.clientWidth + 1 && Math.abs(dy) <= Math.abs(dx) * FLAT && over(list, e)) {
        press.scroll = { list, left: list.scrollLeft }
        swallow = true
        return
      }
    }
    if (!drag && far && press.uid != null) lift(e)
    if (drag) overMove(e)
  }

  function onUp (e) {
    if (!el.isConnected) return release()
    if (press && e.pointerId !== press.e.pointerId) return
    const p = press
    end()
    if (drag) return put(e)
    if (!p || p.long || p.bench) return
    tapTile(p.tile)
  }

  function onCancel () {
    if (!el.isConnected) return release()
    end()
    if (drag) cancelDrag()
  }

  // ── moving a piece ──

  function lift (e) {
    press.hold?.cancel()
    const u = soulOf(press.uid)
    drag = { uid: u.uid, at: undefined, target: null }
    if (press.bench) swallow = true
    hideTip()
    hover = null
    board.hover(null)
    document.body.classList.add('dragging')
    // Off the board the canvas is under the page: a ghost carries the piece, at the board's size in the frame's px.
    const size = Math.round(Math.max(40, 92 * board.zoom()) / frame.k)
    drag.ghost = h('div', { class: 'drag-ghost', hidden: true, style: `--s:${size}px` }, portrait(u.id, size, u.hp <= 0))
    frame.el.append(drag.ghost)
    board.lift(press.bench ? { id: u.id, size: sizeOf(u) } : `s${u.uid}`, e.clientX, e.clientY)
    render()
  }

  // The tiles a piece may be dropped on, by its footprint's anchor: every camp cell it fits or swaps at.
  function dropTiles (u) {
    if (!u || isMonarch(u)) return []
    const out = []
    for (let slot = 0; slot < COLS * CAMP_ROWS; slot++) {
      if (slot !== u.slot && canPlace(run, u, slot)) out.push(deployTile('party', slot))
    }
    return out
  }

  // Where a soul may stand now, rung while a battle waits for one (wanting): the tiles the ossuary's first ready soul may
  // be dropped on (by its footprint), else every open cell of the camp. → { tiles, size }
  function readyCells () {
    const next = inOssuary(souls(s.party)).find((u) => u.hp > 0)
    if (next) return { tiles: dropTiles(next), size: sizeOf(next) }
    const held = heldBut()
    const tiles = []
    for (let slot = 0; slot < COLS * CAMP_ROWS; slot++) {
      if (campOpen(s.camp, slot) && !isMonarchCell(s.camp, slot) && !held.has(slot)) tiles.push(deployTile('party', slot))
    }
    return { tiles, size: 1 }
  }

  // The drop under the pointer and, when it changes, its preview for the board; there the tile is the footprint's anchor.
  function overMove (e) {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    const onBench = hit?.closest?.('.bench-strip')
    const benched = onBench ? hit.closest('[data-uid]')?.dataset.uid : undefined
    const t = onBench ? null : board.tileAt(e.clientX, e.clientY)
    const at = onBench ? `b${benched ?? ''}` : String(t)
    const off = !hit?.closest?.('.stage-wrap')
    drag.ghost.hidden = !off
    const g = toLocal(e.clientX, e.clientY)
    drag.ghost.style.transform = `translate(${g.x}px, ${g.y}px)`
    let preview
    if (at !== drag.at) {
      drag.at = at
      drag.target = dropAt(soulOf(drag.uid), t, !!onBench, benched != null ? soulOf(+benched) : null)
      preview = dragPreview(soulOf(drag.uid), drag.target)
      el.querySelector('.bench')?.classList.toggle('over', !!drag.target?.bench && drag.target.ok)
    }
    board.follow(e.clientX, e.clientY, preview, off)
  }

  // Where a drop would land: a camp cell (its footprint's anchor) with the tiles it would cover (`cells`, those it cannot
  // take in `bad`), a tile past the camp (slot null: all bad), the bench or a soul on it (`benched`: they swap), or null;
  // `ok`: whether the rules take it (a refused one in the camp is still put down, for its message).
  function dropAt (u, t, bench, benched) {
    if (bench) return { bench: true, benched, ok: !isMonarch(u) && onField(u) }
    if (t == null) return null
    const slot = slotOfTile(t)
    const size = sizeOf(u)
    const [x, y] = [tileX(t), tileY(t)]
    const cells = []
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (x + dx < LANES && y + dy < DEPTH) cells.push(tileAt(x + dx, y + dy))
    // Past the camp: every cell red, and a drop there is let go of.
    if (slot == null) return { tile: t, slot, size, cells, bad: cells, ok: false }
    const o = swapWith(run, u, slot)
    const held = heldBut(u, o === 'many' ? null : o)
    const whole = cells.length === size * size
    const bad = cells.filter((c) => {
      const sl = slotOfTile(c)
      return sl == null || !campOpen(s.camp, sl) || isMonarchCell(s.camp, sl) || held.has(sl)
    })
    return { tile: t, slot, size, cells, bad: whole ? bad : cells, ok: slot === u.slot || canPlace(run, u, slot) }
  }

  // What a drop would make of the board: the footprint lit, red where it does not fit, the piece it displaces ghosted.
  function dragPreview (u, target) {
    if (!target || target.bench) return { tile: null, ok: !!target?.ok, swap: null }
    const base = { tile: target.tile, size: target.size, cells: target.cells, bad: target.bad, ok: target.ok }
    if (!target.ok || target.slot === u.slot) return { ...base, swap: null }
    const other = swapWith(run, u, target.slot)
    return { ...base, swap: other && other !== 'many' ? { key: `s${other.uid}`, id: other.id, size: sizeOf(other), to: onField(u) ? deployTile('party', u.slot) : null } : null }
  }

  function put (e) {
    overMove(e)
    const { uid, target } = drag
    cancelDrag(false)
    const u = soulOf(uid)
    if (!target || (!target.bench && target.slot == null)) { error = ''; return render() }
    if (target.bench) {
      if (!onField(u)) return render()
      return target.benched && target.benched !== u ? place(target.benched, u.slot) : place(u, OSSUARY)
    }
    place(u, target.slot)
  }

  function cancelDrag (redraw = true) {
    drag?.ghost?.remove()
    drag = null
    stage.classList.remove('dragging')
    document.body.classList.remove('dragging')
    board.drop()
    if (redraw) render()
  }

  render()
  return {
    el,
    release,
    shown: render,
    // A battle refused for want of a soul on the field: the hint asks for one, shaken afresh, and the cells it may take ring.
    wantSoul () {
      wanting = true
      sfx.play('poor')
      hintEl.classList.remove('want')
      void hintEl.offsetWidth
      render()
    },
    key (e) {
      if (e.key !== 'Escape') return
      if (drag) { end(); return cancelDrag() }
      if (giving) giving = null
      else if (focusSyn) focusSyn = null
      else if (sel) sel = null
      else if (!error) return
      error = ''
      render()
    }
  }
}

// "your camp, front row, lane 4" → "Your camp, front row, lane 4".
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1)
// A soul's relic, worn as a small gem in its tier's colour on its portrait.
const relicMark = (u) => u.relics?.length > 0 && h('i', { class: `relic-mark rt-${relicDef(u.relics[0]).tier}`, 'aria-hidden': 'true' })
