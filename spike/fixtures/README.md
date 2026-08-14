# Fixtures PDF

## Purpose

Corpus local et reproductible pour les kill-tests PDF de Doku.

## Files

| File | Purpose |
|---|---|
| `pdf-annotation-test.pdf` | Quatre pages texte tournées à 0°, 90°, 180° et 270°. |
| `generate_pdf_annotation_test.py` | Régénère la fixture avec ReportLab puis applique les rotations avec pypdf. |

## Dependencies

- Internal: `spike/pdf-text-selection.html`
- External: `reportlab`, `pypdf`
