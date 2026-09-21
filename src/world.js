// world.js — složí celé město do scény.
//
// Všechno se meshuje jednou při načtení a slije do dílů po 80 m. Jeden díl =
// jeden draw call a vlastní obalové těleso, takže se dá ořezávat pohledem.
// Svět se za hry nemění, takže není důvod držet voxely v paměti — po postavení
// zůstanou jen trojúhelníky.

import * as THREE from 'three'
import { Terrain, CELL, STEP, segDist } from './terrain.js'
import { Collider, pointIn } from './collide.js'
import { buildHouse, VOX } from './buildings.js'
import { blockColor, isSolid } from './palette.js'
import { greedyMesh, heightfieldMesh } from './voxel.js'

const CHUNK = 80  // metrů na díl

function hexRGB(h) { return [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255] }

/** Sběrač geometrie po dílech — přidává trojúhelníky a nakonec je slije. */
class ChunkSet {
  constructor(half) {
    this.half = half
    this.n = Math.ceil((2 * half) / CHUNK)
    this.buf = new Map()
  }
  key(x, z) {
    const i = Math.min(this.n - 1, Math.max(0, Math.floor((x + this.half) / CHUNK)))
    const j = Math.min(this.n - 1, Math.max(0, Math.floor((z + this.half) / CHUNK)))
    return j * this.n + i
  }
  add(mesh, x, z) {
    if (!mesh || !mesh.indices.length) return
    const k = this.key(x, z)
    let b = this.buf.get(k)
    if (!b) { b = { P: [], N: [], C: [], I: [] }; this.buf.set(k, b) }
    const off = b.P.length / 3
    for (let i = 0; i < mesh.positions.length; i++) b.P.push(mesh.positions[i])
    for (let i = 0; i < mesh.normals.length; i++) b.N.push(mesh.normals[i])
    for (let i = 0; i < mesh.colors.length; i++) b.C.push(mesh.colors[i])
    for (let i = 0; i < mesh.indices.length; i++) b.I.push(mesh.indices[i] + off)
  }
  build(material) {
    const group = new THREE.Group()
    let tris = 0
    for (const b of this.buf.values()) {
      const gm = new THREE.BufferGeometry()
      gm.setAttribute('position', new THREE.Float32BufferAttribute(b.P, 3))
      gm.setAttribute('normal', new THREE.Float32BufferAttribute(b.N, 3))
      gm.setAttribute('color', new THREE.Float32BufferAttribute(b.C, 3))
      gm.setIndex(b.I)
      gm.computeBoundingSphere()
      const m = new THREE.Mesh(gm, material)
      m.castShadow = true; m.receiveShadow = true
      group.add(m)
      tris += b.I.length / 3
    }
    group.userData.tris = tris
    return group
  }
}

