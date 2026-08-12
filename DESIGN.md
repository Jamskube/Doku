---
name: Doku
description: Un lecteur-éditeur natif où le document parle et le chrome s'efface.
colors:
  primary-ink: "#1C1A16"
  neutral-content: "#FDFBF5"
  neutral-base: "#F4F1E9"
  neutral-soft: "#F9F5EC"
  neutral-tint: "#EFEAE0"
  dark-chrome: "#16171A"
  dark-base: "#25252A"
  dark-content: "#2E2E34"
  dark-ink: "#EBEDF1"
  chrome-reflection: "#3A344A40"
  state-success: "#6BA47B"
  state-warning: "#D4A23E"
  state-error: "#C45F4F"
  danger-action: "#B51D2A"
typography:
  display:
    fontFamily: "Source Serif 4 Variable, Iowan Old Style, Georgia, serif"
    fontSize: "38px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.012em"
  headline:
    fontFamily: "Source Serif 4 Variable, Iowan Old Style, Georgia, serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.008em"
  title:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "Source Serif 4 Variable, Iowan Old Style, Georgia, serif"
    fontSize: "18.5px"
    fontWeight: 400
    lineHeight: 1.78
  ui-body:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter Variable, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.35
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "7px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary-ink}"
    textColor: "{colors.neutral-content}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.neutral-soft}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 13px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.danger-action}"
    textColor: "{colors.neutral-content}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "38px"
  field:
    backgroundColor: "{colors.neutral-content}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.ui-body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "30px"
  chip:
    backgroundColor: "{colors.neutral-tint}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  floating-menu:
    backgroundColor: "{colors.neutral-tint}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.lg}"
    padding: "6px"
  active-tab:
    backgroundColor: "{colors.neutral-content}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.label}"
    rounded: "10px 10px 0 0"
    padding: "0 8px 0 13px"
    height: "32px"
---

# Design System: Doku

## 1. Overview

**Creative North Star: "La Feuille Silencieuse"**

Doku ressemble moins à un logiciel qu’à un objet de lecture bien fait. Le document est la surface dominante ; le chrome se retire, les commandes apparaissent à l’approche et chaque couche supplémentaire doit justifier sa présence. Le système est éditorial, tactile et précis : la sérif porte la lecture longue, la sans structure les gestes, et la mono ne sert qu’aux contenus véritablement techniques.

La couleur reste retenue. En thème clair, des blancs chauds différencient la feuille, le mobilier et les surfaces interactives. En thème sombre, des graphites légèrement teintés remplacent le noir absolu. Le reflet lavande du chrome est un matériau d’ambiance, jamais un accent d’action. La profondeur est stratifiée et ambiante : les surfaces sont plates au repos, les ombres sont réservées aux menus, notifications, composeurs et fenêtres qui flottent réellement.

Le système rejette explicitement le poids des éditeurs Electron, la densité d’un IDE ou d’un dashboard technique et toute esthétique qui met l’outil devant le texte. Le mouvement renseigne un changement d’état en 100–240 ms ; il ne chorégraphie jamais l’arrivée d’une page.

**Key Characteristics:**
- Document dominant, chrome discret et actions révélées au moment utile.
- Palette restreinte de papier, d’encre et de graphite, avec états sémantiques sobres.
- Source Serif 4 pour lire, Inter pour agir, Geist Mono pour les identifiants techniques.
- Surfaces sans contour par défaut ; séparation par tons, espace et élévation justifiée.
- Cibles compactes mais familières, angles doux et boutons d’action en pilule.
- Mouvement court, fonctionnel et toujours compatible avec `prefers-reduced-motion`.

## 2. Colors

La palette oppose une feuille lumineuse à une encre dense, puis transpose cette relation en graphite nocturne sans introduire de néon.

### Primary
- **Encre brune** : texte principal, actions primaires, cases cochées et bouton d’envoi. Elle doit rester rare comme fond afin de conserver son autorité.

### Secondary
- **Reflet lavande** : nuance mobile et peu saturée du matériau sombre du chrome. Il apporte de la profondeur, jamais une signification fonctionnelle.

### Tertiary
- **Vert de confiance**, **ambre d’attention** et **rouge d’erreur** : réservés aux statuts explicites. Une variante plus sombre ou plus claire porte le texte selon le thème afin de maintenir un contraste d’au moins 4,5:1.
- **Rouge d’action** : réservé aux actions destructives confirmées et au bouton natif de fermeture de fenêtre.

### Neutral
- **Feuille claire** : surface de lecture et point de contraste maximal du thème clair.
- **Papier de base** : arrière-plan des fenêtres, dialogues et zones qui entourent la feuille.
- **Voile doux** : second niveau des panneaux et navigations.
- **Papier teinté** : menus flottants et surfaces surélevées.
- **Graphite nocturne** : matériau du chrome sombre.
- **Graphite de base** et **graphite de contenu** : équivalents sombres du mobilier et de la feuille.
- **Encre nocturne** : texte du thème sombre ; ses niveaux secondaires sont obtenus par opacité, pas par une collection de gris arbitraires.

