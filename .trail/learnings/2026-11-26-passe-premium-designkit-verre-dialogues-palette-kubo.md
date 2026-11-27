---
title: "Passe premium DesignKit : verre, dialogues, palette, copilote"
author: Kubo
date: 2026-11-26
branch: main
cost: { minutes: 28, tokens: 225575 }
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
- Verre des couches flottantes par jetons app.css (--glass-bg/--glass-filter/--glass-shadow, recette Apple teintee creme), jamais sur contenu ni grand panneau ; rangees de menu en --menu-row-hover neutre.
- Sortie des modales : closeDialog(dlg) pose .closing puis close() (animationend + minuteur) ; reopenDialog annule une sortie en cours (confirmations en rafale). onclose demonte, jamais un setter d'etat direct.
- Palette sur Ctrl+Maj+A (Ctrl+K lien, Ctrl+P impression, Ctrl+Maj+P Plan). app.banner devient un accesseur sur une file (notice-queue.ts), API inchangee pour les appelants.
- Theme Systeme : app.themeMode = preference, app.theme = theme effectif.

## Tried and ruled out
- backdrop-filter sur .titlebar et .sidebar : en fait la racine de fond de leurs menus, dont le verre ne floutait plus rien (vu a l'ecran). Flou deplace sur un ::before (z-index -1, isolation sur .sidebar).
- Unifier les ~40 :active scale(.97) : refactor sans gain visible, non fait.

## Watch out
- Reduced motion global : animation-delay force a 0 (sinon entree retardee en both invisible) ; transition-property limitee aux couleurs, donc un remplissage clip-path saute : prevoir un repli opacite.
- mouseup global doit filtrer button === 0, sinon un clic droit modifie la selection avant contextmenu.
- Une classe posee par une action (classList.add) est purgee du CSS scope : l'ecrire :global(.x).
- Une capture prise pendant doku-pop-in montre un verre transparent sans flou : attendre la fin de l'entree avant de juger.
