# UX Specification : bureau scindé et notes liées

_Date : 2026-08-13 · Statut : Approved · Référence : `PRD-v3.md`_

## 1. Design principles

1. **La source et la note dominent.** Le bureau scindé n’ajoute pas un tableau de bord : il partage la feuille en deux surfaces documentaires.
2. **Le volet actif ne peut jamais être ambigu.** Focus clavier, onglet choisi, sauvegarde et insertion suivent le même `activePaneId`, matérialisé par un filet discret et un libellé accessible.
3. **Le séparateur reste un outil, pas un objet.** Il mesure 11 px de zone interactive pour une ligne visible de 1 px ; aucun grip décoratif au repos.
4. **La seconde surface enseigne son usage.** Son état vide propose immédiatement « Nouvelle note » et les autres onglets ouverts.
5. **Le document reste portable.** Une note liée est un Markdown ordinaire ; la provenance Doku enrichit la navigation mais n’est jamais nécessaire pour lire le fichier.
6. **Motion fonctionnelle.** L’ouverture décrit le partage de l’espace en 220 ms ; aucune opacité du texte, aucun rebond, et une bascule quasi instantanée en mouvement réduit.

Références d’ancrage : sobriété du chrome Codex, familiarité du mode côte à côte de Microsoft Word, liens de notes d’Obsidian, transposés dans le système « Feuille silencieuse » de Doku.

## 2. Information architecture

```text
Doku
├── Barre d’onglets globale
│   ├── Onglets ouverts
│   ├── Nouvel onglet
│   └── [Scinder / Réunir la vue]
├── Bureau documentaire
│   ├── Volet principal
│   │   ├── Document affecté
│   │   └── Actions contextuelles de document
│   ├── Séparateur redimensionnable
│   └── Volet secondaire
│       ├── Document affecté
│       └── État vide : onglets disponibles / Nouvelle note
├── Barre latérale
│   └── Suit le document du volet actif
└── Doku-San
    └── Suit le document du volet actif ; plein écran masque tout le bureau
```

Règle de navigation : cliquer un onglet global affecte cet onglet au volet actif. Cliquer dans un volet le rend actif et met son onglet en évidence dans la barre globale. Un onglet déjà affiché dans l’autre volet est désactivé dans le sélecteur de volet.

## 3. User flows

### 3.1 Happy path — lire et prendre des notes

```text
[Document ouvert]
       |
       v
[Scinder la vue] ---> [Volet secondaire vide]
                              |
                              v
                     [Nouvelle note liée]
                              |
                              v
                     [Écriture dans la note]
                              |
                              v
                     [Ctrl+S / Enregistrer sous]
                              |
                  +-----------+-----------+
                  |                       |
               [Succès]               [Erreur]
                  |                       |
                  v                       v
         [Note liée enregistrée]   [Buffer intact + Réessayer]
```

| Étape | Surface | Action | Réponse | Erreur |
|---|---|---|---|---|
| 1 | Barre d’onglets | Active « Scinder la vue » | La feuille se partage, le document conserve son scroll | Si aucun document : deux choix vides, aucune fausse note |
| 2 | Volet secondaire | Choisit « Nouvelle note liée » | Un Markdown non enregistré est créé et focusé | Source temporaire : badge « Note temporaire » |
| 3 | Note | Écrit | Seul le buffer secondaire change | Aucun effet sur la source |
| 4 | Note | Ctrl+S | Enregistrer sous avec nom proposé | Annulation : reste modifiée ; erreur : notification |

### 3.2 Première utilisation — comprendre le second volet

```text
[Second volet vide]
  Nouvelle note liée
  ─────────────────
  Onglets disponibles
  • recherche.md
  • synthèse.txt
```

Le premier focus va sur « Nouvelle note liée ». Une phrase courte explique : « Écrivez à côté de votre source ou choisissez un document ouvert. » Aucun tutoriel modal.

### 3.3 Comparer deux documents

| Étape | Action | Réponse |
|---|---|---|
| 1 | Scinde la vue | Le volet secondaire s’ouvre |
| 2 | Choisit un onglet existant | Le document apparaît sans changer l’ordre des onglets |
| 3 | Clique dans le volet gauche/droit | Le filet de focus et l’onglet global suivent ce volet |
| 4 | Déplace le séparateur | Ratio borné 25–75 %, contenu reflow sans animation retardée |
| 5 | Active « Permuter » | Les documents changent de côté, les états d’éditeur restent attachés aux documents |

