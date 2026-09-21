// shot_mobile.mjs — kontrolní snímky v mobilním režimu.
//
// Dotykové ovládání (knipl vlevo, rozhlížení vpravo) se na počítači nezobrazí,
// takže se nedá zkontrolovat běžným scripts/shot.mjs. Tenhle pustí stránku
// s emulovaným dotykem a svislým displejem.
const PW = process.env.PLAYWRIGHT_CORE
  || '/data/bot/review-tools/node_modules/playwright-core/index.js'
const { chromium } = (await import(PW)).default
import fs from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:5189'
const OUT = '/data/bot/pelhrimov/data/shots'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-dev-shm-usage', '--no-sandbox'],
})
for (const [name, ctxOpts, wait] of [
  ['mobil-uvod', { viewport: { width: 414, height: 840 }, hasTouch: true, isMobile: true,
                   deviceScaleFactor: 2 }, 1500],
  ['mobil-hra', { viewport: { width: 414, height: 840 }, hasTouch: true, isMobile: true,
                  deviceScaleFactor: 2 }, 9000],
]) {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e)))
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction('window.__ready === true', null, { timeout: 180000 })
  await page.waitForTimeout(wait)
  if (name === 'mobil-hra') {
    // prst na levé polovině → knipl se musí rozsvítit a vychýlit
    await page.touchscreen.tap(100, 640)
    await page.waitForTimeout(400)
  }
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${name}  ok`)
  if (errs.length) for (const e of new Set(errs)) console.log('   CHYBA:', e)
  await ctx.close()
}
await browser.close()
