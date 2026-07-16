# Handoff : Copilote « Doku‑San » — panneau latéral droit

## Vue d'ensemble
Ajout d'un **assistant IA local (« Doku‑San »)** à l'application Doku (éditeur Markdown/PDF).
L'assistant s'ouvre/se ferme via un **bouton collapse dans le coin haut‑droit du document** et
se déplie en **panneau latéral à droite de la fenêtre**. Le panneau couvre 6 états
(onboarding, conversation vide, génération, conversation nourrie, erreur, gestion des modèles),
en thème **clair (crème)** et **sombre**.

Le tout doit rester cohérent avec l'app existante : palette « AIR » crème, rendu « papier »
du document, chrome discret, boutons‑icônes fantômes, Material Symbols Rounded.

---

## À propos des fichiers de ce bundle
Les fichiers `.dc.html` sont des **références de design produites en HTML** (prototype montrant
l'aspect et le comportement voulus), **pas du code de production à copier tel quel**.
La tâche est de **recréer ces écrans dans l'environnement du dépôt Doku** (Svelte + TypeScript,
d'après la structure `src/components/*.svelte`, `src/lib/stores.ts`, `src/app.css`), en réutilisant
ses composants, ses stores et ses tokens CSS existants.

- `Copilote Panneau.dc.html` — le prototype complet (template + logique + états).
- `support.js` — runtime du prototype. **Ne PAS porter** : purement l'outillage de rendu du
  prototype. Sert uniquement à ouvrir le `.dc.html` dans un navigateur pour inspection.
- `screens/` — captures de tous les états (voir plus bas).

Ouvrir le prototype : ouvrir `Copilote Panneau.dc.html` dans un navigateur. En haut, une **barre
de démonstration hors‑produit** permet de parcourir les 6 états et de basculer clair/sombre —
elle ne fait **pas** partie du produit, ne pas la porter.

## Fidélité
**Haute fidélité (hifi).** Couleurs, typographie, espacements, rayons et interactions sont
définitifs. Reproduire au pixel près en réutilisant les composants/tokens Svelte existants de Doku.

---

## Tokens de design (source de vérité)

Le prototype redéclare les tokens « AIR » déjà présents dans `src/app.css`. **Réutiliser ceux du
dépôt** ; ci‑dessous les valeurs exactes pour vérification.

### Thème clair
```
--desk:          #dedacf   /* fond bureau derrière la fenêtre */
--cream-base:    #F4F1E9   /* chrome de la fenêtre (sidebar, titlebar) */
--cream-content: #FDFBF5   /* surface « papier » (document + carte chat) */
--cream-soft:    #F9F5EC
--cream-tint:    #EFEAE0   /* couche « tête » des cartes imbriquées */
--surface:       #FBF7ED
--surface-2:     #F4EFE2   /* bulles utilisateur, tuiles, tiroir stats */
--code-bg:       #F1ECDF
--ink (rgb):     28,26,22  /* texte principal */
```
Encre dérivée par opacité sur `--ink-rgb` :
`--ink-2:.90  --ink-3:.75  --ink-4:.62  --ink-5:.48`
Lignes : `--line-1:.12  --line-2:.18  --line-3:.28`
Survol/accent : `--surface-hover: rgba(ink,.03)  --accent-soft: rgba(ink,.08)`

### Thème sombre (`[data-theme="dark"]`)
```
--desk:          #161619
--cream-base:    #25252A
--cream-content: #2E2E34
--cream-soft:    #36363D
--cream-tint:    #3D3D44
--surface:       #35353B
--surface-2:     #3D3D45
--code-bg:       #3A3A43
--ink (rgb):     235,237,241
--ink-2:.94   --line-1:.14  --line-2:.22  --line-3:.32
--surface-hover: rgba(ink,.08)  --accent-soft: rgba(ink,.10)
```

### Statuts (identiques aux 2 thèmes)
```
--ok:   #6BA47B   (vert — modèle actif, points de statut)
--warn: #D4A23E
--err:  #C45F4F   (rouge — suppression, bouton fermer au survol)
```
**Seule touche de couleur du panneau = `--ok`** (modèle actif). Tout le reste est à l'encre.

### Typographie
```
--font-sans:  'Geist', -apple-system, BlinkMacSystemFont, sans-serif   /* UI */
--font-mono:  'Geist Mono', ui-monospace, monospace                    /* noms de modèles, chemins, code */
--font-serif: 'Source Serif 4', 'Iowan Old Style', Georgia, serif      /* corps du document « papier » */
```
Google Fonts : `Geist 300/400/500/600`, `Geist Mono 400/500`, `Source Serif 4 (opsz 8..60)`.
Icônes : **Material Symbols Rounded** (les mots dans le proto — `search`, `folder_open`,
`spa`, `layers`, etc. — sont des noms d'icônes, pas du texte).

### Rayons
`6–8px` boutons/onglets · `11–14px` cartes internes · `14px` coins extérieurs document/chat ·
`16–19px` cartes « imbriquées » · `999px` pastilles.

---

## Structure de la fenêtre

Fenêtre = flex **row** : `[ Sidebar ] [ Zone principale (col) ] [ Panneau Copilote (aside) ]`.

Point clé demandé par le client (à respecter précisément) :
- Le **header (titlebar) est une bande continue** sur toute la largeur ; les contrôles fenêtre
  `— ▢ ✕` sont **tout à droite**.
- La **séparation verticale document/chat ne commence que SOUS le header** (bordure gauche sur le
  corps du chat, jamais dans le header).
- **Arrondis seulement aux extrémités extérieures** : coin **haut‑gauche du document** et coin
  **haut‑droit du chat**. La jonction document↔chat est **à angle droit** (pas d'arrondi au milieu).
- Pas de trait horizontal en haut du chat ; uniquement la bordure verticale de séparation.

### Bouton collapse (ouverture/fermeture du chat)
- **Emplacement** : coin **haut‑droit du document**, petit bouton absolu (`top:9px; right:12px`),
  28×28, icône 17px, couleur `--ink-4`, survol `--surface-hover`/`--ink`.
- **Icône** : le même glyphe « panneau » SVG que le bouton de repli de la sidebar (à gauche du
  header), mais **inversé horizontalement** (`transform: scaleX(-1)`) pour pointer vers la droite.
  Voir le SVG exact dans le prototype (viewBox `-0.5 -0.5 16 16`, stroke 1.3).
- Bascule `chatOpen`. Quand **fermé** :
  - le panneau chat disparaît,
  - les contrôles fenêtre `— ▢ ✕` reviennent dans le header principal,
  - le **coin haut‑droit du document s'arrondit** (`border-radius: 14px 14px 0 0`).
  Quand **ouvert** : document `14px 0 0 0` (haut‑gauche seul), contrôles fenêtre dans l'en‑tête du chat.

---

## Panneau Copilote

- Largeur fixe **344px**, pleine hauteur, fond `--cream-base`, apparition animée
  `doku-panel-in` (200ms, `translateX(14px)→0` + fondu, easing `cubic-bezier(.22,1,.36,1)`).
- **En‑tête (40px)**, aligné avec le titlebar : titre **« Doku‑San »** (12.5px, 600, `--ink-2`) à
  gauche ; à droite, bouton **gérer les modèles** (icône `layers`), séparateur, puis contrôles
  fenêtre `— ▢ ✕` (fermer → survol fond `--err`, texte blanc).
  - En état **Modèles**, le bouton `layers` est remplacé par une **flèche retour** (`arrow_back`).
- **Corps** : carte `--cream-content`, `border-left:1px solid var(--line-1)`,
  `border-radius:0 14px 0 0`, `overflow:hidden`. Défilement vertical interne.

### Zone de saisie « imbriquée » (états empty / streaming / conversation / error)
Technique **carte‑dans‑carte à chevauchement** (le motif signature du design) :
- Conteneur `border-radius:19px; overflow:hidden; border:1px solid var(--line-2)`.
- **Tête** (`--cream-tint`, padding bas généreux `…22px`) : chips de contexte —
  puce `notes.md` (fond `--cream-content`, bordure, icône `description` + `close`) et bouton
  pointillé **`+ Contexte`**.
- **Tiroir** (saisie, `--cream-content`) qui **remonte par‑dessus la tête** :
  `margin-top:-15px; border-radius:15px 15px 0 0`. Le chevauchement négatif ≈ rayon crée la
  jonction courbe imbriquée. Contient : bouton `+` (joindre), placeholder
  *« Posez une question sur ce document… »*, bouton d'envoi rond (fond `--ink`, flèche `arrow_upward`).
- Sous la carte : disclaimer centré *« Doku peut se tromper — vérifiez les informations importantes. »* (10.5px, `--ink-5`).
- **Pendant la génération**, le bouton d'envoi devient un **bouton stop** (même emplacement, rond
  `--ink`, glyphe `stop` rempli `font-variation-settings:'FILL' 1`).

---

## Écrans / états

Barre de sélection du proto → prop `initialView` : `onboarding | empty | streaming | conversation | error | models`.

### 1. Onboarding (aucun modèle) — `screens/01-onboarding-*`
Centré : tuile 54×54 (`--surface-2`, rayon 15) avec l'icône assistant, titre
**« Activez votre copilote »**, texte expliquant que tout tourne **en local**. Carte modèle
conseillé `qwen2.5:3b` (nom mono + badge « conseillé », « 1,9 Go · léger, rapide »), bouton plein
`--ink` **« Télécharger ce modèle »** (icône `download`). Lien souligné « Voir d'autres modèles »
→ état Modèles.

### 2. Conversation vide — `screens/02-empty-*`
Titre **« Bonjour. »**, sous‑texte, puis 3 **actions document** en liste (cartes cliquables
`--cream-content`, bordure `--line-1`, rayon 11, icône à gauche + `arrow_forward` à droite) :
*Résumer ce document*, *Poser une question dessus*, *Extraire les points clés*.
Zone de saisie imbriquée en bas.

### 3. Génération en cours — `screens/03-streaming-*`
Bulle utilisateur (alignée à droite, `--surface-2`, rayon `13 13 4 13`), puis ligne auteur
(icône assistant qui **« respire »** `doku-breathe` + « Doku‑San ») et **indicateur shimmer** :
4 barres squelette `.doku-skel` (dégradé balayé `doku-shimmer` 1.6s, `background-size:200%`),
largeurs 92/100/78/64 %, délais 0/.15/.3/.45s. Bouton **stop** dans la saisie.

### 4. Conversation nourrie — `screens/04-conversation-*`
Alternance bulles utilisateur / réponses assistant. Réponse riche : paragraphe, **liste à puces**,
`code` inline (`--code-bg`), et un **tableau** (en‑tête `--surface-2`, lignes séparées `--line-1`,
rayon 8, `overflow:hidden`). Chaque réponse a un bouton **copier** (`content_copy`) en haut à droite.

### 5. Erreur — `screens/05-error-*`
Bulle utilisateur puis **carte d'erreur** (bordure `--line-2`, icône `error` en `--err`) :
titre **« La génération a échoué »**, explication, 2 boutons — **Réessayer** (plein `--ink`,
icône `refresh`) et **Vérifier le moteur** (contour) → état Modèles.

### 6. Modèles — `screens/06-models-*`  (page refaite « moderne »)
Sections empilées (gap 20), labels de section 10.5px 600 `--ink-4` lettrage `.06em` :
1. **MODÈLE ACTIF** — **carte hero « imbriquée »** (même technique que la saisie) :
   - Tête `--cream-content` : tuile icône `layers`, nom mono `qwen2.5:3b`, sous‑titre, **pastille
     « Actif »** verte (`--ok`, fond `rgba(107,164,123,.16)`, point qui respire).
   - Tiroir `--surface-2` remontant (`margin-top:-16px; radius 16 16 0 0`) : **3 stats** séparées
     par filets `--line-2` — `3B` PARAMÈTRES · `1,9 Go` DISQUE · `~48 t/s` DÉBIT (valeurs mono `--ink`).
   > Contraste volontairement **doux** (tête `--cream-content` / tiroir `--surface-2`), pas de noir plein.
2. **BIBLIOTHÈQUE** (`2 installés · 6,0 Go`) — lignes modèle (rayon 12) : point de statut
   (plein `--ok` + halo pour l'actif sur fond `--accent-soft` ; cercle vide `--line-3` sinon),
   nom mono, taille (`white-space:nowrap`), bouton `delete` (survol `--err`).
3. **TÉLÉCHARGEMENT** — carte avec **spinner** `progress_activity` en rotation `doku-orbit` (1.4s),
   nom mono, `63 %`, bouton annuler `close`, et **barre de progression shimmer** (piste `--surface-2`,
   remplissage `.doku-skel` à 63 %).
4. **AJOUTER** — champ pilule (icône `search` + placeholder mono + bouton plein `--ink` **« Obtenir »**),
   puis **puces de suggestion** arrondies `999px` (`+ gemma2:2b`, `+ phi3:mini`, `+ codellama:7b`).
   La confirmation de suppression inline (Annuler / Supprimer rouge) figure dans le proto comme motif à réutiliser.

### État replié (chat fermé) — `screens/07-chat-closed-dark`
Document pleine largeur, coins hauts `14px 14px 0 0`, bouton collapse seul dans le coin,
contrôles fenêtre de retour dans le header principal.

---

## Interactions & animations
- **toggleChat** : ouvre/ferme le panneau (déplacement des contrôles fenêtre + rayon document, voir plus haut).
- **toggleTheme** : bascule `[data-theme]` clair/sombre.
- **Navigation d'états** : `layers` → Modèles ; `arrow_back` → conversation ; liens onboarding/erreur → Modèles.
- **Keyframes** (à recréer en CSS dans le dépôt) :
  - `doku-panel-in` — entrée du panneau (200ms).
  - `doku-shimmer` — balayage dégradé, `background-position 200%→-200%`, 1.6s linear infinite (squelettes + barre de téléchargement).
  - `doku-orbit` — rotation 360°, 1.4s linear infinite (spinner).
  - `doku-breathe` — `opacity .45→1` + `scale .9→1.08`, ~1.8–2s ease‑in‑out infinite (icône assistant en génération, point « Actif »).
- **Envoi ↔ Stop** : le bouton rond d'envoi devient bouton stop pendant la génération.
- Survols : boutons‑icônes fantômes → fond `--surface-hover`, texte `--ink` ; bouton fermer → `--err`/blanc ; actions destructives → `--err`.

## État / logique (à mapper sur les stores Svelte de Doku)
- `chatOpen: boolean` — panneau ouvert/fermé.
- `theme: 'light' | 'dark'` — déjà géré par `toggleTheme` dans `src/lib/stores.ts` (réutiliser).
- `view: 'onboarding'|'empty'|'streaming'|'conversation'|'error'|'models'` — état courant du panneau.
- Données réelles à brancher : liste des modèles installés + actif, progression de téléchargement,
  messages de conversation, exécution locale du LLM (cf. `OllamaSpike.svelte` existant).
- Le nom de l'assistant est **« Doku‑San »** ; l'icône par défaut est **`spa`** (Material Symbols).

## Assets
Aucun binaire. Icônes = **Material Symbols Rounded** (police web). Logo Doku = SVG inline
(déjà dans le dépôt, `public/`). Polices = Google Fonts (listées plus haut).

## Fichiers de référence
- `Copilote Panneau.dc.html` — prototype (valeurs exactes : styles inline).
- `screens/*.png` — 6 états × 2 thèmes + état replié.
- Côté dépôt Doku : `src/app.css` (tokens), `src/App.svelte` (shell), `src/components/TitleBar.svelte`
  (header/onglets/contrôles), `src/components/Sidebar.svelte`, `src/lib/stores.ts`.
