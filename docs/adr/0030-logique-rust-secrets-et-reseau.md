# 0030. Logique Rust assumée : secrets, réseau authentifié et sidecar — supersède l'ADR-0004

**Date** : 2026-09-05 · **Status** : accepted · **Supersedes** : [ADR-0004](./0004-io-fichiers-plugins-officiels.md) · **Deciders** : Kubo (+ Claude) · **Tags** : tauri, rust, sécurité, maintenance

## Context

L'ADR-0004 (2026-07-08) décidait « zéro commande Rust custom » et exigeait un ADR de supersession pour toute exception. Depuis, `src-tauri/src/` compte **15 commandes** et ~2 900 lignes : `openai.rs` (830, connexion Codex et streaming), `compat.rs` (831, fournisseurs par clé API), `web_search.rs` (recherche Exa), `secrets.rs` (coffre CredMan/keyring), `sidecar.rs` (Ollama), et `set_system_backdrop` (Mica). Aucun ADR ne l'avait dit. `AGENTS.md` affirmait encore « Rust minimal, zéro logique métier » : la thèse écrite ne correspondait plus au code.

Chaque commande existe pour une raison que le TypeScript ne peut pas tenir :

| Commande(s) | Pourquoi en Rust |
|---|---|
| `openai_*`, `stream_openai`, `cancel_openai` | Le jeton OAuth Codex ne doit **jamais** entrer dans la webview (ADR-0014). Le flux SSE est lu et relayé par l'hôte. |
| `compat_*`, `stream_compat`, `cancel_compat` | Même règle pour la clé API MiniMax (ADR-0018) : lue du coffre, posée dans l'en-tête, jamais exposée au JS. |
| `secrets.rs` | Windows Credential Manager (FFI) et Secret Service Linux (ADR-0026). |
| `start_ollama` | Job Object Windows pour tuer l'arbre du sidecar à la mort du process (ADR-0006). |
| `web_search` | Appel réseau sortant hors de la CSP de la webview, avec cache et délai d'expiration. |
| `set_system_backdrop` | API DWM (Mica), inaccessible au JS. |

Ce qui reste vrai de l'ADR-0004 : **l'I/O fichiers** passe toujours exclusivement par `plugin-fs` et `plugin-dialog` depuis TypeScript. Aucune commande Rust ne lit ni n'écrit un document de l'utilisateur.

## Decision

1. Le Rust de Doku porte **trois responsabilités, et seulement celles-là** : (a) les secrets et tout appel réseau qui en a besoin, (b) le cycle de vie du sidecar, (c) les API système que la webview n'atteint pas. L'I/O fichiers, le parsing, la logique métier et le classement restent en TypeScript.
2. Toute nouvelle commande Rust doit entrer dans l'une des trois cases ci-dessus et le dire dans son commentaire de tête. Sinon, elle vit en TypeScript.
3. Le Rust est testé comme le TypeScript : `cargo test` et `cargo clippy -D warnings` tournent en CI sur chaque push (voir `.github/workflows/ci.yml`).
4. Les moteurs de recherche scrapés (Bing RSS, Yahoo, DuckDuckGo Lite) sont **retirés** le jour même : ils exigeaient un User-Agent de navigateur usurpé, contredisaient la NFR « aucune requête réseau sans geste explicite » par leur fragilité, et cassaient à chaque changement de balisage. Seul Exa (serveur MCP public, sans clé) reste ; Doku s'annonce désormais `Doku/<version>`.

## Consequences

**Positive** : la doc dit ce que fait le code ; la frontière est nommée et vérifiable en revue (« quelle case ? »).
**Negative** : deux langages à maintenir, comme depuis un an — mais c'est le prix de ne jamais mettre un jeton dans une webview.
**Risks** : la tentation de « juste une commande de plus » ; la règle 2 est la garde.

## Related

- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) — supersédé (l'I/O reste conforme)
- [ADR-0014](./0014-connexion-compte-openai-codex.md), [ADR-0018](./0018-fournisseur-cloud-compatible-openai.md), [ADR-0026](./0026-coffre-de-secrets-multiplateforme.md) — les raisons des commandes
