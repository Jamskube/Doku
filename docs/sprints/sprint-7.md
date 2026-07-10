# Sprint 7

**Goal** : Livrer la dernière feature v1 (widgets interactifs tableaux/images) et formaliser les comportements fonctionnels non tracés → **v1 feature-complete**.
**Start** : 2026-07-10
**End** : 2026-07-17
**Status** : Active

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 3.7 | Widgets tableaux & images (rendu + édition source au clic) | L | TODO | Story la plus dure. Images déjà en widget (1.5) ; reste tableaux + clic-pour-éditer. Piège CM6 : **ne pas muter le DOM d'un widget via `replaceWith`** (AGENTS.md) — conteneur stable + reconfigure |
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
