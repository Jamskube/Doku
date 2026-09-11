# Next session pointer
_Updated: 2026-09-11 08:52_

## Where I left off

Une revue croisée (reviewer + critique, contextes séparés) a validé le travail non commité des 6 et 9 septembre après correction : un **Critical** dans le retrait des marqueurs `[n]` (il réécrivait le CSS de chaque document généré), et six **Major** — plugin de prévisualisation qui ne rebâtissait pas après le premier enregistrement, jauge inatteignable au clavier, index RAG non re-versionné, octets d'images fuyant par la troncature et la reformulation, badge de contexte faux, Markdown portable capable d'embarquer n'importe quel fichier du disque. Tout est corrigé, verrouillé par des tests, typecheck 0 erreur, 907 tests, build OK.

**32 fichiers non commités** portent trois sessions de travail : composeur à sections et palette « / » (06), images collées et Markdown portable (09), correctifs de revue (11). Les installateurs 3.5.0 et 3.5.1 produits ne correspondent à aucun commit et **ne contiennent pas les correctifs du 11** : ne pas les distribuer.

## Open work

- Branch: `main` — **32 fichiers non commités**, 0 commit depuis `1f45856` (5 sept).
- Open PRs: aucune.
- Plans : `docs/plans/signature-et-mises-a-jour.md` (bloqué secrets), `docs/plans/documents-generes-doku-san.md` (à valider en réel).
- Jamais essayé dans l'app : menu à sections, commandes `/`, Markdown portable, images collées après enregistrement, tous les correctifs du 11.
- Reportés : tags/frontmatter, annotations PDF → RAG, découpage de `copilot.svelte.ts`, publication du source du fork bgraph (geste du mainteneur).

## Active Autopilot

- Goal: none
- Status: —
- Next action: —

## Next concrete step

Essayer dans l'app les cinq chantiers non vérifiés (un document PDF généré avec CSS ; une image collée dans une note neuve puis enregistrée ; `/web météo` avec la recherche déjà active ; la jauge au clavier ; un export Markdown portable rouvert), puis **committer en trois commits** (composeur + palette · images + portable · correctifs de revue), tagger `v3.5.1`, et recompiler les installateurs depuis le tag.
