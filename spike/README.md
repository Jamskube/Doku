# Spike S0 — moteur WYSIWYG Markdown

**But** (défini dans `docs/planning/architecture.md`) : départager les deux candidats pour le `MarkdownEditor` de Doku (FR-3, édition à la Typora) et produire l'ADR-0002.

| | A — Milkdown (ProseMirror) | B — CodeMirror 6 « live preview » |
|---|---|---|
| Modèle | markdown → doc ProseMirror → markdown (sérialisation remark) | le buffer **est** le markdown, décorations par-dessus |

## Protocole

`npm install` puis `npm run dev` — deux pages : `/a-milkdown.html`, `/b-cm6.html`.

1. **Round-trip** (bouton) : chaque fichier de `corpus/` (7 vrais documents du projet + 1 fichier piège) est chargé puis re-sérialisé sans aucune édition ; on compare octet pour octet, diff ligne à ligne sinon.
2. **500 Ko** (bouton) : chargement chronométré de `09-stress-500k.md` (5 378 blocs variés).
3. **Frappe** (bouton) : 80 caractères insérés un par frame, on mesure l'écart moyen / p95 / max entre frames.
4. **Faisabilité** : checkbox de tâches cliquables et wikilinks `[[…]]` cliquables, vérifiés à la main dans les deux prototypes.

## Résultats

_À compléter à l'issue du run — voir ADR-0002 pour le verdict._

## Notes de périmètre

Le plugin `src/live-preview.ts` (candidat B) a été écrit pour ce spike (~170 lignes) : titres, gras/italique/barré, code inline + fences, liens, citations, checkbox-widgets, wikilinks — sélection-aware, limité au viewport. **Hors périmètre spike** et compté comme effort restant dans l'ADR : tableaux (le point dur documenté), images inline, `atomicRanges` (saut de curseur), copier-coller/IME polish.