### Named Rules

**The Document Contrast Rule.** La feuille doit toujours se distinguer du chrome, même quand les deux sont clairs ou sombres ; la différence vient d’abord du ton, jamais d’un contour épais.

**The Quiet Accent Rule.** Le reflet lavande n’est jamais utilisé pour un bouton, une sélection ou un état. Les actions restent en encre ; les statuts restent sémantiques.

**The Semantic Text Rule.** Une couleur de statut calibrée pour un point ou un fond n’est jamais réutilisée telle quelle pour du petit texte. Employer la variante textuelle adaptée au thème.

## 3. Typography

**Display/Reading Font:** Source Serif 4 Variable (avec Iowan Old Style, Georgia, serif en repli)
**Interface Font:** Inter Variable (avec la pile système en repli)
**Mono Font:** Geist Mono (avec `ui-monospace` en repli)

**Character:** La sérif crée la sensation d’une page éditoriale et ralentit agréablement la lecture. Inter reste neutre, compacte et fiable pour les commandes. Geist Mono signale uniquement la source, les raccourcis, les noms de modèles locaux et les identifiants.

### Hierarchy
- **Display** (600, 38px, 1.2) : titre H1 du document, avec un resserrement discret de `-0.012em`.
- **Headline** (600, 25px, 1.3) : titres H2 ; le H3 descend à 21px sans effet décoratif.
- **Title** (650, 18px, 1.3) : titres de panneau et de dialogue dans l’interface.
- **Body** (400, 18.5px, 1.78) : lecture Markdown, dans une colonne bornée à 680px par défaut, soit environ 65–75 caractères.
- **UI Body** (400, 13.5px, 1.55) : conversation, saisie et explications courtes.
- **Label** (500, 12.5px, 1.35) : boutons, onglets, lignes de menu et libellés. Pas de capitales forcées ni de tracking décoratif.
- **Mono** (500, 12.5px, 1.5) : source, tags techniques, raccourcis et code. Jamais pour un nom de produit cloud.

### Named Rules

**The Three-Voice Rule.** Source Serif lit, Inter agit, Geist Mono identifie. Toute utilisation qui ne correspond pas à l’un de ces verbes est interdite.

**The Reading Measure Rule.** Le texte de document reste entre 65 et 75 caractères par ligne en mode normal. La pleine largeur est un choix explicite de l’utilisateur, jamais le défaut.

## 4. Elevation

Doku utilise un système hybride : stratification tonale d’abord, ombre ensuite. Les panneaux et cartes au repos sont définis par leur ton et leur espacement. Une ombre n’apparaît que lorsque la surface flotte réellement au-dessus du document ou répond au focus. Chaque ombre diffuse utilise `--shadow-rgb`, jamais la couleur du texte `--ink-rgb`, afin d’éviter tout glow clair en thème sombre.

### Shadow Vocabulary
- **Filet d’élévation** (`0 0 0 1px var(--elevation-ring)`) : séparation optique d’une surface élevée sans bordure matérielle.
- **Contrôle actif** (`0 1px 4px rgba(var(--shadow-rgb), 0.12)`) : segment sélectionné, petit bouton ou état actif.
- **Surface flottante** (`0 12px 30px rgba(var(--shadow-rgb), 0.18)`) : menu, sélecteur et notification.
- **Composeur** (`0 8px 26px rgba(var(--shadow-rgb), 0.07)`) : profondeur légère de la face avant du composeur imbriqué.
- **Fenêtre modale** (`0 28px 76px rgba(var(--shadow-rgb), 0.34), 0 6px 20px rgba(var(--shadow-rgb), 0.16)`) : uniquement pour un vrai dialogue natif centré.

### Named Rules

**The Flat-Until-Floating Rule.** Une surface dans le flux reste plate. Si une ombre est nécessaire pour comprendre sa position, elle doit réellement flotter, se superposer ou recevoir le focus.

**The No-Glow Rule.** Toute ombre lumineuse en thème sombre est un bug. Les halos emploient toujours le token d’ombre noir indépendant du token de texte.

## 5. Components

Les composants sont raffinés et retenus : familiers dans leur geste, doux dans leur géométrie, silencieux au repos.

### Buttons
- **Shape:** les actions textuelles importantes utilisent une pilule complète (999px) ; les contrôles icône compacts utilisent 7–10px ; le bouton d’envoi est circulaire.
- **Primary:** fond Encre brune, texte Feuille claire, hauteur 34–38px et padding horizontal de 14–16px.
- **Hover / Focus:** le hover modifie légèrement le ton ; l’active réduit à `scale(0.96–0.97)` pendant 100 ms ; le focus clavier utilise un anneau de 2px à contraste moyen.
- **Secondary / Ghost:** surface tonale ou fond transparent. Aucun contour permanent sauf lorsqu’il est nécessaire pour distinguer une action secondaire sur un fond identique.
- **Danger:** rouge d’action saturé pour la confirmation ; rouge textuel sur fond transparent pour l’étape préparatoire.

