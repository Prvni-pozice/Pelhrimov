// collide.js — do čeho hráč nesmí projít.
//
// Svět je pevný, takže kolizní tělesa stačí postavit jednou při načtení.
// Držíme je v rovnoměrné mřížce po 8 m; při kroku se testuje jen devět buněk
// kolem hráče, ne všech 414 domů.
//
// Tělesa jsou dvojího druhu: mnohoúhelník (půdorys domu) a tlustá úsečka
// (hradba, zátaras, plot). Obojí umí vytlačit kružnici hráče ven.

const GRID = 8

export class Collider {
  constructor(half) {
    this.half = half
    this.n = Math.ceil((2 * half) / GRID)
    this.cells = new Map()
    this.shapes = []
  }

  _put(idx, minX, minZ, maxX, maxZ) {
    const i0 = this._c(minX), i1 = this._c(maxX)
    const j0 = this._c(minZ), j1 = this._c(maxZ)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.n + i
        let a = this.cells.get(k)
        if (!a) { a = []; this.cells.set(k, a) }
        a.push(idx)
      }
    }
  }
  _c(v) { return Math.max(0, Math.min(this.n - 1, Math.floor((v + this.half) / GRID))) }

  /** Půdorys domu. `top` je výška atiky — nad ni se dá vylézt (zatím nevyužito). */
  addPolygon(poly, top) {
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9
    for (const p of poly) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1])
    }
    this.shapes.push({ t: 'poly', poly, top, minX, minZ, maxX, maxZ })
    this._put(this.shapes.length - 1, minX - 1, minZ - 1, maxX + 1, maxZ + 1)
  }

  /** Tlustá úsečka — hradba, zátaras, zábradlí. */
  addSegment(a, b, r) {
    this.shapes.push({ t: 'seg', a, b, r })
    this._put(this.shapes.length - 1,
      Math.min(a[0], b[0]) - r - 1, Math.min(a[1], b[1]) - r - 1,
      Math.max(a[0], b[0]) + r + 1, Math.max(a[1], b[1]) + r + 1)
  }

  addCircle(x, z, r) {
    this.shapes.push({ t: 'circ', x, z, r })
    this._put(this.shapes.length - 1, x - r - 1, z - r - 1, x + r + 1, z + r + 1)
  }

  /**
   * Vytlačí kružnici (x,z,radius) ven ze všeho, co ji protíná.
   * Vrací [x, z]. Tři průchody, aby se hráč zaklíněný v rohu dvou domů
   * dostal ven a nezůstal drkotat mezi nimi.
   */
  resolve(x, z, radius) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false
      const i0 = this._c(x - radius), i1 = this._c(x + radius)
      const j0 = this._c(z - radius), j1 = this._c(z + radius)
      const seen = new Set()
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const a = this.cells.get(j * this.n + i)
          if (!a) continue
          for (const idx of a) {
            if (seen.has(idx)) continue
            seen.add(idx)
            const s = this.shapes[idx]
            const r = s.t === 'poly' ? pushPoly(x, z, radius, s)
                    : s.t === 'seg' ? pushSeg(x, z, radius, s)
                    : pushCirc(x, z, radius, s)
            if (r) { x = r[0]; z = r[1]; moved = true }
          }
        }
      }
      if (!moved) break
    }
    return [x, z]
  }
}

function pushCirc(x, z, radius, s) {
  const dx = x - s.x, dz = z - s.z
  const d = Math.hypot(dx, dz), need = radius + s.r
  if (d >= need) return null
  if (d < 1e-6) return [x + need, z]
  return [s.x + dx / d * need, s.z + dz / d * need]
}

function pushSeg(x, z, radius, s) {
  const [ax, az] = s.a, [bx, bz] = s.b
  const dx = bx - ax, dz = bz - az
  const L2 = dx * dx + dz * dz
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
  return pushCirc(x, z, radius, { x: ax + t * dx, z: az + t * dz, r: s.r })
}

function pushPoly(x, z, radius, s) {
  if (x < s.minX - radius || x > s.maxX + radius || z < s.minZ - radius || z > s.maxZ + radius) return null
  const poly = s.poly
  // nejbližší bod na obvodu + zda jsme uvnitř
  let bd = 1e9, bx = 0, bz = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], az = poly[j][1], cx = poly[i][0], cz = poly[i][1]
    const dx = cx - ax, dz = cz - az
    const L2 = dx * dx + dz * dz
    const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2))
    const px = ax + t * dx, pz = az + t * dz
    const d = Math.hypot(x - px, z - pz)
    if (d < bd) { bd = d; bx = px; bz = pz }
  }
  const inside = pointIn(x, z, poly)
  if (!inside && bd >= radius) return null
  if (bd < 1e-6) return [bx + radius, bz]
  if (inside) {
    // ven po nejkratší cestě přes nejbližší hranu
    return [bx + (bx - x) / bd * radius, bz + (bz - z) / bd * radius]
  }
  return [bx + (x - bx) / bd * radius, bz + (z - bz) / bd * radius]
}

export function pointIn(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
