# 0015. Stack RAG : granite-embedding:278m + cosinus brute-force en mémoire (fichier binaire, incrémental par hash)

**Date** : 2026-07-20 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : rag, copilote, embeddings, perf, arm64 · **Spike** : 15.1

## Context

Le PRD-v2 (FR-6) demande d'interroger *le sens* d'un dossier de notes : récupération des passages pertinents (top-k) + réponse citant ses sources. C'est « le plus gros chantier du cap » (risque n°1), isolé au Sprint 13. Contraintes dures : **0 réseau** (NFR Confidentialité, argument n°1 du produit), CPU Snapdragon X Plus, **16 Go de RAM partagés** entre le modèle de chat (qwen2.5 q4_0, `num_ctx` 16384) et le futur modèle d'embedding. Le spike 15.1 devait trancher **par la mesure** : modèle d'embedding, format d'index, chunking, stratégie incrémentale — avant toute ligne de 15.2.

## Decision drivers

- **Qualité en FRANÇAIS** : les notes de l'utilisateur sont en français ; la plupart des modèles d'embedding vedettes sont anglophones.
- **Le coût UX dominant est l'indexation** (chunks/s sur CPU ARM), pas la recherche ; la latence d'embed d'une requête s'ajoute à CHAQUE question du copilote.
- RAM : le modèle d'embedding cohabite avec le modèle de chat → chaque Go compte.
- Alignement ADR-0007 (recherche : index en mémoire, aucune lib tierce) et ADR-0006/0012 (tout passe par le sidecar Ollama existant).
- Note ARM : les tags `-q4_0` (repacking ×2,3, leçon S11) **n'existent pas** pour ces modèles d'embedding — ils sont servis en F16 ; le levier de quantif ne s'applique pas ici.

## Mesures (spike 15.1)

Banc Node vendoré dans `spike/rag-15.1/` (corpus **150 notes FR** : 30 cibles rédigées + 120 diversions à fort recouvrement lexical intra-domaine ; **30 requêtes** à vérité terrain : 9 directes, 17 paraphrases, 4 pièges lexicaux). Score note = max cosinus sur ses chunks (~900 car., titre préfixé). Sidecar Ollama 0.32 ARM64 local, batch 16, `OLLAMA_NO_CLOUD=1` — **0 connexion non-loopback observée au niveau process pendant l'inférence**.

| Modèle | dims | RAM | Index (chunks/s) | Requête (ms) | r@1 | r@3 | paraphrase r@1 | piège r@1 |
|---|---|---|---|---|---|---|---|---|
| **granite-embedding:278m** | 768 | **568 Mo** | **11,1** | 293 | **0,933** | **1,000** | **1,000** | 0,50 (rangs 2-3) |
| bge-m3 | 1024 | 1 219 Mo | 3,9 | 335 | 0,900 | 0,967 | 0,882 | 0,75 |
| qwen3-embedding:0.6b | 1024 | 2 371 Mo | 1,4 | 289 | 0,900 | 0,967 | 0,882 | 0,75 |
| embeddinggemma | 768 | 680 Mo | **0,5** | 532 | 0,900 | 0,967 | 0,882 | 0,75 |
| all-minilm (témoin EN) | 384 | 48 Mo | 48,9 | 61 | 0,667 | 0,733 | 0,588 | 0,25 |
| *BM25 (baseline lexicale)* | — | 0 | — | ~0 | 0,867 | 0,967 | 0,882 | 0,75 |

**Échelle** (granite, 1000 notes / 1000 chunks) : index complet **92 s** (10,8 c/s soutenus), recherche brute-force **2,25 ms**/requête, stockage vecteurs **2,9 Mo** (Float32). **Chunking** : 500 vs 900 vs 1500 car. → scores identiques sur CE corpus (notes courtes, non discriminant — voir « non couvert »).

## Considered options

### A. granite-embedding:278m — **choisi**
· Pros : meilleur r@1 (0,933) et **r@3 parfait** — la métrique qui compte pour un RAG (on fournit les k≥3 meilleurs passages au LLM) ; **3× plus rapide** que bge-m3 à l'indexation (le vrai coût UX) ; **moitié de sa RAM** ; multilingue (FR incl.) ; ses deux « échecs » pièges sont des rangs 2-3, rattrapés par k≥3.
· Cons : pièges à r@1 0,50 (n=4, statistiquement mince) ; dims 768.

