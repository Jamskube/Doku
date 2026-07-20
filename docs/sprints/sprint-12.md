# Sprint 12

**Goal** : **v2.0 livrée** — le copilote dialogue, résume et répond sur le document ouvert, et Doku s'installe avec son moteur embarqué.
**Start** : 2026-07-16
**End** : 2026-07-23
**Status** : Completed (2026-07-20 — clos à J+4, rétro : `retro-sprint-12.md`)

1er sprint au **format recalibré** (rétro S11) : **1 semaine / 6-8 stories** au lieu de 2 semaines / 3-4. Source : `docs/planning/PRD-v2.md` (FR-3, FR-4, FR-5 → Epic 14 ; FR-7, FR-8 → Epic 16). À la clôture : le copilote est **utilisable** (chat streamé, résumé, Q&A ancrée) et le sidecar est **prouvé en release installée**.

**Design hors sprint** : l'UI du panneau copilote a été itérée séparément avec Claude Design (préférence actée en rétro S1). **Maquette hifi livrée et vendorée** dans `docs/design/w2-copilot/` (6 états × 2 thèmes + README de handoff). Décisions de cadrage (2026-07-16) : **(A)** on suit la maquette au pixel = **panneau `aside` à droite** (pas la vue sidebar gauche du plan initial), avec bouton *collapse* et chorégraphie du chrome ; **(B)** *coquille visuelle maintenant, câblage plus tard* = on dessine tout (puces `+ Contexte`, « Doku-San », débit `t/s`) mais seul le **doc courant** est branché en v2.0 ; le **contexte multi-docs part en Epic 15 (RAG)**.

