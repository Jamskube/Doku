# Next session pointer
_Updated: 2026-09-11 10:20_

## Where I left off

Doku **3.5.2** est committée, poussée et compilée (arm64 24,3 Mo, x64 28,6 Mo, bâtis sur `40ad8ee`, arbre propre). Deux des **23 souhaits** du mainteneur sont livrés : les notes non enregistrées survivent au redémarrage (session `localStorage`, ≤ 500 k caractères, volet et place conservés), et un clic droit sur un onglet renomme (étiquette Doku, le fichier ne bouge pas — décision prise à l'essai), duplique, envoie dans l'autre volet, ferme les autres / à droite. Revue croisée (reviewer + critique) : trois Majors convergents corrigés (scindage perdu sur une note, invite de quit sautée sur écriture avalée, renommage sans champ en barre repliée). Le mainteneur n'a pas encore dicté les 21 souhaits restants.

## Open work

- Branch: `main` — 44 fichiers non commités = pass `/wrap` (journal, 40 records complétés en schéma, 1 record projet neuf, index, projection AGENTS −1).
- Open PRs: aucune.
- Plans : `docs/plans/signature-et-mises-a-jour.md` (bloqué secrets), `docs/plans/documents-generes-doku-san.md` (à valider en réel).
- **Non vérifié dans l'app** (chemin Tauri seulement) : restauration des notes au redémarrage, scindage sur une note, bannière quota.
- Reportés : couleur d'onglet, tags/frontmatter, annotations PDF → RAG, découpage de `copilot.svelte.ts`, publication du source du fork bgraph, tag `v3.5.2`.
- Curate projet : cursor 40/89 — 45 records sans champs de schéma et 7 Rules > 40 mots (LES-20260828-001/002, 20260905-001/002, 20260911-001/002/003) attendent la prochaine passe.

## Active Autopilot

- Goal: none
- Status: —
- Next action: —

## Next concrete step

Committer la passe `/wrap` (`docs: journal, knowledge curate pass 1/3`), tagger `v3.5.2`, puis demander au mainteneur le troisième des 23 souhaits — après un essai réel de la restauration des notes (`npm run tauri dev`, créer une note, quitter, relancer).
