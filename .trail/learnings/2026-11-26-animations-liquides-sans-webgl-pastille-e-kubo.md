---
title: "Animations liquides sans WebGL : pastille étirée, îlot, gouttes"
author: Kubo
date: 2026-11-26
branch: main
cost: { minutes: 7, tokens: 57661 }
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
- Effets « liquides » (kit flow-tab-bar, droplet-button, liquid-search) refaits sans WebGL : src/lib/liquid.ts (liquidThumb / moveLiquid : le bord avant part d'abord, ressort --ease-spring-liquid), filtre SVG #doku-goo injecté dans main.ts, jamais sur du texte (calque de formes sous un calque net).
- Îlot de barre de titre (TitleIsland.svelte, placement island.ts) : « Enregistré » via app.savedPulse, « Doku-San écrit… » quand le panneau est fermé. Notifications restées en bas (sous l'îlot, elles masqueraient le titre), avec entrée en goutte.
- Gouttes du « + » du composeur : CopilotDropletMenu.svelte ; envoyer ↔ arrêter en pilule (anneau de génération supprimé).
## Tried and ruled out
- Filtre goo sur la coque vitrée de la palette : casse son backdrop-filter ; bord bas arrondi à la place.
- Ressort sur la résorption de l'îlot : finit en trait vertical, sortie sans rebond.
## Watch out
- Un ResizeObserver sur les enfants d'un conteneur dont on anime un enfant en largeur se redéclenche à chaque image et annule l'animation sans erreur : exclure l'élément animé.
- Le goo ronge l'opacité (seuil alpha) : un fondu devient un rétrécissement ; flou 5 efface les formes ≲ 5 px, filtre local à l'échelle des formes.
- Fondu encre → crème = gris boueux : partir d'une teinte.
- Captures : Vite sert les modules avec ?t= après HMR, prendre l'URL dans performance.getEntriesByType('resource') ; ralentir via Animation.setPlaybackRate (CDP) plutôt que viser des instants.
