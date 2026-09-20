// voxel.js — převod voxelů na trojúhelníky.
//
// Dvě různé úlohy, dva různé meshery:
//
//   greedyMesh()      plná 3D mřížka — domy, hradby, mobiliář. Slučuje sousední
//                     stejné plošky do co největších obdélníků, jinak by 414 domů
//                     po 0,5 m dalo přes milion čtverců.
//   heightfieldMesh() terén jako výšková mapa — nemá smysl ho držet jako 3D pole,
//                     je to povrch. Vrchní plošky se slučují 2D greedy algoritmem,
//                     svislé stěny se dogenerují jen tam, kde sousedi mají jinou výšku.
//
// Oba vrací spékané stínění v rozích (AO). Bez něj vypadají plastové plochy jako
// placka — AO je to jediné, co tomu dává objem, protože nemáme textury.

// AO podle tří sousedů u rohu plošky (klasika z Minecraft klonů): 3 = plné světlo.
function vertexAO(side1, side2, corner) {
  if (side1 && side2) return 0
  return 3 - (side1 + side2 + corner)
}
const AO_LEVEL = [0.58, 0.72, 0.86, 1.0]

/**
 * Greedy meshing plné 3D mřížky.
 *
 * @param {(x,y,z)=>number} get      id bloku, 0 = vzduch (mimo mřížku vracet 0)
 * @param {[number,number,number]} dims  rozměry mřížky v blocích
 * @param {object} o
 *   o.scale     hrana bloku v metrech
 *   o.origin    [x,y,z] posun mřížky do světa (v metrech)
 *   o.colorOf   id → [r,g,b] v 0..1
 *   o.solid     id → bool (pro AO a zakrývání; sklo nezakrývá)
 *   o.noise     amplituda odstínu na plošku (0 = vypnuto)
 * @returns {{positions:number[], normals:number[], colors:number[], indices:number[]}}
 */
export function greedyMesh(get, dims, o) {
  const scale = o.scale, [ox, oy, oz] = o.origin
  const colorOf = o.colorOf, solid = o.solid, noise = o.noise || 0
  const positions = [], normals = [], colors = [], indices = []

  const x = [0, 0, 0], q = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0]
  // mask drží pro každou buňku řezu: id bloku (>0 = ploška ven, <0 = dovnitř) a 4× AO
  const maskId = new Int32Array(Math.max(dims[0], dims[1], dims[2]) ** 2)
  const maskAO = new Uint8Array(maskId.length * 4)

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3
    const DU = dims[u], DV = dims[v]
    q[0] = q[1] = q[2] = 0; q[d] = 1

    for (x[d] = -1; x[d] < dims[d];) {
      // ── 1. sestav masku řezu ──────────────────────────────────────
      let n = 0
      for (x[v] = 0; x[v] < DV; x[v]++) {
        for (x[u] = 0; x[u] < DU; x[u]++, n++) {
          const a = x[d] >= 0 ? get(x[0], x[1], x[2]) : 0
          const b = x[d] < dims[d] - 1 ? get(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : 0
          const sa = a !== 0 && solid(a), sb = b !== 0 && solid(b)
          // ploška vzniká tam, kde jeden je vidět skrz druhého
          let id = 0
          if (a !== 0 && !sb) id = a          // ploška míří +d
          else if (b !== 0 && !sa) id = -b    // ploška míří -d
          // sklo vedle skla plošku nedělá (jinak svítí vnitřní stěny okna)
          if (a !== 0 && b !== 0 && !solid(a) && !solid(b)) id = 0
          maskId[n] = id
          if (id === 0) continue

          // ── AO čtyř rohů ──
          // Ploška leží mezi voxely; sousedy hledáme ve vrstvě, kam ploška kouká.
          const side = id > 0 ? 1 : 0   // 1 = díváme se z voxelu a, 0 = z voxelu b
          const px = x[0] + (side ? q[0] : 0), py = x[1] + (side ? q[1] : 0), pz = x[2] + (side ? q[2] : 0)
          const p = [px, py, pz]
          const at = (i, j) => {
            const c = [p[0], p[1], p[2]]
            c[u] += i; c[v] += j
            const g = get(c[0], c[1], c[2])
            return g !== 0 && solid(g) ? 1 : 0
          }
          const nU = at(-1, 0), pU = at(1, 0), nV = at(0, -1), pV = at(0, 1)
          const nn = at(-1, -1), np = at(-1, 1), pn = at(1, -1), pp = at(1, 1)
          maskAO[n * 4 + 0] = vertexAO(nU, nV, nn)
          maskAO[n * 4 + 1] = vertexAO(pU, nV, pn)
          maskAO[n * 4 + 2] = vertexAO(pU, pV, pp)
          maskAO[n * 4 + 3] = vertexAO(nU, pV, np)
        }
      }
      x[d]++

      // ── 2. slučuj obdélníky ───────────────────────────────────────
      n = 0
      for (let j = 0; j < DV; j++) {
        for (let i = 0; i < DU;) {
          const id = maskId[n]
          if (id === 0) { i++; n++; continue }
          const a0 = maskAO[n * 4], a1 = maskAO[n * 4 + 1], a2 = maskAO[n * 4 + 2], a3 = maskAO[n * 4 + 3]
          const same = (m) => maskId[m] === id && maskAO[m * 4] === a0 && maskAO[m * 4 + 1] === a1
            && maskAO[m * 4 + 2] === a2 && maskAO[m * 4 + 3] === a3

          let w = 1
          while (i + w < DU && same(n + w)) w++
          let h = 1
          outer: while (j + h < DV) {
            for (let k = 0; k < w; k++) if (!same(n + k + h * DU)) break outer
            h++
          }

          // ── 3. vysyp obdélník ──
          x[u] = i; x[v] = j
          du[0] = du[1] = du[2] = 0; dv[0] = dv[1] = dv[2] = 0
          du[u] = w; dv[v] = h
          emitQuad(positions, normals, colors, indices, x, du, dv, d, id, [a0, a1, a2, a3],
                   scale, ox, oy, oz, colorOf, noise)

          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) maskId[n + k + l * DU] = 0
          i += w; n += w
        }
      }
    }
  }
  return { positions, normals, colors, indices }
}

