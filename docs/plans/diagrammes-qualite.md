# Plan — Qualité des diagrammes Doku-San

## Objectif

Deux plaintes d'usage : les modèles choisissent mal le genre de diagramme, et
des textes sont **cachés par des blocs** dans les vues d'architecture. Ce plan
corrige d'abord le second, qui est le défaut visible, sans jamais rendre le mode
Diagramme moins fiable qu'il ne l'est aujourd'hui.

_Révisé après critique adverse : l'ordre des étapes a changé, et cinq
affirmations du premier jet étaient fausses (voir « Ce que la critique a
corrigé »)._

## Décisions prises

- **Fork local de bgraph autorisé** par son auteur. Modifications **additives**
  seulement ; la source reste confidentielle, seul `public/bgraph.wasm` est
  versionné.
- **Le bug observé est dans les genres ancrés** — `block`, `free`, `class`,
  `state`, `er`, `network` — ceux où le modèle place lui-même les boîtes.
- **Le modèle local sort du périmètre.** Doku vise le cloud ; le pipeline Ollama
  ne doit pas régresser, et ce plan ne le durcit nulle part.
- **Priorité au filet avant le durcissement.** Aucune porte ne devient bloquante
  tant que l'échec n'est pas amorti.

## Ce que la critique a corrigé

| Affirmation du premier jet | Réalité |
|---|---|
| « Dans bgraph la dernière déclaration `style` gagne » | **Faux.** `style.rs:709-747` : `resolved.insert(nom, style)` dans un `HashMap`. Un second `style block { }` **remplace entièrement** le premier. Injecter une palette effacerait `radius`, `padding`, `font`, `shape` du modèle. La cascade ne vaut que pour `graph { }` (`parser.rs:211` concatène, fusion par propriété). |
| Idem pour les props inline | **Faux.** `style.rs:756` : « defaults ← implicit theme ← listed classes ← **inline props** ». Un `block api "API" { fill: … }` bat toute palette injectée. |
| « `router: ortho → straight` répare exactement » | **Faux.** `check.rs:267` saute toute arête dont `router != Ortho`. Passer en `straight` **désactive le détecteur** au lieu de prouver que la ligne ne traverse plus. |
| « `diagram-studio.ts:207` ne transmet jamais la source » | **Faux.** `previous.candidates` est `DiagramCandidateArtifact[]`, qui contient `source`. Le **planificateur** la reçoit ; c'est l'**ouvrier** (`:245-269`) qui ne l'a pas. |
| « 28 des 30 recettes sont sombres » | **26/30 — et `examples.rs:372`, la recette `block`, est claire (`#f8fafc`) et ne déclare aucun `style block`.** Le genre du bug rapporté est justement l'exception. |
| « `measures`/`events` ne sont lus nulle part » | **Approximatif.** Ils partent dans les prompts via `JSON.stringify(plan.brief)`. Exact : aucun usage **déterministe**. |
| « les 6 littéraux `Diag {` » | **4** : `main.rs:726`, `lsp.rs:1089`, `lsp.rs:1112`, `tests.rs:7586`. |

Les autres `fichier:ligne` du premier jet ont été vérifiés exacts.

## Le constat qui décide de tout

`after_layout` (`check.rs:198-290`) traite **exactement trois cas** :

1. un libellé **d'arête** peint sous un nœud ;
2. un waypoint à l'intérieur d'une boîte ;
3. une route **ortho** qui traverse une boîte.

Il n'existe dans `check.rs` **aucune** détection de recouvrement nœud/nœud,
nœud/groupe, ni de débordement de texte hors de sa boîte — 42 fonctions
`check_*`, aucune ne le fait. Or le prompt Doku impose des `at (x, y)` explicites
(`bgraph.ts:279`, `:288`) : **deux `at` mal choisis superposent deux blocs sans
qu'aucun diagnostic ne le dise.**

Donc : si le texte caché que tu vois est un bloc sous un autre bloc, exposer
`after_layout` ne rapporte rien. C'est pourquoi l'étape 0 existe, et pourquoi le
levier principal est `render_json`, pas `after_layout`.

`render_json.rs:62-92` livre `groups[].rect`, `nodes[].rect` **et** `nodes[].label`
(les lignes déjà découpées), `edges[].label_rect` — en coordonnées canevas. Un
test de recouvrement de rectangles en TypeScript sur ces données couvre les
**quatre** familles de collisions, dont les deux qu'`after_layout` ignore, sans
toucher à `check.rs` ni au type `Diag` public.

