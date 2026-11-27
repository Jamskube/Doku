# Licenses

## Purpose

Textes de licence distribués avec les composants natifs tiers.

## Files

| File | Purpose |
|---|---|
| `Handy-LICENSE.txt` | Licence MIT de Handy (CJ Pais) : nettoyage de dictée et découpage de la parole repris dans `src/lib/` (ADR-0034) |
| `llama.cpp-LICENSE.txt` | Licence MIT du moteur IA local llama.cpp (build b12810, ADR-0032) |
| `LLVM-OpenMP-LICENSE.txt` | Licence de `libomp.dll`, livrée avec le build Windows de llama.cpp |
| `bgraph-LICENSE.txt` | Licence amont du moteur de diagrammes bgraph embarqué en WebAssembly — autorisation élargie de l'auteur consignée dans l'ADR-0028 |
| `Lucide-LICENSE.txt` | Licence ISC (et MIT pour la part Feather) des icônes Lucide du sprite `src/assets/icons.svg` |
| `Beautiful-Article-NOTICE.txt` | Provenance et licence MIT des principes éditoriaux adaptés par Doku Document Studio |

## Dependencies

- Internal: `src-tauri/resources/`
- External: Handy (commit e95d488), llama.cpp b12810, LLVM OpenMP, bgraph, Beautiful Article v0.1.0, Lucide (lucide-static)
