# Retrospective : Sprint 3

**Date** : 2026-07-09
**Vélocité** : 5 codées / 5 planifiées (100 %) — **3 vérifiées** (1.3, 6.2, 6.3), **2 en Review** (4.4, 1.5, validation native en attente)

## Stats
- Stories codées : **5/5** (1.3, 4.4, 6.2, 6.3, 1.5)
- Vérifiées au ledger : 3 · en Review (natif à valider) : 2
- Reportées : 0
- Commits : 5 · Tests auto : 59 (dont wikilink, images)
- Bugs notables : 1 (widget image CM6 qui disparaissait — réconciliation DOM)

## Ce qui a bien marché 👍
- **Beaucoup de stories testables en navigateur** (1.3, 6.2, 6.3) → itération rapide, moins de builds release (frustration du S2 adressée).
- **Réutilisation des couches posées avant** : settings (6.2 largeur), explorer/scanFiles (4.4 wikilinks).
- **Logique pure → tests unitaires** (wikilink, images = 13 tests) : résolution validée sans natif.
- **Découverte** : la coloration de code (1.3) existait déjà via `codeLanguages` — enrichissement plutôt que réécriture.

## Ce qui a moins bien marché 👎
- **Widget image CM6** : le placeholder disparaissait — `img.replaceWith(ph)` mute le DOM hors du contrôle de CodeMirror, qui le clobber à la réconciliation. Debug via inspection du DOM (`cm-widgetBuffer` sans widget) → correctif conteneur stable.
- **2 stories en Review** (4.4, 1.5) restent à valider en natif (scan disque / vraie image) — pas bloquant mais le sprint n'est pas 100 % vert au ledger.

## Action items pour le Sprint 4
| Action | Priorité |
|--------|----------|
| Valider 4.4 + 1.5 en natif (puis flipper le ledger) | Haute |
| Continuer à privilégier le browser-testable dans la planification | Moyenne |
| Garder logique pure + tests unitaires comme défaut | Moyenne |

## Leçons apprises → à mémoriser
- `/start learn gotcha: CodeMirror 6 — ne pas muter le DOM d'un WidgetType via replaceWith (CM6 le réconcilie/clobber). Retourner un conteneur stable (span) et muter SON contenu/classe (ex. img → placeholder à l'erreur de chargement).`
