# Retrospective: Sprint 7

**Date**: 2026-07-13
**Velocity**: 3 completed / 3 planned (100%)

## Stats
- Stories completed: 3 — **3.7** (widgets tableaux/images, L), **3.1** (formaliser live preview, S), **4.3** (formaliser non-supportés masqués, S)
- Stories carried over: 0
- Blockers encountered: 0
- Fenêtre sprint : 2026-07-10 → 2026-07-17 (livré le 07-13, en avance) — objectif **v1 feature-complete atteint (ledger 35/35)**

## What Went Well 👍
- **Séquençage risque-d'abord** : la story dure (3.7) cadrée en premier, les 2 formalisations (3.1/4.3) en soupape. Elles ont fermé des trous de suivi P0 (live preview jamais ledgerisé) **sans écrire de code**.
- **Revue adversariale payante sur 3.7** : `code-reviewer` a attrapé un vrai **Major** (block-replace non aligné sur les frontières de ligne → casse sur tableau indenté) **avant** le smoke natif.
- **Honnêteté du ledger tenue** : 3.7 est resté `passes: false` jusqu'à la validation native **réelle**, malgré une vérif navigateur déjà verte — pas de flip anticipé.
- **Triple couche de vérif** : tests purs (`parseTable` 7 tests) + Playwright (rendu + clic-pour-éditer + re-rendu) + smoke natif utilisateur. 113 tests verts, 0 régression.

## What Didn't Go Well 👎
- **3.7 a coûté 2 refontes d'approche CM6** avant de tenir : `ViewPlugin` → `StateField` (block-replace), puis ré-ancrage sur les frontières de ligne. Coût d'apprentissage de l'API décoration-bloc.
- **Clic-pour-éditer d'abord cassé** : un `domEventHandlers` global ne capte pas fiablement le clic sur un widget → détour par un listener `mousedown` dans `toDOM(view)`.
- **Cellules de tableau en texte brut** (formatage inline hors scope) : compromis v1 assumé, mais limite le WYSIWYG.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| Capturer les 3 gotchas CM6 block-widget dans AGENTS.md (**fait dans cette retro**) | High |
| Cadrer le cap v1.5/v2 via `/gate feasibility` avant d'attaquer (recherche, export, PDF, copilote NPU) | Medium |
| Envisager le formatage inline des cellules de tableau en v1.5 | Low |

## Lessons Learned
→ /start learn gotcha: CM6 — un `ViewPlugin` ne peut pas fournir de décoration `replace` block-level / traversant plusieurs lignes ; passer par un `StateField` (widget-bloc, ex. tableau dans `live-preview.ts`)
→ /start learn gotcha: CM6 — un block-replace doit être aligné sur des **frontières de ligne** ; les nœuds bloc Lezer démarrent **après l'indentation** (mi-ligne) → ancrer sur `doc.lineAt(node.from).from` / `.to`
→ /start learn gotcha: CM6 — le **clic sur un widget** se capte via un listener `mousedown` **dans `toDOM(view)`** (motif `CheckboxWidget`), pas un `domEventHandlers` global (qui ne le voit pas fiablement)
