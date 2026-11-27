# Refonte premium v2 — direction

_Rédigé le 2026-11-26. Demandée par l'utilisateur après la passe v1 (« trop en surface »)._
Périmètre choisi : **barre latérale + onglets**, **copilote Doku-San**, **réglages + dialogues**.
Ampleur choisie : **refonte franche** — mise en page, hiérarchie, tailles et composants changent ;
l'app reste crème, calme, monochrome (encre), sans accent saturé.

Références du kit (`G:\DesignKit`, servir le dossier en HTTP pour voir les `preview.html`) :
- macOS 27 : `apple-macos27/windows-unified-toolbar-title-sidebar`, `sidebars-*`, `titlebars-and-toolbars-*`,
  `alerts-stacked`, `forms-example-forms`, `foundation-materials` (recettes : `_runtime/tokens.css`).
- Kube : `kube-web/app-shell`, `sidebar`, `nav-row`, `composer`, `message`, `settings-page`, `command-palette`.
- NotebookLM : `kube-refs/notebooklm-m3/original/screenshots/*.jpg` (chat + sources, puces de contexte).
- UberDesigner : `ui/draft-agent` (étapes de l'agent), thème Paper.

## 1. La fenêtre devient un bureau de cartes

Aujourd'hui : trois plans plats séparés par des filets. Demain :

- Le **bureau** (`.app`) garde le matériau du chrome / Mica.
- La **feuille du document** (zone sous la barre d'onglets) est une carte : `margin` de `--canvas-gap`
  (8 px) à droite et en bas, `border-radius: var(--sheet-radius)` (14 px), `box-shadow: var(--sheet-shadow)`,
  fond `--cream-content`. L'onglet actif reste soudé au haut de la feuille (congés inversés conservés).
  En vue scindée : **deux feuilles** séparées par l'écart de 8 px, le séparateur vit dans l'écart.
- La **barre latérale** est une carte flottante (Apple 27) : marge 8 px haut/bas/gauche, rayon 14,
  fond `--panel-bg` + flou léger (≤ 16 px, sur `::before` — cf. learning « backdrop root »),
  ombre `--panel-shadow`.
- Le **panneau copilote** est une carte flottante de même famille : marge 8 px haut/droite/bas,
  rayon 14, fond `--cream-content` opaque (lecture longue), ombre `--panel-shadow`.
- Mode focus : aucune carte, la feuille seule. Copilote agrandi : la carte copilote prend la place.
- Mica : les cartes restent opaques ou translucides, le bureau seul laisse voir Mica.

## 2. Barre latérale (Sidebar.svelte, CopilotConversationList.svelte)

- **Plus de ruban d'icônes de 46 px.** En haut de la carte : marque Doku + « Doku » (13/600), bouton
  replier à droite. Dessous, un **sélecteur de vue** en capsule : 5 icônes (Fichiers, Rechercher, Plan,
  Historique, Discussions) dans une piste `--track` avec pastille glissante (transform), bulles d'aide.
- **En-tête de vue** systématique : titre de vue 13/600 + actions à droite (déjà là pour Fichiers ;
  à créer pour Plan, Historique…). Plan : sous-titre = nom du document.
- **Rangées** : 30 px (40 au doigt), rayon 8, sélection `--row-selected` + libellé 510 + icône en encre
  pleine ; survol `--surface-hover`. Méta alignée à droite en `--ink-4` (taille, date, nombre).
- **En-têtes de section** : 11 px / 600, `--section-label`, 16 px au-dessus, repliables quand utile.
- **Plan** : filet vertical de guidage par niveau, titre courant marqué d'une barre d'encre 2 px.
- **Historique** : rail chronologique (points + filet), groupes Aujourd'hui / Hier / Plus tôt.
- **Discussions** : groupes par période, titre + heure à droite, rangée active en pastille.
- **Pied de carte** : Paramètres (rangée avec icône) + état du modèle (point vert « Ollama local »,
  ou fournisseur) — c'est ce qui donne de l'âme au bas de la barre.

## 3. Barre de titre et onglets (TitleBar.svelte, App.svelte)

- Les commandes à droite (…, scinder, épingler) sont **groupées dans une capsule** (Apple 27 toolbar
  group : fond `--fill-hover` léger, rayon plein, séparateurs fins), les contrôles fenêtre restent à part.
- Quand la barre latérale est repliée : marque Doku + bouton déplier à gauche des onglets.
- Onglets : icône du type de fichier + nom, onglets inactifs en encre 3, survol en pastille ; point
  « non enregistré » ; largeur plus généreuse ; bouton « + » en pastille.
- Le bouton copilote flottant en haut à droite du document (`.collapse-btn`) rejoint la capsule.
- Notifications (App.svelte) : style notification macOS 27 — carte verre rayon 18, tuile d'icône
  teintée 28 px à gauche (ton), titre 13/600, message 12, ombre `--glass-shadow`.

## 4. Copilote Doku-San (CopilotPanel.svelte et cartes)

- **En-tête** : tuile de la marque 28 px + « Doku-San » 13/600 ; **capsule modèle** (point d'état
  coloré + nom court + chevron) ; actions groupées en capsule (nouvelle discussion, historique,
  agrandir, plus) ; contrôles fenêtre à part.
- **Accueil vide** : salutation en Source Serif 24 px (« Bonjour. » + ligne sur le document courant :
  « Que voulez-vous faire avec *notes.md* ? »), puce du document en contexte, suggestions en grille
  2 colonnes de cartes (tuile d'icône teintée + libellé + sous-libellé).
- **Messages** : question de l'utilisateur en bulle à droite (`--surface-2`, rayon 18 / 6 en bas à
  droite, ≤ 85 %) ; réponse pleine largeur, précédée d'une ligne « marque 18 px + Doku-San + heure »
  au premier message d'une suite ; barre d'actions sous la réponse (copier, insérer, note, relancer)
  visible au survol et toujours sur la dernière ; sources en puces.
- **Composeur unifié** : UNE carte (rayon 22, `--shadow-composer`) qui contient : rangée de puces de
  contexte (document courant, sources ajoutées, « + »), le champ, puis la barre d'outils (ajout,
  outils/mode, capsule modèle compacte, envoyer rond en encre). Le tiroir « Contexte » séparé au-dessus
  disparaît dans cette carte. Mention « Local · rien ne quitte cet appareil » en 11 px sous la carte.
- **Réflexion** : étapes façon draft-agent (spinner fin + libellé shimmer), pas de bulle vide.

## 5. Réglages et dialogues (SettingsDialog et modales)

- **Paramètres façon Réglages Système macOS 27** : fenêtre 880×620 max ; colonne gauche (fond
  `--surface-2`) avec champ de recherche capsule en haut et sections précédées d'une **tuile d'icône
  teintée** 22 px rayon 6 (Apparence ochre, Système slate, Raccourcis sage, Données clay,
  À propos ink) ; volet droit : grand titre 22/600 + description, puis **groupes en liste encastrée**
  (rayon 12, fond `--cream-content`, filet `--line-1`, rangées ≥ 44 px : libellé + aide à gauche,
  contrôle à droite, séparateurs en retrait). Interrupteurs type macOS (38×22), menus en capsule.
- **Alertes** (Confirm, Wikilink) : alerte macOS 27 empilée — 320 px, centrée, tuile 44 px, titre
  15/600 centré, message centré, boutons pleine largeur empilés en capsule (principal encre plein,
  secondaire teinté, destructif en rouge d'action), rayon 22.
- **Fenêtres outils** (PdfPages, PdfTextEdit, SignaturePad) : même chrome : en-tête (tuile, titre,
  sous-titre, fermer en capsule), corps, barre de pied avec actions à droite. Primitives partagées
  dans `app.css` (section « Primitives de dialogue ») au lieu des copies par fichier.
- **Palette de commandes** : façon Spotlight — champ 52 px en 17 px, rangées 40 px avec tuile
  d'icône, raccourci à droite, pied « ↑↓ naviguer · ↵ ouvrir · Échap ».

## Règles qui ne changent pas
- Encre et crème AIR ; jamais d'accent saturé ; sombre graphite.
- `data-input='touch'` pour le visible au doigt (`:where(...)`), `(any-pointer: coarse)` pour l'invisible.
- Verre uniquement sur les couches flottantes ; flou ≤ 16 px sur un rideau animé ; jamais de
  `backdrop-filter` sur un conteneur qui porte des menus en verre (le mettre sur `::before`).
- Mouvement : ≤ 300 ms, pas d'animation pour un menu ouvert au clavier, mouvement réduit respecté.
- Aucune fonction perdue : chaque bouton, raccourci, menu et état existant garde sa place ou en
  trouve une meilleure.
