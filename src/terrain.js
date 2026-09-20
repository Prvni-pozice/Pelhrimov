// terrain.js — výšková mapa a povrchy.
//
// Terén drží ČÚZK DMR 5G (holá země, 4m mřížka). Z něj uděláme voxelovou
// výškovou mapu s krokem 0,5 m a do ní zapíšeme povrchy: dlažbu náměstí,
// ulice, chodníky, trávu, vodu. Vodorovné rozlišení je 1 m — terén je povrch,
// ne stavba, a jemnější mřížka by jen ztrojnásobila geometrii bez užitku.

import { AREA_BLOCK, ROAD_BLOCK } from './palette.js'

export const CELL = 1.0      // metr na buňku terénu ve vodorovném směru
export const STEP = 0.25     // výškový krok
export const GRASS_STEP = 0.5   // schod na nezpevněném terénu
// Krok je poloviční proti voxelu domu (0,5 m) schválně. Pelhřimovské náměstí
// reálně klesá o několik metrů a při půlmetrovém kroku z něj bylo schodiště
// přes celou plochu. Čtvrtmetrový schod přečte oko jako plynulý sklon a dá se
// přes něj přejít bez skákání. Na domech by to naopak jen zdvojnásobilo
// geometrii, tam zůstává 0,5 m.

export class Terrain {
  constructor(data) {
    this.d = data
    const t = data.terrain
    this.g = t.g; this.half = t.half; this.base = t.base
    this.raw = t.data
    this.W = Math.round((2 * data.half) / CELL)   // buněk na stranu
    this.D = this.W
    this.ox = -data.half; this.oz = -data.half     // levý horní roh mapy v metrech

    this.H = new Int16Array(this.W * this.D)       // výška sloupce v krocích STEP
    this.M = new Uint8Array(this.W * this.D)       // blok povrchu
    this.Hf = new Float32Array(this.W * this.D)    // výška v metrech, bez zaokrouhlení
    this._sample()
    this._paint()
  }

  /** true = zpevněný povrch, který se kreslí jako spojitá rovina, ne schody */
  static paved(m) { return m === 4 || m === 5 || m === 8 }

  /**
   * Výška v ROHU buňky (i,j) v metrech — průměr okolních buněk, takže sousední
   * dílky dlažby sdílejí přesně stejnou hodnotu a mezi nimi nevznikne schod.
   */
  cornerY(i, j) {
    let s = 0, n = 0
    for (let dj = -1; dj <= 0; dj++) {
      for (let di = -1; di <= 0; di++) {
        const x = i + di, z = j + dj
        if (x < 0 || z < 0 || x >= this.W || z >= this.D) continue
        const k = z * this.W + x
        s += Terrain.paved(this.M[k]) ? this.Hf[k] : (this.H[k] + 1) * STEP
        n++
      }
    }
    return n ? s / n : 0
  }

  /** Terén v metrech nad mořem, bilineárně z DMR 5G. */
  elev(x, z) {
    const g = this.g, half = this.half
    const s = (2 * half) / (g - 1)
    let fx = (x + half) / s, fz = (z + half) / s
    fx = Math.max(0, Math.min(g - 1.001, fx)); fz = Math.max(0, Math.min(g - 1.001, fz))
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, d = this.raw
    const h00 = d[j * g + i], h10 = d[j * g + i + 1]
    const h01 = d[(j + 1) * g + i], h11 = d[(j + 1) * g + i + 1]
    return this.base + ((h00 * (1 - tx) + h10 * tx) * (1 - tz)
                      + (h01 * (1 - tx) + h11 * tx) * tz) / 10
  }

  /**
   * Výška povrchu ve světových metrech (y=0 je base terénu).
   * Na dlažbě vrací spojitou hodnotu, jinde vršek schodu — tak, jak to hráč
   * uvidí, aby chůze nešla půl metru nad zemí ani pod ní.
   */
  groundY(x, z) {
    const i = Math.round((x - this.ox) / CELL - 0.5)
    const j = Math.round((z - this.oz) / CELL - 0.5)
    if (i < 0 || j < 0 || i >= this.W || j >= this.D) return this.elev(x, z) - this.base
    const k = j * this.W + i
    if (!Terrain.paved(this.M[k])) return (this.H[k] + 1) * STEP
    // bilineárně mezi rohy, ať se po náměstí chodí plynule
    const fi = (x - this.ox) / CELL, fj = (z - this.oz) / CELL
    const tx = fi - Math.floor(fi), tz = fj - Math.floor(fj)
    const a = this.cornerY(i, j), b = this.cornerY(i + 1, j)
    const c = this.cornerY(i, j + 1), d = this.cornerY(i + 1, j + 1)
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
  }

