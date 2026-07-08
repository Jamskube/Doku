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

## Résultats (run du 2026-07-08, Surface Pro 11 / Snapdragon X Elite, Chrome via Playwright)

| Critère | A — Milkdown 7.21 | B — CM6 live preview (plugin spike) |
|---|---|---|
| Round-trip corpus (8 fichiers, zéro édition) | **0/8 identiques** — 9 à 176 lignes de diff par fichier (tables re-paddées, `_it_`→`*it*`, `\[` échappés, lignes vides) | **8/8 identiques octet pour octet** (par construction) |
| Chargement 500 Ko + premier rendu | 1 727 ms | **27 ms** |
| Frappe sur 500 Ko (par frame) | avg **68,7 ms** · p95 80,3 · max 85,5 (~15 fps) | avg **17,3 ms** · p95 27,1 · max 40,5 |
| Frappe sur document normal | avg 16,6 ms ✓ | équivalent ✓ |
| Checkbox cliquable | modèle `data-checked` présent, UI headless à styler/brancher | **démontré** : widget `<input>`, le clic réécrit `[ ]`↔`[x]` dans la source |
| Wikilink `[[…]]` | texte brut — plugin remark à écrire (~½ j) | **démontré** : décoré, cliquable, cible résolue |
| Masquage de syntaxe hors ligne active | n/a (WYSIWYG pur — la syntaxe n'existe plus) | **démontré** : `#`, `**`, `` ` ``, marqueurs de liens masqués, révélés sur la ligne active |

**Verdict : CodeMirror 6 live preview** — voir `docs/adr/0002-moteur-wysiwyg-cm6-live-preview.md`. Le comportement spécifié par FR-3 (« syntaxe du bloc courant visible pendant l'édition ») *est* le modèle live-preview ; Milkdown le contredit deux fois (round-trip destructif, perf).

## Notes de périmètre

Le plugin `src/live-preview.ts` (candidat B) a été écrit pour ce spike (~170 lignes) : titres, gras/italique/barré, code inline + fences, liens, citations, checkbox-widgets, wikilinks — sélection-aware, limité au viewport. **Hors périmètre spike** et compté comme effort restant dans l'ADR : tableaux (le point dur documenté), images inline, `atomicRanges` (saut de curseur), copier-coller/IME polish.
