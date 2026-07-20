# Spike 15.1 — banc RAG (embeddings locaux)

## Purpose
Banc de mesure du spike 15.1 (Sprint 13) : compare des modèles d'embedding servis par le
sidecar Ollama local sur un corpus de notes FR à vérité terrain, contre une baseline BM25
et une fusion hybride RRF. A tranché l'[ADR-0015](../../docs/adr/0015-stack-rag-embeddings-locaux.md).
**Réutilisable en 15.2/15.3** comme jeu de régression (re-mesurer sur un vrai dossier).

## Usage
```
# sidecar : OLLAMA_HOST=127.0.0.1:11499, OLLAMA_MODELS=%APPDATA%\com.soundnodes.doku\models, OLLAMA_NO_CLOUD=1
node bench.mjs granite-embedding:278m            # qualité + perf (corpus 150 notes)
node bench.mjs granite-embedding:278m --scale 1000   # perf d'indexation à l'échelle
node bench.mjs granite-embedding:278m --chunk 500    # variante de taille de chunk
```

## Files
| File | Purpose |
|---|---|
| `corpus.mjs` | 30 notes cibles FR rédigées (faits interrogés) + ~120 diversions par gabarits ; `buildScaledCorpus(n)` pour la perf |
| `queries.mjs` | 30 requêtes à vérité terrain (direct / paraphrase / piège lexical) |
| `bench.mjs` | embed batché `/api/embed`, cosinus note-level (max chunk), BM25, fusion RRF, recall@k/MRR, latences, RAM |
| `results/*.json` | mesures du 2026-07-20 (5 modèles + échelle + chunks) — chiffres de l'ADR-0015 |

## Dependencies
- Internal: aucune (autonome, hors app)
- External: Node ≥ 20, sidecar Ollama ARM64 du repo (`src-tauri/binaries/`)
