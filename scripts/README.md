# scripts

## Purpose
Outillage de build exécuté à la main (résultats committés — rien ne tourne au `npm run build`).

## Files
| File | Purpose |
|---|---|
| `subset-icons.mjs` | Génère le sous-ensemble Material Symbols (~12 Ko au lieu de 5,1 Mo) via l'API Google Fonts (`icon_names=`) — réseau requis à la régénération uniquement. Sorties committées : `src/assets/material-symbols-rounded.subset.woff2` + `material-symbols-manifest.json`. |
| `icon-names.mjs` | Extraction des noms d'icônes depuis les sources — partagée entre le script et le garde-fou `src/lib/icons.test.ts`. |
| `icon-names.d.mts` | Déclaration TypeScript du module ci-dessus (import depuis le test). |
| `material-symbols-rounded.codepoints` | Table nom → codepoint (dépôt google/material-design-icons) : filtre les faux positifs d'extraction avant l'appel API. |

## Dependencies
- Internal: `src/` (lecture seule, extraction des noms)
- External: réseau (Google Fonts) pour `subset-icons.mjs` uniquement

## Quand régénérer
Le test `icons.test.ts` échoue dès qu'une icône apparaît dans les sources sans être
dans le manifeste : lancer `npm run subset:icons`, vérifier visuellement la nouvelle
icône, committer la police + le manifeste.
