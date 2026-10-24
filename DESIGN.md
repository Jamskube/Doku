---
name: Doku
description: Un lecteur-éditeur natif où le document parle et le chrome s'efface.
colors:
  ink: "#1C1A16"
  cream-content: "#FDFBF5"
  cream-base: "#F4F1E9"
  cream-soft: "#F9F5EC"
  cream-tint: "#EFEAE0"
  surface: "#FBF7ED"
  surface-2: "#F4EFE2"
  composer-bg: "#FFFFFF"
  code-bg: "#F1ECDF"
  desk: "#DEDACF"
  accent-soft: "#1C1A1614"
  fill-hover: "#1C1A160F"
  fill-pressed: "#1C1A161F"
  chrome-base: "#DFDCD4"
  chrome-cool: "#C4D2EF3D"
  chrome-depth: "#60568913"
  dark-ink: "#EBEDF1"
  dark-cream-content: "#181818"
  dark-cream-base: "#151515"
  dark-cream-soft: "#1D1D1D"
  dark-cream-tint: "#242424"
  dark-surface: "#202020"
  dark-surface-2: "#282828"
  dark-code-bg: "#222222"
  dark-desk: "#101010"
  dark-chrome-base: "#16171A"
  dark-chrome-reflection: "#3A344A40"
  dark-chrome-depth: "#000A291D"
  dark-shadow: "#000000"
  ok: "#6BA47B"
  warn: "#D4A23E"
  err: "#C45F4F"
  ok-text: "#38714B"
  warn-text: "#8A5F26"
  err-text: "#A9412F"
  danger-action: "#B51D2A"
  dark-ok-text: "#8FC9A0"
  dark-warn-text: "#DFB35F"
  dark-err-text: "#E08D7B"
  dark-danger-action: "#FF5D68"
  window-close: "#CF2F3A"
  window-close-active: "#B5232D"
  dark-window-close: "#D93641"
  dark-window-close-active: "#BE2731"
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
  subheadline:
    fontFamily: "Source Serif 4 Variable, Iowan Old Style, Georgia, serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Source Serif 4 Variable, Iowan Old Style, Georgia, serif"
    fontSize: "18.5px"
    fontWeight: 400
    lineHeight: 1.78
  doc-table:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title-sm:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  ui-body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  copilot:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 510
    lineHeight: 1.4
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  badge:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.02em"
  code:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
  composer: "22px"
  4xl: "24px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream-content}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.fill-hover}"
  button-danger-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.danger-action}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.danger-action}"
    textColor: "{colors.cream-content}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-compact:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "28px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    size: "32px"
  field:
    backgroundColor: "{colors.cream-content}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  menu:
    backgroundColor: "{colors.composer-bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "4px"
  menu-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "32px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "24px"
  segmented-track:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-thumb:
    backgroundColor: "{colors.cream-content}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "28px"
  switch:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.full}"
    width: "32px"
    height: "20px"
  badge:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.badge}"
    rounded: "{rounded.full}"
    padding: "0 8px"
    height: "20px"
  active-tab:
    backgroundColor: "{colors.cream-content}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "10px 10px 0 0"
    padding: "0 6px 0 12px"
    height: "32px"
  composer:
    backgroundColor: "{colors.composer-bg}"
    textColor: "{colors.ink}"
    typography: "{typography.copilot}"
    rounded: "{rounded.composer}"
---

# Design System: Doku

## 1. Overview

**Creative North Star: "La Feuille Silencieuse"**

Doku ressemble moins à un logiciel qu'à un objet de lecture bien fait. Le document est la surface dominante ; le chrome se retire, les commandes apparaissent à l'approche et chaque couche supplémentaire doit justifier sa présence. Le système est éditorial, tactile et précis : la sérif porte la lecture longue, la police système structure les gestes, et la mono ne sert qu'aux contenus véritablement techniques.

