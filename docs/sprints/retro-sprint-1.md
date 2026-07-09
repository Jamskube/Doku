# Retrospective : Sprint 1

**Date** : 2026-07-09
**Vélocité** : 5 terminées / 5 planifiées (100 %)

## Stats
- Stories terminées : **5/5** (1.1, 2.2, 3.2, 3.3, 3.4) — toutes `passes:true` au ledger
- Stories reportées : 0
- Blockers rencontrés : 1 (fenêtre Tauri figée pendant un rebuild — résolu dans la session par kill de process)
- Durée : ~1 jour (planifié 7) — mais une part notable de l'effort est partie dans du hors-sprint (logo, install Vitest)
- Commits : 8 · Tests auto ajoutés : 26 (round-trip + fins de ligne + onglets)

## Ce qui a bien marché 👍
- **Stories bien amorcées** : plusieurs P0 étaient à 80 % (câblage 🟡) → boucle « ouvrir → éditer → sauver sans perte » bouclée vite.
- **Vérification à deux niveaux** : logique pure testée en Vitest (round-trip, homonymes) + flux UI vérifiés en Playwright, avant validation native par l'utilisateur.
- **Ledger honnête** : les stories à I/O natif (1.1, 3.2) sont restées en Review jusqu'au smoke test réel — pas de faux « Done ».
- **Le test a rattrapé une erreur de conception** : la mauvaise piste `lineSeparator` a été attrapée par le test round-trip avant de committer.

## Ce qui a moins bien marché 👎
- **Icône barre des tâches** (frustration utilisateur) : plusieurs allers-retours à cause du double cache (icône gravée dans l'exe au build + cache d'icônes Windows) et d'une composition initiale mal calibrée (trop de marge, D décentré).
- **Itérations du logo** (frustration utilisateur) : ombre du pli, couleur thème, taille, centrage, ruban sidebar — traitées au fil de l'eau, elles ont gonflé l'effort sans crédit au ledger.
- **Incident fenêtre figée** : un rebuild Rust (déclenché par `build.rs`) a laissé une fenêtre non réactive → nécessité de tuer le process ; a aussi révélé un risque de deadlock dans le garde de fermeture (corrigé).

## Action items pour le Sprint 2
| Action | Priorité |
|--------|----------|
| Traiter les itérations design/logo/UI **hors des stories de sprint** (bac à part) | Haute |
| Smoke-tester en natif dès qu'une story touche l'I/O/fenêtre (ne pas empiler des Review) | Haute |
| Après tout changement d'icône : rebuild propre + vider le cache Windows, vérifier avant de committer | Moyenne |
| Prévoir la gestion du débordement d'onglets (scroll/overflow) — repéré en fenêtre étroite | Basse |

## Leçons apprises → à mémoriser
- `/start learn gotcha: CodeMirror 6 — state.doc.toString() renvoie TOUJOURS du \n ; le facet lineSeparator n'agit que sur le découpage, pas la sérialisation. Pour préserver le round-trip (CRLF), détecter la fin de ligne du fichier et la restituer soi-même (detectLineEnding + serializeDoc).`
- `/start learn gotcha: icône barre des tâches Windows = double cache — l'icône est gravée dans l'exe au build (ajouter cargo:rerun-if-changed=icons/icon.ico dans build.rs) ET Windows cache la miniature (ie4uinit.exe -show ou reset Explorer).`
- `/start learn feedback: garder les itérations design/logo/UI hors des stories de sprint — elles gonflent l'effort sans crédit au ledger et diluent l'objectif.`
