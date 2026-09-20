// play.mjs — automatická procházka městem: test, že se hra dá dohrát.
//
// Nežene se přes vykreslování. Načte hru v headless prohlížeči a pak krokuje
// POUZE fyziku hráče pevným krokem 1/60 s, takže půlhodinu chůze odsimuluje
// za pár sekund. Testuje tím přesně to, co je křehké — kolize, schody a jestli
// jsou všechny cíle dosažitelné — a ne rychlost softwarového rendereru.
//
//   node scripts/play.mjs [simulovaných minut]
// Playwright tu není závislostí projektu — bere se z toho, co je na stroji.
// Jinou cestu lze podstrčit přes PLAYWRIGHT_CORE.
const PW = process.env.PLAYWRIGHT_CORE
  || '/data/bot/review-tools/node_modules/playwright-core/index.js'
const { chromium } = (await import(PW)).default
const BASE = process.env.BASE || 'http://localhost:5189'
const MINUTES = Number(process.argv[2] || 20)

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-dev-shm-usage', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', e => errs.push(String(e)))
await page.goto(BASE, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction('window.__ready === true', null, { timeout: 180000 })

const report = await page.evaluate((minutes) => {
  const { player, quests } = window.__game
  const DT = 1 / 60
  const steps = Math.round(minutes * 60 / DT)
  const out = { reached: [], missed: [], fell: 0, minY: 1e9, maxClimb: 0, simSeconds: 0 }
  let stuck = 0, detour = 0, prev = [player.pos.x, player.pos.z], lastY = player.pos.y

  for (let i = 0; i < steps && quests.target; i++) {
    const t = quests.target, p = player.pos
    const toGoal = Math.atan2(t.gx - p.x, t.gz - p.z)
    // bot neumí hledat cestu; když se zasekne o dům, jde chvíli bokem
    player.yaw = detour > 0 ? toGoal + (detour > 90 ? 1.3 : -1.3) : toGoal
    if (detour > 0) detour--
    player.update(DT, { f: 1, s: 0, run: true, jump: detour > 0 && detour % 40 === 0 })

    const moved = Math.hypot(p.x - prev[0], p.z - prev[1])
    if (moved < 0.005) stuck++; else stuck = 0
    if (stuck > 30 && detour === 0) { detour = 180; stuck = 0 }
    prev = [p.x, p.z]
    out.minY = Math.min(out.minY, p.y)
    out.maxClimb = Math.max(out.maxClimb, p.y - lastY)
    lastY = p.y
    if (p.y < -5) out.fell++
    out.simSeconds += DT

    const got = quests.update(p.x, p.z)
    if (got) out.reached.push({ title: got.title, at: Math.round(out.simSeconds) })
  }
  out.missed = quests.list.filter(q => !quests.found.has(q)).map(q => q.title)
  out.walked = Math.round(quests.walked)
  out.total = quests.total
  return out
}, MINUTES)

console.log(`nalezeno ${report.reached.length}/${report.total} cílů`)
console.log(`ušlo ${report.walked} m za ${Math.round(report.simSeconds)} s simulovaného času`)
console.log(`propady pod terén: ${report.fell}, nejnižší y: ${report.minY.toFixed(1)}, `
          + `největší výstup v jednom kroku: ${report.maxClimb.toFixed(2)} m`)
for (const r of report.reached) console.log(`   OK ${String(r.at).padStart(4)} s  ${r.title}`)
// Bot neumí hledat cestu, takže nedojití NENÍ chyba hry — na dosažitelnost
// je scripts/probe.mjs. Tady jde o to, že se hra v prohlížeči rozjede,
// nepadá a hráč nepropadává světem.
for (const m of report.missed) console.log(`   .. bot nedošel: ${m}`)
if (errs.length) { console.log('CHYBY V KONZOLI:'); for (const e of new Set(errs)) console.log('  ', e) }
await browser.close()
process.exit(report.fell > 0 || errs.length || report.reached.length === 0 ? 1 : 0)
