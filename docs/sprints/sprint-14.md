# Sprint 14

**Goal** : **le copilote lit vraiment les PDF** — solder la dette « texte PDF non extractible » : résumé, Q&A et RAG sur le contenu des PDF, extraction 100 % locale (pdf.js), PDF scanné signalé honnêtement.
**Start** : 2026-07-24
**End** : 2026-07-31
**Status** : Active

Sprint **dette PDF** (direction choisie après le cap v2.1 RAG). La lecture PDF (Epic 11, ADR-0011) rend déjà le canvas ; la couche **texte** (`getTextContent`) n'a jamais été montée. En v2.0, tout PDF renvoyait « texte non extractible » (dette assumée, message honnête). Cet epic lève les 6 gardes `kind==='pdf'` du copilote en **réutilisant** les mécaniques existantes (map-reduce 14.2, index éphémère 15.3, index dossier 15.2), plutôt qu'en rouvrant ces stories. Source : `docs/planning/epics.md` Epic 18.

Rappels de cadrage :
- **0 réseau** = contrainte dure (NFR Confidentialité) : extraction via pdf.js local (worker Vite, aucun CDN — ADR-0011), aucune sortie réseau.
- **Hors scope : OCR.** Un PDF scanné (sans couche texte) est **détecté et signalé**, jamais « deviné » — pas de faux texte (règle FR-4 : pas de troncature/invention silencieuse).
- **Limite connue** (`pdf.ts`) : CMaps CJK et décodeurs WASM non bundlés → PDF CJK dégradent. 18.1 mesure et **liste ce qu'elle ne couvre pas** (leçon S10/S11).
- Spike-en-tête léger dans 18.1 : la qualité d'extraction (ordre de lecture, multi-colonnes) se vérifie sur de vrais PDF avant de câbler 18.2/18.3.

## Stories

| # | Story | Size | Status | Notes |
|---|-------|------|--------|-------|
| 18.1 | Extraction texte PDF (couche pure + service, détection PDF scanné) | M | TODO | `extractPdfText` via `getTextContent` par page, assemblage ordre de lecture, cache par onglet. Détection scanné = ratio texte/pages. Lister les non-couverts (multi-colonnes, CJK sans CMap). |
| 18.2 | Copilote sur PDF (résumé + Q&A + gros PDF via index éphémère) | M | TODO | Câbler le texte extrait : lever les 6 gardes `kind==='pdf'` (`buildDocContext`, `summarizeDoc`, index éphémère, badge Contexte). Réutilise map-reduce 14.2 + index éphémère 15.3. PDF scanné → message honnête. |
| 18.3 | PDF dans l'index du dossier (RAG) | M | TODO | **Stretch cuttable.** Inclure `.pdf` dans `readFolderTexts` (15.2) via extraction ; Q&A dossier cite les sources PDF (clic → ouvre). Coût d'extraction borné pendant l'indexation. |

## Blockers
_None_

## Checkpoints STOP/GO
| ~% | Critère | Si STOP |
|---|---|---|
| 35 % (18.1) | Extraction fidèle sur de vrais PDF texte (ordre de lecture correct) + détection scanné fiable ; non-couverts listés | Extraction de mauvaise qualité (ordre incohérent) → livrer l'extraction brute avec avertissement « mise en page approximative » plutôt que bloquer ; re-scoper 18.2 sur les PDF simples |
| 75 % (18.2) | Résumé + Q&A natif sur un PDF texte réel, gros PDF via index éphémère, PDF scanné → message honnête, 0 réseau | Qualité Q&A décevante sur PDF → livrer résumé seul (map-reduce) + garder le message honnête pour le scanné ; différer la Q&A PDF |
| 100 % (18.3) | PDF indexés dans le dossier, cités comme source (clic ouvre), coût borné | Coût d'extraction trop lourd à l'indexation → 18.3 en index à la demande (PDF extrait au 1er accès) ou cut (dette re-notée) |

## Progress Log
### 2026-07-24
- Sprint initialisé avec **3 stories** (Epic 18, dette PDF). Ledger : +3 entrées (63 features). Direction choisie après clôture du cap v2.1 RAG.
- 18.3 (PDF dans le RAG) désignée **stretch cuttable** : si 18.1 révèle un coût d'extraction lourd ou une qualité insuffisante, elle passe en index à la demande ou est re-notée en dette.
