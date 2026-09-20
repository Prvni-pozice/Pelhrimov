// ui.js — HUD: cíl, šipka, minimapa, kartička po dojití.
//
// Všechno je DOM nad plátnem, ne kreslení do scény. Text v 3D by se musel
// řešit atlasem písma a v češtině by to znamenalo vlastní glyfy — DOM to
// zvládne sám, ostře a na jakékoli velikosti obrazovky.

const CSS = `
#ui { position: fixed; inset: 0; pointer-events: none; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
#ui .panel { background: rgba(18,24,32,.74); backdrop-filter: blur(7px); border: 1px solid rgba(255,255,255,.13);
  border-radius: 12px; color: #f2f6fa; box-shadow: 0 6px 22px rgba(0,0,0,.3); }
#goal { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); padding: 10px 16px;
  min-width: 260px; max-width: 76vw; text-align: center; }
#goal .lbl { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; opacity: .6; }
#goal .name { font-size: 17px; font-weight: 650; margin: 2px 0 1px; }
#goal .hint { font-size: 12px; opacity: .72; }
#goal .dist { font-size: 12px; opacity: .9; margin-top: 4px; font-variant-numeric: tabular-nums; }
#arrow { position: absolute; top: 50%; left: 50%; width: 76px; height: 76px; margin: -38px 0 0 -38px; opacity: .85; }
#score { position: absolute; top: 14px; right: 14px; padding: 8px 13px; font-variant-numeric: tabular-nums; font-size: 13px; }
#score b { font-size: 16px; }
#mapwrap { position: absolute; right: 14px; bottom: 14px; width: 190px; height: 190px; padding: 6px; }
#mapwrap canvas { width: 100%; height: 100%; border-radius: 7px; display: block; }
#card { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-46%) scale(.94); opacity: 0;
  padding: 20px 24px; max-width: min(460px, 86vw); transition: opacity .28s, transform .28s; }
#card.on { opacity: 1; transform: translate(-50%,-50%) scale(1); }
#card h2 { margin: 0 0 6px; font-size: 21px; }
#card .info { font-size: 13px; opacity: .84; }
#card .tick { color: #8fe08f; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }
#help { position: absolute; left: 14px; bottom: 14px; padding: 8px 12px; font-size: 12px; opacity: .78; }
#help kbd { background: #ffffff22; border-radius: 4px; padding: 1px 5px; font: inherit; }
@media (max-width: 720px) {
  #mapwrap { width: 132px; height: 132px; }
  #goal { top: 8px; padding: 8px 12px; }
  #help { display: none; }
}
`

export class HUD {
  constructor(data, quests) {
    this.q = quests
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.id = 'ui'
    root.innerHTML = `
      <div id="goal" class="panel">
        <div class="lbl">Najdi</div>
        <div class="name">—</div>
        <div class="hint"></div>
        <div class="dist"></div>
      </div>
      <svg id="arrow" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M50 8 L74 62 L50 50 L26 62 Z" fill="#ffd27a" stroke="rgba(0,0,0,.45)" stroke-width="3" stroke-linejoin="round"/>
      </svg>
      <div id="score" class="panel"><b>0</b><span class="tot">/0</span> · <span class="t">0:00</span> · <span class="w">0 m</span></div>
      <div id="mapwrap" class="panel"><canvas width="380" height="380"></canvas></div>
      <div id="card" class="panel"><div class="tick">Nalezeno</div><h2></h2><div class="info"></div></div>
      <div id="help" class="panel">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> chůze · <kbd>Shift</kbd> běh ·
        <kbd>mezerník</kbd> skok · myš rozhled · <kbd>F</kbd> volná kamera
      </div>`
    document.body.appendChild(root)

    this.el = {
      name: root.querySelector('#goal .name'), hint: root.querySelector('#goal .hint'),
      dist: root.querySelector('#goal .dist'), arrow: root.querySelector('#arrow'),
      score: root.querySelector('#score b'), total: root.querySelector('#score .tot'),
      time: root.querySelector('#score .t'),
      walk: root.querySelector('#score .w'), goal: root.querySelector('#goal'),
      card: root.querySelector('#card'), cardH: root.querySelector('#card h2'),
      cardI: root.querySelector('#card .info'), map: root.querySelector('#mapwrap canvas'),
    }
    this.base = renderMap(data, 380)
    this.cardUntil = 0
  }

  show(q) {
    this.el.cardH.textContent = q.title
    this.el.cardI.textContent = q.info
    this.el.card.classList.add('on')
    this.cardUntil = performance.now() + 4200
  }