export async function buildWorld(data, onProgress = () => {}) {
  const ter = new Terrain(data)
  const half = data.half
  const group = new THREE.Group()
  const stats = { tris: 0, houses: 0 }

  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  const colorOf = (id) => hexRGB(blockColor(id))

  // ── terén ──
  onProgress('terén')
  const tset = new ChunkSet(half)
  const cellsPerChunk = Math.round(CHUNK / CELL)
  for (let cz = 0; cz < ter.D; cz += cellsPerChunk) {
    for (let cx = 0; cx < ter.W; cx += cellsPerChunk) {
      const mesh = heightfieldChunk(ter, cx, cz, cellsPerChunk, colorOf)
      tset.add(mesh, ter.ox + (cx + 0.5) * CELL, ter.oz + (cz + 0.5) * CELL)
    }
  }
  const terrainGroup = tset.build(material)
  terrainGroup.name = 'teren'
  group.add(terrainGroup)
  stats.tris += terrainGroup.userData.tris

  // ── domy ──
  onProgress('domy')
  const hset = new ChunkSet(half)
  const fronts = frontPoints(data)
  const boxes = []
  const spots = []        // úkryty v podloubí a v branách
  for (const b of data.buildings) {
    // Okna dostane každý dům. Kulisa bez nich byla dlouhá šedá zeď a na
    // konci ulice to vypadalo jako nedostavěné sídliště; portál a dveře
    // ale stačí jen tam, kam hráč dojde.
    const through = b.special === 'gate' ? roadDir(b, data.roads) : null
    const arcLine = b.arcade ? nearestArcade(b, data.arcades) : null
    const mesh = buildHouse(b, ter, fronts.get(b.id) || null, true, through, arcLine)
    if (!mesh) continue
    let cx = 0, cz = 0
    for (const p of b.poly) { cx += p[0]; cz += p[1] }
    hset.add(mesh, cx / b.poly.length, cz / b.poly.length)
    boxes.push({ poly: mesh.collide || b.poly, shape: b.poly, top: mesh.eaveY,
                 rects: mesh.collideRects,
                 name: b.name, id: b.id, sq: b.sq, special: b.special, through })
    for (const sp of mesh.spots || []) {
      sp.y = ter.groundY(sp.x, sp.z)
      spots.push(sp)
    }
    stats.houses++
  }
  const houseGroup = hset.build(material)
  houseGroup.name = 'domy'
  group.add(houseGroup)
  stats.tris += houseGroup.userData.tris

  // ── hradby ──
  onProgress('hradby')
  const wset = new ChunkSet(half)
  for (const w of data.walls) {
    const mesh = buildWall(w, ter, colorOf)
    if (!mesh) continue
    wset.add(mesh, w.poly[0][0], w.poly[0][1])
  }
  const wallGroup = wset.build(material)
  wallGroup.name = 'hradby'
  group.add(wallGroup)
  stats.tris += wallGroup.userData.tris

  // ── zátarasy na okraji mapy ──
  // Historické jádro má dnes tři brány a jinak souvislou frontu domů. Kde
  // dnešní ulice vede z hratelné oblasti ven, postavíme kamennou zeď se
  // zavřenými vraty — hráč vidí, že se město nekončí, jen tudy neprojde.
  onProgress('zátarasy')
  const bset = new ChunkSet(half)
  for (const c of data.barriers) {
    const mesh = buildBarrier(c, ter, colorOf)
    if (mesh) bset.add(mesh, c.x, c.z)
  }
  const barGroup = bset.build(material)
  barGroup.name = 'zatarasy'
  group.add(barGroup)
  stats.tris += barGroup.userData.tris

  // ── zeleň a mobiliář ──
  onProgress('zeleň')
  const pset = new ChunkSet(half)
  for (const p of data.pois) {
    const mesh = buildProp(p, ter, colorOf)
    if (mesh) pset.add(mesh, p.x, p.z)
  }
  const propGroup = pset.build(material)
  propGroup.name = 'mobiliar'
  group.add(propGroup)
  stats.tris += propGroup.userData.tris

  // ── kolize ──
  const col = new Collider(half)
  // Solní brána je v OSM jen `building:part` uvnitř většího domu. Průjezd se
  // probourá v ní, jenže obalový dům zůstával v kolizích celý a bránu zazdil —
  // hráč viděl otevřený průjezd, kterým nešlo projít. Stejný průjezd se proto
  // vyřízne i ze všech domů, které bránu překrývají.
  const gates = boxes.filter(b => b.special === 'gate' && b.through)
    .map(g => ({ ...g, c: centroid(g.shape || g.poly) }))
  for (const b of boxes) {
    const g = gates.find(g => b.special === 'gate' && b.through
      ? g.id === b.id
      : pointIn(g.c[0], g.c[1], b.poly))
    if (g) addGateColliders(col, b, g.c[0], g.c[1], g.through)
    else if (b.rects) for (const r of b.rects) col.addPolygon(r, b.top)
    else col.addPolygon(b.poly, b.top)
  }
  for (const w of data.walls) {
    for (let i = 0; i < w.poly.length - 1; i++) col.addSegment(w.poly[i], w.poly[i + 1], 0.9)
  }
  for (const c of data.barriers) {
    const W = c.w / 2 + 3
    const ca = Math.cos(c.a + Math.PI / 2), sa = Math.sin(c.a + Math.PI / 2)
    col.addSegment([c.x - ca * W, c.z - sa * W], [c.x + ca * W, c.z + sa * W], 0.8)
  }
  for (const p of data.pois) {
    if (p.k === 'fountain') col.addCircle(p.x, p.z, 3.0)
    else if (p.k === 'monument') col.addCircle(p.x, p.z, 1.4)
    else if (p.k === 'tree') col.addCircle(p.x, p.z, 0.45)
  }
  // Hranici počítá scripts/build_world.py a je v datech — tady se jen obtáhne
  // kolizními úsečkami, aby se za ni nedalo projít ani mezerou mezi domy.
  const bound = data.boundary
  for (let i = 0; i < bound.length; i++) {
    col.addSegment(bound[i], bound[(i + 1) % bound.length], 0.5)
  }

  return { group, terrain: ter, boxes, spots, collider: col, boundary: bound, stats }
}

