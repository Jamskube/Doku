# 0018. Fournisseurs cloud compatibles OpenAI par clé API (MiniMax)

**Date** : 2026-08-10 · **Status** : accepted · **Deciders** : nicos · **Tags** : ia, cloud, minimax, compatible-openai, secret, cle-api

## Contexte

L'utilisateur veut employer MiniMax (modèles M-series) comme fournisseur cloud du copilote, en plus d'OpenAI. MiniMax expose une API **compatible OpenAI** (`https://api.minimax.io/v1/chat/completions`, SSE) dont l'authentification passe par une **clé API** — il n'existe pas de flux OAuth de code d'appareil équivalent à celui de Codex.

Ceci amende deux positions antérieures :
- **ADR-0013 (rejetée)** refusait l'approche « clé API » *pour OpenAI*, parce qu'une meilleure voie existait (connexion de compte, ADR-0014). Pour MiniMax, la clé est la seule voie : le rejet de 0013 ne s'y transpose pas. La promesse d'AGENTS.md (« jamais par saisie de clé API ») reste vraie **pour OpenAI** et est reformulée en règle par fournisseur.
- **8.3 (« 0 réseau au runtime »)**, déjà amendée par l'opt-in OpenAI (ADR-0014), s'étend à un second hôte opt-in : `api.minimax.io`, uniquement quand l'utilisateur a connecté une clé ET sélectionné le fournisseur.

## Décision

- **Architecture générique, UI préréglée.** Un module Rust `compat.rs` porte un **registre en dur** des fournisseurs compatibles OpenAI (aujourd'hui : MiniMax seul). La base URL n'est configurable ni depuis le frontend ni depuis `settings.json` : une clé volée ne peut pas être exfiltrée vers un autre hôte. L'UI est une carte « MiniMax » simple : coller la clé, choisir le modèle.
- **La clé est validée AVANT d'être stockée** (appel à 1 token) : clé invalide ou réseau en panne → erreur claire, rien n'est écrit. Elle vit dans le **Gestionnaire d'identifiants Windows** (couche `secrets.rs`, partagée avec la session OpenAI). Elle traverse l'IPC une fois à la connexion, n'est jamais persistée côté webview, jamais renvoyée par aucune commande.
- **Statut honnête** (règle Epic 19) : `compat_status` distingue « clé refusée » (401/403 → carte « reconnectez ») de « réseau inaccessible » (mode dégradé signalé). Aucune requête réseau tant qu'aucune clé n'est stockée.
- **Modèles** : liste dynamique via `GET /models` quand la surface le sert ; MiniMax ne le documente pas → repli sur le catalogue du registre (M3, M2.7, M2.5, M2.1…, variantes highspeed). Choix persisté (`minimaxModel`), défaut `MiniMax-M2.5`.
- **Raisonnement filtré, deux ceintures** : la requête envoie `reasoning_split: true` (la pensée part dans `reasoning_content`, ignoré côté Rust) ET un scrubber streamé côté frontend supprime les blocs `<think>…</think>` ouverts en tête de réponse (balises coupées entre deltas comprises). Une réponse entièrement « pensée » devient un échec franc avec retry — jamais un monologue affiché, jamais un tour supprimé en silence.
- **Un seul prédicat cloud** (`isCloudProvider`) pilote badge, budget de contexte (240k), personas, budgets et libellés — pas de ternaires divergents.
- Le streaming, l'annulation (< 500 ms) et la forme des événements reprennent les motifs éprouvés de `stream_openai`.

## Conséquences

**Positif** : MiniMax utilisable en collant une clé ; tout fournisseur compatible OpenAI futur = une entrée de registre + une carte ; secrets sous Windows ; hôtes réseau bornés par le binaire.

**Négatif** : le document quitte la machine quand MiniMax est actif (signalé dans l'UI, comme OpenAI) ; la gestion de la clé (création, quotas, révocation) reste chez MiniMax ; le catalogue de repli demande une retouche quand MiniMax renomme ses modèles ; la détection d'une clé révoquée sans `GET /models` n'apparaît qu'à la première génération.
