# Retrospective: Sprint 6

**Date**: 2026-07-10
**Velocity**: 4 completed / 4 planned (100%)

## Stats
- Stories complétées : **4/4** (7.1, 7.2, 7.3, 4.5) — **Epic 7 clos**, Epic 4 avancé
- Stories reportées : 0
- Blockers formels : 0 (mais 2 pièges rencontrés en cours de smoke, cf. ci-dessous)
- Commits features : 4 (`a4396e2` 7.1 · `8d3bc9a` 7.2 · `380111f` 7.3 · `1ee82e0` 4.5) — aucun entrelacé
- Ledger global : **32/32 `passes:true`**
- Tests : 82 → **106** (+24) ; svelte-check 0 err/0 warn
- Revues adversariales : `critic` (plan 7.2) + `code-reviewer` (diff 7.2)

## What Went Well 👍
- **Les deux passes adversariales sur la feature data (7.2) ont payé.** Le `critic` (sur le plan, contexte neuf) a cadré les risques AVANT le code — le plus important : **ne jamais donner `fs:allow-remove` en scope `**`** (suppression disque entière pour une feature de confort) → confiné à `$APPDATA/snapshots/**`. Le `code-reviewer` (sur le diff) a ensuite trouvé un défaut que le plan ne pouvait pas voir : **`meta.json` non atomique + pas de réconciliation** → fuite d'orphelins. Deux passes, deux classes de défauts distincts.
- **La leçon S5 « committer avant de switcher » a été appliquée** : chaque story commitée juste après sa validation native → 4 commits nets, zéro entrelacement (le problème de S5 ne s'est pas reproduit).
- **Le smoke natif de l'utilisateur a rattrapé un vrai défaut d'UX** que mes vérifs n'avaient pas : la restauration (7.3) polluait l'historique à chaque clic. Correctif : ne snapshotter l'état courant que s'il est **dirty**.
- **Défense en profondeur sur la suppression** : scope capability étroit + garde runtime (`parseStamp` : on ne supprime QUE des noms datables, jamais `meta.json`) — le code-reviewer a jugé le verrouillage « exemplaire ».
- **Rythme discipliné** : logique pure → tests (snapshot 15, wikilink +9), vérif navigateur des UI (panneau, prompts), smoke natif pour le cœur I/O, flips ledger honnêtes.

## What Didn't Go Well 👎
- **Serveur `npm run dev` parasite pendant un smoke natif.** J'avais laissé un Vite navigateur sur le port 1420 ; `vite.config` a `strictPort: true`, donc le `tauri dev` de l'utilisateur ne pouvait pas prendre le port → la webview native chargeait **mon** serveur au cache de deps périmé → `Failed to fetch dynamically imported module @tauri-apps/plugin-dialog` au clic sur « + ». Diagnostic long (le message d'erreur applicatif générique masquait la vraie cause). **Faute d'opération, pas de code.**
- **`git commit -m @'...'@` (here-string PowerShell) a cassé** sur les parenthèses/guillemets du message → pathspec error. Contourné avec `git commit -F <fichier>`.
- **Le message d'erreur d'ouverture est trompeur** (« erreur de lecture ou d'encodage » agrège tout, y compris un échec de chargement de module) — la vraie cause n'était qu'en console.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| Ne jamais laisser tourner un `npm run dev` navigateur pendant un smoke natif ; pour les vérifs navigateur, port séparé (`--port 1421`) et couper après | High |
| Sur toute feature qui **supprime/écrase** des fichiers : scope capability étroit + garde runtime, et passer `critic` (plan) puis `code-reviewer` (diff) | High |
| Messages de commit multi-lignes : `git commit -F <fichier>` (pas de here-string PowerShell) | Medium |
| Distinguer dans la bannière « échec de chargement (dev) » du cas « fichier binaire/encodage » (P3, hors sprint) | Low |

## Lessons Learned
→ /start learn gotcha: Ne pas laisser tourner un serveur `npm run dev` (navigateur) pendant un smoke natif. `vite.config` a `strictPort: true` sur 1420 → `tauri dev` ne peut pas prendre le port et la webview native charge le serveur parasite au cache de deps périmé (« Failed to fetch dynamically imported module »). Pour une vérif navigateur en parallèle : port séparé (`npm run dev -- --port 1421`) puis couper.
→ /start learn workaround: Une feature qui supprime des fichiers → scoper la capability `fs:allow-remove` au sous-arbre applicatif (`$APPDATA/snapshots/**`), JAMAIS `**` ; + garde runtime (ne supprimer que des noms validés, ex. `parseStamp`, jamais un `meta.json`). Défense en profondeur : scope + code.
→ /start learn feedback: Sur une feature data/destructive, enchaîner `critic` (sur le PLAN, avant code) puis `code-reviewer` (sur le DIFF, après) rattrape deux classes de défauts distinctes — le critic cadre les risques d'architecture (scope de suppression), le reviewer trouve les défauts d'implémentation (atomicité/réconciliation de l'index).
→ /start learn feedback: Pour un « snapshot avant remplacement » (restauration), ne snapshotter l'état courant que s'il est **dirty** — sinon il est déjà dans l'historique (dernière save ou version en cours) et le re-snapshotter crée un doublon à chaque clic (pollution). Retour smoke utilisateur.
→ /start learn gotcha: `git commit -m @'...'@` (here-string PowerShell) casse sur les parenthèses/guillemets du message (pathspec error). Utiliser `git commit -F <fichier>` pour tout message multi-lignes.