> **Impact de la maquette sur le découpage** : le panneau droit change le shell (`App.svelte`/`TitleBar.svelte` : contrôles fenêtre qui migrent, coins du document qui s'arrondissent) et **relocalise l'UI modèles de 13.4** (sidebar gauche → panneau droit, derrière l'icône `layers`). C'est un bloc structurel distinct du chat → scindé en **14.0** (coquille + chrome + relocalisation) pour ne pas laisser 14.1 gonfler en silence (leçon rétro S11). La *logique* validée en 13.4 (`copilot.svelte.ts`, pull/purge/actif) est réutilisée telle quelle ; seul son emplacement d'affichage bouge.

## Stories

| # | Story | Size | Status | Notes |
|---|-------|------|--------|-------|
| 14.0 | Coquille panneau droit (`aside`) + chorégraphie chrome + relocalisation UI modèles (13.4) | M | ✅ Done | Validé natif 2026-07-16. `CopilotPanel.svelte` : aside 344px « Doku-San », bouton collapse, chrome migré (contrôles fenêtre titlebar↔panneau), coin doc `with-copilot`, `doku-panel-in`. Modèles relocalisés (vue `layers`) ; coquille chat statique (streaming → 14.1). Boot-safety : aucun spawn Ollama au démarrage. critic (HIGH corrigé) + code-reviewer Approve. |
| 14.1 | Panneau copilote (chat, streaming, annuler, rendu MD sanitizé) | M | ✅ Done | Validé natif 2026-07-16. Chat streamé (`chat()` /api/chat), stop < 500 ms, rendu MD via **`sanitizeChatHtml` allowlist** (0 réseau, contenu LLM non fiable en webview principale) + CSP durcie, copiable, 3 actions câblées. `OllamaSpike` supprimé. critic (Block → 3 HIGH réseau corrigés) + code-reviewer Approve. |
| 14.2 | Résumer le document (md/txt/html/PDF, map-reduce si > contexte) | M | ✅ Done | Validé natif 2026-07-16. Map-reduce borné (segmentDoc + réductions plafonnées) + `num_ctx` fixé = 0 troncature silencieuse ; résumé direct streamé si ça tient en une fenêtre ; PDF → message clair (extraction = dette). |
| 14.3 | Q&A sur le document courant (ancrée, « je ne trouve pas ») | S | ✅ Done | Validé natif 2026-07-16. Ancrage + phrase de refus exacte, température basse + rappel collé à la question ; badge lecture partielle au-delà du seuil (lecture complète → RAG Epic 15). Correctif post-livraison : distinction tâches-sur-le-texte / invention (le modèle refusait « check les fautes »). |
| 13.5 | Packaging release du sidecar (build ARM64 + install) | S | ✅ Done | Validé natif 2026-07-16. `ollama.exe` + `lib/ollama` frères sous `resource_dir()` prouvés par génération depuis target/release ; app installée OK + association `.pdf`. Les 2 dettes S10/S11 sont soldées. |
| 16.1 | Reformuler une sélection — **stretch** | M | ✅ Done | Validé natif 2026-07-16. Clarifier/Raccourcir/Ton → proposition streamée, accepter remplace (Ctrl+Z restaure), refuser intact, garde zéro-perte onglet+région. UI déplacée ensuite vers l'aperçu en place (16.2/w3). |
| 16.2 | Corriger orthographe & grammaire — **stretch** | S | ✅ Done | Validé natif 2026-07-20. Absorbée par le **brief w3** : 4ᵉ verbe du menu de sélection + **aperçu diff mot à mot EN PLACE** (`rephrase-preview.ts`, StateField, doc intact jusqu'à Accepter, une transaction Ctrl+Z) ; panneau redevenu conversation pure. critic 3 HIGH intégrés + code-reviewer Approve. |

## Blockers
_None_

## Checkpoints STOP/GO
| ~% | Critère | Si STOP |
|---|---|---|
| 20 % (14.0) | Panneau droit s'ouvre/ferme proprement (chrome migré, coins OK) **en release aussi** ; modèles relocalisés fonctionnels | Bug shell fenêtre → figer le chrome (repli « chrome figé ») plutôt que bloquer le sprint |
| 30 % (14.1) | Chat streamé + annulable dans le panneau, rendu MD sanitizé | Revoir le store copilote (13.4) avant d'empiler les usages |
| 50 % (13.5) | Doku **installé** génère (lib chargée via `resource_dir`) + double-clic `.pdf` ouvre | Bug de packaging → traiter en priorité : sans ça, v2 n'est pas distribuable |
| 80 % (14.2-14.3) | Résumé d'un doc > fenêtre de contexte **sans troncature silencieuse** ; Q&A refuse d'inventer | Livrer 14.1+14.3, reporter 14.2 (map-reduce = story à part entière) |
| Stretch (16.x) | — | Couper sans état d'âme, retour en v2.1 (Sprint 13) |

## Progress Log
### 2026-07-16
- Sprint initialisé avec **6 stories** (5 du backlog + 1 nouvelle). Premier sprint à 1 semaine (action rétro S11 : 4×M livrés en 1 jour vs 2 semaines planifiées).
- **13.5 créée** (hors décomposition initiale) : ajoutée à l'Epic 13 dans `epics.md`. Solde les 2 dettes « à confirmer au prochain build+install » avant qu'une 3e ne s'accumule (action rétro S11, High).
- **Epic 16 remontée en stretch** : le PRD-v2 la séquence en v2.1 (avec le RAG), mais 16.1/16.2 réutilisent exactement le `generate` de 14.1 et **ne dépendent pas de l'Epic 15**. Les remonter isole le RAG (spike + L, le gros chantier risqué) dans un Sprint 13 dédié → **v2 bouclée en 2 sprints**.
- **Correction du décompte de la rétro S11** : il reste **8** stories v2 (Epic 14 : 3 · Epic 15 : 3 · Epic 16 : 2), pas ~12 (c'était le total des Epics 13-16, dont l'Epic 13 déjà livrée).
- Design du panneau copilote traité **hors sprint** (Claude Design) ; 14.1 démarre une fois la maquette arrêtée.

### 2026-07-16 (soir) — maquette livrée, cadrage design
- **Maquette hifi reçue et vendorée** (`docs/design/w2-copilot/`, 6 états × 2 thèmes + handoff). Le design diverge du plan : **panneau `aside` droit** (au lieu de la vue sidebar gauche), avec bouton collapse et chorégraphie du chrome, et **relocalise l'UI modèles de 13.4**.
- **2 décisions** (AskUserQuestion) : (A) suivre la maquette au pixel = panneau droit + chrome mobile ; (B) « coquille visuelle maintenant, câblage plus tard » = doc courant seul en v2.0, contexte multi-docs → Epic 15.
- **Découpage ajusté** : **14.0** créée (coquille + chrome + relocalisation modèles) en tête, distincte de **14.1** (chat). Motif : ne pas laisser 14.1 gonfler en silence sous le poids du shell (leçon rétro S11). Ledger : +1 entrée (57 features).
- **Sprint 12 = 7 stories** (14.0/14.1/14.2/14.3/13.5 cœur + 16.1/16.2 stretch). Toujours dans la cible recalibrée 6-8.

### 2026-07-16 — 14.0 validée natif (checkpoint 20 % franchi)
Coquille du panneau copilote droit livrée et validée en natif : ouverture/fermeture animée, chrome migré proprement (close-guard intact), coin du doc, gestion des modèles relocalisée et fonctionnelle, boot sans spawn Ollama. Ledger **51/57**. La fondation UI est prête → 14.1 (chat streaming) remplit la coquille et supprime `OllamaSpike.svelte`.

### 2026-07-16 — 14.1 validée natif (checkpoint 30 % franchi)
Le **chat copilote streaming** est vivant : réponse token-par-token, stop < 500 ms, rendu Markdown à la fin, actions rapides, non perturbé par un changement d'onglet. `OllamaSpike` supprimé. Ledger **52/57**. Le durcissement sécurité est le fait marquant : le critic a renvoyé **Block** (contenu LLM rendu dans la webview principale sans `default-src` = 3 vecteurs réseau), corrigé par une **allowlist DOMPurify** + CSP durcie + `/api/chat`, avec un test de non-régression réseau. Reste au sprint : 14.2 (résumer map-reduce), 14.3 (Q&A ancrée), 13.5 (packaging release), 16.1/16.2 (stretch).

### 2026-07-20 — 16.2 validée natif, sprint clos (ledger 57/57)
La dernière story arrive **par le design** : le brief w3 (confirmé le 17/07 en session `/impeccable`, réaligné par l'utilisateur avec son menu contextuel de sélection) absorbe 16.2 — 4ᵉ verbe **Corriger** + **aperçu diff mot à mot EN PLACE** dans l'éditeur (`rephrase-preview.ts`, StateField, document intact jusqu'à Accepter, une transaction Ctrl+Z) ; le panneau perd ses cartes Proposition. critic « ship with changes » (3 HIGH : reload externe hors transaction, virtualisation CM6, catch non gardé) + code-reviewer Approve (0 Critical/Major). Entre-temps, **hors sprint** : refonte interface (menu `⋯`, vue pleine page), **provider OpenAI optionnel** (ADR-0013/0014) et correctif du sur-ancrage 14.3. **Sprint clos à J+4 : 7/7, v2.0 + rédaction livrées** → rétro `retro-sprint-12.md`, cap sprint 13 = Epic 15 (RAG).
