# Habillage de l'installateur NSIS

## Purpose
Habillage complet de l'installateur Windows (NSIS/MUI2) en D.A. Doku — tokens AIR (crème `#F4F1E9`, encre `#1C1A16`, papier `#FDFBF5`), mark « D » au coin plié, police Geist. Deux étages :
1. **Images** : `src-tauri/installer/sidebar.bmp` (164×314, pages accueil/fin) et `header.bmp` (150×57, pages intermédiaires), branchées dans `tauri.conf.json` → `bundle.windows.nsis` (avec `installerIcon` + langue `French`).
2. **Template NSIS custom** : `src-tauri/installer/installer.nsi` (option `template`), basé sur le template officiel **tauri-cli v2.11.4**, modifications marquées `; DOKU:` — fonds crème/encre partout (`MUI_BGCOLOR`/`MUI_TEXTCOLOR`, `SetCtlColors` sur les dialogues internes, page « déjà installé » nsDialogs comprise), journal d'installation « papier » (`MUI_INSTFILESPAGE_COLORS`), pied de fenêtre « Doku — lire et écrire, sans friction » (`BrandingText`), en-tête du désinstalleur aligné.

**Limite assumée** : boutons, checkbox et barre de progression restent des contrôles Win32 natifs (pas re-stylables proprement sans plugins fragiles).

⚠️ **À chaque upgrade du CLI Tauri** : re-diff le template contre la nouvelle version officielle (`crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi` au tag `tauri-cli-vX.Y.Z`) et re-porter les blocs `; DOKU:`. Un template périmé peut casser l'installateur silencieusement. Les chaînes accentuées du template passent par les échappements `${U+XXXX}` (jamais d'accents bruts dans une string NSIS).

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