### 3.4 Capture d’un passage

```text
[Sélection dans la source]
          |
          v
[Menu : Ajouter aux notes]
          |
     +----+----+
     |         |
[Note MD]   [Pas de note]
     |         |
     v         v
[Insertion] [Créer une note ?]
     |         |
     +----+----+
          v
[Citation + provenance]
```

L’action n’apparaît que pour une sélection Markdown/TXT fiable et une vue scindée. Elle ne s’affiche pas sur une citation révélée programmatiquement.

### 3.5 Error recovery

| État | Message | Action primaire | Action secondaire |
|---|---|---|---|
| Échec Enregistrer sous | « La note n’a pas pu être enregistrée. Vos modifications sont intactes. » | Réessayer | Choisir un autre emplacement |
| Source supprimée | « La source n’est plus accessible. » | Localiser le fichier | Garder la note seule |
| Citation ambiguë | « Plusieurs passages correspondent à cet extrait. » | Ouvrir la source | Fermer |
| Citation non sûre | « Cette provenance ne peut pas être ouverte en sécurité. » | Fermer | — |
| Onglet secondaire fermé | « Choisissez un document pour ce volet. » | Nouvelle note | Onglets disponibles |

## 4. Wireframes

### 4.1 Vue unique — point d’entrée

```text
┌──────────────────────────────────────────────────────────────┐
│ [rail]  note.md ×  rapport.pdf ×       [▣ Scinder] [+]  ··· │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    Document actif                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

Le bouton Scinder est un contrôle icône 32 × 32 px dans la zone d’actions des onglets. Son tooltip est « Scinder la vue » puis « Réunir la vue ».

### 4.2 Second volet vide

```text
┌────────────────────────────┬─┬───────────────────────────────┐
│                            │ │                               │
│       Document source      │ │   Écrire à côté de la source │
│                            │ │                               │
│                            │ │   [＋ Nouvelle note liée]      │
│                            │ │   ───────────────────────     │
│                            │ │   Onglets disponibles         │
│                            │ │   [□ recherche.md]            │
│                            │ │   [□ synthèse.txt]            │
└────────────────────────────┴─┴───────────────────────────────┘
```

La surface vide utilise le fond normal du document, sans carte. Les choix forment une petite liste centrée de 320 px maximum.

### 4.3 Deux documents, volet droit actif

```text
┌────────────────────────────┬─┬───────────────────────────────┐
│ rapport.pdf                │ │ Notes — rapport.md        ●   │
│                            │ │                               │
│      page 12 / 38          │ │ ## Points à vérifier         │
│                            │ │                               │
│                            │ │ Le périmètre reste…           │
│                            │ │                               │
└────────────────────────────┴─┴───────────────────────────────┘
                                └ filet intérieur discret actif
