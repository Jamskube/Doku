---
title: "Passe premium : modalité d'entrée, jetons typo, fluidité mesurée"
author: Kubo
date: 2026-10-24
branch: main
cost: { minutes: 61, tokens: 760643 }
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
- Dessin tactile piloté par `document.documentElement.dataset.input` (`mouse` par défaut, `touch` après un pointerdown doigt/stylet, posé dans `src/main.ts`). Changements VISIBLES pour le doigt sous `:global(:root[data-input='touch'])` ; `@media (any-pointer: coarse)` ne porte que des agrandissements de zone INVISIBLES qui ne chevauchent ni voisin ni barre de défilement. À la souris : rangées de menu 32px (Kube).
- Échelle typographique du chrome en jetons (`--text-2xs`…`--text-xl`, graisses 400/510/600), `--fill-pressed`, `--opacity-disabled`, `--image-outline`, `--ease-icon`, échelle `--z-*` dans `src/app.css` ; DESIGN.md et `.impeccable/design.json` régénérés pour que le détecteur d'impeccable juge contre le vrai système.
- Fluidité mesurée (CPU ×4) : largeur de `.stage` figée pendant le plein écran copilote, placeholder du copilote au démarrage, décorations de tableaux incrémentales (`updateTableDecorations`), plus de lecture de `scrollTop` par touche, bulle de sélection à 0ms au relâché souris, `escapeHtml` sorti dans `lib/html-escape.ts` (marked et print hors du boot).

## Tried and ruled out
- Règles « tactiles » sous `(any-pointer: coarse)` : vraies EN PERMANENCE sur une Surface (écran tactile), même à la souris → menus à 40px et actions toujours visibles partout.
- Critère « l'arbre lezer n'a pas avancé » pour une mise à jour incrémentale : l'arbre change d'objet à chaque transaction qui modifie le document.

## Watch out
- Convertir `@media (...) { .x }` en `:root[data-input] .x` AJOUTE de la spécificité : une règle générale peut se mettre à écraser une règle plus précise. Utiliser `:global(:where(:root[data-input='touch']))` pour garder la cascade.
- Un StateField incrémental doit tester ses états annexes (aperçu de reformulation, révélation) dans l'état de DÉPART ET d'arrivée : un champ vidé sans effet laisse sinon un tableau en markdown brut.
- `transitioncancel` n'est pas une fin fiable quand on inverse une transition : écouter `transitionend` + minuteur.
- Mesures de frames : vérifier une base à 16,7ms et la batterie (l'économiseur de Chrome plafonne à 30fps), `page.bringToFront()`, et piloter le store par l'URL exacte importée par App.svelte (`?t=…` après HMR).
