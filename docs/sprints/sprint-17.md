# Sprint 17

**Goal** : rendre l'édition Markdown **réellement WYSIWYG** — la syntaxe ne se révèle plus que sur demande, les tableaux deviennent saisissables, le formatage courant passe au clavier.
**Start** : 2026-07-30
**End** : 2026-08-10
**Status** : **Done — 4/4** (les quatre stories validées en natif par l'utilisateur)

Premier sprint **issu de l'usage réel** (action High des rétros S15 et S16 : « utiliser Doku pour de vrai, laisser le prochain epic émerger de l'usage »). Il n'est pas né d'un backlog théorique mais d'une friction rencontrée sur un vrai document : un tableau de ~100 clips à qualifier, où cliquer dans une cellule fait tomber le rendu et transforme la saisie en comptage de pipes.

Rappels de cadrage :
- **Cadré par l'[ADR-0017](../adr/0017-revelation-syntaxe-a-la-demande.md)** — amende le volet « syntaxe révélée au curseur » de l'ADR-0002. Le cœur de l'ADR-0002 (buffer Markdown, écriture octet pour octet) est **intouchable**.
- ⚠️ **Le warning critique n°1 du projet s'applique directement ici** : jamais de re-sérialisation du document. Toute écriture est une **édition ciblée** de la portion concernée, jamais une regénération du bloc ou du fichier.
- **20.1 est un socle bloquant** : livré et vérifié **avant** 20.2/20.3/20.4, qui sont tous rattrapés par la syntaxe qui resurgit tant qu'il n'est pas en place.
- **Interdits de sprint** : rouvrir le NPU (ADR-0016), rouvrir le modèle copilote (`qwen2.5:1.5b-instruct-q4_0`), et surtout **rouvrir le débat WYSIWYG type ProseMirror** — mesuré au spike S0 : 0/8 fichiers préservés.

## Stories

| # | Story | Size | Status | Notes |
|---|-------|------|--------|-------|
| 20.1 | Révélation de la syntaxe à la demande (socle) | M | ✅ DONE | Validée en natif 2026-07-30. `revealScopeField` + geste Tab / Ctrl+/ ; ledger flippé |
| 20.2 | Édition en place des cellules de tableau | L | ✅ DONE | Validée en natif 2026-07-30. **2 bugs trouvés par vérif navigateur, invisibles en jsdom** (voir Progress Log) ; ledger flippé |
| 20.3 | Actions de structure du tableau (± ligne, ± colonne) | M | ✅ DONE | Validée en natif 2026-08-10. Codée le 7/08 sans revue, auditée le 10/08 : 6 bugs corrigés (3 chaînes de corruption) ; ledger flippé |
| 20.4 | Formatage sur sélection & insertions de blocs | M | ✅ DONE | Validée en natif 2026-08-10. Détection par l'arbre syntaxique, Prec.highest (piège Mod-i), critic 3 Critical + revue 3 Major ; ledger flippé |

## Blockers
_None_

## Décisions déjà actées (avant dev)

