# Habillage de l'installateur NSIS

## Purpose
Visuels de l'installateur Windows (NSIS/MUI2) en D.A. Doku — tokens AIR (crème `#F4F1E9`, encre `#1C1A16`), mark « D » au coin plié, police Geist. Produits finaux : `src-tauri/installer/sidebar.bmp` (164×314, pages accueil/fin) et `src-tauri/installer/header.bmp` (150×57, pages intermédiaires), branchés dans `tauri.conf.json` → `bundle.windows.nsis` (avec `installerIcon` + langue `French`).

## Files
| File | Purpose |
|---|---|
| `generate-art.mjs` | Génère `installer-art.html` (visuels à 2×, fonts Geist inlinées en data: URI) |

## Régénérer (au rebrand — PAS au bump de version : aucun numéro n'est gravé dans les bitmaps, exprès)
1. `node docs/design/installer-nsis/generate-art.mjs`
2. Servir `installer-art.html` en localhost (port libre, **jamais 1420**) et screenshoter `#sidebar` (328×628) et `#header` (300×114) en PNG, échelle CSS.
3. Downscaler en **BMP 24-bit** (GDI+ `Format24bppRgb`, interpolation bicubique HQ) : sidebar → 164×314, header → 150×57, dans `src-tauri/installer/`.
4. `npm run tauri build` et vérifier l'installateur.

NSIS exige du BMP (pas de PNG) ; le rendu 2× + downscale donne l'anticrénelage propre.

## Dependencies
- Internal: `src/assets/doku-mark-rounded.svg` (mark, recopié dans le script), tokens de `src/app.css`
- External: `@fontsource/geist-sans` (node_modules)
