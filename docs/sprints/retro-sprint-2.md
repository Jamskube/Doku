# Retrospective : Sprint 2

**Date** : 2026-07-09
**Vélocité** : 5 terminées / 5 planifiées (100 %)

## Stats
- Stories terminées : **5/5** (2.3, 1.4, 4.1, 4.2, 2.5) — toutes `passes:true`
- Stories reportées : 0
- Commits : 6 (5 features + 1 fix) · Tests auto : 46 (dont explorer, sanitize, tabs)
- Bugs notables : 1 (fermeture de fenêtre en build **release** uniquement — corrigé)
- Changement d'outillage : happy-dom → jsdom (pour DOMPurify)

## Ce qui a bien marché 👍
- **Logique pure dans des modules testables** (`explorer.ts`, `tabs.ts`, `sanitize.ts`) → couverture unitaire large, plusieurs bugs évités avant le natif.
- **Couche de persistance `settings`** posée en 4.2, immédiatement réutilisée par 2.5 (session) — bon investissement.
- **Rétro S1 appliquée** : aucune itération design/logo n'a pollué le sprint ; smoke tests natifs faits rapidement par l'utilisateur.
- **Découvertes surfacées honnêtement** : 1.4 (aucun rendu HTML de contenu → primitive livrée pour FR-8) plutôt que faux « done ».

## Ce qui a moins bien marché 👎
- **Bug de fermeture visible seulement en release** (frustration utilisateur) : le garde `onCloseRequested` rappelait `close()`, dont la ré-entrance ne se propage pas en profil release. Validé « OK » en dev, cassé en release → il a fallu un build de 4-5 min pour le voir.
- **DOMPurify incompatible happy-dom** : sanitizer qui déstructurait le HTML au lieu de le nettoyer ; diagnostic + bascule jsdom.
- **Coût des allers-retours natifs** : chaque test « réel » (associations, instance unique) passe par un build/install.

## Action items pour le Sprint 3
| Action | Priorité |
|--------|----------|
| Smoke-tester en **build release** (pas seulement dev) tout ce qui touche fenêtre/OS/natif | Haute |
| Garder les modules « logique pure + test unitaire » comme défaut | Moyenne |
| Prévoir le débordement d'onglets (report S1 non traité) | Basse |

## Leçons apprises → à mémoriser
- `/start learn gotcha: Tauri v2 — ne jamais rappeler window.close() depuis un handler onCloseRequested (la ré-entrance ne se propage pas, notamment en profil release → fenêtre qui ne ferme pas). Utiliser window.destroy() (+ permission core:window:allow-destroy) après confirmation.`
- `/start learn gotcha: certains comportements natifs (fermeture de fenêtre, subsystem) diffèrent entre dev (debug) et release — smoke-tester en build release avant de marquer une story fenêtre/OS comme done.`
- `/start learn gotcha: DOMPurify est incompatible avec happy-dom (sanitization dégradée) — tester avec jsdom.`
