# Sprint 10

**Goal** : Doku lit les PDF (lecture seule, hors-ligne) et colle les images du presse-papier — **v1.5 feature-complete**.
**Start** : 2026-07-13
**End** : 2026-07-20
**Status** : Active

Dernier sprint du cap v1.5 (source : `docs/planning/PRD-v1.5.md`, Epics 11-12). À la clôture, tout le PRD-v1.5 est livré (recherche + export + lecture PDF + coller image).

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 11.1 | Viewer PDF.js bundlé local (lecture seule, scroll/zoom, worker sous CSP) | L | TODO | **Le morceau.** PDF.js bundlé 100 % offline ; worker sous CSP `worker-src 'self' blob:` **non testable en dev navigateur** → smoke natif. Octets via plugin-fs `readFile` (`fs:allow-read-file` déjà en place, 10.3). Micro-spike worker+CSP en tête conseillé. |
| 11.2 | `.pdf` comme format supporté (explorateur/associations, lecture seule) | S | TODO | `isSupportedFile` += `.pdf` ; visible/ouvrable ; aucun mode édition proposé. Dépend de 11.1. |
| 12.1 | Coller une image → fichier lié + insertion du lien | M | TODO | Ctrl+V image sur doc **enregistré** → écrit à côté (nom unique **jamais écrasant**) + `![](relatif)` au curseur. `writeFileAtomic`/`fs:allow-write-file` déjà en place (10.4). Doc non enregistré → demande de sauver ; échec → message clair. |

## Blockers
_None_

## Debt (Sprint 9)
- Validation native **10.3** (HTML autonome) + **10.4** (DOCX) en attente (`passes:false`). Action retro : **solder avant de coder par-dessus**.

## Progress Log
### 2026-07-13
- Sprint initialisé avec 3 stories (Epics 11-12). 1 L (11.1) + 1 S (11.2) + 1 M (12.1). Vélocité cible ~4 (S6=4/S7=3/S8=4/S9=4) ; le poids de 11.1 (L) fait de ce sprint un sprint plein.
- Risque principal : **11.1** — bundling PDF.js + worker sous CSP ARM64, non vérifiable en dev navigateur → smoke natif requis (comme la CSP/impression). Micro-spike worker+CSP en tête envisagé.
- Bon présage : permissions binaires (read/write) déjà ajoutées en S9 servent 11.1 (lecture octets PDF) et 12.1 (écriture image collée).
- Après ce sprint : **v1.5 feature-complete** → retro cap v1.5, puis cadrage v2 (copilote Ollama ADR-0006, PRD dédié à écrire).
