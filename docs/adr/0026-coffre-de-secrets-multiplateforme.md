# 0026. Coffre de secrets hors Windows : Secret Service via `keyring`

**Date** : 2026-08-18 · **Status** : accepted · **Deciders** : nicos · **Tags** : secret, linux, keyring, secret-service, cloud, portabilité

## Contexte

[ADR-0025](./0025-distribution-linux-appimage.md) ouvre la distribution Linux et acte, comme limite assumée, que **le copilote cloud n'y fonctionne pas** : `write_secret` hors Windows rendait « Le stockage protégé de {what} est actuellement disponible sous Windows ». Ni OpenAI ni MiniMax.

Cette limite est inacceptable en pratique : le copilote est le cœur de Doku, et un utilisateur Linux réduit au modèle local perd la moitié de l'application. La présente ADR la lève.

Rien ne bloquait côté frontend — aucune garde par plateforme dans l'interface. Le seul verrou était ces trois souches Rust.

## Décision

**`keyring` 4, en features par défaut, uniquement hors Windows** (`[target.'cfg(not(windows))'.dependencies]`).

La feature `v1` installe **paresseusement** le magasin de la plateforme au premier `Entry::new` ; sur *nix c'est `zbus_secret_service_keyring_store`, donc le **Secret Service** de la session (GNOME Keyring, KWallet, KeePassXC) parlé en **zbus — du Rust pur**. Aucune bibliothèque C, aucun `pkg-config`, rien à installer sur la machine de construction.

**Windows n'est PAS migré.** C'est délibéré, et c'est le point qui coûte une seconde implémentation :
`keyring` ne nomme pas les identifiants Windows comme le fait le code actuel (`CredWriteW` avec la cible brute `Doku/MiniMax/api-key`). Basculer dessus **orphelinerait en silence** les secrets déjà stockés : l'utilisateur retrouverait un jour son compte OpenAI déconnecté et sa clé MiniMax disparue, sans message et sans cause visible. Une implémentation supplémentaire est un prix bien inférieur à celui-là.

**Un seul contrat pour les appelants.** `compat.rs` et `openai.rs` ne voient qu'une API : mêmes noms de cible, même nom d'utilisateur « Doku », lecture d'un secret absent = `Ok(None)`, suppression **idempotente**. Les deux faces respectent ce contrat à la lettre.

**L'absence de trousseau est nommée** (règle Epic 19). Une session sans environnement de bureau n'a souvent aucun service de secrets : `Entry::new` échoue alors, et l'erreur n'est pas rendue telle quelle — elle dit ce qui manque et quoi installer.

## Conséquences

**Positif** : le copilote cloud (OpenAI et MiniMax) fonctionne sous Linux ; les secrets y sont protégés par le trousseau de la session, jamais écrits en clair ; les secrets Windows existants sont intacts ; aucune dépendance C ajoutée ; macOS deviendrait accessible sans une ligne de plus (`keyring` y branche le Trousseau).

**Négatif** : deux implémentations à maintenir pour un même contrat — le prix de la compatibilité ascendante des secrets Windows ; un service de secrets devient un prérequis Linux pour le cloud (le local n'en demande aucun) ; `keyring` et sa chaîne `zbus`/`secret-service` entrent dans le graphe de dépendances hors Windows.

**Non vérifié** : le code compile pour `x86_64-unknown-linux-gnu` (banc de recoupement dédié, code de production à l'identique), mais **rien n'a jamais parlé à un vrai Secret Service**. Le premier échange réel avec GNOME Keyring ou KWallet reste à faire.
