// probe.mjs — test, že se město dá projít. Hlavní test projektu.
//
// Postaví svět v Node (three.js na to DOM nepotřebuje) a pustí na kolizní
// model záplavové vyplnění: kam až hráč z náměstí dojde. Odhalí uzavřenou
// bránu, cíl za zdí i rozpadlé město. Běží pár sekund a nepotřebuje
// prohlížeč — na rozdíl od scripts/play.mjs, který je jen kouřová zkouška,
// že se hra v prohlížeči vůbec rozjede.
//   npm test
import fs from 'node:fs'
import { buildWorld } from '../src/world.js'
import { Player } from '../src/player.js'
import { Quests } from '../src/quests.js'

const DATA = JSON.parse(fs.readFileSync(new URL('../src/data/pelhrimov.json', import.meta.url), 'utf8'))
const t0 = Date.now()
const world = await buildWorld(DATA)
console.log(`svět postaven za ${Date.now() - t0} ms — ${world.stats.houses} domů, `
          + `${world.stats.tris.toLocaleString('cs')} trojúhelníků`)

const quests = new Quests(DATA, world.terrain)

/**
 * Záplavové vyplnění průchozích míst.
 *
 * Naivní bot, který jde k cíli po přímce, není důkaz — zasekne se o první dům.
 * Tohle je důkaz: mřížka po metru, buňka je průchozí, když v ní hráč nestojí
 * v geometrii a je uvnitř hranice; ze startu se pak rozlije záplava a smí
 * překročit jen schod do 0,55 m, stejně jako hráč. Co záplava nedosáhne,
 * je opravdu nedostupné.
 */
function reachable(start) {
  const CELL = 1.0, R = 0.35, STEP_UP = 0.55
  const half = DATA.half
  const W = Math.round((2 * half) / CELL)
  const X = (i) => -half + (i + 0.5) * CELL
  const I = (x) => Math.round((x + half) / CELL - 0.5)
  const ring = DATA.boundary

  const free = new Uint8Array(W * W)
  const gy = new Float32Array(W * W)
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const x = X(i), z = X(j)
      gy[j * W + i] = world.terrain.groundY(x, z)
      if (!pointIn(x, z, ring)) continue
      const [rx, rz] = world.collider.resolve(x, z, R)
      free[j * W + i] = (Math.abs(rx - x) < 0.02 && Math.abs(rz - z) < 0.02) ? 1 : 0
    }
  }
  const seen = new Uint8Array(W * W)
  const q = [I(start[0]) + W * I(start[1])]
  if (!free[q[0]]) return { seen, W, X, I, free, bad: 'start není průchozí' }
  seen[q[0]] = 1
  for (let h = 0; h < q.length; h++) {
    const k = q[h], i = k % W, j = (k / W) | 0
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue
      const nk = nj * W + ni
      if (seen[nk] || !free[nk]) continue
      if (gy[nk] - gy[k] > STEP_UP) continue        // moc vysoký schod
      seen[nk] = 1; q.push(nk)
    }
  }
  return { seen, W, X, I, free, count: q.length }
}

function pointIn(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

const spawn = [6, 26]
const fl = reachable(spawn)
if (fl.bad) console.log('CHYBA:', fl.bad)
let freeCells = 0
for (const v of fl.free) freeCells += v
console.log('\ndosažitelnost cílů (záplava z náměstí):')
let bad = 0
for (const qt of quests.list) {
  // stačí se dostat na dosah 11 m, ne přesně na bod
  let ok = false
  for (let dz = -11; dz <= 11 && !ok; dz++) {
    for (let dx = -11; dx <= 11 && !ok; dx++) {
      if (dx * dx + dz * dz > 121) continue
      const i = fl.I(qt.gx + dx), j = fl.I(qt.gz + dz)
      if (i < 0 || j < 0 || i >= fl.W || j >= fl.W) continue
      if (fl.seen[j * fl.W + i]) ok = true
    }
  }
  if (!ok) bad++
  console.log(`  ${ok ? 'OK  ' : 'NE  '}${qt.title}`)
}

console.log(`\nprůchozí plocha: ${fl.count} m² dostupných z náměstí z ${freeCells} m² `
          + `volných uvnitř hranice (${Math.round(100 * fl.count / freeCells)} %). Zbytek jsou`
          + ` uzavřené dvorky za domy — to je v pořádku.`)

if (bad) {
  console.log(`\nSELHALO: ${bad} z ${quests.list.length} cílů není dostupných.`)
  process.exit(1)
}
if (fl.count / freeCells < 0.8) {
  console.log('\nSELHALO: město je rozpadlé na nespojené kusy.')
  process.exit(1)
}
console.log('\nv pořádku: svět je průchozí a všechny cíle se dají obejít.')