  update(px, pz, yaw) {
    const q = this.q
    if (this.cardUntil && performance.now() > this.cardUntil) {
      this.el.card.classList.remove('on'); this.cardUntil = 0
    }
    this.el.score.textContent = q.done
    this.el.total.textContent = `/${q.total}`
    const t = q.elapsed()
    this.el.time.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
    this.el.walk.textContent = `${Math.round(q.walked)} m`

    if (!q.target) {
      this.el.goal.querySelector('.lbl').textContent = 'Hotovo'
      this.el.name.textContent = 'Obešel jsi celé jádro'
      this.el.hint.textContent = `${q.total} pamětihodností, ${Math.round(q.walked)} m chůze`
      this.el.dist.textContent = ''
      this.el.arrow.style.display = 'none'
    } else {
      const dx = q.target.gx - px, dz = q.target.gz - pz
      const d = Math.hypot(dx, dz)
      this.el.name.textContent = q.target.title
      this.el.hint.textContent = q.target.hint
      this.el.dist.textContent = `${Math.round(d)} m`
      // úhel cíle vůči směru pohledu; +z je "dopředu" při yaw 0
      const rel = Math.atan2(dx, dz) - yaw
      this.el.arrow.style.transform = `rotate(${rel}rad)`
      this.el.arrow.style.opacity = d < 30 ? String(Math.max(0.15, (d - 11) / 19)) : '0.85'
    }
    this.drawMap(px, pz, yaw)
  }

  drawMap(px, pz, yaw) {
    const c = this.el.map.getContext('2d')
    const S = this.el.map.width, half = this.base.half, view = 150
    const k = S / (2 * view)
    c.clearRect(0, 0, S, S)
    c.save()
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 2, 0, 7); c.clip()
    c.fillStyle = '#20262e'; c.fillRect(0, 0, S, S)
    // výřez podkladu kolem hráče
    const srcPx = this.base.canvas.width / (2 * half)
    const sx = (px + half) * srcPx - view * srcPx
    const sy = (pz + half) * srcPx - view * srcPx
    const sw = 2 * view * srcPx
    c.drawImage(this.base.canvas, sx, sy, sw, sw, 0, 0, S, S)
    // cíl
    const q = this.q.target
    if (q) {
      const tx = S / 2 + (q.gx - px) * k, ty = S / 2 + (q.gz - pz) * k
      c.fillStyle = '#ffd27a'; c.strokeStyle = '#000'; c.lineWidth = 3
      c.beginPath(); c.arc(clampS(tx, S), clampS(ty, S), 9, 0, 7); c.fill(); c.stroke()
    }
    // hráč
    c.translate(S / 2, S / 2); c.rotate(-yaw + Math.PI)
    c.fillStyle = '#7ecbff'; c.strokeStyle = '#04121e'; c.lineWidth = 3
    c.beginPath(); c.moveTo(0, -15); c.lineTo(11, 12); c.lineTo(0, 5); c.lineTo(-11, 12)
    c.closePath(); c.fill(); c.stroke()
    c.restore()
  }
}

function clampS(v, S) { return Math.max(12, Math.min(S - 12, v)) }

/** Jednou vykreslí půdorys města do plátna, ze kterého pak minimapa jen bere výřez. */
function renderMap(data, _size) {
  const half = data.half, PX = 2                     // 2 px na metr
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.round(2 * half * PX)
  const c = canvas.getContext('2d')
  const X = (v) => (v + half) * PX
  c.fillStyle = '#2a3038'; c.fillRect(0, 0, canvas.width, canvas.height)

  c.fillStyle = '#3c4a3a'
  for (const a of data.areas) {
    if (a.kind !== 'grass' && a.kind !== 'forest') continue
    poly(c, a.poly, X); c.fill()
  }
  c.strokeStyle = '#59606b'; c.lineCap = 'round'; c.lineJoin = 'round'
  for (const r of data.roads) {
    c.lineWidth = Math.max(2, r.w * PX * 0.8)
    c.beginPath()
    r.poly.forEach((p, i) => i ? c.lineTo(X(p[0]), X(p[1])) : c.moveTo(X(p[0]), X(p[1])))
    c.stroke()
  }
  c.fillStyle = '#6b6f78'
  for (const sq of data.square) { poly(c, sq, X); c.fill() }
  for (const b of data.buildings) {
    c.fillStyle = b.sq ? '#c98f4e' : (b.play ? '#8b8175' : '#4e535b')
    poly(c, b.poly, X); c.fill()
  }
  c.strokeStyle = '#d24a4a'; c.lineWidth = 5
  for (const b of data.barriers) {
    const ca = Math.cos(b.a + Math.PI / 2), sa = Math.sin(b.a + Math.PI / 2), L = b.w / 2 + 3
    c.beginPath()
    c.moveTo(X(b.x - ca * L), X(b.z - sa * L)); c.lineTo(X(b.x + ca * L), X(b.z + sa * L))
    c.stroke()
  }
  return { canvas, half }
}

function poly(c, pts, X) {
  c.beginPath()
  pts.forEach((p, i) => i ? c.lineTo(X(p[0]), X(p[1])) : c.moveTo(X(p[0]), X(p[1])))
  c.closePath()
}