/** Úsek osy podloubí nejblíž k domu — podle něj se krojí souvislý koridor. */
function nearestArcade(b, arcades) {
  let cx = 0, cz = 0
  for (const p of b.poly) { cx += p[0]; cz += p[1] }
  cx /= b.poly.length; cz /= b.poly.length
  let best = null, bd = 1e9
  for (const line of arcades || []) {
    for (let i = 0; i < line.length - 1; i++) {
      const d = segDist(cx, cz, line[i], line[i + 1])
      if (d < bd) { bd = d; best = [line[i], line[i + 1]] }
    }
  }
  return best
}

/** Směr ulice, která prochází branou — podle nejbližšího silničního úseku. */
function roadDir(b, roads) {
  let cx = 0, cz = 0
  for (const p of b.poly) { cx += p[0]; cz += p[1] }
  cx /= b.poly.length; cz /= b.poly.length
  let best = null, bd = 1e9
  for (const r of roads) {
    if (r.hw === 'steps' || r.hw === 'footway') continue
    for (let i = 0; i < r.poly.length - 1; i++) {
      const d = segDist(cx, cz, r.poly[i], r.poly[i + 1])
      if (d < bd) { bd = d; best = [r.poly[i], r.poly[i + 1]] }
    }
  }
  if (!best || bd > 25) return null
  const dx = best[1][0] - best[0][0], dz = best[1][1] - best[0][1]
  const L = Math.hypot(dx, dz) || 1
  return [dx / L, dz / L]
}

/**
 * Kolize brány: místo celého půdorysu dvě křídla po stranách průjezdu.
 *
 * Půdorys se rozřízne rovinou průjezdu na dva kusy a do kolizí jdou jen ty.
 * Kdyby se přidal celý, brána by ulici zazdila a jádro by se uzavřelo —
 * všechny tři brány stojí na jediných vstupech do města.
 */
function addGateColliders(col, b, cx, cz, through) {
  const [tx, tz] = through
  const px = -tz, pz = tx                   // kolmice na ulici
  const PW = 2.3                            // poloviční šířka průjezdu + vůle
  let maxP = 0
  for (const p of b.poly) maxP = Math.max(maxP, Math.abs((p[0] - cx) * px + (p[1] - cz) * pz))
  if (maxP <= PW + 0.4) return              // celý dům je průjezd, nic neblokuje
  for (const side of [-1, 1]) {
    const piece = clipHalf(b.poly, cx, cz, px * side, pz * side, PW)
    if (piece.length >= 3) col.addPolygon(piece, b.top)
  }
}

/** Ořízne mnohoúhelník polorovinou (p−c)·n ≥ d. */
function clipHalf(poly, cx, cz, nx, nz, d) {
  const f = (p) => (p[0] - cx) * nx + (p[1] - cz) * nz - d
  const out = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length]
    const fa = f(a), fc = f(c)
    if (fa >= 0) out.push(a)
    if ((fa >= 0) !== (fc >= 0)) {
      const t = fa / (fa - fc)
      out.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t])
    }
  }
  return out
}

function centroid(poly) {
  let x = 0, z = 0
  for (const p of poly) { x += p[0]; z += p[1] }
  return [x / poly.length, z / poly.length]
}

