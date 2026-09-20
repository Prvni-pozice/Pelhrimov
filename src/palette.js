// palette.js — typy bloků a jejich barvy.
//
// Vzhled míří na Roblox, ne na Minecraft: matné plastové plochy, čisté a spíš
// sytější barvy než ve skutečnosti, žádné textury. Členitost dělá geometrie
// a spékané stínění v rozích (AO), ne obrázky. Každý blok má jednu barvu;
// jemný šum se přidává až při meshování, aby velké plochy nebyly mrtvé.

export const AIR = 0

// id → { c: barva (hex), n: rozptyl šumu 0..1, s: "drsnost" pro materiál }
export const BLOCKS = {
  // ── terén a povrchy ────────────────────────────────────────────────
  1:  { name: 'trava',       c: 0x7cb85c, n: 0.055 },
  2:  { name: 'hlina',       c: 0x8a6a48, n: 0.05 },
  3:  { name: 'skala',       c: 0x8e8c88, n: 0.045 },
  4:  { name: 'dlazba',      c: 0xa9a29a, n: 0.05 },  // kočičí hlavy na náměstí
  5:  { name: 'asfalt',      c: 0x6e6e72, n: 0.03 },
  6:  { name: 'sterk',       c: 0xb0a48c, n: 0.06 },
  7:  { name: 'voda',        c: 0x4f8fd0, n: 0.02 },
  8:  { name: 'chodnik',     c: 0xbdb6ab, n: 0.035 },

  // ── stavební hmota ─────────────────────────────────────────────────
  10: { name: 'omitka',      c: 0xefe4cd, n: 0.03 },  // barvu přepisuje dům
  11: { name: 'sokl',        c: 0x9a9088, n: 0.04 },
  12: { name: 'kamen',       c: 0x9c948a, n: 0.05 },  // hradby, ostění
  13: { name: 'strecha',     c: 0x9c4f39, n: 0.045 },
  14: { name: 'strecha_hreben', c: 0x8a4230, n: 0.04 },
  15: { name: 'rimsa',       c: 0xf6f1e6, n: 0.02 },
  16: { name: 'sklo',        c: 0x6f8fa6, n: 0.02, glass: true },
  17: { name: 'ramy',        c: 0xf2efe6, n: 0.02 },  // okenní rámy
  18: { name: 'dvere',       c: 0x6b452c, n: 0.03 },
  19: { name: 'drevo',       c: 0x8a6239, n: 0.05 },
  20: { name: 'plech',       c: 0x6d7a80, n: 0.03 },  // plechové střechy, věže
  21: { name: 'stit',        c: 0xe8dcc4, n: 0.03 },  // štítová zeď nad římsou

  // ── zeleň a mobiliář ───────────────────────────────────────────────
  30: { name: 'kmen',        c: 0x6b4c31, n: 0.05 },
  31: { name: 'koruna',      c: 0x5f9b48, n: 0.08 },
  32: { name: 'kere',        c: 0x6ba554, n: 0.07 },
  33: { name: 'lampa',       c: 0x3a3a3e, n: 0.02 },
  34: { name: 'svetlo',      c: 0xffe9a8, n: 0.0, emissive: true },
  35: { name: 'lavicka',     c: 0x9a6f42, n: 0.04 },
  36: { name: 'kasna',       c: 0xa8a49c, n: 0.04 },
  37: { name: 'zabradli',    c: 0x4a4a50, n: 0.02 },
}

/** Doporučený blok povrchu pro materiál ulice z OSM. */
export const ROAD_BLOCK = { sett: 4, paved: 5, gravel: 6 }

/** Doporučený blok pro plochu z OSM. */
export const AREA_BLOCK = { water: 7, forest: 1, grass: 1, paved: 8 }

export function blockColor(id) {
  const b = BLOCKS[id]
  return b ? b.c : 0xff00ff
}

export function isGlass(id) { return !!(BLOCKS[id] && BLOCKS[id].glass) }
export function isSolid(id) { return id !== AIR && id !== 7 }   // voda se nepočítá jako pevná
