---
title: "Mouvement et tactile selon les skills d'Emil (clavier, reduced-motion, rideaux)"
author: Kubo
date: 2026-10-20
branch: main
cost: { minutes: 56, tokens: 238366 }
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
- Mouvement aligné sur les skills d'Emil Kowalski (~/.agents/skills : emil-design-eng, improve-animations, review-animations, animation-performance, break-ui) : aucune animation sur une action clavier (indicateur `.kbd` posé à l'ouverture quand `event.detail === 0`), pression `scale(0.97)` sur les boutons d'action seulement (pas légende Windows, items de menu, rangées, onglets), modales en `--duration-dialog` 250ms, entrées partagées `doku-pop-in` / `doku-dialog-in` / `doku-fade-in` / `doku-toast-in` / `doku-life` dans app.css, rideaux via `--duration-curtain` / `--ease-curtain`.
- Reduced-motion global : animations 0.01ms ET `animation-iteration-count: 1`, transitions limitées à opacity/couleurs/box-shadow ; un indicateur d'attente garde une pulsation d'opacité redéclarée en longhands `!important`.
- Tactile Surface : `(any-pointer: coarse)` pour révéler les actions et agrandir les cibles ; les survols sous `(hover: hover) and (pointer: fine)`.

## Tried and ruled out
- Borne de largeur du copilote en `vw` dans `flex-basis` (propriété animée) : relançait le rideau à chaque image d'un redimensionnement. La borne vit sur `max-width` (non animée).
- `{#key}` autour de toute la carte d'une notification : rejoue l'entrée à chaque remplacement. Le key ne porte que sur le filet de vie.

## Watch out
- La propriété `scale` individuelle s'applique APRÈS `transform` : un élément animé par `doku-pop-in` et centré par `transform: translateX(-50%)` dérive. Le placer avec `translate:`.
- Relancer une animation par retrait/ajout de classe demande un double rAF ; retirer `.kbd` d'un menu déjà affiché relance son keyframe.
- Un attribut posé par JS (`data-paused`) doit être ciblé en `:global([data-paused])`, sinon Svelte élague le sélecteur.
- Un `out:` dans un `{#if}` imbriqué dans un `{#if}` parent qui disparaît au même instant ne joue pas : garder le conteneur monté.
- Au navigateur de test, `import('/src/lib/stores.svelte.ts')` peut charger une AUTRE instance que l'app après un rechargement à chaud (`?t=…`) : prendre l'URL exacte importée par App.svelte.
