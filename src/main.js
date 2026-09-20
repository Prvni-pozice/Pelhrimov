// main.js — scéna, světlo, smyčka.

import * as THREE from 'three'
import DATA from './data/pelhrimov.json' with { type: 'json' }
import PROGRAM from './data/program.json' with { type: 'json' }
import { buildWorld } from './world.js'
import { Player, Input, EYE } from './player.js'
import { Quests } from './quests.js'
import { HUD } from './ui.js'
import { Collectibles } from './collect.js'

const msg = document.getElementById('msg')
const bar = document.querySelector('#bar i')
const statLine = document.getElementById('hud')
document.getElementById('attr').textContent = DATA.attribution

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x9fc6e8)
scene.fog = new THREE.Fog(0xacd0ec, 300, 700)

// ── světlo ──
// Polokoule dělá základní tón (modré nebe shora, teplá zem zdola), slunce
// přidává směr a stíny. Bez polokoule jsou stinné strany domů černé placky.
// Polokoule je tu i proto, aby podloubí a průjezdy nebyly černé díry —
// jsou to zákoutí, kam slunce nikdy nesvítí, a bez rozptýleného světla by
// z nich byly tmavé skvrny na fasádě.
scene.add(new THREE.HemisphereLight(0xcde2f5, 0x8a7f68, 1.4))
const sun = new THREE.DirectionalLight(0xfff2d8, 1.7)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 20
sun.shadow.camera.far = 520
const S = 130
sun.shadow.camera.left = -S; sun.shadow.camera.right = S
sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S
sun.shadow.bias = -0.0009
sun.shadow.normalBias = 0.3
scene.add(sun, sun.target)

const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.12, 1200)

// ── stavba světa ──
const t0 = performance.now()
const steps = { 'terén': 24, 'domy': 74, 'hradby': 82, 'zátarasy': 88, 'zeleň': 100 }
const world = await buildWorld(DATA, (s) => {
  msg.textContent = s + '…'
  bar.style.width = (steps[s] || 0) + '%'
})
scene.add(world.group)
const buildMs = Math.round(performance.now() - t0)
document.getElementById('load').style.display = 'none'

// ── hráč ──
// Start uprostřed náměstí, čelem k jeho delší straně.
const player = new Player(world.terrain, world.collider, [6, 26, Math.PI])
const input = new Input(renderer.domElement, player)
const quests = new Quests(DATA, world.terrain)
const collect = new Collectibles(PROGRAM, world.spots)
const hud = new HUD(DATA, quests, collect)

// ── listiny rozvěšené po podloubí a branách ──
// Vlastní mesh na kus, ne slité do dílu: po sebrání musí zmizet. Při dvou
// desítkách kusů je to zanedbatelné a ušetří to přestavování geometrie.
const pickups = []
{
  const geo = new THREE.BoxGeometry(0.5, 0.7, 0.07)
  for (const it of collect.items) {
    const col = new THREE.Color(it.strana ? it.strana.barva : '#8aa2b8')
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col }))
    mesh.position.set(it.x, it.y + 1.25, it.z)
    scene.add(mesh)
    pickups.push({ mesh, it, y0: it.y + 1.25 })
  }
}

// Volná kamera (klávesa F) — pro kontrolu světa a pro snímky.
let freeCam = false
const free = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 }
addEventListener('keydown', e => {
  if (e.code === 'KeyF') {
    freeCam = !freeCam
    if (freeCam) { free.pos.copy(camera.position); free.yaw = player.yaw; free.pitch = player.pitch }
  }
})