function hash3(a, b, c) {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791)
  h = (h ^ (h >>> 13)) >>> 0
  return (h % 1024) / 1024
}

function emitQuad(P, N, C, I, x, du, dv, d, id, ao, s, ox, oy, oz, colorOf, noise) {
  const front = id > 0
  const bid = front ? id : -id
  const nx = d === 0 ? (front ? 1 : -1) : 0
  const ny = d === 1 ? (front ? 1 : -1) : 0
  const nz = d === 2 ? (front ? 1 : -1) : 0

  const v0 = [x[0], x[1], x[2]]
  const v1 = [x[0] + du[0], x[1] + du[1], x[2] + du[2]]
  const v2 = [x[0] + du[0] + dv[0], x[1] + du[1] + dv[1], x[2] + du[2] + dv[2]]
  const v3 = [x[0] + dv[0], x[1] + dv[1], x[2] + dv[2]]
  const quad = front ? [v0, v1, v2, v3] : [v0, v3, v2, v1]
  const aoq = front ? [ao[0], ao[1], ao[2], ao[3]] : [ao[0], ao[3], ao[2], ao[1]]

  const base = P.length / 3
  const col = colorOf(bid)
  // odstín na plošku — velké slité plochy by jinak byly úplně mrtvé
  const t = noise ? 1 + (hash3(x[0], x[1], x[2]) - 0.5) * 2 * noise : 1
  // svislé stěny ztmavíme, vodorovné necháme světlé → čitelný objem i bez slunce
  const face = ny > 0 ? 1.0 : ny < 0 ? 0.62 : (nx !== 0 ? 0.84 : 0.74)

  for (let k = 0; k < 4; k++) {
    const p = quad[k]
    P.push(ox + p[0] * s, oy + p[1] * s, oz + p[2] * s)
    N.push(nx, ny, nz)
    const l = AO_LEVEL[aoq[k]] * face * t
    C.push(col[0] * l, col[1] * l, col[2] * l)
  }
  // trojúhelníky orientujeme podle AO, jinak se na rozích láme stín "do V"
  if (aoq[0] + aoq[2] > aoq[1] + aoq[3]) {
    I.push(base, base + 1, base + 2, base, base + 2, base + 3)
  } else {
    I.push(base + 1, base + 2, base + 3, base + 1, base + 3, base)
  }
}

