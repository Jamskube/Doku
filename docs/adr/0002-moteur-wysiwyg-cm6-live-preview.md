# 0002. Moteur d'édition Markdown : CodeMirror 6 « live preview » (pas de ProseMirror)

**Date** : 2026-07-08 · **Status** : accepted · **Deciders** : nicos (+ Claude, sur mesures du spike S0) · **Tags** : éditeur, wysiwyg, fr-3

## Context

FR-3 du PRD exige une édition « à la Typora » : on édite dans le rendu, la syntaxe du bloc courant se révèle autour du curseur, et la sauvegarde préserve le Markdown source (« identique octet pour octet, hors normalisation documentée »). Deux familles techniques existent : les éditeurs WYSIWYG ProseMirror (le markdown est converti en document riche puis re-sérialisé) et l'approche « live preview » à la Obsidian sur CodeMirror 6 (le buffer *reste* du markdown, des décorations masquent/révèlent la syntaxe). Le spike S0 (`spike/`) a prototypé et mesuré les deux sur la machine cible.

## Decision drivers

- Fidélité round-trip : Doku édite les fichiers **existants** de l'utilisateur — les réécrire à la première sauvegarde est inacceptable
- NFRs perf : documents jusqu'à 5 Mo réactifs, frappe < 33 ms/frame
- FR-3 spécifie précisément « syntaxe du bloc courant visible pendant l'édition, re-rendue en sortant »
- Solo dev : effort maîtrisable, repli défini par le PRD (bascule preview↔source)

## Considered options

### Option 1 : Milkdown (@milkdown/kit 7.21, ProseMirror)
Mesures spike : round-trip **0/8** fichiers du corpus préservés (9-176 lignes de diff : tables re-paddées, `_italique_`→`*italique*`, échappements `\[` injectés, lignes vides) ; 500 Ko chargé en 1 727 ms ; frappe sur 500 Ko à 68,7 ms/frame (~15 fps).
· Pros : vrai WYSIWYG mature, checkbox natives (modèle), écosystème plugins, mini-barre via plugin tooltip.
· Cons : sérialisation remark-stringify **structurellement** normalisante (configurable mais jamais fidèle) ; perf insuffisante dès 500 Ko (2 NFRs violés) ; paradoxalement, « révéler la syntaxe autour du curseur » (FR-3) y serait un développement custom.

### Option 2 : CodeMirror 6 + couche live preview custom
Mesures spike : round-trip **8/8** identiques octet pour octet (par construction — le buffer est la source) ; 500 Ko en 27 ms ; frappe 17,3 ms/frame. Le plugin spike (~170 lignes) démontre : masquage sélectif de syntaxe hors ligne active, checkbox-widgets cliquables réécrivant la source, wikilinks décorés cliquables.
· Pros : fidélité parfaite gratuite ; perf excellente (viewport-only) ; FR-3 est le comportement *naturel* du modèle ; mode source = même composant sans décorations (architecture simplifiée) ; CM6 déjà maîtrisé (KUDE).
· Cons : couche à construire et maintenir soi-même ; points durs connus : **tableaux** (édition inline impraticable → widget rendu + édition au clic), images inline, `atomicRanges`, polissage curseur/copier-coller/IME. Estimation externe : 2-4 semaines de premier jet solide + long tail. Pas de lib drop-in mature (atomic-editor = React ; ixora morte ; rich-markdoc = squelette de référence).

### Option 3 : Tiptap
Écarté sans prototype : mêmes fondations ProseMirror que l'option 1 (mêmes limites round-trip/perf), markdown non first-class.

## Decision

**Choisi : Option 2 — CodeMirror 6 live preview.** Les mesures sont sans ambiguïté : l'option 1 viole le driver n°1 (elle réécrirait chaque fichier ouvert-sauvé) et les NFRs perf, quand l'option 2 les satisfait par construction — et le comportement décrit par FR-3 est exactement le modèle live-preview. L'effort custom est réel mais phasable, adossé aux références publiques (patterns rich-markdoc, design doc codemirror-live-markdown, atomic-editor comme implémentation témoin), avec le repli PRD (bascule source) toujours disponible.

## Consequences

**Positive** : zéro perte/réécriture de données par design ; un seul moteur pour WYSIWYG *et* mode source (Ctrl+/ = toggle des décorations via Compartment) ; perf largement dans les NFRs ; TxtView/HtmlView-source partagent le même socle.
**Negative** : Doku possède sa couche éditeur (~1-3 k lignes à terme) — tests de décorations nécessaires ; les tableaux ne seront pas éditables inline (widget rendu, édition de la source au clic — même compromis qu'Obsidian).
**Risks** : dérive d'effort sur le polissage (curseur autour des widgets, IME, collage) → phasage strict M2 du PRD, les tableaux/images rendus peuvent glisser en v1.5 sans casser le contrat FR-3 ; qualité du plugin maison → s'appuyer sur les patterns documentés et le spike comme base de tests.

## Related

- [ADR-0001](./0001-stack-tauri-svelte.md) — la stack qui fournit CM6
- `spike/README.md` — protocole et mesures complètes · `spike/src/live-preview.ts` — preuve de faisabilité
- `docs/planning/PRD.md` FR-3/FR-5 · `docs/planning/architecture.md` — MarkdownEditor