// pevné pohledy pro kontrolní snímky: ?cam=namesti
const VIEWS = {
  namesti:  { p: [0, 34, 78],     yaw: Math.PI,        pitch: -0.30 },
  nadhled:  { p: [-40, 190, 260], yaw: Math.PI,        pitch: -0.56 },
  ulice:    { p: [8, 3.2, 40],    yaw: Math.PI,        pitch: -0.04 },
  brana:    { p: [4.5, 2.0, 86.4], yaw: 0.733,         pitch: 0.14 },
  hradby:   { p: [-90, 26, 60],   yaw: Math.PI * 1.45, pitch: -0.20 },
  dlazba:   { p: [0, 28, 10],     yaw: Math.PI,        pitch: -1.35 },
  solni:    { p: [-58, 22, 14],   yaw: -1.30,          pitch: -0.30 },
  chodnik:  { p: [-30, 3.5, -30], yaw: -2.30,          pitch: -0.10 },
  fasada:   { p: [-8, 2.0, -6],   yaw: -Math.PI / 2,   pitch: 0.12 },
  podloubi: { p: [-10.1, 1.7, -32.6], yaw: -2.612,     pitch: 0.06 },
  podloubi2:{ p: [-38.5, 1.7, -14.7], yaw: -1.611,     pitch: 0.10 },
  rada:     { p: [0, 2.0, -6],    yaw: Math.PI,        pitch: 0.10 },
  rada2:    { p: [10, 2.0, 6],    yaw: Math.PI * 0.62, pitch: 0.10 },
  stit:     { p: [-10, 2.0, -18],  yaw: Math.PI,       pitch: 0.42 },
  banka:    { p: [12, 2.2, -16],  yaw: 2.50,           pitch: 0.16 },
  podloubi_s: { p: [-13.6, 2.0, -25.9], yaw: -2.66,    pitch: 0.14 },
  ulice_k_brane: { p: [-4.0, 1.9, 44.6], yaw: -0.265,  pitch: 0.06 },
  ulice_ruzova:  { p: [42.3, 1.9, 6.3],  yaw: 2.050,   pitch: 0.06 },
  zataras:  { p: [0, 2.2, 0],     yaw: 0,              pitch: -0.02, atBarrier: 0 },
}
const wanted = new URLSearchParams(location.search).get('cam')
if (VIEWS[wanted]) {
  const v = VIEWS[wanted]
  freeCam = true
  let [x, , z] = v.p
  if (v.atBarrier !== undefined && DATA.barriers[v.atBarrier]) {
    // postav se do ulice před zátarasem a koukej na něj
    const b = DATA.barriers[v.atBarrier]
    const dx = Math.cos(b.a), dz = Math.sin(b.a)
    const back = Math.hypot(b.x + dx * 22, b.z + dz * 22) < Math.hypot(b.x - dx * 22, b.z - dz * 22) ? 1 : -1
    x = b.x + dx * 22 * back; z = b.z + dz * 22 * back
    free.yaw = Math.atan2(b.x - x, b.z - z)
  } else {
    free.yaw = v.yaw
  }
  free.pos.set(x, world.terrain.groundY(x, z) + v.p[1], z)
  free.pitch = v.pitch
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const fwd = new THREE.Vector3(), right = new THREE.Vector3()
const clock = new THREE.Clock()
let fps = 0, hudTick = 0

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  fps = fps * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1
  const cmd = input.read()
  if (window.__game && window.__game.autoWalk) { cmd.f = 1; cmd.run = true }

  if (freeCam) {
    if (!VIEWS[wanted]) { free.yaw = player.yaw; free.pitch = player.pitch }
    const sp = (cmd.run ? 90 : 26) * dt
    fwd.set(Math.sin(free.yaw) * Math.cos(free.pitch), Math.sin(free.pitch),
            Math.cos(free.yaw) * Math.cos(free.pitch))
    right.set(Math.sin(free.yaw - Math.PI / 2), 0, Math.cos(free.yaw - Math.PI / 2))
    free.pos.addScaledVector(fwd, cmd.f * sp).addScaledVector(right, cmd.s * sp)
    if (cmd.jump) free.pos.y += sp
    camera.position.copy(free.pos)
    camera.lookAt(free.pos.x + fwd.x, free.pos.y + fwd.y, free.pos.z + fwd.z)
    // HUD ať ukazuje i ve volné kameře, jinak jsou kontrolní snímky prázdné
    hud.update(free.pos.x, free.pos.z, free.yaw)
  } else {
    player.update(dt, cmd)
    player.applyTo(camera)
    const got = collect.update(player.pos.x, player.pos.z, player.pos.y)
    if (got) hud.showItem(got)
    const reached = quests.update(player.pos.x, player.pos.z)
    if (reached && !got) hud.show(reached)
    hud.update(player.pos.x, player.pos.z, player.yaw)
  }

  // stínová kamera jede s hráčem — pokrýt celou mapu jednou mapou by znamenalo
  // 0,5 m na texel, což na římsách dělá zubaté stíny
  const c = camera.position
  sun.target.position.set(c.x, world.terrain.groundY(c.x, c.z), c.z)
  sun.position.set(c.x - 120, 190, c.z + 90)

  // listiny se pomalu otáčejí a pohupují, ať jsou v šeru podloubí vidět
  const now = clock.elapsedTime
  for (const p of pickups) {
    if (p.it.got) { if (p.mesh.visible) p.mesh.visible = false; continue }
    p.mesh.rotation.y = now * 1.1
    p.mesh.position.y = p.y0 + Math.sin(now * 2 + p.y0) * 0.09
  }

  renderer.render(scene, camera)

  if ((hudTick += dt) > 0.25) {
    hudTick = 0
    statLine.textContent = `${Math.round(fps)} fps · ${world.stats.houses} domů · `
      + `${world.stats.tris.toLocaleString('cs')} trojúhelníků · svět za ${buildMs} ms`
      + (freeCam ? ' · VOLNÁ KAMERA (F)' : '')
  }
})

// Přístup pro kontrolní skripty (scripts/play.mjs): automatická procházka
// potřebuje hráče posouvat, aniž by existovala klávesnice.
window.__ready = true
window.__stats = () => ({ ...world.stats, fps: Math.round(fps) })
window.__game = { player, quests, collect, world, autoWalk: false }
