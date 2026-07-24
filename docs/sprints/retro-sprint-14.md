# Retrospective: Sprint 14

**Date**: 2026-07-24
**Velocity**: 3 completed / 3 planned (100 %)
**Goal**: le copilote lit vraiment les PDF — solder la dette « texte PDF non extractible » (résumé, Q&A, RAG dossier), extraction 100 % locale, PDF scanné signalé honnêtement.

## Stats
- Stories completed: **3/3** (18.1, 18.2, 18.3 — stretch 18.3 inclus)
- Stories carried over: 0
- Blockers encountered: 0
- Ledger: 63/63 (toutes PASS, validées natif par l'utilisateur)
- Défauts attrapés avant la validation native: ≥5 (dont **1 BLOCK** critic sur 18.3, garde abort manquante sur 18.2)
- Average story completion: J+0 (sprint planifié J→J+7, clos le jour même)
- Commits: 6 (3 `feat` + 3 `docs` de validation)

## What Went Well 👍
- **« Réutiliser, pas rouvrir » a tenu.** Les 3 stories PDF se sont branchées sur des mécaniques existantes — map-reduce 14.2 (résumé), index éphémère 15.3 (gros PDF), index dossier 15.2 (RAG multi-PDF) — **sans modifier** ces stories. Dette soldée à coût minimal.
- **La boucle critic + reviewer a encore payé.** Elle a attrapé des défauts réels avant le natif à chaque story : un **BLOCK** sur 18.3 (PDF scanné ré-indexé en boucle) et une **garde abort manquante** sur 18.2 (`extractPdfText` lève l'AbortError). Confirme la leçon S13 : critic (plan) et reviewer (diff) sont complémentaires.
- **Détection scannée honnête (FR-4 respectée).** PDF scanné/vide/illisible signalé, jamais deviné : marqueur `chunks:[]` côté RAG, notice honnête côté copilote. Aucun faux texte livré. OCR hors scope, assumé.
- **Clôture J+0, vélocité pleine.** 3 stories dans la journée, 0 report, sans sacrifier la rigueur EPCT (explore → plan → critique → code → test → examine).

## What Didn't Go Well 👎
- **Rien de bloquant** (verdict utilisateur). Le sprint a coulé sans accroc majeur.
- Frictions mineures, non bloquantes, documentées et acceptées :
  - `pdf.ts` browser-only (worker au niveau module) → séparation logique pure / pdfjs forcée pour rester node-testable. Contournement propre mais imposé.
  - Signal de changement PDF = `stat` (`size:mtime`) : rate une réédition à `size`+`mtime` identiques. Compromis coût/justesse assumé, dette notée.
  - Build exit 255 trompeur (warning Vite `INEFFECTIVE_DYNAMIC_IMPORT` traité comme erreur par PowerShell) — bruit récurrent, build réel OK.

## Surprises
- **Rien de surprenant** (verdict utilisateur) : exécution conforme au plan. Les deux « pièges » (l'abort levé par `extractPdfText`, le marqueur anti-boucle) ont été anticipés/attrapés par la boucle critic+reviewer, donc absorbés dans le process plutôt que subis.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| **Trancher l'Epic 17 (NPU / Foundry Local)** — seul epic restant, différé. Décision produit (chantier perf, gain étroit sur le prefill) à prendre AVANT d'ouvrir un sprint 15 | High |
| Garder la boucle critic+reviewer + validation native + ledger telle quelle (process éprouvé sur 2 sprints) | — |

## Lessons Learned
Les leçons techniques du sprint 14 sont déjà dans `AGENTS.md` (persistées au `/wrap` du 2026-07-24) :
- Marqueur anti-ré-extraction dans un index incrémental (un item non-indexable sans entrée meta est re-vu « nouveau » à chaque diff → entrée marqueur vide).
- (S13, complémentaire) critic+reviewer complémentaires ; checksum d'appariement bin/meta RAG.

→ Aucune nouvelle leçon à persister ce sprint (rien de surprenant, frictions déjà documentées dans le journal).
