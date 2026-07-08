# Next session pointer
_Updated: 2026-07-08 13:05_

## Where I left off
Jalon M0 (architecture) terminé et poussé : PRD, spec UX validée, architecture, 4 ADRs accepted, spike S0 exécuté avec verdict mesuré — le moteur d'édition sera **CodeMirror 6 live preview** (base réutilisable : `spike/src/live-preview.ts`). En parallèle, l'utilisateur fait produire les maquettes par Claude design à partir de `docs/planning/claude-design-prompt.md` — les intégrer quand elles arrivent (tokens AIR, 5 écrans W1-W5, thèmes crème + sombre).

## Open work
- Branch: main (clean, synchronisé avec origin)
- Open PRs: aucune
- Drafts/plans: tout `docs/planning/` est à jour ; pas de plan d'implémentation encore (`docs/plans/` vide)

## Next concrete step
`/gate readiness` pour valider le passage en implémentation, puis `/epics` (découpage M1 — socle lecteur : ouvrir/lire/onglets, scaffolding Tauri+Svelte dans `src/`).