```

La vue scindée ne crée aucun second niveau de navigation. La barre d’onglets globale reste haute de 40 px et se partage selon le même ratio que les deux documents : chaque volet possède ainsi son onglet exactement au-dessus de sa surface. Chaque déclencheur reprend à l’identique l’onglet compact déjà utilisé quand la fenêtre manque de largeur : même typographie, compteur `+N`, chevron et clic sur toute la surface pour ouvrir le menu ; aucune croix n’apparaît dans l’onglet. Le menu conserve les mêmes lignes, états actif/modifié, actions de fermeture et navigation clavier. Le bouton Copilote conserve sa position flottante dans le coin de la page ; il ne recouvre plus aucun titre puisque les onglets vivent dans la barre supérieure.

### 4.4 Largeur inférieure à 720 px

```text
┌──────────────────────────────────────────┐
│ rapport.pdf                              │
│              Document source             │
├──────────────────────────────────────────┤
│ Notes — rapport.md                    ●   │
│              Note                        │
└──────────────────────────────────────────┘
```

Le séparateur devient horizontal. Chaque volet conserve 280 px minimum ; si la hauteur disponible ne le permet pas, le bureau devient un empilement scrollable par surface plutôt qu’un panneau écrasé.

### 4.5 Enregistrer sous

Le dialogue reste le sélecteur de fichier natif Windows. Pendant son ouverture, `{paneId, tabId, content}` est capturé ; changer de volet ne change pas la cible. En cas d’annulation, aucun toast de succès ni mutation de chemin.

## 5. Interaction specifications

| Élément | Default | Hover / Active | Clavier | Accessibilité |
|---|---|---|---|---|
| Scinder/Réunir | contrôle icône 32 px | fond `surface-hover`, active scale 0,96 | Tab + Entrée/Espace | `aria-pressed`, libellé dynamique |
| Volet | aucun contour matériel | filet intérieur `line-2` quand actif | F6 alterne les volets | `role=region`, `aria-label` avec document |
| Séparateur | ligne visible 1 px, hitbox 11 px | ligne `line-3` au hover/focus | flèches ±5 %, Home/End 25/75 | `role=separator`, `aria-valuenow/min/max` |
| Onglet de volet | onglet raccordé à sa page + chevron | texte renforcé pour le volet actif | Entrée active, chevron puis flèches naviguent, Échap ferme | réutilise le menu compact des onglets, retour au déclencheur |
| Nouvelle note liée | action primaire textuelle | fond encre, active 0,97 | Entrée/Espace | nom explicite, pas seulement une icône |
| Permuter | ligne du menu compact de volet | fond `surface-hover` | flèches + Entrée | libellé explicite « Permuter les volets » |
| Ajouter aux notes | ligne du menu de sélection | même vocabulaire que Copier/Réécrire | flèches + Entrée | absent si indisponible, pas disabled trompeur |

### Motion

- Ouverture/fermeture : 220 ms `cubic-bezier(0.22, 1, 0.36, 1)` sur la base du volet secondaire ; le contenu est déjà visible avant le mouvement.
- Ratio manuel : aucun easing différé ; la surface suit le pointeur image par image via rAF.
- Permutation : 160 ms de translation locale des onglets dans la barre globale seulement ; les documents ne passent jamais par une opacité nulle.
- `prefers-reduced-motion: reduce` : durées 0,01 ms et aucune translation.

## 6. Responsive behavior

| Largeur utile du bureau | Comportement |
|---|---|
| ≥ 960 px | côte à côte, ratio restauré 25–75 % |
| 720–959 px | côte à côte, ratio borné ; deux onglets alignés dans la barre globale |
| < 720 px | empilement vertical automatique ; la barre montre l’onglet du volet actif et son menu compact |
| Hauteur < 600 px en mode vertical | chaque volet min 240 px, scroll propre ; le second volet ne masque pas les contrôles |

Le copilote réduit conserve la largeur existante et réduit le bureau ; si l’espace documentaire tombe sous 720 px, les volets passent verticalement. Le copilote plein écran masque le bureau entier, puis restaure exactement la disposition.

## 7. Accessibility

- Focus order : onglet du volet actif → menu compact → contrôle Scinder → contenu → séparateur → second volet.
- F6 alterne les volets sans déplacer le document dans la barre d’onglets.
- Les deux volets sont des régions nommées ; le volet actif est annoncé « Volet actif : <nom> » via un statut poli uniquement lors du changement clavier.
- Le focus visible atteint 3:1 sur les fonds clair et sombre ; aucune couleur seule ne signale l’état modifié ou actif.
- Le séparateur expose orientation, valeur 25–75 et raccourcis dans son `aria-description`.
- Les notifications d’erreur utilisent le composant global et `role=alert` pour une erreur d’écriture.
- Aucun menu n’est rendu dans un ancêtre `contain: layout paint` s’il risque d’être clippé ; les menus de volet sont rendus à la racine du bureau.

## 8. Open design questions

Aucune question bloquante. Décisions retenues pour le premier incrément :

- pas de raccourci dédié à Scinder ; la découvrabilité du bouton sera observée avant attribution ;
- un lien vers un troisième document remplace le document du volet actif après confirmation si celui-ci est modifié ; sinon il l’affecte directement ;
- l’orientation est automatique seulement ; aucun réglage manuel avant mesure d’usage ;
- le volet principal reste à gauche/en haut, mais « Permuter » échange les documents sans changer l’identité des volets.
