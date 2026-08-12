# Next session pointer
_Updated: 2026-08-12 14:59_

## Where I left off
Le bouton `+` du chat sait ajouter des sélections, fichiers, dossiers et presse-papiers comme contexte éphémère borné. La mémoire durable cloud est implémentée en Markdown local avec rappel/extraction automatiques, vue de gestion et isolation par note par défaut ; le partage avec un dossier est explicite et ne déborde pas hors de ce dossier. Les 452 tests, le typecheck, le build web, les vérifications visuelles et les bundles NSIS ARM64/x64 sont réussis. Le nouvel installateur x64 est `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Doku_2.2.0_x64-setup.exe` (SHA-256 `19b92e121c8c26ae254877c7eeba71634850c94754a024db55e2cec6fe7ba6da`).

## Open work
- Branch: `main` (19 fichiers non commités)
- Open PRs: non vérifiables pendant le wrap (accès GitHub indisponible)
- Drafts/plans: `docs/plans/ajouter-contexte-chat.md`, `docs/plans/fournisseur-minimax.md`, `docs/plans/notes-ia-et-reecritures-structurelles.md`, `docs/plans/_latest.md`
- La mémoire cloud doit encore recevoir un smoke natif utilisateur avec un vrai échange OpenAI ou MiniMax avant commit.
- Le staging sidecar contient actuellement la variante x64 ; relancer `npm run prepare:ollama:arm64` avant le prochain build ARM64.
- L'installateur x64 n'est pas signé : Windows peut afficher « Éditeur inconnu ».

## Next concrete step
Smoke-tester en natif un rappel puis une extraction mémoire avec OpenAI ou MiniMax, puis revoir et committer ensemble le contexte éphémère et la mémoire durable.