Deux héritages se superposent, et cette répartition est une décision, pas un accident. **Les couleurs viennent d'AIR** : papiers crème, encre brune, graphite. **La structure vient du kit Kube** (`G:\KUBE_style`, lecture seule) : échelle de rayons, ombres fines doublées d'un filet d'élévation, hauteurs de contrôle de 24 / 28 / 32 / 36px, durées et courbes. Le mouvement suit les règles d'Emil Kowalski : il renseigne un changement d'état, se tait au clavier, et ne chorégraphie jamais l'arrivée d'une page. La source de vérité des jetons est `src/app.css` ; ce document en donne le sens.

Le système rejette explicitement le poids des éditeurs Electron, la densité d'un IDE ou d'un dashboard technique, et toute esthétique qui met l'outil devant le texte.

**Grammaire du mouvement** (portée par les composants, résumée ici) :
- État (survol, couleur, opacité) : `--duration-basic` 150ms, `ease`.
- Pression des boutons d'action : `scale(0.97)` sur `:active`, 150ms `--ease-enter-snappy` (`cubic-bezier(.23, 1, .32, 1)`). Jamais sur une rangée de liste, de menu ou d'arbre.
- Menus et popovers : entrée `doku-pop-in` (fondu + `scale: 0.95`, origine posée vers le déclencheur), 150ms. **Ouvert au clavier : aucune animation** (classe `.kbd`). Le survol d'une rangée de menu est instantané : les flèches le déplacent en rafale.
- Dialogues : `--duration-dialog` 250ms, `doku-dialog-in` (fondu + montée de 8px), voile en fondu sur la même durée. Une modale reste sous 300ms.
- Rideaux latéraux (barre latérale, panneau copilote) : largeur en `--duration-curtain` 340ms, `--ease-curtain` (`cubic-bezier(0.22, 1, 0.36, 1)`) ; un seul tempo pour que les deux bords respirent ensemble.
- Échange d'icône en place (copier → coche) : `--ease-icon` (`cubic-bezier(0.2, 0, 0, 1)`), les deux icônes restent dans le DOM.
- `prefers-reduced-motion` : moins de mouvement, pas zéro retour. Les fondus et changements de couleur gardent leur durée ; tout ce qui se déplace ou change de taille devient instantané, et toute animation en boucle est ramenée à une itération.

**Key Characteristics:**
- Document dominant, chrome discret, actions révélées au moment utile.
- Palette AIR restreinte : papier, encre, graphite neutre, états sémantiques sobres.
- Source Serif 4 pour lire, la police système pour agir, Geist Mono pour identifier.
- Structure Kube : rayons concentriques, ombres fines cerclées d'un filet, contrôles de 32px.
- Mouvement court et fonctionnel, muet au clavier, fondus conservés en mouvement réduit.
- Tactile pris au sérieux : le dessin suit le DERNIER pointeur utilisé (`:root[data-input='touch']`, posé par `main.ts`), les zones de clic s'agrandissent sans changer le dessin.

## 2. Colors: La palette Papier et Encre

La palette oppose une feuille lumineuse à une encre dense, puis transpose cette relation en graphite neutre la nuit, sans néon et sans noir absolu.

### Primary
- **Encre brune** (`ink`) : texte principal, action primaire, interrupteur activé, bouton d'envoi, point « non enregistré ». Ses niveaux secondaires sont des **opacités** de la même encre (`--ink-2` 90 %, `--ink-3` 75 %, `--ink-4` 66 %, `--ink-5` 50 %), jamais une collection de gris. `--ink-4` reste ≥ 4,5:1 même sur le matériau du chrome ; `--ink-5` ne porte plus de texte, seulement des icônes décoratives.

### Secondary
- **Reflet du chrome** (`chrome-cool` en clair, `dark-chrome-reflection` lavande en sombre, avec `chrome-depth`) : ingrédients du matériau `--chrome-material` (grain, reflet, profondeur). Ils donnent de la profondeur au chrome, jamais une signification. Sous Windows 11, Mica peint ce fond et le matériau CSS n'est plus qu'un repli.

