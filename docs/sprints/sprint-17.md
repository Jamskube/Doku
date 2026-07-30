# Sprint 17

**Goal** : rendre l'édition Markdown **réellement WYSIWYG** — la syntaxe ne se révèle plus que sur demande, les tableaux deviennent saisissables, le formatage courant passe au clavier.
**Start** : 2026-07-30
**End** : —
**Status** : **In progress — 2/4** (20.1 et 20.2 validées en natif par l'utilisateur)

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
| 20.3 | Actions de structure du tableau (± ligne, ± colonne) | M | ⬜ TODO | Gated 20.2. Maintenir la ligne de délimiteurs cohérente (colonnes + alignements) |
| 20.4 | Formatage sur sélection & insertions de blocs | M | ⬜ TODO | Gated 20.1. Se greffe sur le popover de sélection **existant** (16.1), pas de seconde barre flottante |

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