## Étape 0 — Reproduire ✅ faite le 2026-08-28

**Bug reproduit, et le pari de l'étape 3 est validé.** 18 sources extraites de
discussions réelles, passées à la CLI `bgraph` compilée depuis le fork :

| | CLI (`after_layout`) | WASM (`bgraph_check`) |
|---|---:|---:|
| Avertissements | **23** | 2 |
| dont libellés masqués | **19** | **0** |

Les **trois** vues `block` que l'utilisateur avait sélectionnées portent chacune
des libellés d'arête masqués (3, 5 et 2). Le défaut est concentré sur `block` et
`state` ; aucun `sequence`, `network`, `gantt` ni `pie` n'est touché.

Le texte caché est donc bien un **libellé d'arête** — le cas n°1 d'`after_layout`.
La crainte « et si c'était du bloc-sur-bloc ? » ne se matérialise pas.

**Réparation nommée par le moteur, absente de tous les plans jusqu'ici :
`label-offset`.** Elle déplace le libellé **sans bouger de boîte** — donc sans la
dérive reprochée au `gap` ×1,25, et sans éteindre le détecteur comme le faisait
`ortho → straight`. C'est la première réparation à tenter.

Fixtures archivées dans `src/lib/__fixtures__/diagrammes/` : 5 porteuses de
défauts, 2 témoins négatifs, avec le défaut attendu de chacune.

_Section d'origine :_ Rien dans le dépôt ne reproduisait le bug ; tout le reste
en dépendait.

1. Récupérer une source réelle qui masque un texte, depuis une discussion.
2. La passer à `bgraph check` en **CLI** — qui appelle déjà `after_layout`
   (`main.rs:737`). S'il sort `label-hidden`, l'étape 3 est justifiée. Sinon,
   c'est un recouvrement de boîtes et seule l'étape 2 le verra.
3. Archiver la source dans `src/lib/__fixtures__/` comme cas de test.

Trente minutes. Cette étape seule décide si l'étape 3 vaut la peine.

## Étape 1 — Le filet ✅ faite le 2026-08-28

Rien ici ne change le comportement visible. Tout ici rend la suite rétractable.

Items 4 et 5 livrés. **Items 6 et 7 reportés à l'étape 2** : un détecteur
d'export et un interrupteur qui ne commandent encore rien seraient des
affordances muettes, ce que la règle du projet interdit (« branché ou retiré,
jamais muet »). Ils arrivent avec les gardes qu'ils pilotent.