### B. bge-m3
· Pros : meilleur sur les pièges à r@1 (0,75) ; référence multilingue éprouvée, contexte 8k.
· Cons : 1,2 Go de RAM, 3,9 c/s (1000 notes ≈ 4-5 min d'index). **Repli désigné** si granite déçoit sur corpus réel.

### C. qwen3-embedding:0.6b / embeddinggemma
· Rejetés : débit d'indexation rédhibitoire sur ce CPU (1,4 et 0,5 c/s — embeddinggemma mettrait ~35 min pour 1000 chunks) ; qwen3 charge 2,4 Go. Qualité pourtant équivalente à bge-m3 — c'est la perf qui élimine.

### D. all-minilm (témoin anglophone)
· Rejeté (attendu) : s'effondre en français (0,667 ; pièges 0,25). Confirme par la mesure que le **multilingue est obligatoire**.

### E. BM25 seul (pas d'embeddings)
· Rejeté mais instructif : 0,867 sur ce corpus — baseline sérieuse. Structurellement aveugle aux synonymes/reformulations (son 0,882 « paraphrase » tient au vocabulaire de domaine partagé) ; ne fournit pas la similarité nécessaire au mode « document courant ». L'index lexical 9.2 reste en place, complémentaire.

### F. Fusion hybride RRF (sémantique + BM25)
· **Différée** : mesurée (k=60), elle aide les modèles moyens (+0,033) mais n'apporte RIEN au modèle retenu (0,90 < 0,933 en r@1, pièges inchangés). Complexité sans gain ici ; ré-évaluable en 15.3 si le corpus réel déçoit — l'index 9.2 rend la fusion quasi gratuite.

### G. Base vectorielle tierce (sqlite-vec, LanceDB…)
· Rejetée : le brute-force cosinus fait **2,25 ms sur 1000 chunks** — des ordres de grandeur sous le besoin (ADR-0007 bis : à cette échelle, une lib d'index est du sur-dimensionnement). YAGNI.

## Decision

**granite-embedding:278m** via le sidecar Ollama existant, **cosinus brute-force en mémoire**, persistance **fichier binaire Float32 + méta JSON**, **ré-index incrémental par hash de contenu**.

### Forme pour la story 15.2
- **EmbedService** : `POST /api/embed` (batch 16) sur le port du sidecar existant ; modèle d'embedding = réglage distinct du modèle de chat (`app.embedModel`), pull/purge via la vue Modèles.
- **Stockage** : `%APPDATA%/com.soundnodes.doku/rag/<sha1(dossier)>/` → `vectors.bin` (Float32Array brut, 768 × 4 o/chunk) + `meta.json` (fichiers, hash, chunks, offsets) ; écritures **atomiques** tmp+rename (pattern snapshots 7.2), index chargé en mémoire au premier usage (pattern ADR-0007).
- **Chunking** : paragraphes fusionnés ~900 car., titre de note préfixé (`«titre» — …`) ; frontières de titres Markdown comme coupes préférentielles.
- **Incrémental** : hash par fichier (même détection que l'index de recherche 9.2) → ré-embed des seuls fichiers changés ; suppression → retrait des vecteurs.
- **Indexation de fond bornée** : par lots avec yield, progression visible, n'empêche jamais l'usage (92 s/1000 notes = acceptable UNE fois, incrémental ensuite).
- **Recherche** : top-k=5 par défaut (k≥3 obligatoire — c'est ce qui couvre les pièges à rang 2-3).

## Ce que ce spike NE couvre PAS (à re-vérifier en 15.2/15.3)

1. **Corpus synthétique auto-généré** : 30 requêtes, 4 pièges seulement (n mince) ; les vraies notes de l'utilisateur (style télégraphique, listes, mélange FR/EN, code) peuvent se comporter autrement. Le banc est vendoré pour re-mesurer sur un vrai dossier.
2. **Chunking non discriminant ici** (notes courtes ≈ 1 chunk) : la sensibilité à la taille de chunk sur de **longs documents** — précisément le mode « document courant » de 15.3 — n'est PAS mesurée.
3. **Cohabitation mémoire réelle** : embed (568 Mo) + chat qwen2.5 3b (`num_ctx` 16384) chargés **ensemble** dans 16 Go — non mesurée (le spike n'avait que l'embed en RAM).
4. **Ré-index incrémental non prototypé** (full index seulement) ; idem l'éviction/chargement à l'ouverture d'un autre dossier.
5. **Préfixe de requête granite** : servi brut (aucun protocole officiel documenté) — un préfixe type `query:` n'a pas été essayé.
6. **Re-preuve 8.3 complète en natif** (moniteur réseau app entière avec RAG actif) : appartient à 15.2 ; ici seulement vérif process-level au repos.

## Consequences

**Positive** : qualité FR au rendez-vous (r@3 = 1,0), indexation supportable sur ARM, +568 Mo de RAM seulement, zéro dépendance nouvelle, 100 % local, réutilise sidecar + patterns existants (index mémoire, écritures atomiques, pull explicite).
**Negative** : un 2ᵉ modèle à télécharger (537 Mo, action réseau explicite) et à faire cohabiter en RAM ; les pièges lexicaux ne sont sûrs qu'à partir de k≥3 ; l'index vectoriel est un cache de plus à invalider.
**Risks** : qualité réelle sous la qualité mesurée (corpus synthétique) → repli **bge-m3** (mesuré, prêt) puis fusion RRF (option F) ; RAM contrainte → décharger le modèle d'embedding après l'indexation (`keep_alive: 0`) et ne le recharger qu'à la question.

## Related

- [ADR-0006](./0006-copilote-ia-ollama-sidecar-cpu.md) / [ADR-0012](./0012-cycle-de-vie-sidecar-ollama.md) — le sidecar qui sert les embeddings
- [ADR-0007](./0007-recherche-index-memoire.md) — le précédent « index en mémoire, pas de lib » ; l'index lexical complémentaire (option F)
- `docs/planning/PRD-v2.md` FR-6 · `docs/planning/epics.md` Epic 15 · `docs/sprints/sprint-13.md`
- Banc + corpus + résultats : `spike/rag-15.1/`
