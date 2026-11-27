---
title: "Sélection décalée, échappements Markdown, impression Ctrl+P"
author: Kubo
date: 2026-11-05
branch: main
cost: { minutes: 9, tokens: 105544 }
touches:
  - src/App.svelte
  - src/assets/icons.svg
  - src/components/TitleBar.svelte
  - src/lib/editor/editor.ts
  - src/lib/editor/live-preview.ts
  - src/lib/export/print.ts
---

## Decided
- Sélection/curseur décalés de ~1 caractère = `scrollbarGutter: 'stable both-edges'` sur `.cm-scroller` (editor.ts) : la couche de sélection CM6 se positionne depuis le bord de bordure sans compter la gouttière GAUCHE (9 px, largeur de `::-webkit-scrollbar`). Passé à `'stable'`.
- `\*`, `\_`… : le nœud lezer `Escape` masque sa barre (live-preview.ts), seul le caractère littéral s'affiche.
- Impression : `printDocument(tab)` dans `src/lib/export/print.ts` (réutilise `exportViaPrint`, iframe isolé) ; menu « Imprimer… » (TitleBar) + Ctrl+P (App.svelte, toujours preventDefault sinon la webview imprime l'UI). md/html/txt seulement.

## Tried and ruled out
- Chercher la cause dans les marqueurs masqués (Decoration.replace) : le décalage était constant, même hors marqueurs — mesurer texte vs `.cm-selectionBackground` avant de soupçonner les décorations.

## Watch out
- Ne jamais remettre `both-edges` (ni padding/gouttière gauche sur `.cm-scroller`) sans re-mesurer `range.getClientRects()` contre `.cm-selectionBackground`.
- Accès à la vue en navigateur : `document.querySelector('.cm-content').cmTile` (CM 6.43, plus de `cmView`) ; plusieurs `.cm-editor` coexistent, scoper les requêtes à `view.dom`.
- Un `*` tapé sans `\` reste de l'emphase (masqué) : auto-échappement proposé à l'utilisateur, non fait.
