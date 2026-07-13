# Retrospective: Sprint 9 (Export)

**Date**: 2026-07-13
**Velocity**: 4/4 code-complete (2/4 validés natif) / 4 planifiées — Epic 10 entièrement codé

## Stats
- Stories code-complete : **4** (10.1 spike, 10.2 PDF, 10.3 HTML autonome, 10.4 DOCX stretch)
- Stories validées natif (ledger `passes:true`) : **2** (10.1, 10.2) ; 10.3 + 10.4 = smoke natif en attente
- Carry-over : **0** (aucune story abandonnée)
- Blockers : **0**
- Commits d'exécution : **5** (`3ad7878` → `2935d67`)
- Dépendances ajoutées : `marked`, `docx` (lazy-loadée)
- Permissions fs ajoutées : `fs:allow-read-file`, `fs:allow-write-file`
- ADR : **3** — 0008 (pipeline PDF `window.print`), 0009 (renderer `marked`), 0010 (DOCX `docx` lazy)
- Tests : 123 → **156** (+33)

## What Went Well 👍
- **Boucle qualité appliquée aux 4 stories** — EPCT → `critic` (sur le plan) → `code-reviewer` (sur le diff) → `/quick-fix` → `/commit`. Chaque revue a trouvé du **réel** :
  - spike 10.1 : `renderMarkdown` sorti du spike (fidélité factice évitée) + iframe **sandboxé** (trou IPC/FS fermé).
  - 10.2 : régression `pre` sur l'aperçu `.html` + images bloquées émises (beacon).
  - 10.3 : `.html` « autonome » aux images cassées (prémisse DOMPurify fausse) + CSP retirée à tort.
  - 10.4 : écriture binaire non-atomique.
- **Réutilisation en cascade** — un seul renderer : `renderMarkdown` (10.2) → export HTML autonome (10.3) → `marked.lexer` (10.4). `paperCss`/`injectHead`/`sanitizeHtml` partagés PDF+HTML.
- **Honnêteté ledger tenue** — rien flippé sans validation native de l'utilisateur ; 10.3/10.4 restent `passes:false`.
- **Décisions de dépendances assumées** (ADR) — lib choisie là où le fait-maison est un piège (marked, docx), contrairement à la recherche (ADR-0007, `includes` suffisait).

## What Didn't Go Well 👎
- **Lag code ↔ ledger** — 10.3/10.4 codés + revus mais `passes:false` faute de smoke natif → le sprint « paraît » à 50 % alors que le code est à 100 %. La validation par-story crée un décalage.
- **Piège DOMPurify mordu deux fois** — il **conserve** les URLs relatives mais **strippe** les chemins absolus : a cassé un test (10.2) puis une hypothèse d'archi (`.html` autonome, 10.3).
- **Régression involontaire via refactor partagé** — extraire `paperCss` a modifié l'aperçu `.html` existant (règle `pre`) ; un refactor « behavior-preserving » ne l'était pas.

## Surprises 😲
- `docx` (~100 Ko) **lazy-loadée** par import dynamique = **zéro impact bundle principal** (chunk séparé).
- `Packer.toBlob` ≠ `toBuffer` (le `Buffer` Node casse sous Vite) — piège webview.

## Action Items for Next Sprint
| Action | Priorité |
|---|---|
| **Grouper les validations natives** en fin de sprint (batch) plutôt que par-story → réduire le lag ledger | High |
| Solder la **dette de validation** 10.3/10.4 avant de démarrer le prochain cap | High |
| Sur un **refactor « behavior-preserving » d'une fonction partagée**, diff explicite du CSS/HTML produit avant/après (le `pre` l'a montré) | Medium |
| Durcissement différé 10.3 : passe finale strip des `<img src>` non-`data:` (reference-style) — optionnel, la meta-CSP couvre | Low |

## Lessons Learned
→ `/start learn gotcha: DOMPurify conserve les URLs d'images RELATIVES (<img src="pic.png">) mais strippe les chemins ABSOLUS (G:\...) — pour un export/HTML portable, inliner les images en data: AVANT sanitize (pré-résolution), jamais compter sur la sanitize pour garder un chemin.`
→ `/start learn gotcha: dans le webview Tauri/Vite, sérialiser docx via Packer.toBlob (→ Blob → arrayBuffer → Uint8Array), jamais Packer.toBuffer (dépend du Buffer Node, casse sous Vite).`
→ `/start learn perf: lazy-loader une lib lourde (ex. docx ~100 Ko) via import('...') dynamique au point d'usage → Vite la sort du bundle principal (chunk séparé chargé à la demande). Même pattern que les plugins Tauri.`
→ `/start learn workaround: pour piloter window.print() sans exposer le bridge IPC/FS Tauri, rendre dans un iframe sandbox="allow-modals allow-same-origin" SANS allow-scripts + CSP default-src none injectée (défense en profondeur — un bypass DOMPurify ne peut pas exécuter de JS same-origin).`
