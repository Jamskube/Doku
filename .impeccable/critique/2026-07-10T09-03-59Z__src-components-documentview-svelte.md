---
target: DocumentView
total_score: 25
p0_count: 1
p1_count: 1
timestamp: 2026-07-10T09-03-59Z
slug: src-components-documentview-svelte
---
Method: dual-agent (A: design-review · B: detector+deterministic) — both ran as isolated parallel sub-agents; detector ran (detect.mjs exit 2).

# Critique — DocumentView (surface document de Doku)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | caption `path · enregistré/modifié [· source]` + dirty-dot clairs ; mais le bouton largeur n'indique aucun état courant, pas de feedback « sauvegarde en cours » |
| 2 | Match System / Real World | 4 | métaphore papier, FR clair (« enregistré/modifié »), icônes familières ; « source » = léger jargon |
| 3 | User Control & Freedom | 2 | Ctrl+/ n'a aucun affordance et exécute un effet de bord **destructif** sans opt-out |
| 4 | Consistency & Standards | 2 | le rendu HTML abandonne le design system (Times, collé à gauche) ; bloc code invisible en dark |
| 5 | Error Prevention | 0 | **Ctrl+/ commente silencieusement la ligne courante et salit le doc** — la pire faille ici |
| 6 | Recognition over Recall | 2 | mode source invisible/clavier-only ; bouton largeur cycle 3 états cachés |
| 7 | Flexibility & Efficiency | 3 | modèle clavier riche (save/close/cycle/source/focus/sidebar/largeur), mais Ctrl+/ est piégé |
| 8 | Aesthetic & Minimalist | 4 | la surface de lecture markdown est exemplaire ; léger bruit des ✕ d'onglets toujours visibles |
| 9 | Error Recovery | 3 | bandeau de modif externe nomme fichier + conséquence + Recharger/Ignorer ; sur-alarme quand la copie locale est propre |
| 10 | Help & Documentation | 2 | l'état vide enseigne Ctrl+O, tooltips présents ; mode source non documenté in-app |
| **Total** | | **25/40** | **Acceptable — améliorations réelles nécessaires** |

## Anti-Patterns Verdict

**LLM (revue design)** : la **surface WYSIWYG markdown n'est PAS du slop** — calibre iA Writer/Typora, un utilisateur fluent la trouve digne de confiance d'emblée (Source Serif 18,5px/1,78, colonne centrée ~680px, marqueurs live-preview atténués, panneaux code crème, cases à cocher encrées). L'outil s'efface dans la lecture, exactement ce que le register produit exige. **Mais deux chemins cassent cette confiance** : (1) ouvrir un `.html` retombe en Times New Roman brut collé au bord gauche ; (2) le geste annoncé du mode source (Ctrl+/) corrompt le document.

**Scan déterministe (detect.mjs, exit 2)** : **1 seul warning** — `layout-transition` sur `Sidebar.svelte:153` (`transition: width`). DocumentView.svelte lui-même = **0 finding**. Le warning est un cas défendable (panneau repliable one-shot 220ms, déjà couvert par `prefers-reduced-motion`) → non bloquant. Le détecteur ne « voit » pas les vrais problèmes de fond, révélés par l'analyse statique de B : **aucun état `:focus-visible`/`:active` conçu nulle part** dans les 5 composants (l'app repose sur le ring UA par défaut, et l'éditeur *supprime* le sien), et le token texte `--ink-5` **échoue à 4,5:1** (3,06 light) dans Sidebar/TitleBar.

**Convergence A/B** : les deux relèvent le `transition: width` (mineur). B quantifie ce que A pressentait sur le contraste ; A explique le « pourquoi UX » de ce que B mesure.

## Overall Impression
Le cœur — lire/éditer du Markdown — est de très haut niveau et tient la promesse « une feuille de papier ». Mais la surface est plombée par **un bug de perte de données** (Ctrl+/ commente la ligne) qui contredit frontalement le principe #1 « zéro perte », un **rendu HTML non stylé** qui fait paraître l'app incapable de rendre son propre format, et un **dark mode non vérifié** (collision de tokens). La plus grande opportunité : réparer le geste source et hisser HTML + dark au niveau du markdown.

