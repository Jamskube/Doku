# scripts

## Purpose
Outillage de build exécuté à la main (résultats committés — rien ne tourne au `npm run build`).

## Files
| File | Purpose |
|---|---|
| `subset-icons.mjs` | Génère le sprite Lucide réduit aux icônes utilisées (`src/assets/icons.svg`, ~25 Ko au lieu de 520 Ko) depuis `lucide-static`, le set du kit Kube. Hors ligne. Sortie committée. |
| `icon-names.mjs` | Extraction des noms d'icônes Lucide depuis les sources — partagée entre le script et le garde-fou `src/lib/icons.test.ts`. |
| `icon-names.d.mts` | Déclaration TypeScript du module ci-dessus (import depuis le test). |
| `build-bgraph-wasm.mjs` | Compile le moteur bgraph local en WebAssembly puis actualise l'artefact committé `public/bgraph.wasm`. |

## Dependencies
- Internal: `src/` (lecture seule, extraction des noms)
- External: `lucide-static` (devDependency) pour `subset-icons.mjs` ; Rust et la cible `wasm32-unknown-unknown` pour `build-bgraph-wasm.mjs`

## Quand régénérer
Le test `icons.test.ts` échoue dès qu'une icône apparaît dans les sources sans être
dans le sprite : lancer `npm run subset:icons`, vérifier visuellement la nouvelle
icône, committer `src/assets/icons.svg`.