### Tertiary
- **Vert de confiance** (`ok`), **ambre d'attention** (`warn`), **rouge d'erreur** (`err`) : calibrés comme points et fonds. Le texte porteur de sens emploie leurs variantes `*-text` (≥ 4,5:1 sur `cream-content` et `surface-2`), redéfinies en sombre.
- **Rouge d'action** (`danger-action`, jeton `--danger-action-text`) : réservé aux actions destructives. Le bouton de fermeture de la fenêtre a son propre rouge (`window-close`).

### Neutral
- **Feuille** (`cream-content`) : surface de lecture, fond des onglets actifs et des champs.
- **Papier de base** (`cream-base`) : fond de l'application et des navigations de réglages.
- **Voile doux** et **papier teinté** (`cream-soft`, `cream-tint`) : panneaux de second niveau.
- **Surfaces** (`surface`, `surface-2`) : dialogues, et piste des contrôles segmentés.
- **Blanc du composeur** (`composer-bg`) : menus, popovers, toasts et composeur ; en sombre il devient `surface-2`.
- **Bureau** (`desk`) et **fond de code** (`code-bg`) : derrière les pages PDF et sous les blocs de code.
- **Lavis d'encre** (`accent-soft` 8 %, `fill-hover` 6 %, `fill-pressed` 12 %, `--surface-hover` 3 %) : sélection et bouton secondaire, survol de bouton, pression, survol de rangée. Filets : `--line-1` / `--line-2` / `--line-3` (12 / 18 / 28 %).
- **Graphite nocturne** (préfixe `dark-`) : en sombre, la famille crème devient un graphite **neutre** (`#151515` → `#282828`), seul le matériau du chrome (`dark-chrome-base`) garde une teinte froide.

### Named Rules

**The Document Contrast Rule.** La feuille se distingue toujours du chrome, en clair comme en sombre ; la différence vient du ton, jamais d'un contour épais.

**The Quiet Reflection Rule.** Les reflets du chrome ne servent jamais pour un bouton, une sélection ou un état. Les actions restent en encre, les statuts restent sémantiques.

**The Semantic Text Rule.** Une couleur de statut calibrée pour un point ou un fond n'est jamais réutilisée pour du texte de 14px ou moins : `--ok-text`, `--warn-text`, `--err-text`, `--danger-action-text`.

