// quests.js — co se ve městě dá dělat.
//
// Hra je obchůzka po pamětihodnostech jádra: vždy je zadaný jeden cíl, k němu
// vede šipka a po dojití se otevře kartička. Cíle nevymýšlím — berou se z
// OpenStreetMap (brány, kostel, zámek, sochy, muzeum), takže stojí tam, kde
// ve skutečnosti stojí.
//
// Popisky schválně nepíšou historii, kterou bych si musel domyslet. Říkají to,
// co je v datech měřitelné: kolik má stavba pater, jak je vysoká, v jaké ulici
// stojí. Co je navíc, je označené jako údaj z mapy.

const REACH = 11      // do kolika metrů se cíl počítá za nalezený

/** Ručně vybrané pamětihodnosti: klíč v datech → jak se má ukázat hráči. */
const WANTED = [
  { match: p => p.k === 'monument' && p.name === 'svatý Jakub',
    title: 'Kašna svatého Jakuba', hint: 'Uprostřed náměstí.' },
  { match: p => p.k === 'gate' && p.name === 'Solní brána',
    title: 'Solní brána', hint: 'Západní vstup do jádra, u divadla.' },
  { match: p => p.k === 'gate' && p.name === 'Horní brána',
    title: 'Horní brána', hint: 'Jižní vstup do jádra.' },
  // Muzeum rekordů sídlí přímo v Dolní bráně, takže je to jeden cíl, ne dva.
  { match: p => p.k === 'landmark' && /rekord/i.test(p.name || ''),
    title: 'Dolní brána a Muzeum rekordů', hint: 'Severovýchodní vstup do jádra.' },
  { match: p => p.k === 'landmark' && /divadlo/i.test(p.name || ''),
    title: 'Městské divadlo', hint: 'V Solní ulici, na západě jádra.' },
  { match: p => p.k === 'monument' && /Nepomuck/i.test(p.name || ''),
    title: 'Socha sv. Jana Nepomuckého', hint: 'Severozápadně od náměstí.' },
  { match: p => p.k === 'monument' && /Václav/i.test(p.name || ''),
    title: 'Socha svatého Václava', hint: 'Západně od náměstí.' },
]

/** Stavby, které se poznají podle jména budovy, ne podle bodu zájmu. */
const WANTED_BUILDINGS = [
  { name: 'svatý Bartoloměj', title: 'Kostel svatého Bartoloměje',
    hint: 'Nejvyšší věž ve městě, kousek od náměstí.' },
  { name: 'zámek Pelhřimov', title: 'Zámek Pelhřimov', hint: 'Na jihozápadní straně jádra.' },
  { name: 'Šrejnarovský dům', title: 'Šrejnarovský dům', hint: 'V řadě domů na náměstí.' },
]

export class Quests {
  constructor(data, terrain) {
    this.ter = terrain
    this.roads = data.roads
    this.list = []

    for (const w of WANTED) {
      const p = data.pois.find(w.match)
      if (p) this.list.push({ x: p.x, z: p.z, title: w.title, hint: w.hint, info: `Bod zájmu z OpenStreetMap: ${p.name}.` })
    }
    for (const w of WANTED_BUILDINGS) {
      const b = data.buildings.find(x => x.name === w.name)
      if (!b) continue
      let cx = 0, cz = 0
      for (const q of b.poly) { cx += q[0]; cz += q[1] }
      cx /= b.poly.length; cz /= b.poly.length
      const h = b.eave + (b.roof === 'flat' ? 0 : b.rh)
      this.list.push({
        x: cx, z: cz, title: w.title, hint: w.hint,
        info: `${b.levels} nadzemní podlaží, hřeben ${h.toFixed(1)} m nad terénem `
            + `(podle půdorysu a počtu pater z OpenStreetMap).`,
      })
    }
    // dedup podle místa: muzeum a Dolní brána sdílí budovu
    this.list = this.list.filter((q, i) =>
      !this.list.some((o, j) => j < i && Math.hypot(o.x - q.x, o.z - q.z) < 6))

    // Kam hráč doopravdy dojde. Bod zájmu uvnitř budovy leží v jejím těžišti
    // a u třicetimetrového zámku se k němu na jedenáct metrů nikdy nedostane —
    // takový cíl se posune na nejbližší ulici a šipka míří tam. Na kartičce
    // zůstává pamětihodnost, ne ulice. Kašna uprostřed náměstí se naopak
    // nikam posouvat nesmí, k té se dojde přímo.
    for (const q of this.list) {
      q.gx = q.x; q.gz = q.z
      if (!data.buildings.some(b => inPoly(q.x, q.z, b.poly))) continue
      const g = nearestRoad(q.x, q.z, this.roads)
      if (g) { q.gx = g[0]; q.gz = g[1] }
    }

    this.found = new Set()
    this.target = null
    this.startedAt = null
    this.finishedAt = null
    this.walked = 0
    this._last = null
    this.pick([0, 0])
  }

  get total() { return this.list.length }
  get done() { return this.found.size }

  /** Vybere nejbližší nenalezený cíl. */
  pick(from) {
    let best = null, bd = 1e9
    for (const q of this.list) {
      if (this.found.has(q)) continue
      const d = Math.hypot(q.gx - from[0], q.gz - from[1])
      if (d < bd) { bd = d; best = q }
    }
    this.target = best
    if (!best) this.finishedAt = performance.now()
    return best
  }

  /**
   * @returns {?object} kartička k zobrazení, pokud hráč právě dorazil k cíli
   */
  update(px, pz) {
    if (this.startedAt === null) this.startedAt = performance.now()
    if (this._last) this.walked += Math.hypot(px - this._last[0], pz - this._last[1])
    this._last = [px, pz]

    if (!this.target) return null
    const t = this.target
    const near = Math.min(Math.hypot(t.x - px, t.z - pz), Math.hypot(t.gx - px, t.gz - pz))
    if (near > REACH) return null
    const q = this.target
    this.found.add(q)
    this.pick([px, pz])
    return q
  }

  elapsed() {
    if (this.startedAt === null) return 0
    return ((this.finishedAt ?? performance.now()) - this.startedAt) / 1000
  }
}

/** Nejbližší bod na nějaké ulici — tam se dá dojít. */
function nearestRoad(x, z, roads) {
  let best = null, bd = 60
  for (const r of roads) {
    if (r.hw === 'steps') continue
    for (let i = 0; i < r.poly.length - 1; i++) {
      const a = r.poly[i], b = r.poly[i + 1]
      const dx = b[0] - a[0], dz = b[1] - a[1]
      const L2 = dx * dx + dz * dz
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
      const px = a[0] + t * dx, pz = a[1] + t * dz
      const d = Math.hypot(x - px, z - pz)
      if (d < bd) { bd = d; best = [px, pz] }
    }
  }
  return best
}

function inPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
