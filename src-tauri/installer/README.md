# installer

## Purpose
Habillage de l'installateur NSIS en D.A. Doku (crème/encre AIR). Branché dans `tauri.conf.json` → `bundle.windows.nsis`.

## Files
| File | Purpose |
|---|---|
| `installer.nsi` | Template NSIS custom — copie FIGÉE du template officiel **tauri-cli 2.11.4**, blocs modifiés marqués `; DOKU:`. **Re-diff obligatoire à chaque upgrade du CLI** |
| `sidebar.bmp` | Bandeau 164×314 des pages accueil/fin (BMP 24-bit) |
| `header.bmp` | En-tête 150×57 des pages intermédiaires (BMP 24-bit) |

Recette de régénération des visuels et procédure de re-diff : `docs/design/installer-nsis/README.md`.

## Dependencies
- Internal: `docs/design/installer-nsis/generate-art.mjs` (générateur des BMP)
- External: NSIS (via tauri-cli), `@fontsource/geist-sans` (au moment de la génération)
