---
title: "Refonte premium v2 : fenêtre en cartes, barre latérale, copilote, réglages"
author: Kubo
date: 2026-11-26
branch: main
cost: { minutes: 18, tokens: 196304 }
touches:
  - docs/agent-knowledge/index.md
  - docs/journal/_next-session.md
  - src-tauri/src/openai.rs
  - src/App.svelte
  - src/README.md
  - src/app.css
  - src/assets/icons.svg
  - src/components/ConfirmDialog.svelte
  - src/components/CopilotConversationList.svelte
  - src/components/CopilotDiagram.svelte
---

## Decided
- Fenêtre en cartes : bureau = matériau du chrome/Mica ; feuille du document, barre latérale et copilote = cartes (écart --canvas-gap 8 px, rayon --sheet-radius 14). Jetons dans app.css (--sheet-shadow, --panel-bg, --panel-shadow, --row-selected, --tint-*-bg/fg).
- Ruban d'icônes de la barre latérale supprimé, remplacé par un sélecteur de vue en capsule (role=tab) ; bouton copilote déplacé dans la capsule de la barre de titre (l'ancien .collapse-btn d'App n'existe plus).
- Primitives de dialogue partagées en fin d'app.css (.doku-window, .doku-alert, .doku-switch, .doku-inset-group…) ; plus de copies .window/.btn par fichier.
- Capsule du modèle dans le composeur du copilote, pas dans l'en-tête (doublon + débordement à 400 px).
- Direction complète : docs/plans/refonte-premium-v2.md.
## Tried and ruled out
- Lueur d'ambiance du copilote : bandes visibles, retirée.
- Menus déroulants en capsule dans les réglages : aucun réglage n'en profite, contrôles segmentés gardés.
## Watch out
- Ombre de carte dans un conteneur overflow:hidden = coupée : overflow:clip + overflow-clip-margin. Rideau en largeur : retarder visibility de sa durée, sinon l'ombre reste.
- Congé inversé d'onglet : décaler le premier onglet d'au moins le rayon de la feuille.
- En sombre, --cream-content est plus sombre que --surface : un groupe encastré paraît creusé, l'éclaircir.
- Figer document.getAnimations() dans un script de capture plante sur les animations liées au défilement : filtrer a.timeline === document.timeline.
- Non vérifié en natif : Mica, glisser d'onglets entre fenêtres, toucher.
