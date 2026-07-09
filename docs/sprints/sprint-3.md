# Sprint 3

**Goal** : Lire comme un document fini — rendu riche (code coloré, images), wikilinks navigables, et confort de lecture (largeur, focus).
**Start** : 2026-07-09
**End** : 2026-07-16
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 1.3 | Rendu GFM : coloration des blocs de code | M | P0 | ✅ Done | Coloration déjà via `codeLanguages` ; `dokuHighlight` enrichi (types/fonctions/propriétés/opérateurs/bool) ; validé JS + TS (Playwright) |
| 1.5 | Images locales (relatives + placeholder) | S | P1 | TODO | résoudre `![](rel.png)` au dossier du fichier via convertFileSrc ; placeholder discret si manquante |
| 4.4 | Résolution & navigation des wikilinks | M | P1 | Review | `wikilink.ts` (`normalizeTarget`/`matchWikilink`, 7 tests) + `scanFiles` récursif ; clic → onglet ouvert (validé Playwright) ou fichier du dossier (scan disque = smoke test natif) |
| 6.2 | Largeur de colonne réglable (3 crans) | S | P1 | ✅ Done | Variable `--doc-width` (680/820/none) pilotée par bouton doc-head ; persistée (settings) ; validé Playwright |
| 6.3 | Mode focus (masque le chrome) | S | P1 | ✅ Done | `app.focus` (transitoire) ; F9 bascule, Échap sort ; masque titlebar/sidebar/doc-head/bannière ; validé Playwright |

## Blockers
_None_

## Progress Log
### 2026-07-09
- Sprint initialisé avec 5 stories (1 P0, 4 P1) — thème « lecture riche + confort »
- Hors périmètre volontaire : 3.7 (widgets tableaux WYSIWYG, L) → futur sprint « éditeur riche »
- Freebies acquis au S2 à formaliser à l'occasion : 6.1 (thème persistant), 8.1 (build ARM64), 8.2 (installateur + associations)
- Rappels process (rétros) : design/UI hors stories ; smoke-tester en **release** pour tout ce qui touche fenêtre/OS ; logique pure → tests unitaires

### 2026-07-09 — 6.3
- **6.3** ✅ **Done** : `app.focus` (transitoire, non persisté). F9 bascule, Échap sort (gérés dans `onKey` avant le check des modificateurs, après le guard `dialog.open`). App masque `<TitleBar>`/`<Sidebar>`/bannière via `{#if !app.focus}` ; DocumentView masque le doc-head. Ne reste que l'éditeur. Validé Playwright : F9 → chrome absent + éditeur présent ; Échap → tout restauré.

### 2026-07-09 — 6.2
- **6.2** ✅ **Done** : 3 crans de largeur via variable CSS `--doc-width` (narrow 680px / wide 820px / full none) consommée par `.cm-content` (editor.ts) + `.doc-head`. Bouton cycleur dans le doc-head (icônes `width_normal/wide/full`). Intégré à la couche settings (`applyColumnWidth`, persisté). Validé Playwright : cycle immédiat + persistance au reload.

### 2026-07-09 — 4.4
- **4.4** → Review : résolveur `wikilink.ts` (`normalizeTarget` enlève ancre/extension/casse ; `matchWikilink` cherche dans une liste, préfère `.md` — 7 tests) ; `scanFiles` (readDir récursif borné, natif) dans `tauri.ts` ; `openWikilink` (store) : onglet ouvert du même nom sinon fichier du dossier du doc actif (+ sous-dossiers) → `openPath`. Handler App branché sur `doku:wikilink`. Validé Playwright : `[[idées]]` → active l'onglet idées.md. Reste : ouvrir un fichier **pas encore ouvert** via scan disque (natif). Création si absent = 4.5.

### 2026-07-09 — 1.3
- **1.3** ✅ **Done** : la coloration de base existait déjà (`markdown({ codeLanguages })` + `dokuHighlight`). Enrichi `dokuHighlight` (WYSIWYG) : types/classes (ink-2 gras), fonctions/méthodes (gras), propriétés/variables (ink-2), opérateurs/ponctuation (ink-3), bool/atom/constantes (warn), regexp/escape (ok). Validé Playwright sur **JS** et **TypeScript** (chargement lazy du langage OK). Tableaux WYSIWYG → 3.7 (hors sprint).