**The Thumb-Lighter Rule.** Dans un contrôle segmenté, la sélection est toujours plus claire que sa piste, dans les deux thèmes (`--track` / `--track-thumb` s'inversent en sombre).

## 3. Typography

**Reading Font:** Source Serif 4 Variable (avec Iowan Old Style, Georgia, serif), embarquée en latin et latin-ext seulement
**Interface Font:** police système, comme le kit Kube : Segoe UI Variable sous Windows 11, SF sur Apple, celle du bureau sous Linux (`--font-sans`)
**Mono Font:** Geist Mono (avec `ui-monospace`)

**Character:** la sérif donne la sensation d'une page éditoriale et ralentit agréablement la lecture. La police système est neutre, native, et variable : la graisse 510 des contrôles existe vraiment. Geist Mono signale uniquement la source, le code, les raccourcis et les identifiants techniques.

### Hierarchy

Contenu du document (zoomable par Ctrl + molette via `--doc-zoom`, hors échelle du chrome) :
- **Display** (600, 38px, 1.2, `-0.012em`) : H1 du document.
- **Headline** (600, 25px, 1.3, `-0.008em`) : H2. **Subheadline** (600, 21px) : H3.
- **Body** (400, 18.5px, 1.78) : lecture, colonne `--doc-width` de 680px par défaut, soit 65-75 caractères.
- **Tableaux** (sans, 14.5px) et **code** (Geist Mono 13.5px, 1.7, sur `code-bg`) ; le code en ligne descend à 0.78em.

Chrome (échelle `--text-*`, graisses `--weight-regular` 400 / `--weight-control` 510 / `--weight-strong` 600) :
- **Title** (`--text-xl` 18px, 600, `--tracking-tight`) : titre de volet de réglages.
- **Title small** (`--text-lg` 16px, 600, `--tracking-snug`) : titre de dialogue.
- **UI body** (`--text-md` 14px, 400, 1.5) : texte courant d'un dialogue.
- **Label** (`--text-sm` 13px, **510**) : tout ce qui se clique — boutons, rangées, onglets, menus. Sélection = même taille, graisse 510 ou fond, jamais une taille de plus.
- **Caption** (`--text-xs` 12px, 400) : secondaire, raccourcis, chemins, aides.
- **Badge** (`--text-2xs` 11px, 600, `--tracking-badge` 0.02em, chiffres tabulaires).
- **Copilote** (`--cop-text`, 13.5px par défaut, réglable dans Apparence) : tout ce qui grossit avec lui s'exprime en `em`.

### Named Rules

**The Three-Voice Rule.** Source Serif lit, la police système agit, Geist Mono identifie. Toute utilisation qui ne correspond pas à l'un de ces verbes est interdite. Mono jamais pour un nom de produit cloud.

**The Scale-Only Rule.** Le chrome ne connaît que 11 / 12 / 13 / 14 / 16 / 18px et 400 / 510 / 600. Un 12.5px, un 15px ou une graisse 590 sont des restes à migrer, pas des nuances.

**The Reading Measure Rule.** Le texte de document reste entre 65 et 75 caractères par ligne. La pleine largeur est un choix explicite de l'utilisateur, jamais le défaut. Pas de capitales forcées ni de tracking décoratif sur les libellés.

## 4. Elevation

Système hybride à la manière de Kube : stratification tonale d'abord, ombre ensuite. Au repos, panneaux et groupes se distinguent par le ton et l'espace. Une ombre n'apparaît que lorsque la surface flotte réellement ; elle est toujours fine et presque toujours doublée d'un filet `0 0 0 0.5px var(--elevation-ring)` qui dessine le bord sans bordure matérielle. Toute ombre passe par `--shadow-rgb` (encre chaude en clair, noir pur en sombre), jamais par `--ink-rgb`.

### Shadow Vocabulary
- **sm** (`0 1px 2px -1px rgba(var(--shadow-rgb), 0.08)`) : curseur d'un contrôle segmenté, bouton de l'interrupteur (avec le filet).
- **lg** (`0 4px 8px -2px … 0.10` + filet) : petits badges flottants (niveau de zoom, repères).
- **xl** (`0 8px 16px -4px … 0.12` + filet) : **tous les menus, popovers et toasts**. C'est l'ombre la plus employée.
- **2xl** (`0 16px 32px -8px … 0.19` + filet) : objet en cours de glisser (aperçu d'onglet détaché).
- **card** (`0 4px 16px 0 … 0.05` + filet) : objet posé sur une surface — page PDF, marque de l'application.
- **dialog** (`0 8px 16px 0 … 0.07, 0 2px 6px 0 … 0.05, 0 0 0 1px var(--elevation-ring)`) : modales ; en sombre, ombres noires plus denses et liseré intérieur blanc à 4 %.
- **composer** (anneau 4 % + `0 2px 8px` + halo `0 4px 80px 8px` à 2.5 %) : face avant du composeur du copilote, seule.

Couches (`--z-*`) : chrome 20, toast 30, popover 40, overlay 50, menu contextuel 60, glisser 80. Les couches internes d'un composant (pages PDF) restent locales.

### Named Rules

**The Flat-Until-Floating Rule.** Une surface dans le flux reste plate. Si une ombre est nécessaire pour comprendre sa position, elle doit réellement flotter, se superposer ou recevoir le focus.

**The No-Glow Rule.** Toute ombre lumineuse en thème sombre est un bug. Les halos emploient toujours `--shadow-rgb`, indépendant de l'encre.

**The Faint-Scrim Rule.** Le voile d'une modale est discret (`--scrim` : encre 16 % en clair, noir 32 % en sombre). La fenêtre se détache par son ombre, pas par l'assombrissement du document.

## 5. Components

Familiers dans leur geste, doux dans leur géométrie, silencieux au repos. Les hauteurs viennent de Kube : `--control-2xs` 24px, `--control-sm` 28px, `--control-md` 32px, `--control-lg` 36px.

### Rayons concentriques
Un rayon intérieur vaut le rayon extérieur moins le retrait : menu 12px − 4px de padding = rangée 8px ; piste segmentée 8px − 2px = curseur 6px (`calc(var(--radius-md) - 2px)`) ; composeur 22px − 6px = boutons intérieurs 16px. Échelle : `xs` 4 (repères, wikiliens), `sm` 6, `md` 8 (rangées, champs, boutons compacts), `lg` 10 (boutons 32px, onglets), `xl` 12 (menus, tuiles d'icône), `2xl` 16 (modales, groupes de réglages, cartes du copilote), `composer` 22, `full` (badges, interrupteur, bouton d'envoi, barres de défilement). `4xl` 24px n'est plus attribué : les deux modales qui l'emploient encore (confirmation, réglages) migrent vers `2xl`.

### Buttons
- **Shape:** rectangle doux, plus de pilule pour un bouton texte : 32px de haut, rayon `lg` (10px), padding 0 12px, 13px/510.
- **Primary:** fond encre, texte feuille ; survol à 80 % d'encre. **Un seul par vue.**
- **Secondary:** lavis `accent-soft` (8 %), texte encre ; survol à 12 % (`--fill-pressed`).
- **Ghost:** transparent, texte `--ink-3` ou `--ink-4` ; survol `--fill-hover` (6 %) et texte plein.
- **Destructive:** en deux temps. Fantôme rouge (`--danger-action-text`, survol lavé de 10 % du même rouge) pour l'étape préparatoire ou le refus (« Ne pas enregistrer ») ; plein rouge (texte feuille) uniquement pour la confirmation finale.
- **Compact:** 28px, rayon `md`, padding 0 10px, dans les rangées de réglages.
- **Icône:** carré de 32px rayon `lg` dans les barres, 24px rayon `md` dans les rangées ; bouton d'envoi rond de 28px.
- **États:** pression `scale(0.97)` sur les boutons d'action ; focus clavier = contour 2px `--focus-ring` (`--ink-3`), décalé de 2px (de −2px à l'intérieur d'un menu ou d'un onglet) ; désactivé = `--opacity-disabled` (0.4), curseur neutre, plus de pression.

### Chips / Badges
- **Style:** 20px, rayon `full`, lavis `accent-soft`, texte `--ink-3`, 11px/600 à chiffres tabulaires (version, compteurs, état).
- **State:** une seule pastille par information ; les statuts portent leur couleur sémantique en point, le texte en variante `*-text`.

### Cards / Containers
- **Groupes de réglages:** boîte à filet 1px `--line-1`, rayon `2xl`, fond feuille ; rangées de 12px × 16px séparées par un filet ; le contrôle passe sous le texte quand la place manque.
- **Background:** tons adjacents de papier ou de graphite ; une carte imbriquée doit gagner une fonction, pas seulement une couleur.
- **Shadow Strategy:** aucune ombre au repos ; `card` seulement pour un objet posé (page, marque).
- **Internal Padding:** 12-16px en carte compacte, 24px en volet de réglages ou dialogue.

### Inputs / Fields
- **Style:** fond feuille, aucun trait dur, rayon `md`, 28px, 13px. Le champ de recherche de l'éditeur garde un filet 1px `--line-2`.
- **Focus:** contour 2px `--focus-ring` intérieur (décalage −2px), jamais de halo coloré. Le placeholder reste lisible (`--ink-4`).
- **Error / Disabled:** message textuel en `--err-text` sous le contrôle ; désactivé à 0.4 sans fausse interactivité.
- **Segmenté:** piste `--track`, padding 2px, rayon `md` ; segments de 28px en 13px/510 ; le choix courant porte le curseur plus clair avec l'ombre `sm` et le filet.
- **Interrupteur:** 32 × 20px rayon `full`, `--line-2` éteint, encre allumé ; bouton de 16px qui glisse de 12px en 150ms `--ease-enter-snappy`.

### Navigation
- **Barre de titre:** 40px (`--chrome-titlebar-height`) en matériau du chrome. Les onglets font 32px, rayon `lg` en haut ; l'onglet actif rejoint la feuille (fond `cream-content` et congés inversés de 10.5px à son pied), en 510. La croix d'un onglet apparaît au survol, au focus et sur l'onglet actif ; sa place reste réservée. Sous 600px les onglets se replient en un déclencheur unique « onglet actif · n ▾ ».
- **Barre latérale:** rangées de 30px rayon `md`, texte `--ink-2` ; la rangée courante prend le lavis `accent-soft` et la graisse 510 ; survol `--surface-hover`.
- **Réglages:** navigation latérale de 188px sur `cream-base`, qui devient une rangée horizontale sous 680px.

### Menus flottants
Une seule grammaire pour le menu document, le menu de tri, les menus contextuels et la liste des onglets : fond `composer-bg`, rayon `xl` (12px), padding 4px, ombre `xl`, largeur 220-244px. **Rangées de 32px** (`--control-md`), rayon `md` (8px), padding 0 8px, gap 8px, icône de 15px en `--ink-3` qui passe à l'encre au survol, raccourci en 12px `--ink-4` aligné à droite. Le survol est une couche `::before` en `accent-soft`, instantanée. Séparateur 1px `--line-1` (marges 4px 8px) ; intitulé de section en 12px/510 `--ink-3`, non focusable ; rangée destructive en `--danger-action-text`. Un sous-menu s'ouvre à 8px du parent, sa première rangée alignée sur la rangée déclencheuse. Tout menu sort de son conteneur (`position: fixed` ou racine du composant) pour ne jamais être rogné.

### Modales
`<dialog>` natif, voile `--scrim`, fenêtre `surface` rayon `2xl`, ombre `dialog`, padding 24px, entrée 250ms. En-tête : tuile d'icône de 36px rayon `xl` en `accent-soft`, titre 16px/600 équilibré, texte 14px/1.5 en `--ink-3` borné à ~46ch. Pied : l'action destructive seule à gauche, Annuler (secondaire) et l'action primaire à droite, gap 8px ; sous 460px les boutons s'empilent en pleine largeur, primaire en bas à portée de pouce.

### États vides
Colonne centrée : icône Lucide de 24-28px en `--ink-4` (trait 1.5), un titre court en graisse forte, une phrase en `--ink-3` bornée à ~38ch, puis au plus une action primaire et une secondaire. Un état vide dit quoi faire ensuite ; il ne décore pas.

### Indicateur non enregistré
Une pastille CSS de 6px (`border-radius: 50%`, fond `--ink`) devant le nom, partout (onglets, sélecteur de volet, liste des onglets, explorateur), doublée d'un `<span class="sr-only">non enregistré</span>` — jamais le glyphe `●`, lu « cercle noir ». Jamais d'astérisque, d'italique ni de couleur. Fermer un document modifié ouvre toujours la modale Enregistrer / Annuler / Ne pas enregistrer.

### Icônes
Lucide, en sprite (`src/assets/icons.svg`, injecté au démarrage) : `<svg class="icon"><use href="#i-nom" /></svg>`. L'icône prend `1em` et `currentColor`, trait 2, bouts arrondis. Tailles : 14px dans les rangées, 15px dans les menus, 16px dans les boutons et la navigation, 18px dans les tuiles de dialogue, 24-28px dans les états vides. Une icône hors sprite fait échouer `icons.test.ts` : relancer `npm run subset:icons`.

### Cibles tactiles
Sur une Surface (écran tactile + Type Cover), `(any-pointer: coarse)` est TOUJOURS vrai, même à la souris : il ne décide donc jamais du dessin. `main.ts` pose `data-input` (`mouse` par défaut, `touch` après un toucher ou un stylet) sur `<html>`. Sous `:root[data-input='touch']`, et seulement là, les actions principales atteignent **au moins 40px**, les rangées de menu passent à 40px et les actions révélées au survol deviennent visibles. Sous `(any-pointer: coarse)` ne vivent que des agrandissements INVISIBLES (`::after` transparent) qui ne chevauchent ni un voisin ni une barre de défilement. À la souris, le dessin reste celui de Kube (rangées de 32px). Le flash gris de WebView est coupé, le retour vient de `:active`.

### Document Editor
Composant signature : CodeMirror 6 en aperçu vivant, Source Serif 4 à 18.5px/1.78, colonne de 680px, titres hiérarchisés, aucune barre d'outils persistante. Les affordances d'édition apparaissent au survol ou au focus. Citations par un filet de 2px `--line-3`, liens soulignés d'un filet `--line-3`, wikiliens sur lavis `accent-soft` rayon `xs`. Les tableaux s'éditent en place, leurs outils presque invisibles au repos.

### Doku-San Composer
La saisie reste toujours visible : rayon `composer` (22px), fond `composer-bg`, ombre `composer`. Entrée envoie, Maj+Entrée et Alt+Entrée vont à la ligne, une composition IME n'envoie jamais ; un seul disque Envoyer/Arrêter (`aria-busy`). Les libellés du pied se masquent par container queries (≤ 440px, ≤ 300px), le nom accessible reste.

Le tiroir Contexte (Kube `ComposerDrawer`) sort de derrière la saisie : rentré de 13px de chaque côté, coins hauts `2xl`, filet `--line-1` au lieu d'ombre, bas replié de 20px sous la saisie (le filet y est coupé). Il se révèle en HAUTEUR (grille `0fr → 1fr`, 150ms `--ease-enter-snappy`, filet et fondu en phase), jamais par `transform` ; fermé, il est `inert` puis `visibility: hidden`. Instantané au clavier et en mouvement réduit.

Taper « / » remplace le tiroir par le **tray** des commandes (jamais les deux) : le focus reste dans la saisie (`aria-activedescendant`), ↑/↓ bouclent, Entrée ou Tab choisit sans envoyer, Échap ferme jusqu'au prochain changement de texte ; rangées 28px (40px au doigt), indice aligné à droite, aucune transition sur la sélection.

### Fil Doku-San
Le fil suit le bas tant qu'on y est (≤ 96px) ; remonter, même un peu, arrête le suivi et fait paraître « Aller au dernier message » (disque 32px au-dessus du fondu du dock, 40px au doigt). Le suivi passe par un ResizeObserver, jamais par jeton reçu. Un tour ajouté entre par une montée de 8px + fondu (300ms) ; une conversation rouverte n'est pas animée. 12px entre deux tours, 32px au changement de locuteur. Les actions d'un tour (Copier, Sauver en note) se révèlent au survol ou au focus, toujours visibles au doigt ; la copie confirme par une coche 1,3s annoncée en `aria-live`. La prose des réponses dérive d'une seule taille, `--cop-text` ; les tableaux défilent dans `.cop-table-scroll`, les blocs de code portent leur langage et un Copier. L'activité suit Kube `WorkflowSteps` (un seul point vivant), les sources sont des puces Kube `Source` (icône de type, nom coupé au milieu) avec aperçu au survol.

### Bulles d'aide
`use:tooltip` (`src/lib/tooltip.ts`), jamais `title` sur un bouton à icône seule : 200ms au survol, puis 300ms pendant lesquels la bulle voisine s'ouvre sans délai ni fondu ; immédiate au focus clavier ; jamais au doigt, au stylet, pendant un glisser ni sur un déclencheur dont le menu est ouvert. Fond `--tooltip-bg`, sombre dans les deux thèmes (Kube ne l'inverse pas), texte `--on-tooltip` en `--text-xs`/510, rayon `md`, puce de raccourci à 25 %. Les raccourcis s'écrivent « Ctrl+Maj+E ». `title` natif reste pour un nom tronqué ou la raison d'un bouton désactivé.