  _sample() {
    for (let j = 0; j < this.D; j++) {
      for (let i = 0; i < this.W; i++) {
        const x = this.ox + (i + 0.5) * CELL, z = this.oz + (j + 0.5) * CELL
        const h = this.elev(x, z) - this.base
        this.Hf[j * this.W + i] = h
        // -1, aby (H+1)*STEP odpovídalo hornímu povrchu bloku
        this.H[j * this.W + i] = Math.round(h / STEP) - 1
        this.M[j * this.W + i] = 1   // výchozí povrch: tráva
      }
    }
  }

  _paint() {
    const d = this.d
    // pořadí je důležité: plochy → ulice → náměstí (náměstí přebíjí všechno)
    this.fixed = new Uint8Array(this.W * this.D)   // co přišlo z OSM, se nepřemalovává
    for (const a of d.areas) this._fillPoly(a.poly, AREA_BLOCK[a.kind], a.kind === 'water', true)
    for (const r of d.roads) this._stroke(r.poly, r.w, ROAD_BLOCK[r.m])
    for (const poly of d.square) this._fillPoly(poly, 4, false)
    this._pavements(3, 8, d.boundary)
    // pořadí: vyhladit dlažbu → srovnat náměstí do roviny → zhrubnout trávu
    this._smoothPaved()
    for (const poly of d.square) this._flattenToPlane(poly, 14)
    this._quantize()
  }