/** Kamenná zeď se zavřenými vraty napříč ulicí. */
function buildBarrier(c, ter, colorOf) {
  const VOXB = 0.5
  const HALFW = c.w / 2 + 3          // přesah přes chodníky
  const H = 2.8
  const nu = Math.ceil((HALFW * 2) / VOXB) + 2
  const nv = 4                        // tloušťka 2 m
  const ny = Math.ceil((H + 1.5) / VOXB)
  const ca = Math.cos(c.a + Math.PI / 2), sa = Math.sin(c.a + Math.PI / 2)
  const toWorld = (u, v) => [c.x + u * ca - v * sa, c.z + u * sa + v * ca]
  const ou = -nu * VOXB / 2, ov = -nv * VOXB / 2

  let gMin = 1e9
  for (let i = 0; i < nu; i++) gMin = Math.min(gMin, ter.groundY(...toWorld(ou + (i + 0.5) * VOXB, 0)))
  const y0 = gMin - 1

  const g = new Uint8Array(nu * ny * nv)
  const at = (x, y, z) => x + nu * (z + nv * y)
  const gateHalf = Math.round(1.3 / VOXB)
  const mid = nu >> 1
  for (let i = 0; i < nu; i++) {
    const [wx, wz] = toWorld(ou + (i + 0.5) * VOXB, 0)
    const gy = ter.groundY(wx, wz)
    const bottom = Math.max(0, Math.round((gy - y0) / VOXB) - 2)
    const gate = Math.abs(i - mid) <= gateHalf
    const top = Math.round((gy + (gate ? H - 0.4 : H) - y0) / VOXB)
    for (let j = 0; j < nv; j++) {
      for (let y = bottom; y < top && y < ny; y++) {
        g[at(i, y, j)] = gate ? 19 : 12          // vrata dřevěná, zeď kamenná
      }
      // stříška / krakorce nad zdí
      if (!gate && top < ny) g[at(i, top, j)] = 20
    }
  }
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nu || y >= ny || z >= nv) ? 0 : g[at(x, y, z)]
  const mesh = greedyMesh(get, [nu, ny, nv], {
    scale: VOXB, origin: [ou, y0, ov], colorOf, solid: isSolid, noise: 0.05,
  })
  const P = mesh.positions, N = mesh.normals
  for (let k = 0; k < P.length; k += 3) {
    const u = P[k], v = P[k + 2]
    P[k] = c.x + u * ca - v * sa
    P[k + 2] = c.z + u * sa + v * ca
    const nu2 = N[k], nv2 = N[k + 2]
    N[k] = nu2 * ca - nv2 * sa
    N[k + 2] = nu2 * sa + nv2 * ca
  }
  return mesh
}

function heightfieldChunk(ter, cx, cz, n, colorOf) {
  return heightfieldMesh(ter.H, ter.M, {
    W: ter.W, D: ter.D, cell: CELL, step: STEP,
    origin: [ter.ox, 0, ter.oz], colorOf, noise: 0.05, ter,
    rect: { x0: cx, z0: cz, x1: Math.min(ter.W, cx + n), z1: Math.min(ter.D, cz + n) },
  })
}

/**
 * Ke každému domu bod, ke kterému "kouká" — kvůli portálu a podloubí.
 *
 * Měří se od NEJBLIŽŠÍHO ROHU půdorysu, ne od těžiště. Měšťanské domy na
 * náměstí stojí na hlubokých parcelách; jeden má 54 m a jeho těžiště je
 * 48 m od náměstí, takže při měření z těžiště propadl přes limit a zůstal
 * bez podloubí i bez portálu — v podloubí z něj pak byla stěna napříč
 * průchodem. Dům ve frontě náměstí navíc limit nemá vůbec, ten na náměstí
 * kouká z definice.
 */
function frontPoints(data) {
  const m = new Map()
  const sq = data.square[0]
  for (const b of data.buildings) {
    if (!b.play) continue
    let best = null, bd = 1e9
    const probe = (a, c) => {
      for (const p of b.poly) {
        const d = segDist(p[0], p[1], a, c)
        if (d < bd) { bd = d; best = nearestOn(p[0], p[1], a, c) }
      }
    }
    if (b.sq) {
      for (let i = 0; i < sq.length; i++) probe(sq[i], sq[(i + 1) % sq.length])
    } else {
      for (const r of data.roads) {
        if (r.hw === 'steps' || r.hw === 'path') continue
        for (let i = 0; i < r.poly.length - 1; i++) probe(r.poly[i], r.poly[i + 1])
      }
    }
    if (best && (b.sq || bd < 40)) m.set(b.id, best)
  }
  return m
}

function nearestOn(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const L2 = dx * dx + dz * dz
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2))
  return [a[0] + t * dx, a[1] + t * dz]
}

