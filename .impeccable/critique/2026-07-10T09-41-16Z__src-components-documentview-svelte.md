---
target: DocumentView
total_score: 27
p0_count: 0
p1_count: 1
timestamp: 2026-07-10T09-41-16Z
slug: src-components-documentview-svelte
---
Method: dual-agent (A: design-review · B: detector+deterministic) — both isolated parallel sub-agents; detect.mjs exit 2 (1 warning, non-target).

# Critique #2 — DocumentView (après passe design)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | caption + dirty-dot clairs, mais le mode focus (F9) masque le seul indicateur d'enregistrement persistant |
| 2 | Match System / Real World | 3 | FR clair + métaphore papier ; « Ignorer » = mot doux pour « perdre définitivement » |
| 3 | User Control & Freedom | 3 | Échap annule proprement le dialogue non-sauvé ; pas de moyen à l'écran d'apprendre/quitter le mode focus |
| 4 | Consistency & Standards | 2 | la colonne de l'iframe HTML (680px hardcodé, content-box) ne s'aligne pas sur la colonne caption/markdown et ignore le contrôle de largeur |
| 5 | Error Prevention | **4** | `suppressToggleComment` neutralise Mod-/ (toggleComment) ; garde de fermeture + bandeau reload préviennent la perte silencieuse — **P0 précédent corrigé** |
| 6 | Recognition over Recall | 2 | seul Ctrl+O est enseigné ; F9/Ctrl+//Ctrl+Shift+E,P,H = rappel seul |
| 7 | Flexibility & Efficiency | 3 | bons raccourcis + cycle largeur + focus, mais pas de palette et le bouton largeur est un cycle aveugle |
| 8 | Aesthetic & Minimalist | 4 | restraint exemplaire — démarrage vide, sidebar masquée, chrome discret |
| 9 | Error Recovery | 2 | ouverture de fichier échouée = silencieuse (`console.error`, « story 1.2 ») ; le bandeau existe mais n'y est pas câblé |
| 10 | Help & Documentation | 1 | aucune aide in-app, aucune référence de raccourcis |
| **Total** | | **27/40** | **Acceptable — cœur fiable, gaps réparables** (25→27) |

## Anti-Patterns Verdict

**Revue design** : **pas du slop** — un lecteur « papier » authentique et assumé. Un utilisateur fluent (iA Writer/Typora/Linear) fait confiance d'emblée : Source Serif sur crème, captions mono, colonne centrée calme, dialogue serif dans le monde « papier », rings focus 2px corrects, rendu HTML sandboxé theme-aware, et — le signe du soin réel — un toggle source **safety-engineered** pour que Ctrl+/ n'injecte jamais `<!-- -->`. Les seuls temps d'arrêt : le chemin HTML (colonne non alignée + bouton largeur inerte) et les marqueurs `#`/`-` toujours visibles (choix de positionnement/polish, pas de la falsification).

**Scan déterministe (detect.mjs, exit 2)** : toujours **1 warning** — `layout-transition` sur `Sidebar.svelte:153` (`transition: width`, panneau repliable défendable, couvert reduced-motion). Les 5 fichiers markup = 0 finding sur DocumentView. Preuves statiques B : caption `--ink-4` **passe maintenant 4,78:1 (light)/5,42 (dark)** ; le ring `:focus-visible` global est présent et large ; dark `--surface` (#35353B) diffère de `--cream-content` (#2E2E34) mais delta figure/fond faible (1,11:1, **à parité avec le light** — plus le bug d'identité) ; seul usage texte `--ink-5` restant = `contentSeparator` (editor.ts:24, `---` décoratif, 3,1:1).

**Convergence** : A et B confirment le P0 réglé, le ring focus présent, la caption remontée au-dessus du seuil ; tous deux notent le bloc code peu détaché et les cibles < 24px.

## Overall Impression
La passe design a payé : le bug de perte de données est éliminé (Error Prevention 0→4), le rendu HTML est theme-aware et habite la colonne papier, le focus clavier est enfin conçu, la caption passe AA. Le score monte modérément (25→27) parce que réparer le P0 flagrant a laissé voir la couche suivante : le contrôle de largeur **inerte sur HTML** (introduit par le fix HTML : 680px hardcodé ≠ `--doc-width`), l'ouverture échouée **silencieuse** (= story 1.2 du backlog), et l'indicateur d'enregistrement **absent en mode focus**.

## What's Working
1. **Toggle source safety-engineered** (`suppressToggleComment`, Prec.highest no-op sur Mod-/) — vérifié live : caption « enregistré · source », doc byte-identique. Principe #3 rendu réel au niveau de la frappe.
2. **Dialogue de fermeture non-sauvé** — heading serif dans le monde papier, scrim + ombre, « Sauver » primaire à droite, « Ignorer » en `--err`, Échap = annulation sûre.
3. **Rendu HTML sandboxé theme-aware** — l'iframe reçoit `app.theme` et repeint sa palette AIR sous CSP stricte (`default-src 'none'`) — hors-ligne, sûr, cohérent avec le shell.

## Priority Issues

**[P1] La colonne du rendu HTML ignore la largeur et ne s'aligne pas sur sa caption.**
Pourquoi : `baseStyle` (`html.ts`) hardcode `max-width:680px` en content-box, alors que doc-head/éditeur utilisent `var(--doc-width)` en border-box. Mesuré à « wide » (820px) : la caption commence à x=270, le corps HTML à ~300 ; le bouton largeur ne fait **rien** sur l'iframe → contrôle mort sur tout `.html`.
Fix : interpoler `--doc-width` courant dans `sandboxDoc`, `box-sizing:border-box` sur le body iframe, re-rendre `srcdoc` au changement de largeur (déjà fait au changement de thème).
Command : `/impeccable adapt src/lib/html.ts`.

**[P2] Ouverture de fichier échouée = silencieuse.**
Pourquoi : `openFromDialog` (`App.svelte`) attrape l'erreur et ne fait que `console.error` (« UX d'erreur… story 1.2 »). Binaire/mauvais encodage → rien pour l'utilisateur (heuristique #9). Le mécanisme `app.banner` existe déjà. **= story 1.2 du Sprint 5.**
Fix : au fail, `app.banner` avec raison FR claire.
Command : `/impeccable harden src/App.svelte` (ou story 1.2).

