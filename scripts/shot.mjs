// shot.mjs — kontrolní snímky běžící hry.
//   node scripts/shot.mjs [pohled ...]     (výchozí: všechny)
// Renderuje se v headless Chromiu přes SwiftShader, takže FPS z něj NEČTI —
// slouží jen k tomu, aby šlo vidět, jak město vypadá, bez otevírání prohlížeče.
// Playwright tu není závislostí projektu — bere se z toho, co je na stroji.
// Jinou cestu lze podstrčit přes PLAYWRIGHT_CORE.
const PW = process.env.PLAYWRIGHT_CORE
  || '/data/bot/review-tools/node_modules/playwright-core/index.js'
const { chromium } = (await import(PW)).default
import fs from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:5189'
const OUT = '/data/bot/pelhrimov/data/shots'
const views = process.argv.slice(2).length ? process.argv.slice(2)
  : ['namesti', 'nadhled', 'ulice', 'brana', 'hradby']

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-dev-shm-usage', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } })
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', e => errs.push(String(e)))

for (const v of views) {
  const t0 = Date.now()
  await page.goto(`${BASE}/?cam=${v}`, { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction('window.__ready === true', null, { timeout: 180000 })
  await page.waitForTimeout(2500)          // pár snímků, ať doběhne stínová mapa
  await page.screenshot({ path: `${OUT}/${v}.png` })
  const s = await page.evaluate('window.__stats()')
  console.log(`${v.padEnd(9)} ${((Date.now() - t0) / 1000).toFixed(1)}s  ` +
              `${s.houses} domů, ${s.tris.toLocaleString('cs')} trojúhelníků`)
}
if (errs.length) { console.log('\nCHYBY V KONZOLI:'); for (const e of new Set(errs)) console.log('  ', e) }
await browser.close()
