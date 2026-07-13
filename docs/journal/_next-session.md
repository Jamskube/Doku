# Next session pointer
_Updated: 2026-07-13 16:10_

## Where I left off
**Cap v1.5 quasi bouclé côté code.** Sprint 9 (Export, Epic 10) **codé 4/4** — 10.1 spike PDF + 10.2 renderer MD→HTML (`marked`) **validés natif** ; 10.3 (HTML autonome) + 10.4 (DOCX `docx`) code-complete + revus. Sprint 10 (Lecture PDF + coller image) **lancé** : **spike 11.1 (lecteur PDF via PDF.js) codé + revu** (0 Critical/Major, data-safety confirmée — garde `saveTab` anti-destruction du .pdf). **3 validations natives en attente : 10.3, 10.4, 11.1** (ledger `passes:false`). Chaque story passée à EPCT → critic → code-reviewer → quick-fix → commit ; **2 bugs data-loss évités** par les revues. Ledger **41/46**, 156 tests verts, svelte-check 0 err, build OK (marked/docx/pdfjs lazy-loadés en chunks séparés).

## Open work
- Branch: `main` — **propre** (rien de non commité), poussé (`bbb2f06`)
- Open PRs: aucune
- Sprint actif: **Sprint 10** (`docs/sprints/sprint-10.md`), 2026-07-13 → 2026-07-20 — stories `11.1` (viewer PDF, en attente validation), `11.2` (`.pdf` associations OS), `12.1` (coller image)
- Specs/ADR: PRD-v1.5, ADR 0008-0011 (export PDF/HTML/DOCX + lecture PDF)

## Next concrete step
**Solder les 3 validations natives en un seul `tauri dev`** (action retro « grouper les validations ») :
1. **10.3** — Exporter en HTML → ouvrir le `.html` hors-ligne dans un vrai navigateur → **image inline** visible, aucun script.
2. **10.4** — Exporter en DOCX → ouvrir le `.docx` dans Word/LibreOffice → titres/gras/listes/lien/table/code.
3. **11.1** — Ctrl+O un vrai `.pdf` (polices embarquées) → rendu lecture seule, **scroll multi-pages**, worker offline (0 « fake worker »/violation CSP en console), 1re page < 1 s ; **⚠️ test critique : Ctrl+S sur le PDF ne doit RIEN faire** (fichier intact). Un PDF CJK dégradé = confirme la limite CMap (documentée ADR-0011).

Chaque « je valide » → je flippe le ledger correspondant. Puis **enchaîner 11.2** (`.pdf` associations/explorateur — S) et **12.1** (coller image — M, réutilise `writeFileAtomic`/`fs:allow-write-file`) pour clore le Sprint 10 = **v1.5 feature-complete**. Dette technique notée : Minor `checkExternalChanges` skip pdf (perf), bundling cmap/wasm pdfjs (CJK/JPEG2000), zoom PDF.