**[P2] Le mode focus supprime l'indicateur d'enregistrement.**
Pourquoi : le doc-head est gated `{#if activeTab() && !app.focus}` → en F9, plus de « modifié/enregistré » ni de dirty-dot, exactement quand l'utilisateur écrit en immersion. Inconfortable pour un produit « zéro perte ».
Fix : garder une affordance dirty discrète en focus (petit point de coin qui apparaît si modifié).
Command : `/impeccable delight` / finition ciblée.

**[P3] Vocabulaire de fonctions non-découvrable (rappel seul).**
Pourquoi : F9, Ctrl+/, Ctrl+Shift+E/P/H, sortie du mode focus ne sont surfacés nulle part ; seul Ctrl+O enseigné. Heuristiques #6/#10.
Fix : une affordance on-brand — feuille « ? » de raccourcis ou palette minimale ; au minimum tooltips avec le raccourci.
Command : `/impeccable shape` (surface de raccourcis).

**[P3] Bloc code peu détaché + cibles < 24px + séparateur `--ink-5`.**
Pourquoi : `.cm-lp-codeblock` `--surface` vs `--cream-content` = 1,11:1 (dark, à parité light) sans bordure ; `.close` d'onglet 18×18 et boutons bandeau ~22px (< 24 WCAG 2.5.8) ; `tags.contentSeparator` `--ink-5` 3,1:1 (décoratif).
Fix : hairline `--line-1` sur le bloc code ; agrandir les petites cibles ; laisser le séparateur (décoratif) ou le remonter.
Command : `/impeccable polish`.

## Persona Red Flags
- **Alex (power user)** : cycle le bouton largeur sur `recette.html` → rien ne bouge (contrôle aveugle inerte sur HTML) ; adore Ctrl+//F9 mais a dû les *trouver* (pas de palette) ; en mode focus, ne peut pas confirmer que le doc est sauvé avant de switcher.
- **Sam (a11y/clavier/contraste)** : bonnes nouvelles — ring focus présent et visible (2px `--ink-3`, offset 2px), icônes rail 7,16:1 light/8,47 dark, toggle thème avec `aria-pressed`. Flags : bloc code sans contraste non-texte (1,02–1,11:1) ; caption à 4,81:1 (light) = plancher AA ; chaque onglet **imbrique** un bouton close (contrôles interactifs imbriqués) → double stop clavier + confusion lecteur d'écran.

## Minor Observations
- Live-preview montre `#`/`-` **toujours** (style Obsidian, pas active-line-only) — un habitué de Typora le remarque.
- Titres HTML en Georgia (Source Serif ne franchit pas `font-src data:`) — contrainte justifiée mais le H1 HTML paraît plus lourd qu'un H1 markdown.
- Console propre (0 erreur/0 warning) sur toutes les transitions — vrai signal de confiance.
- Marque Doku de l'état vide à opacity 0.35 (~1,58:1) = même poids qu'un contrôle désactivé ; un soupçon plus de présence lirait « brand » plutôt que « grisé ».

## Questions to Consider
1. Si le rendu HTML ne peut *jamais* partager le bord de la colonne markdown ni obéir au contrôle de largeur, montrer le bouton largeur sur les onglets `.html` est-il pire que le cacher — un contrôle mort est-il plus malhonnête qu'un contrôle absent ?
2. Le mode focus retire le seul signal « modifié/enregistré » persistant. Pour un produit dont le principe #3 est « zéro perte toujours », l'immersion silencieuse est-elle une fonction ou une trahison discrète de la promesse ?
3. Doku enseigne exactement un raccourci et cache le reste derrière « le chrome s'efface ». Où est la ligne entre *minimal* et *impénétrable* ?
