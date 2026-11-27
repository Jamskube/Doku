---
title: "Cartographie G:\\DesignKit pour une passe premium de Doku"
author: Kubo
date: 2026-11-26
branch: main
cost: { minutes: 11, tokens: 102112 }
touches:
  - docs/agent-knowledge/index.md
  - docs/journal/_next-session.md
  - src-tauri/src/openai.rs
  - src/App.svelte
  - src/components/CopilotPanel.svelte
  - src/components/DocxView.svelte
  - src/components/TitleBar.svelte
  - src/lib/copilot.svelte.ts
  - src/lib/editor/editor.ts
  - src/lib/editor/live-preview.ts
---

## Decided
- G:\DesignKit = 5 kits : Apple macOS/iOS 27 (decompilation Sketch), Kube web/mobile/refs, Antigravity, Dqnamo, UberDesigner (ui/websites). On reprend des VALEURS et des IDEES, jamais le code tel quel.
- Apple : HTML en positions absolues inutilisable ; les recettes utiles sont dans apple-macos27/_runtime/tokens.css (materiaux, menus, liquid glass = piles de box-shadow inset blancs .35 + anneau .5px). A teinter avec --ink-rgb/--shadow-rgb, opacite niveau "thick".
- UberDesigner : theme "Paper" = le plus proche de Doku ; draft-agent (faisceau de lecture + diff en direct) et voice-to-text (mot qui monte depuis un flou) sont les pistes copilote. Presque tout y est pilote en JS/canvas : reecrire en CSS.
- Kube : Doku l'a porte sans prefixe k- ; verifier par commentaires "Kube X" et equivalents fonctionnels. Absents notables : command-palette, ambient-glow, press-feedback unifie, hover-reveal masque, number-roll, nav-rail, sticky-header, search-highlight avec compteur.

## Tried and ruled out
- Assets Apple (wallpapers ~27 Mo, bezels, feux tricolores) : inutiles et licence floue.
- Liquid/metaball, particules, WebGL, mascottes, themes Glow/Cables/Tactile : trop demonstratif pour un outil de lecture.
- Antigravity themes-and-tokens : manifeste VS Code vide, rien a prendre ; dqnamo stamp = timbre-poste, tactile-button = source absente.

## Watch out
- Deux shimmers dans Doku : app.css (transform, ok) et .cop-shimmer de CopilotPanel (background-position steps(48), repeint).
- Ctrl+K est pris (lien, format-commands.ts) et Ctrl+P aussi : une palette devra etre Ctrl+Shift+P.
- "Oublier ma signature" (PdfView forgetSignature) efface sans garde-fou.
- Flou 60-100px sur grandes surfaces = cher dans WebView2 sur Surface : reserver aux couches flottantes.
