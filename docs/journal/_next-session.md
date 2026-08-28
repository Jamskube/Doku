# Next session pointer
_Updated: 2026-08-27 11:32_

## Where I left off

Le mode Diagramme de Doku-San est implémenté mais pas encore commité. OpenAI et MiniMax passent désormais par un studio cloud multi-passe : brief factuel, 2–3 genres bgraph distincts, génération par deux ouvriers, validation locale, critique indépendante, raffinement optionnel et persistance de toutes les variantes. La carte permet de comparer puis sélectionner une autre vue sans nouvelle génération ; Ollama conserve le pipeline simple à vue unique. La documentation du choix se trouve dans `docs/adr/0028-diagrammes-bgraph-wasm.md` et le plan dans `docs/plans/diagrammes-doku-san.md`.

## Open work

- Branch: `main` — **48 entrées de travail non commitées** ; elles regroupent le chantier précédent de recherche Web/mémoire, le nouveau chantier diagrammes et ce journal, donc le staging devra rester délibéré.
- Open PRs: aucune.
- Drafts/plans: `docs/plans/diagrammes-doku-san.md` ; décision acceptée dans `docs/adr/0028-diagrammes-bgraph-wasm.md`.
- Vérifications: `npm run check` sans diagnostic ; `npm test -- --run` avec 913/913 tests ; `npm run build` réussi ; contrôle visuel sombre réussi aux largeurs normale et 420 px.
- Validation encore manquante: aucun smoke test réel n’a encore comparé la même demande de diagramme sur OpenAI et MiniMax avec restauration après redémarrage.

## Next concrete step

Exécuter une même demande d’architecture réelle avec OpenAI puis MiniMax, vérifier la recommandation, le changement via « Autres vues » et la restauration de la discussion, puis créer des commits atomiques si les deux parcours sont validés.