/** Hradba — kamenná zeď s cimbuřím podél lomené čáry. */
function buildWall(w, ter, colorOf) {
  const pts = w.poly
  let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9
  for (const p of pts) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
    minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1])
  }
  const T = 1.2   // tloušťka
  const pad = T + 1
  const nx = Math.ceil((maxX - minX + 2 * pad) / VOX)
  const nz = Math.ceil((maxZ - minZ + 2 * pad) / VOX)
  if (nx * nz > 400000) return null
  const ox = minX - pad, oz = minZ - pad
  let gMin = 1e9
  for (const p of pts) gMin = Math.min(gMin, ter.groundY(p[0], p[1]))
  const y0 = gMin - 2
  const ny = Math.ceil((w.h + 4) / VOX)
  const g = new Uint8Array(nx * ny * nz)
  const at = (x, y, z) => x + nx * (z + nz * y)

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = ox + (i + 0.5) * VOX, z = oz + (j + 0.5) * VOX
      // nejbližší úsek hradby + vzdálenost od jejího začátku (kvůli cimbuří)
      let d = 1e9, along = 0, run = 0
      for (let s = 0; s < pts.length - 1; s++) {
        const a = pts[s], b = pts[s + 1]
        const sx = b[0] - a[0], sz = b[1] - a[1]
        const L2 = sx * sx + sz * sz
        const tt = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * sx + (z - a[1]) * sz) / L2))
        const dd = Math.hypot(x - (a[0] + tt * sx), z - (a[1] + tt * sz))
        if (dd < d) { d = dd; along = run + tt * Math.sqrt(L2) }
        run += Math.sqrt(L2)
      }
      if (d > T / 2) continue
      // Korunu hradby držíme po půlmetrových stupních. Kdyby kopírovala terén
      // buňku po buňce, měl by každý sloupec jinou výšku, greedy mesher by je
      // nesloučil a ze zdi by bylo svislé žebrování.
      const gy = ter.groundY(x, z)
      const top = 2 * Math.round((gy + w.h - y0) / VOX / 2)
      for (let y = 0; y < top; y++) g[at(i, y, j)] = 12
      // Žádné cimbuří. OSM u hradeb neuvádí výšku ani tvar a z fotek jádra je
      // vidět, že dochované úseky jsou obyčejná kamenná zeď mezi domy a
      // zahradami — zubatá koruna z prvního pokusu byl čistě můj výmysl a
      // u Solní brány z ní byl hrad, který tam nestojí.
    }
  }
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : g[at(x, y, z)]
  return greedyMesh(get, [nx, ny, nz], {
    scale: VOX, origin: [ox, y0, oz], colorOf, solid: isSolid, noise: 0.02,
  })
}

/** Strom, lampa, lavička, kašna — drobnosti, které dělají město obydlené. */
function buildProp(p, ter, colorOf) {
  const spec = PROPS[p.k]
  if (!spec) return null
  const vox = spec.vox || VOX
  const { n, h, fill } = spec
  const g = new Uint8Array(n * h * n)
  const at = (x, y, z) => x + n * (z + n * y)
  fill((x, y, z, v) => {
    if (x < 0 || y < 0 || z < 0 || x >= n || y >= h || z >= n) return
    g[at(x, y, z)] = v
  }, n, h, hash(p.x, p.z))
  const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= n || y >= h || z >= n) ? 0 : g[at(x, y, z)]
  const gy = ter.groundY(p.x, p.z)
  return greedyMesh(get, [n, h, n], {
    scale: vox, origin: [p.x - n * vox / 2, gy - vox, p.z - n * vox / 2],
    colorOf, solid: isSolid, noise: 0.07,
  })
}

