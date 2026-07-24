# Retrospective: Sprint 13

**Date**: 2026-07-24
**Velocity**: 3 completed / 3 planned (100 %)

Sprint « RAG seul » (Epic 15 complet) — le plus gros chantier du cap v2 (risque n°1 du PRD-v2), isolé dans son propre sprint sur décision de la rétro S12. Livré en 3/3, clos J+4 (comme S12).

## Stats
- Stories completed: **3** (15.1 spike + ADR, 15.2 index incrémental, 15.3 Q&A citée + doc courant)
- Stories carried over: 0
- Blockers encountered: 0
- Ledger: **60/60**
- Commits: 6 (spike, 3 feat, flips ledger) sur 4 jours
- Boucle qualité : critic (plan) + code-reviewer (diff) sur chaque story de code — **2 HIGH + 2 Major réels** attrapés avant le natif

## What Went Well 👍
- **Boucle critic + code-reviewer** (choix de l'utilisateur) : deux passes à contexte frais, et elles ont mordu. Le critic a imposé le checksum d'appariement bin/meta (15.2) et la garde anti-détournement du premier pull ; le reviewer a rattrapé deux Major qui **défaisaient des invariants pourtant validés par le critic** (garde `buildIfMissing` ne vérifiant pas le modèle du meta → ré-embed intégral silencieux ; prédicat embed divergent entre badge et comportement → régression d'honnêteté). Deux passes valent mieux qu'une : le critic raisonne sur le plan, le reviewer sur le code réel.
- (Implicites, non retenus comme n°1 mais confirmés par l'exécution) Spike-en-tête + ADR d'abord : la 15.2 avait un brief prêt (« Forme pour la story 15.2 »). Découpe spike→L→M : risque n°1 encaissé sans report. Citations déterministes : le pied « Passages consultés » est posé par l'app d'après les passages réellement fournis, pas par la fiabilité du modèle — le STOP/GO « citations peu fiables » est éliminé par construction.

## What Didn't Go Well 👎
- **Rien de notable** (question Frictions laissée sans sélection — même verdict qu'au S12). Le mode natif (sidecar Ollama) non testable en navigateur reste une contrainte structurelle assumée, pas une frustration : la validation native par l'utilisateur est le checkpoint de chaque story.

## Surprises 💡
- **granite-embedding:278m bat bge-m3 sur tous les axes** : meilleure qualité FR (r@1 0,933 vs 0,90, r@3 parfait), **3× plus rapide** à l'indexation, **moitié de la RAM**. Le petit modèle gagne partout — contre-intuitif face à la réputation multilingue de bge-m3, et ça n'aurait pas été trouvé sans mesurer. (Confirme la valeur du spike : sa vraie sortie est la liste de surprises, pas le go/no-go.)

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| Reconduire le processus tel quel (spike-en-tête si risque, boucle critic+reviewer, validation native par story) | High |

**Action n°1 retenue : « Rien à changer »** — comme au S12, le processus tient. À noter sans en faire une action bloquante : les non-couverts de l'ADR-0015 (qualité sur le vrai corpus, cohabitation RAM embed+chat, chunking des longs docs) restent à observer à l'usage ; le repli bge-m3 est mesuré et prêt.

## Lessons Learned
→ /start learn process: Boucle critic (plan) + code-reviewer (diff) à contexte frais = deux filets complémentaires, pas redondants. Au S13, le reviewer a rattrapé 2 Major qui défaisaient des invariants pourtant validés par le critic sur le plan — parce qu'un plan correct peut être mal implémenté (garde qui teste l'existence d'un fichier au lieu de sa validité ; deux prédicats censés être « le même » qui divergent). Garder les deux passes sur toute story > 100 LOC ou surface données.

→ /start learn tech: Sur ARM CPU, mesurer avant de croire les réputations. granite-embedding:278m (768 dims, 568 Mo) bat bge-m3 (1024 dims, 1,2 Go) en qualité FR, vitesse (3×) et RAM (½) — la réputation multilingue de bge-m3 ne se traduit pas en avantage mesuré sur ce corpus. Le banc `spike/rag-15.1/` est vendoré comme jeu de régression : re-mesurer sur un vrai dossier avant de changer de modèle.
