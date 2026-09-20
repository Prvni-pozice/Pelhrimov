// collect.js — sbírání bodů programu po městě.
//
// Listiny jsou schované v polích podloubí a v průjezdech bran, takže se k nim
// nedá dostat jinak než projít celé náměstí a všechny tři brány. Ke každé je
// vidět, za kterou kandidátku je a odkud text pochází.
//
// Obsah se NEVYMÝŠLÍ. Bere se ze src/data/program.json a dokud tam u strany
// nejsou žádné body, hra sbírá ukázkové údaje o městě a v HUD to hlásí —
// aby si nikdo nespletl mapová data s tím, co strany slibují.

/** Stabilní míchání: stejné rozmístění při každém spuštění. */
function shuffled(arr, seed) {
  const a = arr.slice()
  let s = seed >>> 0
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) ^ 0x9e3779b9) >>> 0
    const j = s % (i + 1)
    const t = a[i]; a[i] = a[j]; a[j] = t
  }
  return a
}

export class Collectibles {
  /**
   * @param {object} program obsah src/data/program.json
   * @param {Array} spots    úkryty ze světa ({x, z, y, kind, id, name})
   */
  constructor(program, spots) {
    this.program = program
    this.demo = program.strany.every(s => !s.body || !s.body.length)

    // ── seznam listin ──
    const items = []
    if (this.demo) {
      program.ukazka.forEach((text, i) => items.push({
        text, strana: null, zdroj: 'vlastní mapová data hry', i,
      }))
    } else {
      for (const s of program.strany) {
        for (const b of (s.body || [])) {
          items.push({ text: b.text, zdroj: b.zdroj, strana: s })
        }
      }
    }

    // ── rozmístění ──
    // Brány mají přednost (jsou daleko a hráč je musí najít), zbytek se
    // rozhodí po podloubí. Míchá se pevným semínkem, aby byl svět pokaždé
    // stejný a dal se o něm někomu vyprávět.
    const gates = spots.filter(s => s.kind === 'brana')
    const arcs = shuffled(spots.filter(s => s.kind === 'podloubi'), 0x50454c48)
    const order = [...gates, ...arcs]
    // prostřídat strany, ať jedna kandidátka nesedí celá v jednom rohu
    const mixed = this.demo ? items : interleave(items)

    this.items = mixed.slice(0, order.length).map((it, i) => ({
      ...it,
      x: order[i].x, z: order[i].z, y: order[i].y,
      kde: order[i].kind === 'brana' ? order[i].name : 'podloubí na náměstí',
      got: false,
    }))
    this.left = this.items.length

    this.startedAt = null
    this.finishedAt = null
  }

  get total() { return this.items.length }
  get done() { return this.items.length - this.left }

  /** Kolik má která strana nalezeno — {id: {nazev, barva, got, total}} */
  perParty() {
    const out = new Map()
    for (const it of this.items) {
      const key = it.strana ? it.strana.id : 'mesto'
      if (!out.has(key)) {
        out.set(key, {
          nazev: it.strana ? it.strana.nazev : 'o městě',
          barva: it.strana ? it.strana.barva : '#8aa2b8',
          got: 0, total: 0,
        })
      }
      const e = out.get(key)
      e.total++
      if (it.got) e.got++
    }
    return [...out.values()]
  }

  /** @returns {?object} listina, kterou hráč právě sebral */
  update(px, pz, py) {
    if (this.startedAt === null) this.startedAt = performance.now()
    if (!this.left) return null
    for (const it of this.items) {
      if (it.got) continue
      if (Math.abs(it.y - py) > 4) continue          // ne skrz patro
      const d = (it.x - px) ** 2 + (it.z - pz) ** 2
      if (d > 2.6 * 2.6) continue
      it.got = true
      this.left--
      if (!this.left) this.finishedAt = performance.now()
      return it
    }
    return null
  }

  elapsed() {
    if (this.startedAt === null) return 0
    return ((this.finishedAt ?? performance.now()) - this.startedAt) / 1000
  }

  /** Nejbližší nesebraná listina — pro šipku a vzdálenost v HUD. */
  nearest(px, pz) {
    let best = null, bd = 1e9
    for (const it of this.items) {
      if (it.got) continue
      const d = (it.x - px) ** 2 + (it.z - pz) ** 2
      if (d < bd) { bd = d; best = it }
    }
    return best
  }
}

/** Prostřídá položky po stranách, aby byly kandidátky rozházené po městě. */
function interleave(items) {
  const byParty = new Map()
  for (const it of items) {
    const k = it.strana.id
    if (!byParty.has(k)) byParty.set(k, [])
    byParty.get(k).push(it)
  }
  const lists = [...byParty.values()]
  const out = []
  for (let i = 0; out.length < items.length; i++) {
    for (const l of lists) if (i < l.length) out.push(l[i])
  }
  return out
}
