---
title: "Tokens et pièges du polish Kube (menus, tuiles d'icônes, sombre)"
author: Kubo
date: 2026-10-20
branch: main
cost: { minutes: 14, tokens: 109623 }
touches:
  - AGENTS.md
  - DESIGN.md
  - README.md
  - docs/agent-knowledge/index.md
  - docs/agent-knowledge/records/LES-20260714-003.md
  - docs/agent-knowledge/records/LES-20260714-004.md
  - docs/agent-knowledge/records/LES-20260714-006.md
  - docs/agent-knowledge/records/LES-20260716-001.md
  - docs/agent-knowledge/records/LES-20260716-002.md
  - docs/agent-knowledge/records/LES-20260716-003.md
---

## Decided
- Tokens partagés ajoutés à src/app.css pendant le polish Kube : --fill-hover (survol des BOUTONS, 6 %), --track / --track-thumb (contrôles segmentés), --scrim (voile de modale, via --shadow-rgb), --duration-dialog (600ms). Menus et popovers : fond --composer-bg, --radius-xl, padding 4px, --shadow-xl, rangées 30-32px, survol/sélection --accent-soft.

## Tried and ruled out
- --surface-hover (3 %) pour le survol des boutons : invisible sur la crème. Il reste réservé aux rangées.

## Watch out
- Un `<svg class="icon">` qui hérite d'une règle de tuile (width/height fixes + fond) dessine son tracé sur toute la tuile : réduire par un padding sur le svg.
- Un menu imbriqué dans un conteneur d'actions hérite de la règle générique `.actions button` (même spécificité, plus loin dans le fichier) : ses items deviennent des carrés de 28px qui se chevauchent. Exclure `[role='menuitem']` ou cibler par classe.
- En sombre, --composer-bg vaut --surface-2 : une tuile en --surface-2 dans un menu ou le composeur disparaît. Utiliser --accent-soft.
- Le menu contextuel des rangées de l'explorateur ne s'ouvre que sous Tauri (`if (!isTauri) return`) : invisible au navigateur, ce n'est pas une régression.