/**
 * Mesh terénu z výškové mapy.
 *
 * Dva režimy v jednom povrchu:
 *   * tráva a pole — schodovité voxely, slévané 2D greedy algoritmem
 *   * dlažba a asfalt — SPOJITÁ nakloněná plocha, po jednom čtverci na buňku
 *
 * Náměstí klesá o 2,5 m; ve schodech z něj bylo terasovité hlediště. Dlažba
 * proto bere výšku v rozích buňky (ty sdílí se sousedy), takže na sebe dílky
 * navazují bez spár a hráč po nich jde plynule. Slévat je nejde — dva slité
 * obdélníky různé velikosti by se na styku rozešly a vznikla by škvíra.
 *
 * @param {Int16Array} H  výška sloupce v krocích (délka W*D, index z*W+x)
 * @param {Uint8Array} M  id bloku povrchu (stejné indexování)
 * @param {object} o  { W, D, cell, step, origin:[x,y,z], colorOf, noise, rect, ter }
 *   ter   Terrain — kvůli cornerY() a Terrain.paved(); bez něj je vše schodovité
 *   rect  nepovinný výřez {x0,z0,x1,z1} — mešuje se jen on, ale sousedy se čtou
 *         z celé mřížky, takže na hranici dílu nevznikne falešná stěna.
 */
