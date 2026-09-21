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
#goal .vedle { font-size: 11px; opacity: .6; margin-top: 5px; border-top: 1px solid #ffffff1f; padding-top: 5px; }
#warn { position: absolute; top: 14px; left: 14px; padding: 7px 11px; max-width: 22ch; font-size: 11px;
  line-height: 1.35; border-color: #e8a33d55; }
#warn b { color: #ffca72; }
#strany { position: absolute; top: 62px; right: 14px; padding: 8px 12px; font-size: 12px; }
#strany div { display: flex; align-items: center; gap: 7px; margin: 3px 0; font-variant-numeric: tabular-nums; }
#strany i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; flex: none; }
#strany span.n { flex: 1; opacity: .85; }
#card .zdroj { font-size: 11px; opacity: .55; margin-top: 9px; word-break: break-all; }
#card .party { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
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
/* ── dotykové ovládání ───────────────────────────────────────────────
   Nákres kniplu vlevo dole ukazuje, kam dát prst. Bez něj lidé na mobilu
   nevědí, že levá polovina obrazovky chodí a pravá se rozhlíží. */
#stick { position: absolute; left: 26px; bottom: 26px; width: 132px; height: 132px;
  border-radius: 50%; border: 2px solid rgba(255,255,255,.34);
  background: radial-gradient(circle, rgba(18,24,32,.42), rgba(18,24,32,.18));
  box-shadow: 0 4px 18px rgba(0,0,0,.28); }
#stick .knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px;
  margin: -27px 0 0 -27px; border-radius: 50%; background: rgba(255,255,255,.5);
  border: 2px solid rgba(255,255,255,.72); transition: background .12s; }
#stick.on .knob { background: #ffd27a; border-color: #fff; }
#stick .dir { position: absolute; color: rgba(255,255,255,.62); font-size: 15px; line-height: 1; }
#stick .up { left: 50%; top: 9px; transform: translateX(-50%); }
#stick .dn { left: 50%; bottom: 9px; transform: translateX(-50%); }
#stick .lf { left: 9px; top: 50%; transform: translateY(-50%); }
#stick .rt { right: 9px; top: 50%; transform: translateY(-50%); }
#stick .lbl { position: absolute; left: 50%; bottom: -22px; transform: translateX(-50%);
  font-size: 11px; white-space: nowrap; color: rgba(255,255,255,.7); text-shadow: 0 1px 3px #000; }
#look { position: absolute; right: 26px; bottom: 34px; width: 104px; text-align: center;
  font-size: 11px; color: rgba(255,255,255,.7); text-shadow: 0 1px 3px #000; }
#look svg { width: 54px; height: 54px; opacity: .66; display: block; margin: 0 auto 4px; }

#intro { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  padding: 20px 26px; max-width: min(430px, 88vw); text-align: center;
  transition: opacity .45s; }
#intro h2 { margin: 0 0 4px; font-size: 20px; }
#intro p { margin: 6px 0; font-size: 13px; opacity: .86; }
#intro table { margin: 10px auto 2px; font-size: 13px; border-spacing: 10px 4px; }
#intro td:first-child { text-align: right; opacity: .72; white-space: nowrap; }
#intro td:last-child { text-align: left; font-weight: 600; }
#intro .zav { font-size: 11px; opacity: .55; margin-top: 10px; }
#intro.pryc { opacity: 0; pointer-events: none; }

/* ── úzká obrazovka ──────────────────────────────────────────────────
   Na mobilu se panely z desktopu překrývaly. Tady se skládají pod sebe:
   nahoře varování a cíl, vpravo nahoře počitadlo, dole knipl a minimapa. */
