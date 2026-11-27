# llama-bench b12810 (CPU ARM64, --load-mode none, 2 répétitions) — 2026-11-27

Machine chargée (Chrome, Claude, ~1-2 Go RAM disponibles) : écarts-types larges, lire les ordres de grandeur.

| model                          |       size |     params | backend    | threads |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | ------: | ---------: | --------------: | -------------------: |
| qwen2 1.5B Q4_0                | 885.97 MiB |     1.54 B | CPU        |       4 |       none |           pp512 |        413.67 ± 7.88 |
| qwen2 1.5B Q4_0                | 885.97 MiB |     1.54 B | CPU        |       4 |       none |          pp2048 |        164.13 ± 3.13 |
| qwen2 1.5B Q4_0                | 885.97 MiB |     1.54 B | CPU        |       4 |       none |           tg128 |         37.35 ± 0.95 |
| qwen2 1.5B Q4_0                | 885.97 MiB |     1.54 B | CPU        |       5 |       none |           pp512 |        312.19 ± 1.08 |
| qwen2 1.5B Q4_0                | 885.97 MiB |     1.54 B | CPU        |       5 |       none |          pp2048 |       263.20 ± 15.59 |
| qwen2 1.5B Q4_0                | 885.97 MiB |     1.54 B | CPU        |       5 |       none |           tg128 |         39.49 ± 0.83 |
| lfm3 1.7B Q4_0                 | 993.13 MiB |     1.73 B | CPU        |       4 |       none |           pp512 |        368.62 ± 7.77 |
| lfm3 1.7B Q4_0                 | 993.13 MiB |     1.73 B | CPU        |       4 |       none |          pp2048 |       209.25 ± 31.85 |
| lfm3 1.7B Q4_0                 | 993.13 MiB |     1.73 B | CPU        |       4 |       none |           tg128 |         34.22 ± 3.94 |
| lfm3 1.7B Q4_0                 | 993.13 MiB |     1.73 B | CPU        |       5 |       none |           pp512 |       308.78 ± 33.30 |
| lfm3 1.7B Q4_0                 | 993.13 MiB |     1.73 B | CPU        |       5 |       none |          pp2048 |       281.77 ± 15.34 |
| lfm3 1.7B Q4_0                 | 993.13 MiB |     1.73 B | CPU        |       5 |       none |           tg128 |         34.97 ± 1.87 |
| lfm3 1.7B Q4_K - Medium        |   1.02 GiB |     1.73 B | CPU        |       4 |       none |           pp512 |       246.77 ± 10.33 |
| lfm3 1.7B Q4_K - Medium        |   1.02 GiB |     1.73 B | CPU        |       4 |       none |          pp2048 |       153.10 ± 12.56 |
| lfm3 1.7B Q4_K - Medium        |   1.02 GiB |     1.73 B | CPU        |       4 |       none |           tg128 |         29.10 ± 4.80 |
| lfm3 1.7B Q4_K - Medium        |   1.02 GiB |     1.73 B | CPU        |       5 |       none |           pp512 |        219.18 ± 6.37 |
| lfm3 1.7B Q4_K - Medium        |   1.02 GiB |     1.73 B | CPU        |       5 |       none |          pp2048 |        143.14 ± 2.60 |
| lfm3 1.7B Q4_K - Medium        |   1.02 GiB |     1.73 B | CPU        |       5 |       none |           tg128 |         15.48 ± 1.85 |

## Balayage des threads (qwen2.5-1.5b Q4_0)

| threads | pp512 | tg128 |
|---|---|---|
| 4 | 418 ± 3 | 53,9 ± 9,0 |
| 6 | 434 ± 33 | 39,6 ± 0,8 |
| 8 | 414 ± 10 | 30,7 ± 3,3 |
| 10 (défaut llama.cpp) | 362 ± 255 | 23,3 ± 6,9 |