## 6. Do's and Don'ts

### Do:
- **Do** laisser la feuille dominer et borner la lecture courante à 680px.
- **Do** prendre chaque valeur dans `src/app.css` : `--radius-*`, `--control-*`, `--shadow-*`, `--text-*`, `--weight-*`, `--duration-*`, `--ease-*`, `--z-*`, `--fill-*`, `--opacity-disabled`.
- **Do** dessiner les boutons texte à 32px, rayon 10px, 13px/510, avec un seul primaire par vue.
- **Do** construire tout menu en 12 / 4 / 8 : rayon 12px, padding 4px, rangées de 32px rayon 8px.
- **Do** calculer les rayons intérieurs par soustraction du retrait.
- **Do** réserver les ombres aux surfaces qui flottent, toujours depuis `--shadow-rgb` et cerclées du filet `--elevation-ring`.
- **Do** couper toute animation d'un menu ouvert au clavier, et poser `transform-origin` vers le déclencheur.
- **Do** garder les fondus sous `prefers-reduced-motion` et rendre instantané tout ce qui bouge ou grandit.
- **Do** porter les cibles à 40px minimum au doigt (`:root[data-input='touch']`) ; à la souris, garder le dessin Kube.
- **Do** fournir les états default, hover, focus, active, disabled, loading et error de chaque contrôle interactif.
- **Do** préserver le fichier source byte-identique quand l'utilisateur n'a rien modifié ; la fidélité fait partie de la qualité perçue.

