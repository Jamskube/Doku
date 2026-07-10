# Retrospective: Sprint 4

**Date**: 2026-07-10
**Velocity**: 5 completed / 5 planned (100%) + 3 freebies clôturés

## Stats
- Stories complétées : **5/5** (5.1, 5.2, 4.6, 3.6, 3.5)
- Stories reportées : 0
- Blockers rencontrés : 0
- Commits sprint : 6 (`c4ad006` fix protocol-asset → `b5292a4` reload externe)
- Ledger global : **23/23 `passes:true`** — le plan initial (4 sprints) est bouclé

## What Went Well 👍
- **Payoff des décisions d'archi antérieures** : 3.6 (mode source) et 4.6 (TOC) livrées vite car le socle existait déjà (Compartment `livePreviewComp`, `elementAtHeight`). Les stories « formaliser + vérifier » se réduisent à une vérification rigoureuse quand la fondation est bonne.
- **Simplification volontaire sur 3.5** : reload au focus (relecture disque) plutôt que watcher plugin-fs → zéro code Rust, zéro capability nouvelle, mieux aligné ADR-0004. Le PRD disait « au focus » — suivre la lettre du critère a évité de la complexité inutile.
- **Pattern testable maintenu** : logique pure extraite (`reload.ts`, `html.ts`) + tests unitaires + smoke natif pour la partie non-navigateur. 68 tests au total, régression toujours verte.
- **Vérification navigateur systématique** : chaque story browser-testable passée au crible Playwright (curseur au caractère près sur 3.6, navigation d'onglets sur 3.5) avant de flipper le ledger.

## What Didn't Go Well 👎
- **Features natives non testables au navigateur** (3.5, comme 1.5/4.4/2.3 avant) : dépendance au smoke test manuel de l'utilisateur → boucle de validation plus lente que les stories pures. Mitigé par l'extraction de logique pure, mais le cœur natif reste hors CI.
- **Rien de bloquant** : sprint fluide, mais c'est aussi parce qu'il capitalisait sur 3 sprints de fondations — un futur sprint « nouvelles fondations » (PDF, NPU) sera moins linéaire.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| Décider le cap post-plan : nouvelles features (Ctrl+F, wikilink 4.5, export PDF) vs consolidation/polish | High |
| Pour les features natives, préparer un mini-protocole de smoke test réutilisable (checklist) pour accélérer la validation | Medium |
| Envisager un test d'intégration natif léger (Tauri) pour sortir le cœur natif du « tout-manuel » | Low |

## Lessons Learned
→ /start learn workaround: Rafraîchir un éditeur CM6 caché-par-onglet (cache d'`EditorState` par onglet) sans remount : ajouter un compteur `rev` sur l'onglet, le lire dans le `$effect` Svelte, et `setState(makeState(...))` quand `rev` change (invalider aussi le cache des onglets inactifs rechargés). C'est le hook minimal pour pousser un contenu externe dans un éditeur qui ne re-render que sur changement d'id d'onglet.
→ /start learn gotcha: Tauri `getCurrentWindow().onFocusChanged` se déclenche au focus ET au blur — filtrer sur `payload.focused` sinon l'action tourne deux fois par cycle.
→ /start learn gotcha: Un critère PRD précis (« au focus ») peut trancher un choix d'implémentation (relecture au focus vs watcher fs) en faveur du plus simple — lire le critère à la lettre avant de sur-concevoir.