## What's Working
1. **La surface WYSIWYG elle-même** (`editor.ts` `dokuTheme`+`dokuHighlight`) : restraint typographique + rampe d'encre sans accent + blanc généreux → le document parle, l'outil s'efface.
2. **Message de perte de données honnête** (bandeau reload d'`App.svelte`) : nomme le fichier, la conséquence, offre Recharger ET Ignorer — la réassurance au bon moment, bien faite.
3. **Efficacité clavier + état vide pédagogique** : la marque Doku + « Ouvrir un fichier » + puces `Ctrl` `O` enseignent le geste quotidien au lieu de le cacher.

## Priority Issues

**[P0] Ctrl+/ commente la ligne courante en basculant en mode source.**
Pourquoi : quand l'éditeur a le focus (cas normal en édition), Ctrl+/ déclenche `toggleComment` de CodeMirror (`Mod-/`, embarqué dans `minimalSetup`) **en plus** du toggle `sourceMode` d'`App.svelte`. La ligne courante est enveloppée dans `<!-- -->`, le doc passe « modifié », et en WYSIWYG le titre disparaît. Reproduit proprement. Cause : `baseExtensions` (editor.ts:186) inclut `minimalSetup` (→ `defaultKeymap`) et `keymap.of([])` (l.191) n'annule rien. Viole le principe #1 (zéro perte) et Error Prevention. **Note : ceci ré-ouvre la story 3.6 — le « retour sans perte » échoue quand l'éditeur a le focus.**
Fix : neutraliser `Mod-/` dans CM — binding `Prec.highest` `Mod-/` → no-op qui `return true`, ou porter le toggle source dans le keymap CM. Vérifier avec un contrôle d'historique/undo.
Command : `/impeccable harden` (ou correctif ciblé `editor.ts`).

**[P1] Le rendu HTML est non stylé et mal aligné.**
Pourquoi : `recette.html` s'affiche en Times New Roman brut, collé à gauche (~8px), ignorant la typo AIR et la colonne centrée — alors que la caption au-dessus est correctement dans les 680px. Lecture « cassé/inachevé » ; Doku paraît incapable de rendre son propre format.
Fix : injecter une feuille de base dans `sandboxDoc()` (`src/lib/html.ts`) — stack Source Serif/Geist, couleurs `--ink`, `max-width:680px; margin:0 auto`, padding aligné sur `.cm-content`, fond crème.
Command : `/impeccable shape` (chemin de rendu HTML).

**[P2] Dark mode : `--surface` == `--cream-content` → blocs code invisibles.**
Pourquoi : en tokens dark (`app.css`), `--surface: #2E2E34` est **identique** à `--cream-content: #2E2E34`. `.cm-lp-codeblock`, `.empty-open`, `.width-btn` perdent tout contraste figure/fond en sombre.
Fix : donner à `--surface` dark une valeur distincte (ex. `#35353B`) ou ajouter `1px solid var(--line-1)` sur `.cm-lp-codeblock`.
Command : `/impeccable colorize` (tokens dark).

**[P2] Aucun état focus-visible/active conçu sur les contrôles interactifs.**
Pourquoi : aucun `:focus-visible` ni `:active` dans les 5 composants ; l'éditeur *supprime* son outline (`editor.ts:44`). L'app repose sur le ring UA par défaut — pas de focus au design system AIR (règle produit default/hover/focus/active). Gap le plus systémique et objectif.
Fix : définir un ring focus-visible AIR (ex. `outline: 2px solid var(--ink-3); outline-offset: 2px`) appliqué globalement aux contrôles ; réintroduire un focus visible dans l'éditeur.
Command : `/impeccable audit` (a11y) / `/impeccable harden`.

**[P2] `--ink-5` texte échoue 4,5:1 (3,06 light).**
Pourquoi : le token `--ink-5` (.48) composité sur crème = ~3,06 (light)/4,14 (dark) — sous le seuil corps. Pas dans DocumentView (plancher `--ink-4` passe, 4,78 borderline) mais dans Sidebar (`.empty` hints, `.purge`) et TitleBar (`.parent` différenciateur d'homonymes), tous < 18px.
Fix : pour du texte, remonter les usages `--ink-5` vers `--ink-4`, ou assombrir `--ink-5`.
Command : `/impeccable colorize` / `/impeccable audit`.

## Persona Red Flags

**Alex (power user)** : son premier réflexe — Ctrl+/ pour jeter un œil au markdown brut — **corrompt son document à chaque fois** (collision keymap `editor.ts`), silencieusement jusqu'à ce que son H1 disparaisse. Pas de toggle source découvrable ; `.width-btn` sans feedback d'état ; un `.html` qu'il a écrit s'affiche en Times brut. Éléments cassés : handler Ctrl+/, `.width-btn`, iframe `.html-view`.

**Sam (accessibilité/clavier/contraste)** : le Ctrl+/ destructif frappe le plus fort un utilisateur clavier — son mode d'interaction principal est piégé. Aucun état focus-visible conçu ; contrôles icône-only sans annonce d'état (largeur, pin, thème). `.caption` `--ink-4` ~4,78:1 (light) passe AA mais au plancher à 12px mono ; `tags.url`/`tags.meta` en `--ink-5` (~3,3:1) échouent AA là où ils portent du sens. ✕ d'onglets = cibles 18×18 (sous 24 AA 2.5.8).

## Minor Observations
- Bouton largeur : 3 états sans indicateur de position courante.
- Listes à puces : marqueur `-` littéral en WYSIWYG (choix iA défendable, mais surprend les habitués de Typora).
- `.cm-lp-wikilink` (accent-soft .10) quasi invisible en dark (pilule faible vs soulignement 1px).
- Le bandeau reload se déclenche même quand la copie locale est non modifiée, où « vos modifications locales seront perdues » est faux et sur-alarmant.
- ✕ d'onglets toujours visibles → bruit vs « le chrome s'efface » (révéler au hover/actif).
- `.caption` en `user-select: text` : le chemin fichier est copiable — bon détail.

## Questions to Consider
1. Si Ctrl+/ est *le* geste pour voir le markdown brut, pourquoi mute-t-il aussi le document — et combien de titres ont été commentés à l'insu de l'utilisateur ?
2. Doku rend le Markdown comme « une feuille de papier » mais le HTML comme un défaut navigateur de 1996 — le HTML est-il citoyen de première classe, ou un après-coup qui sape « le document parle » ?
3. Les tokens distinguent `--surface` de `--cream-content` en light mais les confondent en dark — le thème sombre est-il *conçu*, ou le light inversé et livré non vérifié ?