| Sujet | Décision |
|---|---|
| Déclencheur de révélation | **Tab hors tableau** + **Ctrl+/** (global, inchangé). Le curseur seul ne révèle plus rien |
| Tab dans un tableau | **Navigation de cellule**, pas bascule source — sinon on casse l'enchaînement de saisie qui motive le sprint |
| Sortie clavier de l'éditeur | **Échap** (Tab étant pris, ne pas piéger la navigation) |
| Menu d'effets | Greffé sur le **popover de sélection existant** (celui de la reformulation Doku-San) |
| Modèle de données | **Inchangé** — le buffer reste du Markdown (ADR-0002) |

## Points ouverts (à trancher au dev, pas maintenant)

- **Tab en dernière cellule** : créer une nouvelle ligne, ou sortir du tableau ? À éprouver à l'usage sur le vrai document de verdicts.
- **Constructions sans édition évidente en rendu pur** — bloc de code, URL d'un lien, image : geste dédié ou maintien en source, **au cas par cas** (l'ADR-0017 refuse explicitement une règle globale ici).

## Checkpoints STOP/GO

| ~% | Critère | Si STOP |
|---|---|---|
| 25 % (20.1) | Écriture d'un titre/gras/liste **sans voir les marqueurs** ; Tab et Ctrl+/ révèlent ; `roundtrip.test.ts` **vert** | **STOP dur** : si le round-trip casse, on revient à l'état antérieur. La fidélité prime sur le confort — c'est la raison d'être de Doku |
| 50 % (20.2) | Saisie de plusieurs cellules d'affilée au Tab sur le **vrai document de verdicts** (~100 lignes), fichier relu identique hors cellules voulues | Si l'écriture ciblée s'avère non fiable, livrer 20.1 + 20.4 et re-cadrer les tableaux plutôt que de risquer la corruption |
| 100 % (20.3+20.4) | Actions de structure produisent un tableau **toujours valide** ; raccourcis toggle sans empilement | Une story de confort ne justifie pas de sceller un tableau invalide |

## Progress Log

### 2026-07-30
- Sprint planifié : **4 stories**, Epic 20 créé à partir de l'usage réel (premier epic non théorique du projet).
- **ADR-0017 écrit et accepté** avant tout code — la révélation au curseur devient une révélation à la demande ; l'ADR-0002 est amendé sur ce seul volet, son cœur (fidélité) est réaffirmé.
- Décisions actées avec l'utilisateur : Tab contextuel (navigation dans un tableau / bascule hors tableau), Ctrl+/ conservé en bascule globale, menu d'effets greffé sur le popover existant.
- Ledger : +4 entrées (20.1 → 20.4) → **73 features**, 68 PASS, ouvertes : 17.2 (annulée par conception) + 20.1-20.4.
- **20.1 livrée** : `src/lib/editor/reveal.ts` (`revealScopeField` + `setRevealScope`), `activeLineSet` ne peuple plus rien sans geste explicite, keymap Tab/Échap dans `previewExtensions`. Découverte au passage : **Ctrl+Tab était déjà pris** (cycle d'onglets) — Tab nu était libre, pas de collision. Garde `insideTable` posée dès 20.1 pour que 20.2 s'y branche sans re-toucher au keymap. 281 tests verts (7 neufs), round-trip re-prouvé. **Validée en natif par l'utilisateur.**
- **20.2 livrée** : `tableCellSpans` + `escapeCellText` (couche pure, `src/lib/table.ts`) → écriture **ciblée cellule** ; `TableWidget` rend des cellules `contenteditable` avec Tab/Maj+Tab, Entrée (valide), Échap (annule) ; `updateDOM` met à jour en place pour ne **jamais** tuer le focus en cours de frappe.
- ⚠️ **Leçon du sprint (gravée dans AGENTS.md)** : les 10 tests jsdom de 20.2 étaient verts alors que **deux bugs bloquants** subsistaient — le clic sélectionnait le bloc entier, puis (après 1er correctif) la frappe atterrissait **en tête de document**. C'est l'utilisateur qui a signalé le premier et demandé une vraie vérification. Trouvés seulement en pilotant de vrais clics dans un navigateur, puis en **lisant la source via Ctrl+/**. Règle retenue : clic/focus/sélection ⇒ vérif navigateur obligatoire avant de déclarer une story faite.
- Sprint à **2/4** : restent 20.3 (structure du tableau) et 20.4 (formatage & insertions).

### 2026-08-10
- **Découverte** : 20.3 avait été **codée le 7/08 dans la session de polish** (commit `d8bc8e6` : couche pure `applyTableOp` + boutons ± au survol) mais était passée **sans revue, sans vérif navigateur, sans entrée de journal** — exactement le trou que la leçon 20.2 interdit (clic/focus ⇒ vérif navigateur obligatoire).
- Audit EPCT complet : **6 bugs réels corrigés**, tous confirmés par de vrais clics Playwright, dont 3 chaînes de corruption du document :
  1. `updateDOM` réutilisait le DOM après un changement de géométrie → ligne ajoutée invisible, cellules affichant les valeurs d'une autre ligne **qu'un blur committait ensuite dans la source** ;
  2. les listeners du DOM réutilisé gardaient un `this.from` figé → après édition au-dessus du tableau, écritures au mauvais offset → remplacé par `posAtDOM` au moment du geste ;
  3. l'heuristique « ligne à pipe » de `currentTableRange` absorbait un bloc suivant (`- item \| note`) que lezer exclut → réécrit en ligne de tableau → remplacée par le **nœud Table de l'arbre syntaxique** (revue) ;
  4. cellule vide + îlot de boutons non éditable = **frappe muette** (Chromium ne pose pas de caret exploitable) → restructuration : la saisie vit dans un span interne `.cm-lp-cellin`, les boutons ± dans la cellule non éditable ;
  5. cliquer ± avec une saisie en cours perdait le texte tapé → blur/commit forcé avant l'action (revue) ;
  6. Échap restaurait la valeur de création du widget, pas la dernière committée → capture au focus.
- Validations : 371 tests (+4 régressions ciblées sur les bugs ci-dessus), svelte-check 0 err, matrice navigateur complète (± ligne/colonne, saisie clic + Tab dans cellules neuves, refus dernière ligne/colonne, alignements `:--`/`--:` conservés, édition au-dessus puis action, bloc à pipe adjacent intact, deux thèmes, 0 erreur console).
- **20.3 validée en natif par l'utilisateur** (même jour) → ledger flippé, sprint à **3/4**. Reste 20.4 (formatage sur sélection & insertions de blocs, gated 20.1 ✅).
- **20.4 livrée** (même jour, EPCT complet). Couche pure `src/lib/format.ts` (enveloppe, titres, préfixes de ligne, gabarits) + glue `src/lib/editor/format-commands.ts` — la détection « déjà formaté » vient de l'**arbre syntaxique** (nœuds StrongEmphasis/Emphasis/Strikethrough/InlineCode/Link), jamais d'heuristique de chaîne. Ctrl+B/I/K en `Prec.highest` (**le defaultKeymap liait déjà Mod-i** = selectParentSyntax — même piège que Mod-/, attrapé par le critic). Popover : rangée de 5 effets + tiroir « Titres & blocs » (H1-H3, liste, citation, bloc de code, séparateur, tableau), tiroirs mutuellement exclusifs, hauteur mesurée généralisée. 11 icônes ajoutées au subset (94, 13,6 Ko).
- Critic (plan) : 3 Critical évités avant le code — Mod-i déjà lié ; détection par l'arbre (un Ctrl+I dans `` `code *x*` `` aurait supprimé des octets du code) ; `---` collé sous un paragraphe = titre setext. Code-review (diff) : 3 Major corrigés — biais de côté `resolveInner` (Ctrl+B muet en bordure de marqueur) ; zones URL/Image inscriptibles (un gras détruisait le lien) ; opérations de ligne déchiquetant un bloc de code traversé. + setext sans soulignement orphelin, rembourrage des code spans, marqueurs de liste remplacés (jamais `- * item`).
- Décision assumée : Ctrl+B **muet dans une cellule de tableau** (les îlots 20.2 stopPropagation) — no-op accepté, noté ici pour ne pas être redécouvert en bug.
- 415 tests (408 → 415 après régressions de revue ; +48 sur la journée), svelte-check 0 err, vérif navigateur aux vrais gestes (clics + clavier réel, deux thèmes, 0 erreur console).
- **20.4 validée en natif par l'utilisateur** (même jour) → ledger flippé. **Sprint 17 clos à 4/4** — l'édition Markdown est réellement WYSIWYG : syntaxe à la demande, tableaux saisissables et restructurables, formatage au clavier. → `/sprint retro` à la prochaine session.