### Chips
- **Style:** pilules compactes ou petits rectangles de 5–8px pour les tags techniques, sur un fond d’accent neutre.
- **State:** le chip sélectionné gagne un fond plus dense et une encre pleine ; les statuts utilisent leur couleur sémantique, sans multiplier les badges.

### Cards / Containers
- **Corner Style:** 12–18px selon l’échelle ; 14px est le rayon de référence des panneaux et menus.
- **Background:** tons adjacents de papier ou graphite. Une carte imbriquée doit gagner une fonction, pas seulement une couleur.
- **Shadow Strategy:** aucune ombre au repos ; vocabulaire de la section Elevation dès qu’une surface flotte.
- **Border:** absent par défaut. Les filets de 1px sont réservés aux séparations structurelles, tableaux et anneaux d’élévation.
- **Internal Padding:** 12–18px pour une carte compacte, 24–30px pour un panneau de réglages.

### Inputs / Fields
- **Style:** fond de feuille, aucun trait extérieur dur, rayon 7–8px pour la recherche ; le composeur principal emploie un grand rayon de 16px et un textarea sans bordure.
- **Focus:** anneau interne ou ombre ambiante, jamais glow coloré. Le placeholder conserve un contraste lisible.
- **Error / Disabled:** message textuel sémantique ; contrôle désactivé à environ 0.4 d’opacité, curseur neutre et aucune fausse interactivité.

### Navigation

La sidebar et la barre d’onglets appartiennent au même matériau de chrome. Les actions inactives restent transparentes ; le hover révèle un fond très léger ; l’état actif rejoint visuellement la feuille. À largeur réduite, les onglets se replient en un déclencheur unique et les réglages passent d’une navigation latérale à une rangée horizontale.

### Floating Menus

Les menus utilisent le Papier teinté, un rayon de 13–14px, 6px de padding et une ombre ambiante. Une ligne de commande mesure 40px, porte une icône de 17px, un libellé de 12.5px et éventuellement un raccourci discret. Toute surface flottante vivant dans un conteneur `contain: layout paint` doit être rendue à la racine de ce conteneur pour éviter le clipping.

### Document Editor

Le document est le composant signature : Source Serif 4 à 18.5px/1.78, colonne centrée de 680px et titres hiérarchisés sans barre d’outils persistante. Les affordances d’édition apparaissent au survol ou au focus. Les tableaux sont éditables en place ; leurs outils structurels sont presque invisibles au repos.

### Doku-San Composer

Question et Contexte forment deux surfaces imbriquées qui échangent leur profondeur. La face avant est pleine largeur, la face arrière est raccourcie de 28px pour rester lisible comme une seconde couche. La saisie commence en haut ; les actions restent en bas. L’animation de 240 ms décrit un changement de plan et respecte le mouvement réduit.

## 6. Do's and Don'ts

### Do:
- **Do** laisser la feuille dominer la surface et borner la lecture courante à 680px.
- **Do** employer les tons de papier et graphite avant d’ajouter un contour.
- **Do** utiliser Inter pour les gestes, Source Serif 4 pour lire et Geist Mono uniquement pour les contenus techniques.
- **Do** réserver les ombres aux surfaces réellement flottantes et toujours les calculer depuis `--shadow-rgb`.
- **Do** garder les transitions d’état entre 100 et 240 ms, avec une alternative explicite sous `prefers-reduced-motion`.
- **Do** fournir les états default, hover, focus, active, disabled, loading et error de chaque contrôle interactif.
- **Do** tester en natif tout comportement lié à Tauri, WebView2, la CSP, la fermeture de fenêtre ou le système de fichiers.
- **Do** préserver le fichier source byte-identique quand l’utilisateur n’a rien modifié ; la fidélité fait partie de la qualité perçue.

### Don't:
- **Don't** reproduire **les éditeurs Electron lourds** : aucun chrome envahissant, aucune barre d’outils dense, aucun démarrage visuellement chargé.
- **Don't** ressembler à **un IDE ou un dashboard technique** : pas de noir-néon, pas de cockpit, pas d’accumulation de cartes et de badges.
- **Don't** imiter **les outils Markdown qui réécrivent la source** : aucun choix visuel ne justifie une normalisation ou une sérialisation destructive.
- **Don't** utiliser le reflet lavande comme accent de bouton, de sélection ou de statut.
- **Don't** transformer les ombres en glow clair dans le thème sombre ; `--ink-rgb` est interdit pour l’élévation.
- **Don't** ajouter une bordure latérale colorée de plus de 1px à une carte ou une alerte.
- **Don't** rendre du texte transparent pour lui appliquer un dégradé ; le texte doit rester lisible dans son état de base.
- **Don't** généraliser le verre, le flou ou la transparence : le matériau Mica appartient au chrome, pas aux cartes de contenu.
- **Don't** imbriquer des cartes sans fonction ni inventer une modale quand une révélation progressive suffit.
- **Don't** animer une propriété custom héritée sur `:root`, ni ajouter une animation décorative qui ne décrit aucun état.
