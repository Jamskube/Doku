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

### 2026-07-24
- **15.1 validée par l'utilisateur (GO)** : ADR-0015 confirmée (granite-embedding:278m, brute-force mémoire, repli bge-m3). Ledger 58/60. Checkpoint 35 % franchi → lancement 15.2.
- **15.2 codée (validation native en attente)** : index d'embeddings incrémental conforme à la « Forme » de l'ADR-0015 — cœur pur `rag.ts` (chunking ~900 car. coupes aux titres, SHA-1 contenu, diff added/changed/removed, Float32 bin + meta, top-k), service `rag-index.svelte.ts` (refreshs sérialisés, checkpoint ~10 s, annulable, flag dirty posé par les saves), stockage `%APPDATA%/…/rag/<sha1(dossier)>/` atomique avec **checksum du bin dans meta.json** (appariement garanti après crash), réglage `app.embedModel`, section « Index du dossier » dans la vue Modèles (progression, caps visibles, purge). Boucle critic (2 HIGH intégrés : checksum d'appariement, garde anti-détournement du 1er pull) + code-reviewer (« approve with comments », Major corrigé : illisibles ≠ plafond). 243 tests, svelte-check et build OK. À vérifier natif : indexer un vrai dossier, modif/suppression → ré-index incrémental, app réactive, **0 réseau (moniteur process, re-preuve 8.3)**.
- **15.2 validée par l'utilisateur (natif)** : indexation réelle, incrémental et 0 réseau confirmés. Ledger 59/60. Checkpoint 75 % franchi → lancement 15.3.

### 2026-07-20 — 15.1 : spike mesuré, ADR-0015 écrite (validation utilisateur en attente)
5 modèles d'embedding comparés sur banc Node (corpus 150 notes FR à vérité terrain, 30 requêtes direct/paraphrase/piège, baseline BM25 + fusion RRF), sidecar Ollama local `OLLAMA_NO_CLOUD=1`, 0 connexion non-loopback à l'inférence. **Verdict : `granite-embedding:278m`** — r@1 0,933, **r@3 parfait (1,0)**, paraphrases 1,0, 11,1 chunks/s (3× bge-m3), 568 Mo (½ bge-m3) ; échelle 1000 notes = 92 s d'index, recherche 2,25 ms, 2,9 Mo. Surprises du spike : embeddinggemma inutilisable sur ce CPU (0,5 c/s), qwen3-embedding charge 2,4 Go, **BM25 est une baseline sérieuse (0,867)** mais la fusion RRF n'apporte rien au modèle retenu → différée. Repli désigné : bge-m3. Base vectorielle tierce rejetée (brute-force 2,25 ms, YAGNI). ADR-0015 + banc vendoré `spike/rag-15.1/` (jeu de régression pour 15.2/15.3) + liste explicite des non-couverts (corpus synthétique, chunking longs docs, cohabitation RAM embed+chat, incrémental non prototypé). Modèles perdants purgés du disque, granite conservé.