export function heightfieldMesh(H, M, o) {
  const { W, D, cell, step } = o
  const R = o.rect || { x0: 0, z0: 0, x1: W, z1: D }
  const [ox, oy, oz] = o.origin
  const colorOf = o.colorOf, noise = o.noise || 0, ter = o.ter || null
  const positions = [], normals = [], colors = [], indices = []
  const at = (x, z) => (x < 0 || z < 0 || x >= W || z >= D) ? -32768 : H[z * W + x]
  const paved = ter ? (x, z) => (x >= 0 && z >= 0 && x < W && z < D) && ter.constructor.paved(M[z * W + x])
                    : () => false
  const cy = ter ? (i, j) => oy + ter.cornerY(i, j) : () => 0
  const flat = (x, z) => oy + (H[z * W + x] + 1) * step

  const push = (P4, Y4, nrm, col, shade) => {
    const base = positions.length / 3
    for (let k = 0; k < 4; k++) {
      positions.push(P4[k][0], Y4[k], P4[k][1])
      normals.push(nrm[0], nrm[1], nrm[2])
      const l = shade[k]
      colors.push(col[0] * l, col[1] * l, col[2] * l)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  // ── A. dlažba: spojitá plocha, jeden čtverec na buňku ─────────────
  for (let z = R.z0; z < R.z1; z++) {
    for (let x = R.x0; x < R.x1; x++) {
      if (!paved(x, z)) continue
      const m = M[z * W + x]
      const x0 = ox + x * cell, z0 = oz + z * cell, x1 = x0 + cell, z1 = z0 + cell
      const c = colorOf(m)
      const t = noise ? 1 + (hash3(x, H[z * W + x], z) - 0.5) * 2 * noise : 1
      push([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(p => [p[0], p[1]]).reverse(),
           [cy(x, z + 1), cy(x + 1, z + 1), cy(x + 1, z), cy(x, z)],
           [0, 1, 0], c, [t, t, t, t])
    }
  }

  // ── B. tráva a ostatní: schody, slévané do obdélníků ──────────────
  const used = new Uint8Array(W * D)
  for (let z = R.z0; z < R.z1; z++) {
    for (let x = R.x0; x < R.x1;) {
      const idx = z * W + x
      if (used[idx] || paved(x, z)) { x++; continue }
      const h = H[idx], m = M[idx]
      let w = 1
      while (x + w < R.x1 && !used[idx + w] && !paved(x + w, z)
             && H[idx + w] === h && M[idx + w] === m) w++
      let d = 1
      outer: while (z + d < R.z1) {
        for (let k = 0; k < w; k++) {
          const j = idx + k + d * W
          if (used[j] || paved(x + k, z + d) || H[j] !== h || M[j] !== m) break outer
        }
        d++
      }
      for (let l = 0; l < d; l++) for (let k = 0; k < w; k++) used[idx + k + l * W] = 1

      const y = oy + (h + 1) * step
      const x0 = ox + x * cell, z0 = oz + z * cell
      const x1 = x0 + w * cell, z1 = z0 + d * cell
      const c = colorOf(m)
      const t = noise ? 1 + (hash3(x, h, z) - 0.5) * 2 * noise : 1
      // roh ztmavíme, pokud je vedle vyšší soused
      const cor = (cx, cz) => {
        let k = 0
        if (at(cx, z) > h) k++
        if (at(x, cz) > h) k++
        if (at(cx, cz) > h) k++
        return AO_LEVEL[Math.max(0, 3 - k)] * t
      }
      push([[x0, z1], [x1, z1], [x1, z0], [x0, z0]], [y, y, y, y], [0, 1, 0], c,
           [cor(x - 1, z + d), cor(x + w, z + d), cor(x + w, z - 1), cor(x - 1, z - 1)])
      x += w
    }
  }

  // ── C. svislé stěny mezi sloupci různé výšky ──────────────────────
  // Mezi dvěma dlážděnými buňkami žádná není — ty na sebe navazují v rozích.
  // Mezi dvěma schodovitými platí "stěnu kreslí vyšší" a dají se slévat.
  // Na rozhraní dlažba/tráva se výšky nepotkají (jedna je spojitá, druhá
  // zaokrouhlená), takže se tam VŽDY spustí lem dolů pod sousedovu úroveň —
  // bez něj tam prosvítá obloha.
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [dx, dz] of SIDES) {
    const alongZ = dx !== 0
    const A0 = alongZ ? R.x0 : R.z0, A1 = alongZ ? R.x1 : R.z1
    const B0 = alongZ ? R.z0 : R.x0, B1 = alongZ ? R.z1 : R.x1
    for (let a = A0; a < A1; a++) {
      for (let b = B0; b < B1;) {
        const x = alongZ ? a : b, z = alongZ ? b : a
        const nx2 = x + dx, nz2 = z + dz
        const inGrid = nx2 >= 0 && nz2 >= 0 && nx2 < W && nz2 < D
        const pa = paved(x, z), pb = paved(nx2, nz2)
        if (pa && pb) { b++; continue }
        const m = M[z * W + x]
        const h = H[z * W + x]

        // hrana mezi buňkami, její dva konce v rozích mřížky
        const ei = x + (dx > 0 ? 1 : 0), ej = z + (dz > 0 ? 1 : 0)
        const e2i = alongZ ? ei : ei + 1, e2j = alongZ ? ej + 1 : ej
        const yT1 = pa ? cy(ei, ej) : flat(x, z)
        const yT2 = pa ? cy(e2i, e2j) : flat(x, z)
        const yB1 = !inGrid ? oy - 4 : (pb ? cy(ei, ej) : flat(nx2, nz2))
        const yB2 = !inGrid ? oy - 4 : (pb ? cy(e2i, e2j) : flat(nx2, nz2))

        let run = 1, lo1 = yB1, lo2 = yB2
        if (pa !== pb || !inGrid) {
          // lem přes rozhraní: kreslí ho vyšší strana a jde o kus níž,
          // aby zakryl i zaokrouhlovací rozdíl
          if (Math.max(yT1, yT2) <= Math.max(yB1, yB2) + 1e-4) { b++; continue }
          lo1 = Math.min(yB1, yB2) - 0.45; lo2 = lo1
        } else {
          const hn = inGrid ? H[nz2 * W + nx2] : -32768
          if (hn >= h) { b++; continue }
          while (b + run < B1) {
            const rx = alongZ ? a : b + run, rz = alongZ ? b + run : a
            if (paved(rx, rz) || paved(rx + dx, rz + dz)) break
            if (H[rz * W + rx] !== h || at(rx + dx, rz + dz) !== hn || M[rz * W + rx] !== m) break
            run++
          }
        }

        const ex = ox + ei * cell, ez = oz + ej * cell
        const ax = alongZ ? ex : ex + run * cell
        const az = alongZ ? ez + run * cell : ez
        const drop = Math.max(yT1, yT2) - Math.min(lo1, lo2)
        const c = colorOf(drop > 1.5 ? 3 : (m === 1 ? 2 : m))
        const shade = alongZ ? 0.84 : 0.74
        const t = noise ? 1 + (hash3(x, h, z) - 0.5) * 2 * noise : 1
        const pts = [[ex, ez], [ax, az], [ax, az], [ex, ez]]
        const ys = [lo1, lo2, yT2, yT1]
        const sh = [shade * t * 0.72, shade * t * 0.72, shade * t, shade * t]
        const ord = (dz - dx) > 0 ? [0, 1, 2, 3] : [3, 2, 1, 0]
        push(ord.map(k => pts[k]), ord.map(k => ys[k]), [dx, 0, dz], c, ord.map(k => sh[k]))
        b += run
      }
    }
  }
  return { positions, normals, colors, indices }
}
