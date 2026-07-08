# Prompt pour Claude design — UI de Doku

_À copier-coller tel quel. Donner accès au repo Doku (`G:\Doku`) ; l'accès à `G:\KUDE` est un plus (source de vérité des tokens), pas une obligation — les tokens essentiels sont inclus ci-dessous._

---

Tu es chargé du design visuel de **Doku**, une app desktop Windows (Tauri 2 + Svelte 5) pour lire et éditer des documents — Markdown en WYSIWYG d'abord, HTML, puis PDF. Esprit : **« ouvrir une feuille de papier, pas lancer un logiciel »** — calme, immédiat, chrome minimal.

## Tes contrats (à lire dans le repo Doku, dans cet ordre)
1. `docs/planning/ux-spec.md` — **le contrat principal** : layout, wireframes W1-W5, interactions, raccourcis, accessibilité. Tu ne redessines pas l'architecture de l'interface, tu lui donnes sa forme visuelle finale.
2. `docs/planning/PRD.md` — les exigences (FR-1 à FR-12) et NFRs.
3. `src/assets/doku-mark-rounded.svg` — le logo officiel.

## Système de design : « AIR » (hérité du repo KUDE)
Si tu as accès à `G:\KUDE` : la source de vérité est `src/App.css`, **bloc AIR uniquement** — ignore toute la couche d'alias legacy (`--kude-*`, `--bg-surface`, `--text-primary`, schist). Sinon, voici les tokens :

- **Surfaces crème (thème clair, PAR DÉFAUT)** : base `#F4F1E9` (chrome : sidebar, titlebar) · contenu `#FDFBF5` (panneau document) · soft `#F9F5EC` · tint `#EFEAE0` · surface `#FBF7ED`
- **Encre** : `#1C1A16` (rgb 28,26,22) + échelle alpha `--ink-2…--ink-5` pour les niveaux atténués
- **Accent** : clair `#1C1A16` · sombre `#E6E6EA` · **Sémantique** : ok `#6BA47B` · warn `#D4A23E` · err `#C45F4F`
- **Polices** : sans `Geist` · mono `Geist Mono` · serif `Source Serif 4` — **à bundler localement** (jamais de Google Fonts @import : l'app est 100 % offline)
- **Échelles** : radius `r-1…r-5` + pill · spacing `s-1…s-10` (4→72 px)
- **Thème sombre** : via `[data-theme="dark"]`, à concevoir avec le même soin que le crème

## Ce que tu dois produire
Des maquettes HTML/CSS statiques (un fichier par écran, tokens en variables CSS partagées dans un `tokens.css` propre) pour les 5 écrans de la spec UX :
1. **W1** — fenêtre principale, sidebar repliée (= totalement invisible, 0 px), document Markdown rendu dans le panneau « stage » inséré (coins gauches arrondis ~16 px, hairline), onglets en tête du stage, titlebar custom 32 px
2. **W2** — sidebar dépliée (240 px, pleine hauteur, wordmark + logo, nav icône+label 38 px, actif en accent-soft) + panneau Fichiers 268 px sous la titlebar
3. **W3** — écran d'accueil : dropzone, boutons Ouvrir, récents, case « app par défaut »
4. **W4** — mode focus : document seul, plus aucun chrome
5. **W5** — surcouches : dialogue « modifications non enregistrées », bannières ambre/rouge, panneau Historique des versions, **mini-barre de formatage flottante** sur sélection de texte ([B][I][lien][code])

Chaque écran : version **crème** et version **sombre**. Montre les états clés (onglet actif/inactif/non-sauvé `●`, hover, focus visible en anneau accent 2 px).

## Le contenu Markdown de démonstration
Utilise un vrai document : titre H1, paragraphes, un `[[wikilink]]`, un lien externe, un bloc de code coloré, une liste à cases cochées/décochées, un tableau, une image. Colonne de lecture centrée ~72ch, interligne généreux, la typo de lecture peut tirer vers `Source Serif 4` pour le corps — à ta discrétion, propose.

## Contraintes non négociables
- **Contraste AA** (4,5:1 texte, 3:1 UI) sur les DEUX thèmes, y compris les niveaux d'encre atténués
- **Cibles tactiles ≥ 40 px** (Surface Pro tactile) sur titlebar, onglets, sidebar
- **Zéro chrome superflu** : pas de status bar, pas de compteur de mots, pas de toolbar permanente — décisions actées dans la spec
- Sidebar repliée = **rien** (pas de rail d'icônes résiduel — différence voulue par rapport à KUDE)
- Le logo : corrige le pli — son `fill="#FFFFFF"` doit devenir transparent ou couleur de fond, et le trait `#000` doit passer en `currentColor` pour suivre l'encre des deux thèmes
- Animations sobres : 150-220 ms ease-out max, et tout doit rester utilisable avec `prefers-reduced-motion`

## Ce que tu ne fais PAS
- Ne pas inventer de nouveaux écrans, panneaux ou navigation (la spec UX est le contrat)
- Ne pas introduire d'autres couleurs d'accent « pour égayer » — la palette AIR suffit
- Ne pas charger de ressources réseau (fonts, icônes, images externes)

Commence par W1 crème (l'écran de vie quotidienne), fais-le valider, puis décline.
