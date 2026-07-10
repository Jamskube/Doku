# Sprint 5

**Goal** : Ouvrir plus de situations de fichiers, plus souplement — élargir et durcir l'ouverture.
**Start** : 2026-07-10
**End** : 2026-07-17
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 2.4 | Glisser-déposer de fichiers dans la fenêtre | S | P1 | TODO | événement drop Tauri/webview → openPath ; partiellement testable navigateur |
| 1.2 | Détection d'encodage & fichiers non supportés | S | P1 | TODO | non-UTF-8/binaire → message clair, sans planter ni corrompre |
| 5.3 | Support `.txt` (éditeur simple) | S | P2 | ✅ Done | `txtExtensions` (CM6 nu, ni markdown ni live preview) branché sur `kind==='txt'` ; monospace ; Plan gated md ; validé Playwright |
| 8.3 | Zéro requête réseau au runtime | S | P1 | TODO | monitorer le réseau à l'exécution → aucune requête (polices/assets bundlés) |
| 1.6 | Gros fichiers (≥ ~2 Mo) réactifs | M | P1 | TODO | pas de gel > 200 ms ; proposer bascule mode source au-delà d'un seuil |

## Blockers
_None_

## Progress Log
### 2026-07-10 — Critique impeccable + passe design (hors-sprint)
- `/impeccable init` : PRODUCT.md + config live mode écrits (register product, plateforme web).
- `/impeccable critique DocumentView` (dual-agent) : **25/40**. A déterré un **P0 réel manqué par la vérif 3.6** — `Ctrl+/` déclenchait aussi `toggleComment` de CodeMirror quand l'éditeur avait le focus → commentait la ligne + salissait le doc. **Corrigé** (`suppressToggleComment`, `Prec.highest` no-op dans `editor.ts`), re-vérifié éditeur focus. Ledger 3.6 `verified_by` mis à jour.
- Passe design (P1/P2 de la critique) : rendu HTML stylé (feuille de base AIR threadée au thème dans `sandboxDoc`), dark `--surface` distinct de `--cream-content` (blocs code visibles), ring `:focus-visible` global AIR, texte `--ink-5`→`--ink-4` (contraste ≥4,5:1). Validé Playwright (light+dark).

### 2026-07-10 — 5.3
- **5.3** ✅ **Done** : `.txt` en éditeur CM6 nu. `txtExtensions()` (minimalSetup + lineWrapping + thème, **sans markdown/live-preview/coloration**) branché dans `makeState` sur `kind==='txt'` ; rendu monospace (classe `.txt`). Le panneau Plan et le scroll-spy sont gated `kind==='md'` (pas de faux titre sur un `.txt`/`.html`). Onglet de démo `courses.txt`. Round-trip assuré par `serializeDoc`/`detectLineEnding` (kind-agnostiques). Validé Playwright : texte brut (`#`/`**` littéraux, 0 déco live-preview), monospace, Plan vide sur txt / 4 titres sur md, édition→dirty. 68 tests + `svelte-check` 0 erreur.

### 2026-07-10
- Sprint initialisé : 5 stories (4 P1, 1 P2) issues du backlog restant (epics.md)
- Écartées volontairement : Ctrl+F, export, PDF, NPU — différées v1.5/v2 (pas de critère d'acceptance ; nécessitent `/gate` ou cadrage avant d'entrer au backlog)
- Rappels process (rétros S1-S4) : design hors stories ; logique pure → tests unitaires ; smoke-tester en natif/release tôt ; privilégier le browser-testable
