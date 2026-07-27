# Sprint 16

**Goal** : clore l'Epic 19 (zéro bouton muet) et **sceller la v2.2** — dernier sprint de code avant la période d'usage réel décidée à la rétro S15.
**Start** : 2026-07-27
**End** : 2026-07-27 (clos J+0)
**Status** : **Completed — 3/3, v2.2.0 scellée** · rétro : [`retro-sprint-16.md`](./retro-sprint-16.md)

Sprint de **clôture**, volontairement léger : 19.2 et 19.3 sont déjà codées (commits `3054ba3`, `7558fa0`) — le travail restant est la **validation native**, puis le scellement de la release. Aucun code neuf hors 19.4. L'action High de la rétro S15 (« utiliser Doku pour de vrai, laisser le prochain epic émerger de l'usage ») commence dès que ce sprint est clos.

Rappels de cadrage :
- **Version tranchée : `2.2.0`** (décision utilisateur 2026-07-27) — `package.json` + `src-tauri/tauri.conf.json`, pour que la carte « À propos » affiche *Doku v2.2.0*.
- ⚠️ La section « Données » de 19.2 fait de la **suppression définitive** (historique des versions, index sémantique) — à éprouver sur un vrai historique avant de flipper le ledger.
- **Interdits de sprint** : rouvrir le NPU (3 conditions ADR-0016), rouvrir le choix du modèle copilote (tranché : `qwen2.5:1.5b-instruct-q4_0`), ajouter un epic.

## Stories

| # | Story | Size | Status | Notes |
|---|-------|------|--------|-------|
| 19.2 | Modale Paramètres — validation native (⚙, Échap/fond/focus piégé, Apparence, purges en 2 temps, À propos) | S | ✅ DONE | Validée en natif par l'utilisateur 2026-07-27 (purge « Données » éprouvée) — ledger flippé |
| 19.3 | Logo → À propos — validation native (modale ouverte section À propos surlignée, title/aria-label) | S | ✅ DONE | Validée en natif par l'utilisateur 2026-07-27 — ledger flippé |
| 19.4 | Sceller la v2.2 : bump `2.2.0` + `npm run tauri build` → installateur ARM64 vérifié (app installée : .md, save, copilote, assoc .pdf) | S | ✅ DONE | Validée par l'utilisateur 2026-07-27 (installateur habillé + smoke app installée) — ledger flippé |

## Blockers
_None_

## Checkpoints STOP/GO
| ~% | Critère | Si STOP |
|---|---|---|
| 66 % (19.2+19.3) | Validées en natif, ledger flippé | Un défaut trouvé (surtout sur la purge) se corrige **dans** le sprint — c'est du travail de l'epic, pas du scope neuf |
| 100 % (19.4) | Installateur généré + app installée smoke-testée | Ne pas sceller une release avec une story Epic 19 en échec |

## Progress Log
### 2026-07-27
- Sprint initialisé avec **3 stories** (2 validations Epic 19 + scellement release). Ledger : +1 entrée (19.4) → 69 features, 65 PASS, ouvertes : 17.2 (annulée, par conception), 19.2, 19.3, 19.4.
- Décisions actées : périmètre accepté tel quel ; version **2.2.0**.
- **19.2 + 19.3 validées en natif par l'utilisateur** (modale Paramètres complète, purges éprouvées en 2 temps ; logo → À propos surligné) → ledger flippé (67/69 PASS, seules 17.2 annulée et 19.4 restent).
- **19.4 engagée** : versions bumpées à `2.2.0` (`package.json` + lock, `tauri.conf.json`, `Cargo.toml` + lock — la carte À propos lit `package.json`) ; `svelte-check` 0 err / 0 warn ; `npm run build` OK ; `npm run tauri build` lancé. Incident évité : un remplacement PowerShell avait mojibaké les accents de `Cargo.toml` (lecture ANSI) — restauré via git puis bump refait proprement.
- **Hors sprint (design, préférence utilisateur)** : habillage complet de l'installateur NSIS en D.A. Doku, en deux itérations sur retour utilisateur — (1) BMPs sidebar/header + icône + langue française ; (2) template NSIS custom (base tauri-cli 2.11.4, blocs `; DOKU:`) pour les fonds crème/encre sur toutes les pages, le journal « papier » et le BrandingText. Recette + dette de re-diff documentées dans `docs/design/installer-nsis/`.
- **19.4 validée par l'utilisateur** (installateur habillé jugé sur pièce + smoke de l'app installée) → ledger flippé. **Sprint 16 : 3/3 — reste la rétro pour clore.**
