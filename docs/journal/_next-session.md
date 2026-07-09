# Next session pointer
_Updated: 2026-07-08 19:05_

## Where I left off
**L'app tourne en natif** : `npm run tauri dev` compile et lance la fenêtre Doku (sans décorations, icône D, validée visuellement par l'utilisateur). Le shell W1 est fidèle à la maquette (onglets Chrome-style sans filet — retiré à la demande —, sidebar ruban+panneau repliable à 0 px, crème/sombre) et l'éditeur CM6 live preview fonctionne (checkboxes, wikilinks, mode source Ctrl+/). Contenu = démo en mémoire ; l'ouverture/sauvegarde réelles (`Ctrl+O`/`Ctrl+S` via plugin-dialog/fs) sont câblées mais **pas encore testées en natif**.

## Open work
- Branch: main — **1 fichier non commité attendu** (`docs/journal/*` + AGENTS.md memories de cette clôture) ; tout le reste est poussé (`2e099f3`)
- Open PRs: aucune
- Reste W1/M1 : tester ouverture/sauvegarde natives · vrai explorateur de dossier (FR-6, remplacer la démo) · SnapshotService (FR-12, ADR-0003) · widgets tableaux/images dans l'éditeur · mini-barre de sélection · écrans W3 (accueil), W4 (focus), W5 (bannières) — maquettes à faire côté Claude design (« on rajoutera des choses plus tard »)

## Next concrete step
Lancer `npm run tauri dev`, tester Ctrl+O/Ctrl+S sur de vrais fichiers (+ épinglage 📌 et drag de fenêtre), corriger ce qui accroche, puis attaquer le vrai explorateur de dossier (FR-6) — ou `/epics` pour structurer le reste de M1.