@media (max-width: 720px) {
  #goal { top: auto; left: 8px; right: 8px; transform: none; min-width: 0;
    max-width: none; padding: 7px 10px; }
  #goal .name { font-size: 15px; }
  #goal .hint, #goal .vedle { font-size: 11px; }
  #warn { position: absolute; top: 8px; left: 8px; right: 8px; max-width: none;
    padding: 6px 10px; font-size: 10.5px; }
  #goal { top: 8px; }
  #ui.demo #goal { top: 72px; }
  #score { top: auto; right: 8px; bottom: 226px; padding: 6px 10px; font-size: 12px; }
  #strany { display: none; }
  #mapwrap { width: 124px; height: 124px; right: 8px; bottom: 26px; }
  #stick { left: 16px; bottom: 34px; width: 116px; height: 116px; }
  #stick .knob { width: 46px; height: 46px; margin: -23px 0 0 -23px; }
  #look { right: 8px; bottom: 158px; width: 124px; font-size: 10px; }
  #look svg { width: 38px; height: 38px; }
  #hud, #help { display: none; }
  #arrow { width: 62px; height: 62px; margin: -31px 0 0 -31px; }
  #card { padding: 14px 16px; }
  #card h2 { font-size: 17px; }
  #intro { padding: 14px 16px; max-width: 92vw; }
  #intro h2 { font-size: 18px; }
  #intro p, #intro table { font-size: 12px; }
  #intro table { border-spacing: 7px 3px; }
}
@media (max-height: 520px) {
  #intro table { display: none; }
}
`

export class HUD {
  constructor(data, quests, collect) {
    this.q = quests
    this.c = collect
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
        <div class="vedle"></div>
      </div>
      <svg id="arrow" viewBox="0 0 100 100" aria-hidden="true">
        <path d="M50 8 L74 62 L50 50 L26 62 Z" fill="#ffd27a" stroke="rgba(0,0,0,.45)" stroke-width="3" stroke-linejoin="round"/>
      </svg>
      <div id="score" class="panel"><b>0</b><span class="tot">/0</span> listin · <span class="t">0:00</span> · <span class="w">0 m</span></div>
      <div id="strany" class="panel"></div>
      <div id="warn" class="panel" hidden></div>
      <div id="mapwrap" class="panel"><canvas width="380" height="380"></canvas></div>
      <div id="card" class="panel"><div class="tick party">Nalezeno</div><h2></h2><div class="info"></div>
        <div class="zdroj"></div></div>
      <div id="stick" hidden>
        <span class="dir up">▲</span><span class="dir dn">▼</span>
        <span class="dir lf">◀</span><span class="dir rt">▶</span>
        <span class="knob"></span><span class="lbl">prst sem — chůze</span>
      </div>
      <div id="look" hidden>
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="18" r="8" fill="none" stroke="#fff" stroke-width="3"/>
          <path d="M24 30v12M18 36l6 6 6-6" fill="none" stroke="#fff" stroke-width="3"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        tažením se rozhlédneš
      </div>
      <div id="intro" class="panel"></div>
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
      vedle: root.querySelector('#goal .vedle'), strany: root.querySelector('#strany'),
      warn: root.querySelector('#warn'), tick: root.querySelector('#card .tick'),
      zdroj: root.querySelector('#card .zdroj'), stick: root.querySelector('#stick'),
      knob: root.querySelector('#stick .knob'), look: root.querySelector('#look'),
      intro: root.querySelector('#intro'), help: root.querySelector('#help'),
    }

    // ── úvodní nápověda ──
    // Na dotykovém zařízení je to jediné místo, kde se hráč dozví, že levá
    // polovina obrazovky chodí a pravá se rozhlíží. Mizí sama po chvíli,
    // nebo hned, jakmile se hráč pohne.
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
    if (this.touch) {
      this.el.stick.hidden = false
      this.el.look.hidden = false
      this.el.help.hidden = true
    }
    this.el.intro.innerHTML = this.touch
      ? `<h2>Pelhřimov</h2><p>Projdi náměstí, podloubí a všechny tři brány
         a posbírej listiny.</p>
         <table><tr><td>levá polovina</td><td>chůze — přidrž a táhni</td></tr>
         <tr><td>pravá polovina</td><td>rozhlížení</td></tr>
         <tr><td>tah nahoru</td><td>skok</td></tr></table>
         <p class="zav">Klepnutím zavřeš.</p>`
      : `<h2>Pelhřimov</h2><p>Projdi náměstí, podloubí a všechny tři brány
         a posbírej listiny.</p>
         <table><tr><td>W A S D</td><td>chůze</td></tr>
         <tr><td>myš</td><td>rozhlížení (klikni pro uzamčení)</td></tr>
         <tr><td>Shift / mezerník</td><td>běh / skok</td></tr>
         <tr><td>F</td><td>volná kamera</td></tr></table>
         <p class="zav">Klávesou nebo kliknutím zavřeš.</p>`
    this.introUntil = performance.now() + 7000
    const close = () => this.hideIntro()
    addEventListener('keydown', close, { once: true })
    this.el.intro.addEventListener('click', close)
    this.el.intro.addEventListener('touchstart', close, { passive: true })
    this.base = renderMap(data, 380)
    this.cardUntil = 0

    if (collect.demo) {
      root.classList.add('demo')
      this.el.warn.hidden = false
      this.el.warn.innerHTML = '<b>Ukázková data.</b> Programy stran zatím '
        + 'nejsou vyplněné, takže se sbírají údaje o městě z map. '
        + 'Nic z toho neříkají kandidátky.'
    }
    for (const p of collect.perParty()) {
      const row = document.createElement('div')
      row.innerHTML = `<i style="background:${p.barva}"></i><span class="n"></span><b></b>`
      row.querySelector('.n').textContent = p.nazev
      this.el.strany.appendChild(row)
    }
  }

  hideIntro() {
    if (!this.introUntil) return
    this.introUntil = 0
    this.el.intro.classList.add('pryc')
  }

  /** Poloha kniplu podle prstu — nákres musí reagovat, jinak vypadá jako obrázek. */
  drawStick(input) {
    if (!this.touch) return
    const t = input.touchMove
    const on = t.id !== null
    this.el.stick.classList.toggle('on', on)
    const r = 34
    this.el.knob.style.transform = on
      ? `translate(${(t.x * r).toFixed(1)}px, ${(t.y * r).toFixed(1)}px)` : ''
  }

  /** Kartička pamětihodnosti. */
  show(q) {
    this.el.tick.textContent = 'Nalezeno'
    this.el.tick.style.color = '#8fe08f'
    this.el.cardH.textContent = q.title
    this.el.cardI.textContent = q.info
    this.el.zdroj.textContent = ''
    this.el.card.classList.add('on')
    this.cardUntil = performance.now() + 4200
  }

  /** Kartička sebrané listiny. Vždy ukáže, čí to je a odkud text pochází. */
  showItem(it) {
    this.el.tick.textContent = it.strana ? it.strana.nazev : 'Údaj o městě'
    this.el.tick.style.color = it.strana ? it.strana.barva : '#8aa2b8'
    this.el.cardH.textContent = it.text
    this.el.cardI.textContent = it.strana
      ? `${it.strana.plnyNazev} · lídr ${it.strana.lidr}` : ''
    this.el.zdroj.textContent = 'zdroj: ' + (it.zdroj || '—')
    this.el.card.classList.add('on')
    this.cardUntil = performance.now() + 6000
  }

  update(px, pz, yaw, input) {
    const q = this.q, c = this.c
    if (input) this.drawStick(input)
    if (this.introUntil && performance.now() > this.introUntil) this.hideIntro()
    if (this.cardUntil && performance.now() > this.cardUntil) {
      this.el.card.classList.remove('on'); this.cardUntil = 0
    }

    // hlavní počitadlo: sebrané listiny a běžící čas
    this.el.score.textContent = c.done
    this.el.total.textContent = `/${c.total}`
    const t = c.elapsed()
    this.el.time.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
    this.el.walk.textContent = `${Math.round(q.walked)} m`

    const rows = this.el.strany.children
    c.perParty().forEach((p, i) => {
      if (rows[i]) rows[i].querySelector('b').textContent = `${p.got}/${p.total}`
    })

    const near = c.nearest(px, pz)
    if (!near) {
      this.el.goal.querySelector('.lbl').textContent = 'Hotovo'
      this.el.name.textContent = 'Máš všechny listiny'
      this.el.hint.textContent = `${c.total} kusů za ${Math.floor(t / 60)}:`
        + `${String(Math.floor(t % 60)).padStart(2, '0')}, ${Math.round(q.walked)} m chůze`
      this.el.dist.textContent = ''
      this.el.arrow.style.display = 'none'
    } else {
      const dx = near.x - px, dz = near.z - pz
      const d = Math.hypot(dx, dz)
      this.el.goal.querySelector('.lbl').textContent = 'Nejbližší listina'
      this.el.name.textContent = near.strana ? near.strana.nazev : 'Údaj o městě'
      this.el.hint.textContent = near.kde
      this.el.dist.textContent = `${Math.round(d)} m`
      const rel = Math.atan2(dx, dz) - yaw
      this.el.arrow.style.transform = `rotate(${rel}rad)`
      this.el.arrow.style.opacity = d < 30 ? String(Math.max(0.15, (d - 4) / 26)) : '0.85'
    }

    // pamětihodnosti zůstávají jako vedlejší úkol
    this.el.vedle.textContent = q.target
      ? `vedle toho: ${q.target.title} (${q.done}/${q.total})`
      : `pamětihodnosti hotové (${q.total}/${q.total})`

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
    // nesebrané listiny
    for (const it of this.c.items) {
      if (it.got) continue
      const tx = S / 2 + (it.x - px) * k, ty = S / 2 + (it.z - pz) * k
      if (tx < 6 || ty < 6 || tx > S - 6 || ty > S - 6) continue
      c.fillStyle = it.strana ? it.strana.barva : '#8aa2b8'
      c.strokeStyle = '#04121e'; c.lineWidth = 2.5
      c.beginPath(); c.arc(tx, ty, 7, 0, 7); c.fill(); c.stroke()
    }
    // cíl pamětihodnosti
    const q = this.q.target
    if (q) {
      const tx = S / 2 + (q.gx - px) * k, ty = S / 2 + (q.gz - pz) * k
      c.fillStyle = '#ffd27a'; c.strokeStyle = '#000'; c.lineWidth = 3
      c.beginPath(); c.arc(clampS(tx, S), clampS(ty, S), 6, 0, 7); c.fill(); c.stroke()
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
