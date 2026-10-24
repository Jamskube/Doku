---
title: Import des composants de chat du kit Kube
author: Kubo
date: 2026-10-24
branch: main
cost: { minutes: 54, tokens: 208293 }
touches:
  - ".impeccable/design.json"
  - AGENTS.md
  - DESIGN.md
  - README.md
  - docs/agent-knowledge/index.md
  - docs/agent-knowledge/records/LES-20260714-003.md
  - docs/agent-knowledge/records/LES-20260714-004.md
  - docs/agent-knowledge/records/LES-20260714-006.md
  - docs/agent-knowledge/records/LES-20260716-001.md
  - docs/agent-knowledge/records/LES-20260716-002.md
---

## Decided
- Composants Kube portés en Svelte (pas de data-kube runtime) : Thread (src/lib/stick-to-bottom.ts, seuil 96px, ResizeObserver, remonter décroche toujours), ComposerDrawer (révélation grid 0fr→1fr 150ms) avec tray pour « / » (focus gardé dans la saisie, aria-activedescendant), WorkflowSteps/Source dans CopilotEvidence, Tooltip global (src/lib/tooltip.ts, use:tooltip, sombre dans les deux thèmes via --tooltip-bg).
- Le tour utilisateur apparaît sans entrée animée (envoyé au clavier) ; seul le tour de Doku-San entre en 300ms.
- sanitizeChatHtml retire tout attribut contenant < > ou [ (hook DOMPurify posé/retiré autour de l'appel) : les décorations par regex du HTML assaini (chat-blocks, citations) ne peuvent plus injecter.

## Tried and ruled out
- Fondu des blocs Markdown pendant le flux : le flux est en texte brut, le Markdown n'est rendu qu'à la fin ; parser à chaque jeton sort du budget.
- Croissance animée du composeur : field-sizing: content laisse la hauteur à auto, rien à animer sans mesure par frappe.

## Watch out
- Une règle tactile :where(:root[data-input='touch']) .x a la spécificité de .x : la placer APRÈS la règle de base, et doubler pour les variantes (.btn.lg).
- offsetTop d'une option n'est pas relatif à sa liste si la liste n'est pas positionnée ; et ne pas recaler le défilement pendant une révélation en hauteur (clientHeight encore petit).
- Playwright sur page en arrière-plan : les scroll events programmatiques ne sont pas délivrés ; bringToFront et vraie molette pour tester le suivi du fil.
- Supprimer un bloc CSS « mort » a emporté .cop-sr-only encore utilisée : les annonces lecteur d'écran s'affichaient.