### Don't:
- **Don't** reproduire **les éditeurs Electron lourds** : chrome envahissant, barre d'outils dense, démarrage visuellement chargé.
- **Don't** ressembler à **l'esthétique IDE / dashboard technique** : pas de « dev tool » sombre-néon, pas de cockpit, pas de densité d'ingénieur, pas d'accumulation de cartes et de badges.
- **Don't** imiter **les outils Markdown qui réécrivent la source** : aucun choix visuel ne justifie une normalisation ou une sérialisation destructive.
- **Don't** revenir aux valeurs AIR d'interface : Inter, rayons de 7px, rangées de menu de 40px, boutons en pilule, police d'icônes Material.
- **Don't** utiliser une taille ou une graisse hors échelle dans le chrome (12.5px, 15px, 590) ni un rayon hors échelle.
- **Don't** animer une pression sur une rangée de liste ou de menu, ni dépasser 300ms pour une modale.
- **Don't** utiliser les reflets du chrome comme accent de bouton, de sélection ou de statut.
- **Don't** transformer les ombres en glow clair dans le thème sombre ; `--ink-rgb` est interdit pour l'élévation.
- **Don't** ajouter une bordure latérale colorée de plus de 1px à une carte ou une alerte ; le filet de citation de 2px, neutre et typographique, est la seule exception.
- **Don't** rendre du texte transparent pour lui appliquer un dégradé.
- **Don't** généraliser le verre ou le flou : Mica et le matériau du chrome appartiennent au chrome, pas aux cartes de contenu.
- **Don't** préfixer une classe ou un id par `ad-`, `ads-`, `banner-`, `sponsor-`, `promo-` ou `advert-` : les bloqueurs les masquent.
- **Don't** imbriquer des cartes sans fonction ni inventer une modale quand une révélation progressive suffit.
- **Don't** animer une propriété custom héritée sur `:root`, ni ajouter une animation décorative qui ne décrit aucun état.
