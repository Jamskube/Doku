---
title: "Polish Kube : icônes Lucide, police système, couleurs AIR gardées"
author: Kubo
date: 2026-10-20
branch: main
cost: { minutes: 17, tokens: 213215 }
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
- Polish du front d'après le kit Kube (G:\KUBE_style) : on garde les COULEURS AIR (crème), on adopte la structure Kube (rayons, ombres via --shadow-rgb, tailles de contrôles, durées/courbes) dans src/app.css, la police système (Inter retiré) et les icônes Lucide (Material Symbols retiré).
- Icônes : `<svg class="icon"><use href="#i-nom" /></svg>`, taille = font-size (1em). Sprite réduit src/assets/icons.svg généré par `npm run subset:icons` depuis la devDependency lucide-static (identique au sprite du kit), injecté dans le DOM par main.ts. Ids préfixés `i-` pour ne pas collisionner avec les ancres des documents.
- Garde-fou src/lib/icons.test.ts : icônes utilisées ⊆ sprite, et tout `#i-nom` statique doit exister dans Lucide.

## Tried and ruled out
- Composant Svelte `<Icon>` : le CSS scopé des parents (`.foo .msr { font-size }`) ne traverse pas un composant enfant ; le balisage svg en ligne garde ces règles valides.
- Charger dist/kube.css en entier : 500 Ko, et ses noms de tokens (--surface, --ink) collisionnent avec ceux d'AIR aux sens différents.

## Watch out
- Lucide v1 a renommé des icônes : trash-2 → trash, history → rotate-ccw-clock, align-* → text-align-*. Vérifier les noms dans node_modules/lucide-static/sprite.svg.
- Les fonctions qui RENVOIENT un nom d'icône (ex. activityIcon) ne sont détectées par l'extracteur que si le nom contient un tiret ; un nom sans tiret doit aussi apparaître ailleurs, sinon l'ajouter au sprite à la main.