  _forEachCell(minX, minZ, maxX, maxZ, fn) {
    const i0 = Math.max(0, Math.floor((minX - this.ox) / CELL))
    const i1 = Math.min(this.W - 1, Math.ceil((maxX - this.ox) / CELL))
    const j0 = Math.max(0, Math.floor((minZ - this.oz) / CELL))
    const j1 = Math.min(this.D - 1, Math.ceil((maxZ - this.oz) / CELL))
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        fn(i, j, this.ox + (i + 0.5) * CELL, this.oz + (j + 0.5) * CELL)
      }
    }
  }

  _fillPoly(poly, block, sink, fixed) {
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9
    for (const p of poly) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1])
    }
    this._forEachCell(minX, minZ, maxX, maxZ, (i, j, x, z) => {
      if (!pointInPoly(x, z, poly)) return
      const k = j * this.W + i
      this.M[k] = block
      if (fixed) this.fixed[k] = 1
      if (sink) { this.H[k] -= 4; this.Hf[k] -= 4 * STEP }  // hladina níž, ať voda netvoří kopec
    })
  }

  _stroke(poly, w, block) {
    const r = w / 2
    for (let s = 0; s < poly.length - 1; s++) {
      const a = poly[s], b = poly[s + 1]
      this._forEachCell(Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r,
                        Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, (i, j, x, z) => {
        if (segDist(x, z, a, b) > r) return
        this.M[j * this.W + i] = block
      })
    }
  }

  /**
   * Zahladí zpevněné povrchy. DMR 5G je přesný do centimetrů, jenže na náměstí
   * tím vzniknou vrstevnice, které se po zaokrouhlení na voxely projeví jako
   * bludiště schůdků. Dost průchodů průměrem je srovná do jednoho čistého
   * sklonu — přesně tak, jak náměstí vypadá ve skutečnosti.
   */
  /**
   * Doplní chodníky do pásu kolem zpevněných ploch.
   *
   * OSM v historickém jádru chodníky skoro nemá zmapované, takže všechno mezi
   * vozovkou a domem zůstávalo výchozí trávou — kolem náměstí z toho byly
   * zelené dlaždice přesně tam, kde je ve skutečnosti dlažba. Plošné vydláždění
   * celého jádra to ale přehnalo na druhou stranu a vydláždilo i dvorky, takže
   * hradba u Solní brány stála uprostřed kamenné pláně.
   *
   * Tohle je mezi tím: dlažba se rozlije od vozovek a náměstí — `rOut` metrů
   * všude (běžný chodník podél ulice) a `rIn` metrů uvnitř jádra, kde domy
   * stojí přímo na dlažbě. Dál zůstane zeleň a plochy, které OSM výslovně
   * označuje (parky, zahrady, voda), se nepřemalovávají vůbec.
   */
  _pavements(rOut, rIn, boundary) {
    const inCore = this._polyMask(boundary)
    const paved = (m) => Terrain.paved(m) || m === 4 || m === 5
    for (let pass = 0; pass < rIn; pass++) {
      const core = pass >= rOut
      const add = []
      for (let j = 1; j < this.D - 1; j++) {
        for (let i = 1; i < this.W - 1; i++) {
          const k = j * this.W + i
          if (this.M[k] !== 1 || this.fixed[k]) continue
          if (core && !inCore[k]) continue
          if (paved(this.M[k - 1]) || paved(this.M[k + 1])
              || paved(this.M[k - this.W]) || paved(this.M[k + this.W])) add.push(k)
        }
      }
      for (const k of add) this.M[k] = 8
    }
  }

  /** Rastr mnohoúhelníku řádkovým vyplněním — levnější než test bod po bodu. */
  _polyMask(poly) {
    const mask = new Uint8Array(this.W * this.D)
    const xs = []
    for (let j = 0; j < this.D; j++) {
      const z = this.oz + (j + 0.5) * CELL
      xs.length = 0
      for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
        const z1 = poly[k][1], z2 = poly[i][1]
        if ((z1 > z) !== (z2 > z)) {
          xs.push(poly[k][0] + (z - z1) / (z2 - z1) * (poly[i][0] - poly[k][0]))
        }
      }
      xs.sort((a, b) => a - b)
      for (let p = 0; p + 1 < xs.length; p += 2) {
        const i0 = Math.max(0, Math.ceil((xs[p] - this.ox) / CELL - 0.5))
        const i1 = Math.min(this.W - 1, Math.floor((xs[p + 1] - this.ox) / CELL - 0.5))
        for (let i = i0; i <= i1; i++) mask[j * this.W + i] = 1
      }
    }
    return mask
  }

  /**
   * Proloží plochou rovinu a usadí na ni celé náměstí.
   *
   * Vyhlazení samo o sobě nechá mírně zvlněný povrch a po zaokrouhlení z něj
   * zbudou bloudivé vrstevnice. Náměstí je ve skutečnosti vyspádovaná plocha,
   * tak ji i uděláme: metodou nejmenších čtverců se najde skutečný spád (tady
   * klesá zhruba 2,5 m napříč) a dlažba na něm leží přesně. V pásu `margin`
   * kolem se rovina přelévá do okolního terénu, aby na okraji nevznikl sráz.
   */
  _flattenToPlane(poly, margin) {
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9
    for (const p of poly) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1])
    }
    // normální rovnice pro h = a*x + b*z + c
    let sxx = 0, sxz = 0, sxw = 0, szz = 0, szw = 0, sww = 0, sxh = 0, szh = 0, shw = 0
    this._forEachCell(minX, minZ, maxX, maxZ, (i, j, x, z) => {
      if (!pointInPoly(x, z, poly)) return
      const h = this.Hf[j * this.W + i]
      sxx += x * x; sxz += x * z; sxw += x
      szz += z * z; szw += z; sww += 1
      sxh += x * h; szh += z * h; shw += h
    })
    if (sww < 30) return
    const sol = solve3([[sxx, sxz, sxw], [sxz, szz, szw], [sxw, szw, sww]], [sxh, szh, shw])
    if (!sol) return
    const [a, b, c] = sol
    this._forEachCell(minX - margin, minZ - margin, maxX + margin, maxZ + margin, (i, j, x, z) => {
      const d = pointInPoly(x, z, poly) ? 0 : distToPoly(x, z, poly)
      if (d > margin) return
      const t = d <= 0 ? 1 : 1 - d / margin          // 1 uvnitř, 0 na kraji pásu
      const k = j * this.W + i
      const plane = a * x + b * z + c
      this.Hf[k] = this.Hf[k] + (plane - this.Hf[k]) * (t * t * (3 - 2 * t))
    })
  }

  /** Z výšek v metrech udělá mřížku: dlažba jemně, tráva po půl metru. */
  _quantize() {
    const q = Math.round(GRASS_STEP / STEP)
    for (let k = 0; k < this.H.length; k++) {
      if (Terrain.paved(this.M[k])) this.H[k] = Math.round(this.Hf[k] / STEP) - 1
      else this.H[k] = q * Math.round(this.Hf[k] / GRASS_STEP) - 1
    }
  }

  _smoothPaved() {
    for (let pass = 0; pass < 40; pass++) {
      const next = Float32Array.from(this.Hf)
      for (let j = 1; j < this.D - 1; j++) {
        for (let i = 1; i < this.W - 1; i++) {
          const k = j * this.W + i
          if (!Terrain.paved(this.M[k])) continue
          const s = this.Hf[k - 1] + this.Hf[k + 1] + this.Hf[k - this.W] + this.Hf[k + this.W]
          next[k] = (s + this.Hf[k]) / 5
        }
      }
      this.Hf = next
    }
  }

}

export function pointInPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Vzdálenost bodu od obvodu mnohoúhelníku. */
export function distToPoly(x, z, poly) {
  let m = 1e9
  for (let i = 0; i < poly.length; i++) {
    m = Math.min(m, segDist(x, z, poly[i], poly[(i + 1) % poly.length]))
  }
  return m
}

/** Gaussova eliminace 3×3 — pro proložení roviny. */
function solve3(A, b) {
  const M = [[...A[0], b[0]], [...A[1], b[1]], [...A[2], b[2]]]
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    if (Math.abs(M[piv][c]) < 1e-9) return null
    const t = M[c]; M[c] = M[piv]; M[piv] = t
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k]
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]]
}

export function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const L2 = dx * dx + dz * dz
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
}
