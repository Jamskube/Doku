# Sprint 3

**Goal** : Lire comme un document fini — rendu riche (code coloré, images), wikilinks navigables, et confort de lecture (largeur, focus).
**Start** : 2026-07-09
**End** : 2026-07-16
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 1.3 | Rendu GFM : coloration des blocs de code | M | P0 | TODO | coloration syntaxique dans les fences en live preview (lang-markdown + codeLanguages) ; tableaux WYSIWYG = 3.7 (hors sprint) |
| 1.5 | Images locales (relatives + placeholder) | S | P1 | TODO | résoudre `![](rel.png)` au dossier du fichier via convertFileSrc ; placeholder discret si manquante |
| 4.4 | Résolution & navigation des wikilinks | M | P1 | TODO | scan dossier+sous-dossiers, cache invalidé au changement ; clic `[[note]]` → ouvre l'onglet (l'événement `doku:wikilink` existe déjà) |
| 6.2 | Largeur de colonne réglable (3 crans) | S | P1 | TODO | ~65ch / ~80ch / pleine ; appliqué immédiat + persisté (couche settings) |
| 6.3 | Mode focus (masque le chrome) | S | P1 | TODO | F9 masque titlebar/sidebar/barres ; Échap restaure |

## Blockers
_None_

## Progress Log
### 2026-07-09
- Sprint initialisé avec 5 stories (1 P0, 4 P1) — thème « lecture riche + confort »
- Hors périmètre volontaire : 3.7 (widgets tableaux WYSIWYG, L) → futur sprint « éditeur riche »
- Freebies acquis au S2 à formaliser à l'occasion : 6.1 (thème persistant), 8.1 (build ARM64), 8.2 (installateur + associations)
- Rappels process (rétros) : design/UI hors stories ; smoke-tester en **release** pour tout ce qui touche fenêtre/OS ; logique pure → tests unitaires
