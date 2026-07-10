# Sprint 5

**Goal** : Ouvrir plus de situations de fichiers, plus souplement — élargir et durcir l'ouverture.
**Start** : 2026-07-10
**End** : 2026-07-17
**Status** : Completed (5/5) — 2026-07-10

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 2.4 | Glisser-déposer de fichiers dans la fenêtre | S | P1 | ✅ Done | `onDragDropEvent` webview (zéro Rust) → `openDropped` (openPath + garde 1.2 / bandeau si non supporté) ; overlay de dépôt ; validé natif |
| 1.2 | Détection d'encodage & fichiers non supportés | S | P1 | ✅ Done | `detectUnsupported` (NUL + ratio U+FFFD) sur dialogue/explorateur/session ; bandeau clair, pas de crash ; PDF/images masqués en amont (voulu) ; validé natif |
| 5.3 | Support `.txt` (éditeur simple) | S | P2 | ✅ Done | `txtExtensions` (CM6 nu, ni markdown ni live preview) branché sur `kind==='txt'` ; monospace ; Plan gated md ; validé Playwright |
| 8.3 | Zéro requête réseau au runtime | S | P1 | ✅ Done | audit code + Playwright (72 req toutes localhost, 0 distant) ; CSP `connect-src 'self' ipc:` ajoutée ; validé natif |
| 1.6 | Gros fichiers (≥ ~2 Mo) réactifs | M | P1 | ✅ Done | `heavy` (> 1,5 M chars) → mode source léger + scroll-spy/Plan gatés (docHeadings O(doc) était la cause du gel) ; notice + « Afficher l'aperçu » ; validé Playwright (doc 1,9 Mo, scroll 34ms/20) |

## Blockers
_None_

## Progress Log
### 2026-07-10 — 1.6
- **1.6** ✅ **Done** : gros fichiers réactifs. Diagnostic — le live-preview est déjà viewport-scopé (peu coûteux) ; la vraie cause du gel = `updateActiveHeading` appelant `docHeadings(content)` (split O(doc)) **à chaque scroll**, + le panneau Plan O(doc). Correctif : flag `heavy` (`content.length > 1,5 M`, `HEAVY_THRESHOLD`) sur `DocTab` (openTab) → l'onglet s'ouvre en **mode source léger** (`baseExtensions(sourceMode||heavy)`, pas de widgets), le **scroll-spy et le Plan sont gatés `!heavy`**. Notice « Fichier volumineux — mode source · [Afficher l'aperçu] » → `forcePreview` (heavy=false + rev++ → rebuild). Validé Playwright avec un doc généré ~1,9 Mo : source-light (0 déco live-preview), **scroll 34 ms / 20 events** (vs O(doc) sinon), Plan vide, forcePreview bascule sans gel ; non-régression notes.md (preview + Plan 4 titres). Limite connue : la sérialisation O(doc) à la frappe reste (édition d'énorme fichier), hors périmètre gel-lecture.

### 2026-07-10 — 8.3
- **8.3** ✅ **Done** (validé natif) : audit — aucun `fetch`/XHR/WebSocket/telemetry (JS), aucun réseau Rust (pas de reqwest/updater), plugins locaux, polices `@fontsource`/`material-symbols` en fichiers **locaux bundlés**. Preuve Playwright : usage complet → **72 requêtes toutes `localhost`, 0 hôte distant**. Durcissement : `security.csp` = `connect-src 'self' ipc: http://ipc.localhost; object-src 'none'` (bloque tout fetch/XHR/WS distant ; volontairement sans `default-src`/`script-src`/`frame-src` pour ne pas casser polices/`srcdoc`/asset-protocol/IPC). Validé natif : app pleinement fonctionnelle sous CSP.

### 2026-07-10 — 2.4
- **2.4** ✅ **Done** (validé natif) : glisser-déposer via `onDragDropEvent` du webview Tauri (`onFileDrop`, **zéro Rust**). Chaque chemin lâché → `openDropped` : extension supportée → `openPath` (dédup onglet existant + garde binaire/encodage 1.2) ; sinon bandeau « format non pris en charge » (un dépôt est explicite, contrairement au masquage de l'explorateur). Overlay de dépôt (bordure pointillée + « Déposez le fichier pour l'ouvrir ») piloté par enter/over/leave. Validé natif : drop simple/multiple, format non supporté → bandeau, dédup.