4. **Réarmer le WASM après un trap.** `bgraph.ts:42` garde `api` en singleton et
   ne le remet **jamais** à `null` après un chargement réussi (`:58-61` ne traite
   que l'échec du `fetch`). `wasm.rs:72` documente qu'« une panique traversant la
   frontière wasm emporte tout le module ». Les étapes suivantes ajoutent deux
   traversées du solveur : un seul `unreachable` sur une source pathologique
   ferait tomber **toutes** les cartes de la session, archives comprises.
   Envelopper `withSource` : sur `WebAssembly.RuntimeError`, remettre `api` et
   `loading` à `null`, réessayer une fois sur une instance neuve.
5. **Garder la meilleure tentative** au lieu de la dernière, dans les deux
   boucles (`copilot.svelte.ts:1116`, `:1931`). Une source qui rend avec un
   défaut mineur vaut mieux qu'une carte d'erreur.
6. **Détecter la présence des nouveaux exports.** `bgraph.ts:56` fait
   `instance.exports as BgraphExports` sans vérification : sur un `.wasm` non
   forké, `bgraph_layout` lèverait un `TypeError` remonté en « rendu impossible ».
   Vérifier `typeof exports.bgraph_layout === 'function'` au chargement et
   dégrader vers les gardes actuelles. C'est le seul chemin de rollback du
   chantier.
7. **Un interrupteur** `DIAGRAM_STRICT_GEOMETRY` pour désarmer les gardes si
   elles refusent des diagrammes corrects.

## Étape 2 — Voir les recouvrements ✅ faite le 2026-08-28

Mesuré sur les fixtures et sur les 30 recettes officielles :

| | Défauts vus |
|---|---|
| **30 recettes officielles** | **0** — aucune génération n'est bloquée à tort |
| `ffc8c76b-block-1` | `hidden-edge-label`, `overlapping-boxes`, `box-overlaps-group` |
| `1d2a8c88-block-1` | `hidden-edge-label`, `overlapping-boxes` |
| `a759fb64-block-1`, `1d2a8c88-state-3` | `hidden-edge-label` |
| Les 2 témoins négatifs | aucun |

Les gardes voient **plus** que la CLI : `overlapping-boxes` et `box-overlaps-group`
sont invisibles à `after_layout`, qui ne connaît que les libellés d'arête, les
waypoints et les routes ortho. Le pari de l'étape 2 comme levier principal est
confirmé.

**Item 10 (lisibilité) retiré.** Mesurée, la règle signalait tout : à la largeur
de la carte, un canevas de 760 px rend déjà son texte de 13 px à 6,5 px, et les
vues acceptées font 806 à 1377 px de large. Un seuil qui refuse tout ne protège
de rien. À rouvrir avec une mesure, pas avec une intuition.

**Item 12 (compteurs) reporté** : ils ont besoin d'un endroit où vivre, et en
inventer un ici serait hors sujet.

_Section d'origine :_

8. **Rust, additif** : nouvel export `bgraph_layout(ptr, len)` dans `wasm.rs`, sur
   le modèle de `bgraph_render`, rendant `render_json`. Six lignes. `render_json`
   n'est pas derrière un `feature` (`lib.rs:141`) et `serde_json` est une
   dépendance non optionnelle : rien d'autre à changer.
9. **TypeScript** : gardes de recouvrement sur les rectangles nommés —
   - boîte ∩ boîte ;
   - boîte ∩ groupe dont elle n'est pas membre ;
   - `label_rect` d'arête ∩ boîte ;
   - largeur de `label` estimée > largeur de sa boîte.

   Chaque défaut nomme l'élément fautif par son `id` et son libellé, ce qui rend
   le message de correction utilisable par le modèle.
10. **La taille de police effective**, correctement calculée :
    `min(largeur_affichée / canvas.width, 450 / canvas.height)`. La scène est
    `width: 100%; max-height: 450px; object-fit: contain`
    (`CopilotDiagram.svelte:280`) : pour un canevas haut, c'est la **hauteur** qui
    borne. Le ratio d'aspect actuel (`bgraph.ts:190`) ne dit rien de la
    lisibilité.
11. **Ces gardes s'appliquent à la génération, jamais à l'affichage.**
    `renderBgraph` est appelé à **chaque** affichage (`CopilotDiagram.svelte:43`
    et `:70`) : y rendre un défaut bloquant afficherait une carte d'erreur à la
    place de tout diagramme archivé qui masque un texte. `renderBgraph` continue
    de ne bloquer que sur `severity === 'error'` ; les gardes vivent dans une
    porte de génération appelée en `copilot.svelte.ts:1095` et `:1197`
    uniquement — **pas** en `:1909`, qui est la boucle Ollama.
12. **Compteurs**, sans quoi on ne saura pas si ça a marché : combien de défauts
    par code, combien d'appels de correction, combien d'échecs définitifs.

## Étape 3 — ✅ obtenue autrement le 2026-08-28, sans toucher au moteur

**Les items 13 à 16 sont annulés : ils ne sont plus nécessaires.**

Le seul cas qu'il restait à couvrir était la traversée `ortho`. Or `render_json`
donne `edges[].points` — la route **telle que dessinée, coudes compris**. Un test
segment/rectangle en TypeScript la détecte donc directement, et le fait **mieux**
que le moteur : `after_layout` ignore toute arête dont le routeur n'est pas
`ortho`, là où Doku teste la route quel que soit le routeur.

Conséquences :

- **le fork reste à un seul export additif** (`bgraph_layout`), sans passe
  géométrique dans `bgraph_check` ;
- **`Diag` n'est pas modifié** — pas de champ `code`, donc pas de rupture pour
  `main.rs`, `lsp.rs` ni `tests.rs`, et un fork bien plus facile à proposer en
  amont ;
- **aucune table de traduction** : les messages sont écrits par Doku, en français,
  et nomment la boîte fautive.

Couverture finale des fixtures — les 5 porteuses de défauts sont vues, les
2 témoins restent muets, et les **30 recettes officielles ne déclenchent rien** :

| Fixture | Codes |
|---|---|
| `ffc8c76b-block-1` | `hidden-edge-label`, `edge-crosses-box`, `overlapping-boxes`, `box-overlaps-group` |
| `1d2a8c88-block-1` | `hidden-edge-label`, `overlapping-boxes` |
| `a759fb64-block-1`, `1d2a8c88-state-3` | `hidden-edge-label` |
| `a759fb64-bpmn-2` | `edge-crosses-box` |

_Plan d'origine, conservé pour mémoire :_

13. `wasm.rs::bgraph_check` — ajouter la passe géométrique, calquée sur
    `main.rs:663` :
    ```rust
    if let Ok(solved) = crate::layout::solve(&diagram) {
        diagnostics.extend(crate::check::after_layout(&solved));
    }
    ```
14. `check.rs` — `code: Option<&'static str>` sur `Diag`, `None` dans `error()` /
    `warn()` et dans les **4** littéraux hors `check.rs` ; codes stables
    `label-hidden`, `ortho-crosses-box`, `waypoint-inside-box`.
15. Côté TS : `label-hidden` devient bloquant **dans la porte de génération**
    (voir item 11). `ortho-crosses-box` et `waypoint-inside-box` sont journalisés,
    jamais bloquants.
16. Table de traduction FR des codes — les messages du moteur sont en anglais et
    partiraient tels quels dans un prompt français (`bgraph.ts:326`).

## Étape 4 — ✅ faite le 2026-08-28, et pas comme prévu

**L'injection de palette dans la source est abandonnée.** `check.rs:2842`
(`check_contrast`) valide les couleurs de texte **contre le fond déclaré** :
réécrire le fond seul désynchroniserait les textes de leur ground, et pouvait
rendre un libellé d'arête invisible. C'est le second piège de cette idée, après
celui de la cascade `style` relevé par la critique.

La vraie cause était en amont : `buildDiagramCandidatePrompt` ne disait **rien**
de la palette, alors que 26 des 30 recettes servies au modèle sont en fond sombre.
D'où, dans une même réponse, un `block` en `#ffffff` et une `sequence` en
`#0b1120`. Le prompt impose désormais la palette claire et précise explicitement
de ne pas recopier les couleurs des exemples — une ligne, aucun risque de
désynchronisation, et le raisonnement de contraste du moteur reste intact.

Les trois `background: #fff` en dur sont remplacés par `var(--surface-2)` : le
diagramme peint son propre fond, ce qu'on voyait n'était que le letterbox de
`object-fit: contain`, qui posait une dalle blanche en thème sombre.

`alt` vaut désormais `brief.desiredInsight`, avec repli sur le titre.

**L'allowlist SVG complétée** — et la liste du premier jet n'aurait pas suffi : il
manquait l'attribut `dx` (le moteur émet `dx="0"`) et l'attribut `filter`
lui-même, en plus des éléments `filter`/`feDropShadow` et des attributs
`flood-opacity`, `stddeviation`, `stroke-opacity`. La garde `url(#id)` et
l'interdiction des schémas d'URL restent en place, avec un test qui le vérifie.

_Plan d'origine :_

17. **Injecter `graph { background: … }` seulement.** C'est le seul cas où la
    fusion est réelle. **Ne pas injecter de `style <item> { }`** : ça effacerait
    le style du modèle (voir « Ce que la critique a corrigé ») et déclencherait
    en prime le `Diag::warn` « style declared more than once » de `check.rs:354`.
18. Retirer les trois `background: #fff` en dur de `CopilotDiagram.svelte`
    (`:278`, `:321`, `:352`) et re-rendre au changement de thème. La palette est
    appliquée **au rendu**, jamais persistée : la source archivée reste neutre.
19. **Compléter l'allowlist SVG** — la liste du premier jet était incomplète et
    n'aurait pas suffi : il manque l'attribut **`dx`** (`bgraph.ts:106` a `dy`,
    pas `dx`, alors que `render_svg.rs:189` émet `dx="0"`) **et l'attribut
    `filter`** (`render_svg.rs:1007` émet `filter="url(#bg-shadow)"`), en plus des
    éléments `filter`/`feDropShadow` et des attributs `flood-opacity`,
    `stddeviation`, `stroke-opacity`. Tous inertes ; la garde `url(#id)` et
    l'interdiction des schémas d'URL restent en place.
    _Priorité basse : aucune des 30 recettes ne contient `shadow:` ni de couleur
    avec alpha. C'est une panne latente, pas observée._
20. `alt` de l'image : `brief.desiredInsight`, avec repli sur `artifact.title`
    (le chemin Ollama n'a pas de `studio`). Le passage par `<img src="data:…">`
    rend inertes le `role="img"` et les `<title>` que le moteur produit.

## Étape 5 — ✅ faite le 2026-08-28

Champ `offered: boolean` sur les profils. **6 genres retirés du catalogue soumis**
— `wave`, `packet`, `gitgraph`, `harness`, `rack`, `bytefield` : du matériel et de
l'outillage de développement qu'un copilote documentaire n'a pratiquement aucune
chance d'employer à bon escient. Il en reste **24 offerts**, pas la douzaine
annoncée : après m'être trompé en devinant la liste des genres ancrés, je ne
retire que ce qui est manifestement hors sujet. Tout resserrage supplémentaire
devra s'appuyer sur un mauvais choix observé, pas sur une intuition.

`offered` ne filtre qu'à la **planification** : `parsePersistedDiagramStudio`
accepte les 30, donc une discussion archivée qui utilisait un genre retiré
s'ouvre toujours avec son brief et ses variantes. Un test le vérifie dans les deux
sens.

_Plan d'origine :_

21. Champ `offered: boolean` sur les profils de genre, une douzaine offerte au
    prompt. **Pas de suppression** : `parsePersistedDiagramStudio`
    (`diagram-studio.ts:325`) exige un profil connu, et retirer une entrée ferait
    perdre le brief et les variantes de toute discussion archivée qui l'utilisait.

C'est le seul élément de l'ancienne « phase 4 » retenu à ce stade.

## Reporté, avec la raison

## Réparation déterministe ✅ faite le 2026-08-28 — rouverte par la mesure

Le premier smoke réel a montré que les gardes voient juste mais que **la boucle
ne converge pas** : après 3 tours de correction, le modèle n'avait toujours pas
dégagé ses libellés, et le repli retenait la moins fautive des tentatives. D'où
le « c'est moins qu'avant » de l'utilisateur.

La réparation avait été reportée faute de mesure. La mesure existe désormais, et
elle donne une réparation **différente de celles envisagées** — ni `gap`, ni
`ortho→straight`, mais `label-offset`, que le moteur nomme lui-même : elle ne
bouge que le texte, jamais une boîte, donc elle ne peut pas casser la mise en
page. Et sur une arête elle **épingle** le libellé, ce qui empêche le solveur de
le remettre où il était.

| Source réelle | Libellés masqués, avant → après |
|---|---:|
| `new-block-1` (généré ce jour) | 7 → **0** |
| `new-state-3` (généré ce jour, vue retenue) | 4 → **0** |
| `1d2a8c88-block-1` | 3 → **0** |
| `1d2a8c88-state-3` | 5 → **0** |
| `a759fb64-block-1` | 5 → **0** (plus aucun défaut du tout) |
| `ffc8c76b-block-1` | 2 → **0** |
| **Total** | **26 → 0** |

Zéro appel modèle. Trois passes au maximum, parce que déplacer un libellé hors de
sa forme fait suivre le canevas et peut en découvrir un autre ; les déplacements
successifs s'additionnent sur la même arête. La réécriture est prudente : un bloc
étalé sur plusieurs lignes ou une ligne commentée est laissée telle quelle plutôt
que réécrite de travers, et une réparation qui n'améliore pas le compte est
abandonnée.

**Ce qu'elle ne répare pas** : `edge-crosses-box`, `overlapping-boxes` et
`box-overlaps-group` demandent de déplacer une boîte — c'est au modèle, ou au
choix du critique.

| Reporté | Pourquoi |
|---|---|
| ~~**Réparations déterministes**~~ — *faite, voir ci-dessus* | (l'analyse d'origine, conservée) `ortho→straight`, `gap` ×1,25, troncature | La n°1 rend un détecteur muet au lieu de réparer. La n°2 est **inerte sur `block`** : les recettes posent des `gap` par ancre (`gap 150`, `gap 64`), qui surchargent `graph { gap }` ; réparer vraiment exigerait de réécrire chaque clause par regex sur du source modèle. Et ×1,5625 sur toutes les distances allongerait le canevas, dégradant la taille de police effective que l'étape 2 introduit. À rouvrir avec les compteurs de l'étape 2. |
| **Interdire `at (x, y)`** | Contredit la recette que Doku fournit lui-même : `examples.rs:379` et `bgraph.ts:288` posent `at (0, 0)` comme origine obligatoire d'un groupe. Au mieux, n'interdire que les `at` non nuls. |
| **Éligibilité déterministe genre ↔ données** | `parseDiagramStudioPlan` retourne `null` sous 2 candidats (`:196`) : un filtre trop strict casse le mode Diagramme. Exige un plancher explicite — filtrer par score, jamais sous 2, et signaler l'inéligibilité plutôt que supprimer. |
| **Métriques au critique** | Dépend des compteurs de l'étape 2 pour savoir quoi lui donner. |
| **Doku dessine les genres chiffrés** (JSON borné → source générée) | **Tranché par l'utilisateur, donc conservé — mais en dernier.** La critique recommande de le reporter : ça ne touche pas au bug rapporté, ça déplace la frontière de responsabilité modèle/Doku, ça ajoute cinq générateurs et un contrat JSON à maintenir, et son gain n'est chiffré nulle part. Son principal bénéfice annoncé — rendre `qwen2.5:1.5b` capable — est caduc depuis que le modèle local est hors périmètre. **À reconfirmer avant de le lancer.** |
| **« Modifier » qui régénère** | Défaut réel mais mal cerné au premier jet : le planificateur reçoit bien la source, l'ouvrier non. Chantier distinct. |
| **Chevauchements internes aux genres chiffrés** | Les étiquettes de parts et plaques d'axes sont des `annotations` **sans rectangle** dans `render_json` : ni `after_layout` ni les gardes de l'étape 2 ne les verront. `charts.rs` (5 481 lignes) n'a été lu par personne. Le bug rapporté est ailleurs. |
| **Métrologie du français** | `layout.rs:207` couvre `0x20..0x7e`, le reste à 0,56 em. Les caractères français dominants (`é è à ç ù ô`) valent 0,556 en Helvetica, donc **mesurés juste** ; seuls `—` et `…` sont sous-mesurés et `« »` sur-mesurés. Impact plus faible qu'annoncé. |

## Reproductibilité du fork

Non négociable, et absent du premier jet. `/add-ons/` est gitignoré et seul le
`.wasm` est versionné : après le fork, le binaire livré n'est reconstructible par
personne.

- Épingler le commit amont de bgraph dans l'ADR-0028.
- Archiver `bgraph-doku.patch` hors du dépôt public, à côté de la source.
- `npm run build:bgraph` échoue bruyamment si le patch n'est pas appliqué.
- Proposer les exports à l'auteur en amont : c'est la sortie propre du fork.

## Risques

| Risque | Parade |
|---|---|
| Une porte durcie refuse des diagrammes que l'utilisateur trouvait acceptables — il troque « un mot caché » contre « une carte d'erreur après 30 s » | Étape 1 avant tout durcissement ; garde en génération seulement ; interrupteur ; compteurs |
| Un trap WASM brique les cartes de toute la session | Item 4, avant les étapes qui ajoutent des traversées du solveur |
| Le fork diverge et devient irreproductible | Section « Reproductibilité du fork » |
| Les valeurs de `render_json` bougent d'une version à l'autre — son contrat dit la forme stable, pas les valeurs | Ne jamais les persister ; toujours recalculer au rendu |
| La restauration re-rend N × 3 diagrammes en synchrone — l'effet se déclenche dès `alternatives.length >= 2` (`CopilotDiagram.svelte:64-81`), pas à l'ouverture du dialogue | Ne rendre les vignettes qu'à l'ouverture de « Autres vues » ; envisager un export fusionnant check et render |
| Les réparations, si un jour réintroduites, rendent faux les `width`/`height` persistés (`diagram-studio.ts:330`) et l'export SVG | Trancher alors : réparations persistées **ou** rejouées au rendu, jamais les deux |

## Critères d'acceptation

1. La source archivée à l'étape 0 produit un défaut nommé et ne passe pas la
   porte de **génération**.
2. Cette même source, ouverte depuis une discussion existante, **s'affiche
   toujours**.
3. Une demande d'architecture réelle sur OpenAI **et** sur MiniMax rend un
   diagramme sans texte masqué, aux deux thèmes, à largeur normale et à 420 px.
4. Un `.wasm` non forké fait dégrader Doku vers les gardes actuelles, sans erreur
   visible.
5. Le pipeline Ollama rend toujours une vue unique valide, avec le même taux
   d'échec qu'avant le chantier.
6. Les compteurs disent combien de défauts par code et combien d'appels de
   correction, avant et après.

## Vérification

- `npm test -- --run`, `npm run check`, `npm run build`
- Tests des gardes sans LLM : ce sont des fonctions pures sur le JSON de layout.
  Le harnais existe déjà — `bgraph.test.ts:1` tourne en jsdom et charge
  `public/bgraph.wasm` directement.
- Non-régression sur un `messages.json` réel d'avant le chantier.
- Contrôle visuel aux deux thèmes, à largeur normale et à 420 px.
- Smoke réel OpenAI puis MiniMax sur la même demande d'architecture, avec
  redémarrage et restauration de la discussion.
