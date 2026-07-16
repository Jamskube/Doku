# Retrospective: Sprint 11

**Date**: 2026-07-16
**Velocity**: 4 completed / 4 planned (100%)

## Stats
- Stories completed: **4/4** (13.1 M · 13.2 M · 13.3 M · 13.4 M) — ledger **50/50**, **Epic 13 clos = fondation copilote complète**
- Stories carried over: 0
- Blockers encountered: 0
- Durée réelle : **~1 jour** sur 14 planifiés (14→28/07) — sprint clos 12 jours avant la date de fin
- Commits sprint : 11 (5 `feat` · 6 `docs`)
- Majors interceptés en revue (avant validation native) : **5** — `resource_dir` sans fallback dev · `shutdown` lock-ordering (kill d'un sidecar tout juste démarré) · `$effect` auto-re-déclenché (untrack) · `ensureReady` sans dédup · `ensureReady` n'attrapait pas un `startOllama` qui throw
- Vélocité : S6=4 · S7=3 · S8=4 · S9=4 · S10=3 · **S11=4**
- Premier sprint du cap **v2** ; premier sprint avec du **vrai code Rust** (Job Object / Win32)

## What Went Well 👍
- **Le spike en tête de sprint a payé, littéralement.** 13.1 n'a pas seulement répondu « oui c'est faisable » : il a sorti les **3 pièges** qui auraient tous explosé au milieu de 13.2 — packaging `lib/ollama` (que `externalBin` ne copie pas), orphelin `llama-server.exe` (grand-enfant), egress autonome vers `ollama.com`. Chacun est devenu une ligne de dette explicite dans le sprint file, traitée à froid en 13.2. **C'est la vraie valeur d'un spike : pas le go/no-go, la liste des surprises.**
- **Boucle `critic` (plan) → `code-reviewer` (diff) → validation native** tenue sur les 4 stories : 5 Majors interceptés avant que la machine ne soit allumée. Le pattern « deux classes de défauts distinctes » (leçon S9) se confirme sur un sous-système neuf.
- **Fondation livrée d'un bloc cohérent** : Epic 13 = « le moteur marche » — spawn ARM64, cycle de vie, client, UI modèles. Aucune story orpheline, `copilot.svelte.ts` est déjà le socle de 14.1.
- **La discipline du ledger a tenu sous pression** : 13.4 est restée `passes:false` pendant deux wraps et une compaction de contexte, jusqu'à validation native réelle. Le pointeur `_next-session.md` a repris exactement là.
- **Job Object > pidfile** : ADR-0012 amendé *pendant* le sprint sur la base d'une mesure (kill brutal de `doku.exe` → 0 survivant), pas d'une intuition.

## What Didn't Go Well 👎
- **Deux allers-retours natifs perdus sur 13.1** pour une cause non-technique : le binaire Rust était **stale** (`Finished 0.49s` = pas de recompilation) → le fix `OLLAMA_LIBRARY_PATH` semblait ne rien faire alors qu'il n'était jamais entré dans le binaire. On a diagnostiqué le code au lieu de lire la ligne de build.
- **L'orphelin `llama-server.exe` a été trouvé par l'utilisateur, pas par nous.** Le spike vérifiait « le sidecar meurt » (le parent), pas « l'arbre meurt ». Même famille que le flou PDF de S10 : **le critère de done du spike était trop étroit** — deux sprints de suite.
- **Tension ADR-0004** (« hôte Rust minimal, zéro logique métier ») : `sidecar.rs` fait ~200 lignes de Win32. C'est défendable (cycle de vie process = infra hôte, pas métier) mais ce n'est **écrit nulle part** — l'ADR n'a pas été revisité alors que le sprint l'a clairement mis sous tension.
- **Vélocité complètement décalibrée** : 4×M planifiés pour 2 semaines, livrés en une journée. Un sprint qui se termine à 7 % de sa durée n'est plus une boîte de temps — c'est une liste de courses. Les checkpoints STOP/GO (25 %/60 %/90 %) n'ont eu aucune chance de servir.
- **Dette de packaging release toujours ouverte** : `resource_dir()` + `bundle.resources` ne sont pas prouvés — la story 13.2 est validée en **dev** seulement sur ce point. C'est le même pattern que « associations `.pdf` validées sur confiance » (S10) : deux dettes qui n'attendent que le prochain `tauri build`.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| **Tout spike qui lance un process inclut « l'arbre meurt » dans son done** (pas seulement le parent) — corollaire de l'action S10 sur les critères de spike, qui s'était limitée au rendu graphique. Généraliser : un spike doit énumérer ce qu'il **ne** couvre **pas**. | High |
| **Recalibrer la vélocité** — ✅ **décidé en rétro (2026-07-16)** : les sprints passent à **1 semaine / 6-8 stories** (v2 = ~12 stories restantes sur Epics 14-16 → 2 sprints, pas 3). Le sprint reste une unité de cohérence livrable, pas un calendrier. Applicable dès le Sprint 12. | High |
| **Faire le `tauri build` release au prochain sprint** et solder les 2 dettes d'un coup : packaging `lib/ollama` (`resource_dir`) + association `.pdf` (S10). Ne pas laisser une 3e dette « à confirmer à l'install » s'accumuler. | High |
| **Amender ADR-0004** (ou noter la frontière dans ADR-0012) : « Rust minimal » = plomberie hôte (fenêtre, process, OS), la logique métier reste en TS. `sidecar.rs` est conforme — l'écrire noir sur blanc avant qu'un futur ajout Rust s'en réclame abusivement. | Medium |
| **Avant de diagnostiquer un comportement natif inchangé, vérifier que le binaire a recompilé** (`Compiling` vs `Finished 0.49s`). | Medium |

## Lessons Learned
→ /start learn process: Un spike vaut moins pour son verdict go/no-go que pour la **liste de surprises** qu'il produit : 13.1 a sorti 3 pièges (packaging `lib/`, orphelin grand-enfant, egress autonome) qui auraient tous explosé au milieu de la story suivante. Transformer chaque surprise en ligne de dette explicite dans le sprint file, traitée à froid dans la story d'après.

→ /start learn process: Le critère de « done » d'un spike doit énumérer ce qu'il **ne couvre pas** — deux sprints de suite, un spike a validé la fonction principale en manquant une propriété adjacente que l'utilisateur a trouvée à sa place (S10 : « ça rend » mais pas la netteté HiDPI ; S11 : « le sidecar meurt » mais pas son arbre de process). Pour tout spike : rendu → netteté ; process → arbre ; réseau → egress au repos.

→ /start learn workaround: Cargo/Tauri : avant de diagnostiquer un comportement natif qui « n'a pas changé » après un fix Rust, lire la ligne de build — `Finished 0.49s` (sans `Compiling`) = le binaire est **stale**, le fix n'est jamais entré dedans. Deux allers-retours natifs perdus en 13.1 à déboguer un code correct qui ne tournait pas.
