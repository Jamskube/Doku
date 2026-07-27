# Retrospective: Sprint 16

**Date**: 2026-07-27
**Velocity**: 3 complétées / 3 planifiées (100 %)

## Stats
- Stories complétées : **3** (19.2, 19.3 — validations natives ; 19.4 — v2.2.0 scellée)
- Stories reportées : **0**
- Blockers rencontrés : **0**
- Durée : **J+0** (planifié, exécuté, validé et clos le 2026-07-27)
- Commits : 5 (`4636ac1` → `3628114`), poussés
- Livrable : **Doku v2.2.0 installée** (`Doku_2.2.0_arm64-setup.exe`), Epic 19 clos — plus aucun bouton muet. Bonus hors sprint : installateur entièrement habillé en D.A. Doku.

## What Went Well 👍
- **Le design sur retour direct, hors sprint.** L'habillage de l'installateur s'est fait en deux itérations serrées sur le retour de l'utilisateur (BMPs + langue, puis template complet), sans story ni entrée ledger — exactement le régime prévu par la préférence « design hors sprint ». Le retour « pas assez stylisé » a été traité comme une itération de design, pas comme du scope creep.
- (Facilitateur) Le sprint « clôture » a tenu son format : 3 stories S, gate 19.4 respectée (pas de release avant validation 19.2/19.3), clos le jour même.

## What Didn't Go Well 👎
- **L'installateur brut a été découvert à la release.** La D.A. Doku s'arrêtait au bord de la fenêtre de l'app : l'installateur — le **premier** contact avec le produit — n'avait jamais été regardé en 15 sprints. C'est l'angle mort classique : tout ce qui porte la marque **hors** de la webview (installateur, désinstalleur, dialogues OS, icônes système) n'est couvert ni par les maquettes ni par les vérifs visuelles.
- (Facilitateur) Frictions d'encodage Windows récurrentes : mojibake sur `Cargo.toml` (réécriture PowerShell en ANSI, rattrapé par git) et BOM dans un titre de commit (rattrapé par amend). Deux quasi-incidents du même type dans la même session.

## Surprises 😲
- **NSIS est bien plus habillable que prévu.** Le template officiel Tauri est remplaçable (`bundle.windows.nsis.template`) et permet fonds/textes/langue/désinstalleur aux couleurs de la D.A. — les deux BMP documentés ne sont que la surface. Contrepartie : le template est figé sur la version du CLI (2.11.4) et devra être re-diffé à chaque upgrade.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| **Utiliser Doku pour de vrai au quotidien** (v2.2.0 installée) — reconduite de l'action S15, cette fois sans sprint de code qui s'intercale : le prochain epic doit émerger de l'usage | High |
| À la prochaine release : passer la **périphérie de marque** en revue (installateur, icônes, dialogues natifs, assoc fichiers) — ne plus la découvrir à la fin | Medium |
| À chaque upgrade du CLI Tauri : re-diff `installer/installer.nsi` contre le template officiel (voir `docs/design/installer-nsis/README.md`) | Medium |

## Lessons Learned

**1. La D.A. ne s'arrête pas au bord de la fenêtre.** Le premier écran que voit un utilisateur n'est pas l'app — c'est l'installateur. Tout artefact périphérique qui porte la marque (setup, désinstalleur, icônes, dialogues OS) fait partie du produit et doit passer par la même exigence de design, idéalement avant la release, pas après un « c'est pas joli ».

→ `/start learn process: la D.A. couvre aussi la périphérie (installateur, désinstalleur, icônes, dialogues OS) — la passer en revue avant chaque release, le setup est le premier écran vu`

**2. Un template d'outil tiers forké = une dette datée, à étiqueter le jour même.** Le template NSIS custom donne un installateur 100 % D.A., mais fige une copie du code de tauri-cli 2.11.4 dans le repo. Ce genre de fork silencieux casse des mois plus tard, à l'upgrade. Le réflexe qui sauve : marquer chaque bloc modifié (`; DOKU:`), noter la version de base en tête de fichier, et documenter la procédure de re-diff au moment du fork — pas quand ça casse.

→ `/start learn gotcha: le template NSIS custom (src-tauri/installer/installer.nsi) est une copie figée du template tauri-cli 2.11.4 — re-diff OBLIGATOIRE à chaque upgrade du CLI, blocs marqués « ; DOKU: », procédure dans docs/design/installer-nsis/README.md`

**3. Sur Windows, toute réécriture de fichier accentué via PowerShell est un piège à mojibake.** `Get-Content -Raw` lit en ANSI, `Out-File`/`Set-Content -Encoding utf8` (PS 5.1) ajoute un BOM : deux corruptions différentes dans la même session (Cargo.toml mojibaké, BOM dans un titre de commit). Réécrire les fichiers accentués avec l'outil Edit (ou node), et les messages de commit multi-lignes via `[System.IO.File]::WriteAllText` en UTF-8 **sans BOM** + `git commit -F`.

→ `/start learn workaround: fichiers accentués sous Windows — jamais de Get-Content|-replace|Set-Content (ANSI→mojibake) ni Out-File utf8 pour un message de commit (BOM dans le titre) ; utiliser l'outil Edit/node et WriteAllText(UTF8 sans BOM) + git commit -F`
