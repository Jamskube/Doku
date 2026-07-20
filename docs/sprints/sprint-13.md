# Sprint 13

**Goal** : **v2.1 — le copilote comprend le dossier entier** : recherche sémantique locale (embeddings) + réponses citant leurs sources, 100 % hors-ligne.
**Start** : 2026-07-20
**End** : 2026-07-27
**Status** : Active

Sprint **RAG seul** (action rétro S12, High) : l'Epic 15 est « le plus gros chantier du cap » (PRD-v2, risque n°1) — il a son sprint dédié, spike en tête (pattern S11 : la valeur d'un spike = sa liste de surprises, pas son go/no-go). Source : `docs/planning/PRD-v2.md` FR-6 → Epic 15. À la clôture : une question en mode « dossier » récupère les passages pertinents et répond en **citant les notes sources** ; le mode « document courant » couvre enfin les gros documents (décision 2026-07-16, badge lecture partielle de 14.3).

Rappels de cadrage :
- **0 réseau** = contrainte dure (NFR Confidentialité) : embeddings via le sidecar Ollama local, index sur disque local, re-preuve de l'egress au spike.
- Les puces `+ Contexte` du panneau (coquille désactivée depuis 14.0) trouvent ici leur câblage.
- Machine : Snapdragon X Plus CPU-only, 16 Go — le spike mesure qualité top-k EN FRANÇAIS, temps d'indexation et empreinte avant tout code de 15.2.

## Stories

| # | Story | Size | Status | Notes |
|---|-------|------|--------|-------|
| 15.1 | Spike : stack RAG (modèle d'embedding local, format d'index, perf/qualité ARM) → **ADR avant 15.2** | M | TODO | Corpus test ~10²-10³ notes FR. Tranche par la mesure : modèle d'embedding (tag `-q4_0` si dispo), chunking, format de stockage, stratégie incrémentale. Lister ce que le spike NE couvre PAS (leçon S10/S11). |
| 15.2 | Index d'embeddings incrémental (`%APPDATA%\Doku\rag`, hash, borné ARM, 0 réseau) | L | TODO | **Risque n°1 du cap.** Ajout/modif/suppression → ré-index incrémental ; n'empêche jamais l'usage de l'app ; écritures atomiques (pattern snapshots 7.2). |
| 15.3 | Q&A dossier avec citations sources + mode « document courant » (gros docs) | M | TODO | Top-k → réponse citant les notes (nom cliquable → ouvre le fichier, pattern 9.4). Solde la lecture partielle de 14.3 (badge) pour les documents > fenêtre. |

## Blockers
_None_

## Checkpoints STOP/GO
| ~% | Critère | Si STOP |
|---|---|---|
| 35 % (15.1) | Spike tranché PAR LA MESURE + ADR écrite : qualité top-k FR acceptable, indexation bornée, empreinte OK | Qualité/coût rédhibitoires → repli assumé : pas de RAG en v2.1, renforcer la recherche lexicale (Epic 9) + garder le badge lecture partielle ; re-prioriser Epic 17 |
| 75 % (15.2) | Index incrémental réel sur un vrai dossier (ajout/modif/suppression), app réactive pendant l'indexation, 0 réseau mesuré | Indexation trop lourde → réduire le scope (index à la demande, dossier actif seul) plutôt que bloquer 15.3 |
| 100 % (15.3) | Q&A dossier cité + mode doc courant validés natif | Citations peu fiables → livrer top-k « passages trouvés » sans synthèse (dégradé honnête) |

## Progress Log
### 2026-07-20
- Sprint initialisé avec **3 stories** (Epic 15 complet, rien d'autre — action rétro S12). Ledger : +3 entrées (60 features).
- Dette « extraction texte PDF » (14.2) proposée en stretch, **écartée par l'utilisateur** : RAG seul.