function hash(a, b) {
  let h = Math.imul(Math.round(a * 13) ^ Math.round(b * 7919), 2654435761)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

// Mobiliář se staví v jemnější mřížce než domy (0,25 m). Lavička o hraně půl
// metru vypadá na náměstí jako bedna — tohle je ta hranice, kde se voxel musí
// zjemnit, jinak přestane být poznat, co ta věc je.
const P_VOX = 0.25
const PROPS = {
  tree: {
    n: 13, h: 26, vox: 0.5,
    fill(set, n, h, r) {
      const c = n >> 1
      const trunk = 5 + Math.floor(r * 4)
      for (let y = 0; y < trunk; y++) set(c, y, c, 30)
      const rad = 2.6 + r * 1.8
      const top = trunk + Math.round(rad * 2.3)
      for (let y = trunk; y < top && y < h; y++) {
        const t = (y - trunk) / (top - trunk)
        const rr = rad * Math.sin(Math.PI * (0.22 + 0.78 * t)) * (1 - 0.12 * t)
        for (let z = -Math.ceil(rr); z <= Math.ceil(rr); z++) {
          for (let x = -Math.ceil(rr); x <= Math.ceil(rr); x++) {
            if (x * x + z * z <= rr * rr) set(c + x, y, c + z, 31)
          }
        }
      }
    },
  },
  lamp: {
    // litinová lampa: patka, dřík 3,5 m, rameno a svítidlo
    n: 5, h: 20, vox: P_VOX,
    fill(set, n) {
      const c = n >> 1
      for (let y = 0; y < 2; y++) for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
        if (Math.abs(x) + Math.abs(z) <= 1) set(c + x, y, c + z, 33)
      }
      for (let y = 2; y < 15; y++) set(c, y, c, 33)
      for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) set(c + x, 15, c + z, 33)
      for (let y = 16; y < 18; y++) for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
        if (Math.abs(x) + Math.abs(z) <= 1) set(c + x, y, c + z, 34)
      }
      set(c, 18, c, 33)
    },
  },
  bench: {
    // 1,75 m dlouhá, sedák 0,5 m, opěradlo 1 m
    n: 9, h: 6, vox: P_VOX,
    fill(set, n, h, r) {
      const along = r < 0.5 ? 'x' : 'z'
      const put = (a, y, b, v) => along === 'x' ? set(a, y, b, v) : set(b, y, a, v)
      for (let a = 1; a <= 7; a++) {
        put(a, 2, 4, 35); put(a, 2, 5, 35)      // sedák
        put(a, 3, 5, 35); put(a, 4, 5, 35)      // opěradlo
      }
      for (const a of [1, 7]) for (let y = 0; y < 2; y++) { put(a, y, 4, 33); put(a, y, 5, 33) }
    },
  },
  fountain: {
    // kamenná kašna s vodou a sloupkem uprostřed
    n: 26, h: 14, vox: P_VOX,
    fill(set, n) {
      const c = n >> 1, R = 11
      for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
        const d = Math.hypot(x, z)
        if (d > R) continue
        set(c + x, 0, c + z, 36); set(c + x, 1, c + z, 36)
        if (d > R - 2) { for (let y = 2; y < 5; y++) set(c + x, y, c + z, 36) }
        else set(c + x, 2, c + z, 7)
      }
      for (let y = 3; y < 10; y++) for (const [dx, dz] of [[0,0],[1,0],[0,1],[1,1]]) set(c+dx, y, c+dz, 36)
      for (let z = -2; z <= 3; z++) for (let x = -2; x <= 3; x++) set(c + x, 10, c + z, 36)
    },
  },
  monument: {
    // sloup se sochou: stupně, dřík, hlavice, figura
    n: 14, h: 30, vox: P_VOX,
    fill(set, n) {
      const c = n >> 1
      for (let y = 0; y < 3; y++) {
        const r = 5 - y
        for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) set(c + x, y, c + z, 36)
      }
      for (let y = 3; y < 7; y++) for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) set(c+x, y, c+z, 36)
      for (let y = 7; y < 20; y++) for (const [dx, dz] of [[0,0],[1,0],[0,1],[1,1]]) set(c+dx, y, c+dz, 36)
      for (let z = -2; z <= 3; z++) for (let x = -2; x <= 3; x++) set(c + x, 20, c + z, 36)
      // figura
      for (let y = 21; y < 26; y++) for (const [dx, dz] of [[0,0],[1,0],[0,1],[1,1]]) set(c+dx, y, c+dz, 15)
      for (let y = 26; y < 28; y++) set(c, y, c, 15)
    },
  },
  gate: { n: 0, h: 0, fill() {} },      // brány řeší vlastní kód, ne mobiliář
  landmark: { n: 0, h: 0, fill() {} },
}