### 2026-07-10 — 1.2
- **1.2** ✅ **Done** (validé natif) : `detectUnsupported(content, name)` — garde octet NUL (binaire) + ratio U+FFFD > 2% (encodage non-UTF-8), module pur `encoding.ts` (6 tests). Câblé sur les 3 chemins d'ouverture : dialogue (`openFromDialog`), explorateur/wikilink/association (`openPath`, avec try/catch sur le throw UTF-8 de Tauri), restauration de session (garde + **bug latent corrigé** : un fichier illisible ne casse plus la boucle). Fichier non affichable → bandeau clair, aucun onglet-garbage. **Décision** : les formats non supportés (PDF/images) restent **masqués** en amont (dialogue + `visibleEntries`) — voulu ; PDF = v2. Validé natif : `binaire-test.txt` (NUL) et `latin1-test.txt` → bandeaux ; `.md` UTF-8 OK.

### 2026-07-10 — Critique impeccable + passe design (hors-sprint)
- `/impeccable init` : PRODUCT.md + config live mode écrits (register product, plateforme web).
- `/impeccable critique DocumentView` (dual-agent) : **25/40**. A déterré un **P0 réel manqué par la vérif 3.6** — `Ctrl+/` déclenchait aussi `toggleComment` de CodeMirror quand l'éditeur avait le focus → commentait la ligne + salissait le doc. **Corrigé** (`suppressToggleComment`, `Prec.highest` no-op dans `editor.ts`), re-vérifié éditeur focus. Ledger 3.6 `verified_by` mis à jour.
- Passe design (P1/P2 de la critique) : rendu HTML stylé (feuille de base AIR threadée au thème dans `sandboxDoc`), dark `--surface` distinct de `--cream-content` (blocs code visibles), ring `:focus-visible` global AIR, texte `--ink-5`→`--ink-4` (contraste ≥4,5:1). Validé Playwright (light+dark).
- **Re-critique : 25 → 27/40, P0 éliminé.** 2e passe sur les findings restants : rendu HTML obéit à `--doc-width` + s'aligne à la caption (P1) ; ouverture de fichier échouée → bandeau + garde binaire NUL (P2, amorce 1.2) ; indicateur « non enregistré » discret en mode focus (P2) ; token `--code-bg` dédié (blocs code plus détachés), cibles ≥24px (onglet close, boutons bandeau), shortcuts dans l'état vide, séparateur `--ink-5`→`--ink-4` (P3). Validé Playwright (largeurs HTML, dot focus, état vide).

### 2026-07-10 — 5.3
- **5.3** ✅ **Done** : `.txt` en éditeur CM6 nu. `txtExtensions()` (minimalSetup + lineWrapping + thème, **sans markdown/live-preview/coloration**) branché dans `makeState` sur `kind==='txt'` ; rendu monospace (classe `.txt`). Le panneau Plan et le scroll-spy sont gated `kind==='md'` (pas de faux titre sur un `.txt`/`.html`). Onglet de démo `courses.txt`. Round-trip assuré par `serializeDoc`/`detectLineEnding` (kind-agnostiques). Validé Playwright : texte brut (`#`/`**` littéraux, 0 déco live-preview), monospace, Plan vide sur txt / 4 titres sur md, édition→dirty. 68 tests + `svelte-check` 0 erreur.

### 2026-07-10
- Sprint initialisé : 5 stories (4 P1, 1 P2) issues du backlog restant (epics.md)
- Écartées volontairement : Ctrl+F, export, PDF, NPU — différées v1.5/v2 (pas de critère d'acceptance ; nécessitent `/gate` ou cadrage avant d'entrer au backlog)
- Rappels process (rétros S1-S4) : design hors stories ; logique pure → tests unitaires ; smoke-tester en natif/release tôt ; privilégier le browser-testable
