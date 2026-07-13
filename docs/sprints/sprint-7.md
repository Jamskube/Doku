# Sprint 7

**Goal** : Livrer la dernière feature v1 (widgets interactifs tableaux/images) et formaliser les comportements fonctionnels non tracés → **v1 feature-complete**.
**Start** : 2026-07-10
**End** : 2026-07-17
**Status** : Completed

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 3.7 | Widgets tableaux & images (rendu + édition source au clic) | L | ✅ Done | `StateField` `tableField` (block-widget) + clic-pour-éditer (`mousedown` dans `toDOM`). `code-reviewer` Approve, Major corrigé (alignement frontières de ligne). Validé natif utilisateur (2026-07-13) |
| 3.1 | Formaliser l'édition live preview (vérif + ledger) | S | ✅ Done | Playwright : `#` révélé au curseur / re-masqué à la sortie, édition en place → dirty ; validé (2026-07-10) |
| 4.3 | Formaliser « non supportés masqués » (vérif + ledger) | S | ✅ Done | `image.png` masqué dans l'explorateur démo + tests unitaires ; validé (2026-07-10) |

## Blockers
_None_

## Progress Log
### 2026-07-10
- Sprint initialisé avec 3 stories (dernière P1 + 2 formalisations). Vélocité cible ~5-6 pts.
- Risque principal : **3.7** (WidgetType CM6 pour tableaux + clic-pour-éditer-la-source) — mini-cadrage en début de story ; 3.1/4.3 = soupape si 3.7 déborde.
- Après ce sprint : v1 feature-complete → cap suivant = v1.5/v2 (`/gate feasibility`).
- **3.1 ✅ + 4.3 ✅** (formalisations) : live preview (révélation syntaxe au curseur / re-masquage à la sortie, édition en place) et non-supportés masqués (`image.png` absent de l'explorateur) — vérifiés Playwright + tests unitaires, ledgerisés. Reste **3.7**.

### 2026-07-13
- **3.7 ✅** validé en natif par l'utilisateur (tableau → rendu widget ; clic → source `| … |` éditable ; image → source `![...]`). Commit `90cb91d`.
- **Sprint 7 clos : 3/3 (100%). Ledger 35/35 → v1 feature-complete.** Retro : `retro-sprint-7.md` (3 gotchas CM6 capturés dans AGENTS.md).
