// Contenu de démonstration (mode navigateur / premier lancement) — reprend la maquette W1.
import type { DocKind } from './stores.svelte'

const NOTES_MD = `# Mes notes de projet

Ce document sert de démonstration au rendu WYSIWYG de Doku. Le texte occupe une colonne centrée d'environ 72 caractères, avec un interligne généreux — l'idée est d'ouvrir *une feuille de papier*, pas de lancer un logiciel. Les décisions structurantes vivent dans [[architecture]], et la référence officielle reste la [spec CommonMark](https://spec.commonmark.org).

## Décisions

Le seuil de rendu progressif est fixé à 42 Ko : au-delà, le haut du document s'affiche d'abord. Le chargeur reste volontairement minuscule.

\`\`\`javascript
// seuil de rendu progressif
const seuil = 42;

function charger(doc) {
  if (doc.taille > seuil) return 'progressif';
  return 'immédiat';
}
\`\`\`

## À faire

- [x] Rédiger la spec UX
- [ ] Valider les maquettes crème
- [ ] Décliner le thème sombre

## Formats pris en charge

| Format | Édition | Statut |
|---|---|---|
| Markdown | WYSIWYG | Prêt |
| HTML | Sandbox | Prêt |
| PDF | Lecture | À venir |

Rien ne rivalise visuellement avec le contenu : le chrome s'efface, le document parle.
`

const IDEES_MD = `# Idées en vrac

- Mode focus (F9) : rien que le document
- Coller intelligent : une image collée est sauvée à côté du fichier
- Export PDF en un clic

> La légèreté est une discipline, pas une absence.
`

const RECETTE_HTML = `<!doctype html>
<html lang="fr">
  <head><title>Recette</title></head>
  <body>
    <h1>Tarte crème–citron</h1>
    <p>Le rendu sandbox arrive avec FR-8.</p>
  </body>
</html>
`

export const DEMO_TABS: { name: string; path: string | null; content: string; kind: DocKind }[] = [
  { name: 'notes.md', path: 'G:\\Notes\\notes.md', content: NOTES_MD, kind: 'md' },
  { name: 'idées.md', path: 'G:\\Notes\\idées.md', content: IDEES_MD, kind: 'md' },
  { name: 'recette.html', path: 'G:\\Notes\\recette.html', content: RECETTE_HTML, kind: 'html' },
]
