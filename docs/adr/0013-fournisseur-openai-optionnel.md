# 0013. Fournisseur OpenAI optionnel pour Doku-San

**Date** : 2026-07-17 · **Status** : rejected · **Deciders** : nicos (+ Codex) · **Tags** : ia, openai, cloud, secret, confidentialité

> Rejetée le 2026-07-17 : Doku doit connecter directement le compte OpenAI/ChatGPT de l’utilisateur. Une clé API saisie ou configurée manuellement ne répond pas au besoin produit.

## Contexte

Doku-San fonctionne historiquement avec Ollama en local (ADR-0006/0012), avec une promesse d'inférence hors ligne. Le produit doit désormais permettre à l'utilisateur de choisir explicitement OpenAI et `gpt-5.6-luna` pour le chat, les résumés et les reformulations, sans dégrader le mode local ni exposer une clé API dans la webview Svelte.

L'abonnement ChatGPT et l'API OpenAI sont deux produits facturés séparément. La connexion retenue est donc une clé de plateforme API, pas un détournement de la session ChatGPT.

## Décision

- Ollama reste le fournisseur par défaut et continue de fonctionner entièrement sur l'appareil.
- OpenAI est un fournisseur **opt-in** persistant, clairement identifié comme cloud dans le header, la vue Modèles et le composeur.
- Le modèle initial est `gpt-5.6-luna`, via `POST /v1/responses`, en streaming SSE.
- La clé est lue par l'hôte natif depuis `OPENAI_API_KEY`. Elle n'est ni renvoyée au frontend, ni stockée dans `localStorage`, ni écrite dans le repo.
- L'hôte Rust effectue l'appel HTTPS et relaie uniquement les deltas de texte par canal IPC. L'annulation reste disponible pendant le flux.
- Les requêtes posent `store: false`. Le contexte visible est envoyé uniquement lorsqu'OpenAI est le fournisseur actif et que l'utilisateur déclenche une action.

Cette commande Rust réseau est une exception ciblée à l'ADR-0004 : une primitive native est nécessaire pour garder le secret hors de la webview. Elle ne déplace aucune logique de prompt ou de document en Rust.

## Conséquences

**Positif** : choix local/cloud explicite ; secret absent du frontend ; même expérience de streaming et d'annulation ; modèle cloud plus capable disponible sans téléchargement local.

**Négatif** : nécessite une clé API et une facturation plateforme séparée ; le document quitte la machine quand OpenAI est actif ; dépendance réseau et nouvelle surface Rust (`reqwest`).

**Garde-fous** : aucun appel automatique à OpenAI à l'ouverture de Doku ou de la vue ; statut lu localement ; erreurs d'authentification et de quota traduites sans journaliser le secret ; mode Ollama inchangé.

## Liens

- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) — exception Rust ciblée pour la conservation du secret
- [ADR-0006](./0006-copilote-ia-ollama-sidecar-cpu.md) — le local reste le défaut
- [ADR-0012](./0012-cycle-de-vie-sidecar-ollama.md) — cycle de vie Ollama inchangé
