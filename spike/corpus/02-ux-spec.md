# UX Specification : Doku

**Date** : 2026-07-08 · **Status** : Reviewed (wireframes et interactions validés le 2026-07-08) · **PRD** : `docs/planning/PRD.md` v1.0

## 1. Design principles

1. **Le document est l'interface** — le chrome (onglets, sidebar, barres) est minimal, discret, et disparaît en mode focus. Rien ne rivalise visuellement avec le contenu.
2. **Immédiat** — aucune attente perceptible : pas de splash screen, pas de spinner pour les cas courants ; si un chargement dépasse 300 ms, indicateur discret en haut de fenêtre.
3. **Motifs connus** — raccourcis Windows standards, comportements d'onglets de navigateur, dialogue de fermeture classique. Zéro apprentissage.
4. **Papier crème** — thème clair crème par défaut (tokens AIR de KUDE), typographie de lecture soignée, contrastes AA sur les deux thèmes.
5. **Clavier d'abord, tactile bienvenu** — toute action a un raccourci ; cibles tactiles ≥ 40 px (Surface Pro 11 = écran tactile).

Objectif émotionnel : **calme et immédiat** — l'app doit donner l'impression d'ouvrir une feuille de papier, pas de lancer un logiciel.

## 2. Information architecture

```
Layout hérité de KUDE (grille CSS : colonne sidebar | titlebar + stage), **à une différence près : repliée, la sidebar disparaît totalement** (largeur 0, pas de rail résiduel — le document prend toute la largeur).

```
Fenêtre unique (instance unique) — grille : [sidebar 0↔240px] × [titlebar 32px / stage]
│
├── Sidebar pleine hauteur (REPLIÉE = INVISIBLE par défaut ; toggle [⫞] titlebar, 220 ms)
│   ├── Wordmark « Doku »
│   ├── 🏠 Accueil (écran d'accueil)
│   ├── 📄 Fichiers  → ouvre le panneau explorateur (FR-6)
│   ├── 🧭 Plan      → ouvre le panneau TOC (FR-10)
│   ├── 🕘 Historique → ouvre le panneau snapshots (FR-12)
│   └── ⚙ Paramètres (pied : thème, largeur de colonne, app par défaut)
│
├── Barre de titre custom 32px (à droite de la sidebar ; pleine largeur quand repliée)
│   ├── [⫞] toggle sidebar · [☰] menu (Ouvrir, Ouvrir dossier, Récents, À propos)
│   └── [📌 épingler] [🌓 thème] [– □ ✕]
│
└── Stage — panneau « inséré » (--cream-content, coins gauches arrondis, hairline)
    ├── Bandeau d'onglets (● = non sauvé) + [+]
    ├── Panneau contextuel 268px (Fichiers / Plan / Historique), sous la titlebar
    ├── Zone document : WYSIWYG (FR-2/3) · source Ctrl+/ (FR-5) · HTML sandbox (FR-8)
    └── Surcouches : mode focus (F9) · dialogues · bannières d'état
```

Tout est à ≤ 2 clics ; les actions quotidiennes (ouvrir, sauver, basculer) à 1 geste. Ctrl+Shift+E / Ctrl+Shift+P ouvrent directement sidebar + panneau Fichiers / Plan.

## 3. User flows

### 3.1 Happy path — retoucher une note

```
Explorateur Windows ──double-clic──▶ Doku (onglet, rendu crème)
        │                                   │ clic dans un paragraphe
        │                                   ▼
        │                          édition en place (syntaxe révélée)
        │                                   │ Ctrl+S
        │                                   ▼
        │                     sauvegarde atomique + snapshot, ● disparaît
        │                                   │ Ctrl+W
        └───────────────────────────────────▶ onglet fermé
```

| Écran | Action utilisateur | Réponse système | État d'erreur |
|---|---|---|---|
| Explorateur | double-clic `notes.md` | fenêtre (ou onglet si déjà lancé) < 1,5 s, rendu | encodage non supporté → écran d'état dédié |
| Document | clic dans un paragraphe | curseur posé, syntaxe du bloc révélée | — |
| Document | frappe | édition en place, `●` sur l'onglet | — |
| Document | Ctrl+S | écriture atomique, `●` disparaît (aucun toast — la disparition du ● suffit) | disque/verrou → bannière rouge + « Enregistrer sous » |
| Document | Ctrl+W | onglet fermé | non sauvé → dialogue Sauver/Ignorer/Annuler |

### 3.2 Premier lancement (sans fichier)

| Écran | Action | Réponse | Erreur |
|---|---|---|---|
| Accueil | lancement depuis le menu Démarrer | écran d'accueil : dropzone + [Ouvrir] + récents (vide au 1er run) | — |
| Accueil | clic « Définir Doku par défaut » | ouvre les paramètres Windows d'association (l'OS garde la main) | — |
| Accueil | glisser un `.md` | ouverture en onglet, l'accueil disparaît | format non supporté → refus doux (bannière 3 s) |

L'écran d'accueil réapparaît quand tous les onglets sont fermés (jamais de fenêtre vide morte).

### 3.3 Récupération d'erreur — fichier modifié/supprimé sous nos pieds

| Cas | Détection | Réponse | Issue |
|---|---|---|---|
| Modifié à l'extérieur, pas d'édits locaux | au focus | rechargement silencieux + mention discrète « Rechargé 14:32 » 3 s | — |
| Modifié à l'extérieur, édits locaux | au focus | bannière ambre : « Modifié à l'extérieur — [Recharger] [Garder ma version] » | choix explicite, jamais silencieux |
| Supprimé/renommé pendant l'édition | au focus / à la sauvegarde | bannière ambre : « Fichier introuvable — [Enregistrer sous…] [Fermer] » | contenu jamais perdu |
| Échec d'écriture | Ctrl+S | bannière rouge + [Réessayer] [Enregistrer sous…] ; le buffer reste intact | — |

### 3.4 États vides

| Contexte | État vide |
|---|---|
| Aucun onglet | écran d'accueil (§3.2) |
| Sidebar Fichiers sur dossier sans fichiers supportés | « Aucun document ici » + [Ouvrir un autre dossier] |
| Sidebar Plan sans titres | « Pas de titres dans ce document » (discret, grisé) |
| Historique sans snapshots | « Les versions apparaîtront après ta première sauvegarde » |
| Wikilink vers note inexistante | dialogue : « `autre-note.md` n'existe pas — [Créer à côté de ce fichier] [Annuler] » |

## 4. Wireframes

### W1 — Fenêtre principale (défaut : sidebar repliée = invisible, WYSIWYG)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [⫞][☰]  Doku                                          [📌][🌓][–][□][✕] │ ← titlebar 32px
├─────────────────────────────────────────────────────────────────────────┤
│ ╭─────────────────────────────────────────────────────────────────────╮ │
│ │ │ notes.md ● │ idées.md │ recette.html │ [+]                        │ │ ← onglets en tête du stage
│ │─────────────────────────────────────────────────────────────────────│ │
│ │                                                                     │ │
│ │            # Mes notes de projet                                    │ │
│ │                                                                     │ │
│ │            Texte rendu, colonne centrée (~72ch), interligne         │ │
│ │            généreux. Un [[wikilink]] et un [lien externe] sont      │ │
│ │            soulignés au survol.                                     │ │
│ │            ┌───────────────────────────────────────┐                │ │
│ │            │ const x = 42   // code coloré         │                │ │
│ │            └───────────────────────────────────────┘                │ │
│ │            - [x] tâche cochée (case cliquable)                      │ │
│ │            - [ ] tâche à faire                                      │ │
│ ╰─────────────────────────────────────────────────────────────────────╯ │
└─────────────────────────────────────────────────────────────────────────┘
   stage = panneau « inséré » --cream-content, coins arrondis, hairline --line-1
```

- Barre de titre custom 32 px (pattern KUDE `TitlebarV2`) : `[⫞]` toggle sidebar, `[☰]` menu, zone vide = drag de fenêtre ; boutons fenêtre 36×32 px, close hover `--err`.
- Sidebar repliée = **totalement absente** (différence voulue vs KUDE : pas de rail 56 px) — la titlebar et le stage occupent toute la largeur.
- Onglets en tête du panneau stage : `●` = non sauvé ; `[+]` ouvre le dialogue Ouvrir ; clic-molette = fermer.
- `[📌]` épinglage toujours-au-dessus (état enfoncé + teinte accent). `[🌓]` bascule crème/sombre.
- États : chargement > 300 ms → fine barre de progression sous la barre de titre ; document énorme → rendu progressif (le haut s'affiche d'abord).

### W2 — Sidebar dépliée + panneau contextuel (ici : Fichiers)

```
┌───────────┬─────────────────────────────────────────────────────────────┐
│ ◆ Doku    │ [⫞][☰]                                     [📌][🌓][–][□][✕] │
│           ├─────────────────────────────────────────────────────────────┤
│ 🏠 Accueil │ ╭───────────────┬─────────────────────────────────────────╮ │
│ 📄 Fichiers◀ │ FICHIERS   [✕]│ │ notes.md ● │ idées.md │ [+]           │ │
│ 🧭 Plan    │ │               │─────────────────────────────────────────│ │
│ 🕘 Histor. │ │ ▸ archives/   │                                         │ │
│           │ │ ● notes.md ◀actif    # Mes notes de projet               │ │
│           │ │   idées.md    │                                          │ │
│           │ │   todo.md     │      Lorem ipsum dolor sit amet…         │ │
│           │ │   img.png (grisé)                                        │ │
│ ⚙ Param.  │ ╰───────────────┴─────────────────────────────────────────╯ │
└───────────┴─────────────────────────────────────────────────────────────┘
 sidebar 240px  panneau 268px           stage
 (pleine hauteur, fond --cream-base, items icône+label 38px, actif --accent-soft)
```

- Sidebar pleine hauteur à gauche de la titlebar (pattern KUDE `SideRail` déplié) : wordmark + logo (`◆` = `src/assets/doku-mark-rounded.svg`, recolorisé en `--ink` via `currentColor`), nav, pied Paramètres. Toggle `[⫞]` (220 ms) ; état persistant.
- **Repliée = largeur 0, invisible** (la différence voulue vs KUDE — jamais de rail icônes seul).
- Panneau contextuel 268 px (pattern KUDE `FileExplorer`) : s'ouvre **sous la titlebar**, dans le stage ; refermable par son `[✕]` ; un seul panneau à la fois (Fichiers / Plan / Historique).
- Fichiers : dossiers d'abord, alphabétique ; actif surligné ; non supportés grisés ; sous-dossiers repliables (`▸`) ; chips d'extension colorées (pattern KUDE).
- Plan : H1-H3 indentés, titre courant en évidence au scroll, clic = scroll animé (200 ms).
- Ctrl+Shift+E / Ctrl+Shift+P : ouvrent directement sidebar + panneau correspondant (et le referment si déjà ouvert).

### W3 — Écran d'accueil (aucun onglet / premier lancement)

```
┌────────────────────────────────────────────────────────────────────────┐
│ [☰]                                                     [📌][🌓][–][□][✕]│
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│                               Doku                                     │
│                  Lire et écrire, sans friction.                        │
│                                                                        │
│              ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                      │
│                 Glisse un fichier ici                                  │
│              └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                      │
│                                                                        │
│              [ Ouvrir un fichier  Ctrl+O ]  [ Ouvrir un dossier ]      │
│                                                                        │
│              Récents                                                   │
│                notes.md            G:\Notes          hier              │
│                brief.html          G:\Docs           lun.              │
│                                                                        │
│              ☐ Définir Doku comme app par défaut pour .md              │
└────────────────────────────────────────────────────────────────────────┘
```

- Récents : 8 max, chemin + date relative ; Entrée ouvre le premier ; liste navigable aux flèches.
- La case « app par défaut » disparaît une fois l'association faite (ou si refusée deux fois — pas de harcèlement).
- Premier lancement : récents absents, la dropzone domine.

### W4 — Mode focus (F9)

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│               # Mes notes de projet                                    │
│                                                                        │
│               Rien d'autre que le document. Pas d'onglets,             │
│               pas de sidebar, pas de boutons.                          │
│                                                                        │
│                                                       (Échap · souris  │
│                                                        en haut = barre)│
└────────────────────────────────────────────────────────────────────────┘
```

- Entrée/sortie : F9 ; Échap sort ; amener la souris en haut révèle temporairement la barre d'onglets (auto-masquée après 2 s).
- L'édition WYSIWYG reste active — focus ≠ lecture seule.
- Transition : fondu 150 ms (pas de zoom/slide).

### W5 — Surcouches : dialogue, bannière, historique

```
Dialogue fermeture non sauvée          Bannière (sous la barre de titre)
┌──────────────────────────────┐      ┌─────────────────────────────────────┐
│  notes.md a des modifications│      │ ⚠ Modifié à l'extérieur —           │
│  non enregistrées.           │      │   [Recharger] [Garder ma version]   │
│                              │      └─────────────────────────────────────┘
│ [Enregistrer] [Ignorer]      │       ambre = récupérable · rouge = échec
│              [Annuler]       │       + icône + texte (jamais couleur seule)
└──────────────────────────────┘

Panneau Historique (FR-12, via 🕘 dans la sidebar — même emplacement que Fichiers/Plan)
┌──────────────── notes.md — versions ──┐
│ Aujourd'hui 14:32   (courant)         │
│ Aujourd'hui 09:15   [Aperçu][Restaurer]│
│ Hier 18:40          [Aperçu][Restaurer]│
│ …purge auto : 20 versions / 30 jours  │
└───────────────────────────────────────┘
```

- « Restaurer » snapshotte d'abord l'état courant (filet de sécurité PRD FR-12), puis confirme en une ligne.
- « Aperçu » ouvre le snapshot en onglet lecture seule (badge « version du 07/07 18:40 »).

## 5. Interaction specifications

### 5.1 Raccourcis clavier (complets — NFR accessibilité)

| Raccourci | Action |
|---|---|
| Ctrl+O / Ctrl+Shift+O(dial.) | Ouvrir un fichier / un dossier |
| Ctrl+S | Enregistrer |
| Ctrl+W · Ctrl+Shift+T | Fermer l'onglet · rouvrir l'onglet fermé |
| Ctrl+Tab / Ctrl+Shift+Tab · Ctrl+1…9 | Onglet suivant/précédent · onglet n |
| Ctrl+/ | Bascule WYSIWYG ↔ source |
| Ctrl+Shift+E · Ctrl+Shift+P | Sidebar Fichiers · sidebar Plan |
| F9 · Échap | Mode focus · sortir (focus, dialogues, sélection) |
| F11 | Plein écran |
| Ctrl+B / Ctrl+I / Ctrl+K | Gras / italique / lien (WYSIWYG) |
| Ctrl+F | Recherche dans le document (barre en haut à droite) |
| Ctrl+molette / Ctrl+0 | Zoom texte / réinitialiser |

(Ctrl+Shift+O dialogue dossier vs sidebar Plan : conflit résolu — Plan passe sur **Ctrl+Shift+P**.)

### 5.2 Éléments interactifs

| Élément | Type | États | Comportement | Accessibilité |
|---|---|---|---|---|
| Onglet | bouton | défaut → hover (croix visible) → actif (fond contenu) → non-sauvé (●) | clic = activer ; molette = fermer ; drag = réordonner ; double-clic zone vide = nouvel onglet | `role=tab`, `aria-selected`, flèches ←→ naviguent, Suppr ferme |
| Case à cocher de tâche (rendu) | checkbox | défaut → hover → cochée | clic coche/décoche et **modifie la source** (`- [ ]`↔`- [x]`), marque non-sauvé | vraie `<input type=checkbox>`, focusable, Espace |
| Wikilink | lien | défaut (teinte accent) → hover (souligné) → cible manquante (pointillé) | clic = ouvrir en onglet ; Ctrl+clic = arrière-plan ; manquant → dialogue de création | `role=link`, title = chemin résolu ou « créer » |
| Lien externe | lien | comme wikilink + icône ↗ discrète | clic = navigateur par défaut (jamais dans l'app) | annonce « lien externe » |
| Bouton 📌 | toggle | off → hover → on (enfoncé, teinte accent) | fenêtre toujours-au-dessus | `aria-pressed`, label « Toujours au-dessus » |
| Bouton 🌓 | toggle | crème ↔ sombre | bascule instantanée (pas de fondu), persistée | `aria-pressed`, label « Thème sombre » |
| Bannières | alerte | ambre (récupérable) / rouge (échec) | boutons d'action inline ; pas d'auto-dismiss si action requise | `role=alert` (annonce lecteur d'écran), icône + texte |
| Barre de recherche (Ctrl+F) | input | apparaît en haut à droite, compteur n/N | Entrée/Maj+Entrée = suivant/précédent ; Échap ferme ; surlignage des occurrences | focus piégé dans la barre, `aria-live` pour n/N |
| Poignée sidebar | slider | invisible → hover (barre accent 2 px) | drag redimensionne (180-400 px) | focusable, flèches ←→ ±10 px |

### 5.3 WYSIWYG — comportement d'édition (FR-3)

- **Révélation de syntaxe** : le bloc contenant le curseur montre ses marqueurs (`##`, `**`, `` ` ``) en encre atténuée (`--ink-3`) ; en sortant du bloc, re-rendu à 100 ms de debounce. Aucun autre bloc n'est affecté.
- **Sélection** : sélectionner du texte affiche une mini-barre flottante `[B] [I] [🔗] [</>]` au-dessus de la sélection (150 ms de délai pour éviter le flicker) ; Échap la masque. Uniquement en WYSIWYG, jamais en mode source.
- **Entrées intelligentes** : `- ` en début de ligne → liste ; `# ` → titre ; ` ``` ` → bloc de code ; collage d'une URL sur une sélection → lien. Toujours annulables d'un Ctrl+Z (l'auto-formatage compte comme une étape d'undo distincte).
- **Curseur** : jamais perdu — la bascule Ctrl+/ (WYSIWYG↔source) conserve la position ; undo/redo conservés par mode au minimum (PRD FR-5).

### 5.4 Animations

| Contexte | Animation | Durée |
|---|---|---|
| Ouverture/fermeture sidebar & tiroir | slide + fondu | 150 ms ease-out |
| Mode focus in/out | fondu du chrome | 150 ms |
| Scroll TOC / ancres | scroll doux | 200 ms |
| Bannières | slide down | 120 ms |
| Re-rendu d'un bloc WYSIWYG | aucun (instantané — tout mouvement serait du bruit) | — |

Toutes les animations respectent `prefers-reduced-motion` (désactivées).

## 6. Responsive behavior

App desktop fenêtrée — le « responsive » = largeurs de fenêtre (snap Windows, Surface en portrait) :

| Largeur fenêtre | Comportement |
|---|---|
| ≥ 1100 px | sidebar (240) + panneau (268) poussent le contenu ; colonne de lecture centrée selon réglage (~65ch/~80ch/pleine) |
| 700-1100 px | sidebar + panneau **recouvrent** le contenu (overlay + voile), se referment au clic dehors |
| < 700 px (snap ⅓, portrait étroit) | onglets compactés (titre tronqué, croix au hover seulement) ; boutons 📌🌓 repliés dans [☰] ; colonne pleine largeur avec marges 24 px |
| Tactile (Surface) | cibles ≥ 40 px (onglets, boutons barre, items sidebar) ; scroll inertiel natif ; appui long = menu contextuel |

## 7. Accessibility

Checklist (engagements v1, vérifiés à `/visual-check` et en revue) :

- [x] Toutes les actions au clavier (tableau 5.1 exhaustif ; aucune action souris-seulement)
- [x] Ordre de focus = ordre visuel (barre de titre → sidebar → document → surcouches)
- [x] La couleur n'est jamais seule : ● non-sauvé doublé du title « non enregistré » ; bannières icône + texte ; wikilink manquant pointillé + title
- [x] Contraste AA : encre `#1C1A16` sur crème `#FDFBF5` ≈ 15:1 ✓ ; vérifier les états atténués (`--ink-3+`) ≥ 4,5:1 et UI ≥ 3:1 sur les deux thèmes
- [x] Erreurs annoncées : bannières en `role=alert`, compteur de recherche en `aria-live=polite`
- [x] Images : alt du Markdown restitué ; placeholder d'image manquante avec texte
- [x] Hiérarchie de titres du rendu = celle du document (pas de remapping)
- [x] Focus visible : anneau 2 px teinte accent, jamais supprimé
- [x] `prefers-reduced-motion` respecté

## 8. Open design questions

1. ~~Mini-barre de formatage à la sélection~~ → **validée** (2026-07-08), spec §5.3.
2. ~~Compteur de mots~~ → **non** — zéro chrome, esprit papier (2026-07-08).
3. ~~Set de raccourcis~~ → **validé** (2026-07-08), tableau §5.1.
4. ~~Sidebar/header à la KUDE~~ → **intégré** (2026-07-08) : layout KUDE (sidebar pleine hauteur + titlebar 32 px + stage inséré), avec pour différence que la sidebar repliée est **totalement invisible** (0 px, pas de rail résiduel). Spec §2, §4 W1/W2.
5. **Récents épinglables** sur l'écran d'accueil — utile ou superflu pour un usage mono-utilisateur ? (défaut v1 : non)
6. Détails visuels fins (courbes des onglets, iconographie, micro-typographie) → à traiter avec **Claude design** sur la base des tokens AIR, hors périmètre de cette spec.
