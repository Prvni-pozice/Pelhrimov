// player.js — chůze po městě.
//
// Hráč je svislá kružnice o poloměru 0,35 m; svět je pevný, takže kolize řeší
// předpočítaný Collider a výšku terén. Schod do 0,45 m se vyjde bez skákání —
// bez toho by se v historickém jádru nedalo přejít přes obrubník ani po dlažbě,
// která se láme o čtvrt metru.

import * as THREE from 'three'

export const EYE = 1.62          // výška očí nad nohama
const RADIUS = 0.35
const WALK = 4.4, RUN = 7.6
const GRAV = 22, JUMP = 7.2
const STEP_UP = 0.55
const ACCEL = 14, AIR_ACCEL = 2.5

export class Player {
  constructor(terrain, collider, spawn) {
    this.ter = terrain
    this.col = collider
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1])
    this.pos.y = terrain.groundY(spawn[0], spawn[1])
    this.vel = new THREE.Vector3()
    this.yaw = spawn[2] || 0
    this.pitch = 0
    this.onGround = true
    this.bob = 0
  }

  /** @param {{f:number,s:number,run:boolean,jump:boolean}} input  f/s v -1..1 */
  update(dt, input) {
    const g = this.ter.groundY(this.pos.x, this.pos.z)

    // ── vodorovný pohyb ──
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw)
    let wx = sin * input.f + Math.sin(this.yaw - Math.PI / 2) * input.s
    let wz = cos * input.f + Math.cos(this.yaw - Math.PI / 2) * input.s
    const L = Math.hypot(wx, wz)
    if (L > 1) { wx /= L; wz /= L }
    const speed = (input.run ? RUN : WALK)
    const a = (this.onGround ? ACCEL : AIR_ACCEL) * dt
    this.vel.x += (wx * speed - this.vel.x) * Math.min(1, a)
    this.vel.z += (wz * speed - this.vel.z) * Math.min(1, a)

    // ── svislý pohyb ──
    if (this.onGround && input.jump) { this.vel.y = JUMP; this.onGround = false }
    this.vel.y -= GRAV * dt

    // ── posun + kolize ──
    const nx = this.pos.x + this.vel.x * dt
    const nz = this.pos.z + this.vel.z * dt
    const [rx, rz] = this.col.resolve(nx, nz, RADIUS)
    // když nás kolize vytlačila, sraz i rychlost v tom směru — jinak se hráč
    // "lepí" na zeď a zrychluje podél ní
    if (Math.abs(rx - nx) > 1e-4) this.vel.x *= 0.2
    if (Math.abs(rz - nz) > 1e-4) this.vel.z *= 0.2

    const gNew = this.ter.groundY(rx, rz)
    const climb = gNew - this.pos.y
    if (climb > STEP_UP && this.onGround) {
      // příliš vysoký schod (zídka, sráz) — neprojdeme
      this.vel.x = this.vel.z = 0
    } else {
      this.pos.x = rx; this.pos.z = rz
      if (this.onGround && climb > 0 && climb <= STEP_UP) this.pos.y = gNew
    }

    this.pos.y += this.vel.y * dt
    const gy = this.ter.groundY(this.pos.x, this.pos.z)
    if (this.pos.y <= gy) {
      this.pos.y = gy
      this.vel.y = 0
      this.onGround = true
    } else if (this.pos.y > gy + 0.02) {
      this.onGround = false
    }

    // ── houpání kamery při chůzi ──
    const sp = Math.hypot(this.vel.x, this.vel.z)
    this.bob += dt * sp * 1.7
    if (sp < 0.2) this.bob *= 0.92
  }

  applyTo(camera) {
    const b = Math.sin(this.bob) * 0.035 * (this.onGround ? 1 : 0)
    camera.position.set(this.pos.x, this.pos.y + EYE + b, this.pos.z)
    const cp = Math.cos(this.pitch)
    camera.lookAt(
      this.pos.x + Math.sin(this.yaw) * cp,
      this.pos.y + EYE + b + Math.sin(this.pitch),
      this.pos.z + Math.cos(this.yaw) * cp,
    )
  }
}

/** Klávesnice, myš a dotyk v jednom — vrací {f,s,run,jump} pro Player.update. */
export class Input {
  constructor(el, player) {
    this.p = player
    this.keys = new Set()
    this.touchMove = { x: 0, y: 0, id: null, ox: 0, oy: 0 }
    this.touchLook = { id: null, x: 0, y: 0 }
    this.jumpQueued = false

    addEventListener('keydown', e => {
      this.keys.add(e.code)
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault() }
    })
    addEventListener('keyup', e => this.keys.delete(e.code))
    addEventListener('blur', () => this.keys.clear())

    el.addEventListener('click', () => {
      if (!('ontouchstart' in window)) el.requestPointerLock()
    })
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== el) return
      player.yaw -= e.movementX * 0.0022
      player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45)
    })

    // ── dotyk: levá půlka obrazovky chodí, pravá se rozhlíží ──
    el.addEventListener('touchstart', e => {
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth / 2 && this.touchMove.id === null) {
          this.touchMove.id = t.identifier
          this.touchMove.ox = t.clientX; this.touchMove.oy = t.clientY
        } else if (this.touchLook.id === null) {
          this.touchLook.id = t.identifier
          this.touchLook.x = t.clientX; this.touchLook.y = t.clientY
        }
      }
    }, { passive: true })
    el.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchMove.id) {
          this.touchMove.x = clamp((t.clientX - this.touchMove.ox) / 55, -1, 1)
          this.touchMove.y = clamp((t.clientY - this.touchMove.oy) / 55, -1, 1)
        } else if (t.identifier === this.touchLook.id) {
          player.yaw -= (t.clientX - this.touchLook.x) * 0.006
          player.pitch = clamp(player.pitch - (t.clientY - this.touchLook.y) * 0.006, -1.45, 1.45)
          this.touchLook.x = t.clientX; this.touchLook.y = t.clientY
        }
      }
      e.preventDefault()
    }, { passive: false })
    const end = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touchMove.id) { this.touchMove.id = null; this.touchMove.x = this.touchMove.y = 0 }
        if (t.identifier === this.touchLook.id) this.touchLook.id = null
      }
    }
    el.addEventListener('touchend', end, { passive: true })
    el.addEventListener('touchcancel', end, { passive: true })
  }

  read() {
    const k = this.keys
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
    let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    if (this.touchMove.id !== null) { f -= this.touchMove.y; s += this.touchMove.x }
    const jump = this.jumpQueued || this.touchMove.y < -0.85
    this.jumpQueued = false
    return { f: clamp(f, -1, 1), s: clamp(s, -1, 1), run: k.has('ShiftLeft') || k.has('ShiftRight'), jump }
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
