# Sprint 4

**Goal** : Multi-format & finitions — ouvrir/éditer le HTML, mode source propre, table des matières, rechargement externe.
**Start** : 2026-07-09
**End** : 2026-07-16
**Status** : Active

## Stories

| # | Story | Size | Priority | Status | Notes |
|---|-------|------|----------|--------|-------|
| 5.1 | Vue HTML rendue (sandbox) | M | P1 | ✅ Done | `<iframe sandbox="">` + CSP `default-src 'none'` injectée (`html.ts`, 4 tests) ; éditeur masqué ; validé Playwright (recette.html) |
| 5.2 | HTML : édition source + refresh | S | P1 | TODO | bascule source (CM6 html) ↔ rendu ; Ctrl+S rafraîchit |
| 3.6 | Mode source Ctrl+/ (formaliser + vérifier) | S | P1 | TODO | socle en place (Compartment) ; vérifier curseur conservé + retour sans perte |
| 4.6 | Table des matières (highlight au scroll) | S | P2 | TODO | panneau Plan calcule déjà `docHeadings` + `scrollToLine` ; ajouter le surlignage du titre courant au scroll |
| 3.5 | Rechargement sur modification externe | M | P1 | TODO | watcher plugin-fs ; au focus, proposer recharger (silencieux si pas de modif locale) |

### Freebies clôturés (acquis S2/S3)
| # | Story | Acquis via |
|---|-------|-----------|
| 6.1 | Thème crème persistant | couche settings (S2, 4.2) |
| 8.1 | Build ARM64 natif | `tauri build` release `Target: arm64` (S2) |
| 8.2 | Installateur NSIS + associations | 2.3 (S2) |

## Blockers
_None_

## Progress Log
### 2026-07-09
- Sprint initialisé : 5 stories neuves (4 P1, 1 P2) + 3 freebies clôturés au ledger
- Rappels process (rétros) : design hors stories ; smoke-tester en release/natif tôt ; logique pure → tests ; privilégier le browser-testable

### 2026-07-09 — 5.1 (+ correctif 1.5)
- **Correctif 1.5** : la CLI Tauri a auto-ajouté `features = ["protocol-asset"]` à `Cargo.toml` lors du smoke test natif de 1.5 (requis par `assetProtocol`) — commité à part, sinon un build neuf casserait.
- **5.1** ✅ **Done** : onglet `.html` en mode rendu → `<iframe class="html-view" sandbox="">` (scripts off) avec CSP `default-src 'none'` injectée via `html.ts::sandboxDoc` (4 tests) ; l'éditeur CM6 reste monté mais masqué (`.hidden`). Ctrl+/ basculera vers la source (5.2). Validé Playwright : recette.html rendu (h1 + p), `sandbox=""`, CSP présente, éditeur masqué.
