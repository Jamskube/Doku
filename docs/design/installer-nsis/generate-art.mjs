// Génère installer-art.html : visuels de l'installateur NSIS en D.A. Doku (tokens AIR),
// rendus à 2× pour un downscale net, polices Geist embarquées en data: URI.
//
// Pipeline complet (voir README.md) :
//   1. node generate-art.mjs            → installer-art.html à côté de ce script
//   2. servir le HTML en localhost, screenshoter #sidebar (328×628) et #header (300×114)
//   3. downscaler en BMP 24-bit : sidebar 164×314, header 150×57 → src-tauri/installer/
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')

const font = (w) =>
  'data:font/woff2;base64,' +
  readFileSync(join(repo, `node_modules/@fontsource/geist-sans/files/geist-sans-latin-${w}-normal.woff2`)).toString('base64')

// Mark Doku (src/assets/doku-mark-rounded.svg) — encre, coin plié en couleur de fond
const mark = (fold) => `<svg viewBox="284 266 490 572" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill="#1C1A16" fill-rule="evenodd" clip-rule="evenodd"
    d="M332 286H520C538 286 548 293 562 307L704 449C735 480 754 532 754 586C754 716 650 818 520 818H332Q304 818 304 790V314Q304 286 332 286M424 370Q396 370 396 398V684Q396 716 428 716H520C596 716 660 655 660 578V458H552V370H424"/>
  <path fill="${fold}" d="M660 458H724L668 472H660Z"/>
</svg>`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Geist'; font-weight: 400; src: url('${font(400)}') format('woff2'); }
  @font-face { font-family: 'Geist'; font-weight: 500; src: url('${font(500)}') format('woff2'); }
  @font-face { font-family: 'Geist'; font-weight: 600; src: url('${font(600)}') format('woff2'); }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #888; font-family: 'Geist', sans-serif; -webkit-font-smoothing: antialiased; }
  /* rendu à 2× : 328×628 et 300×114, downscalés ensuite */
  #sidebar {
    width: 328px; height: 628px; background: #F4F1E9;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  #sidebar .mark { width: 128px; height: 150px; margin-bottom: 40px; }
  #sidebar .word { font-size: 56px; font-weight: 600; color: #1C1A16; letter-spacing: -1px; line-height: 1; }
  #sidebar .tag { font-size: 19px; font-weight: 400; color: rgba(28,26,22,0.62); margin-top: 18px; }
  #sidebar .rule { width: 56px; height: 3px; background: rgba(28,26,22,0.18); border-radius: 2px; margin-top: 44px; }
  /* PAS de numéro de version dans le bitmap : il mentirait au bump suivant */
  #sidebar .ver { position: absolute; bottom: 28px; font-size: 17px; font-weight: 500; color: rgba(28,26,22,0.48); }
  #sidebar .band { position: absolute; top: 0; left: 0; right: 0; height: 8px; background: #1C1A16; }
  #header {
    width: 300px; height: 114px; background: #F4F1E9; margin-top: 24px;
    display: flex; align-items: center; justify-content: flex-end; gap: 16px; padding-right: 26px;
    position: relative; overflow: hidden;
  }
  #header .mark { width: 46px; height: 54px; }
  #header .word { font-size: 40px; font-weight: 600; color: #1C1A16; letter-spacing: -0.5px; }
  #header .band { position: absolute; bottom: 0; left: 0; right: 0; height: 6px; background: #1C1A16; }
</style></head><body>
  <div id="sidebar">
    <div class="band"></div>
    <div class="mark">${mark('#F4F1E9')}</div>
    <div class="word">Doku</div>
    <div class="tag">lire et écrire, sans friction</div>
    <div class="rule"></div>
    <div class="ver">100 % hors-ligne</div>
  </div>
  <div id="header">
    <div class="word">Doku</div>
    <div class="mark">${mark('#F4F1E9')}</div>
    <div class="band"></div>
  </div>
</body></html>`

writeFileSync(join(here, 'installer-art.html'), html)
console.log('OK installer-art.html')
