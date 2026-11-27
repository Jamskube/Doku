# 0034. Dictée de notes inspirée de Handy : mains libres ou Espace maintenue, transcription LFM3

**Date** : 2026-11-27 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : ia, voix, dictée, lfm3, ux, éditeur · **S'appuie sur** : ADR-0032, ADR-0033 · **Source** : [Handy](https://github.com/cjpais/handy) (MIT), commit `e95d488`

## Contexte

L'utilisateur veut prendre des notes **écrites** à la voix dans Doku, « en reprenant tout ce qu'on peut reprendre » de Handy, une application libre de dictée (raccourci → parole → texte collé).

Analyse du code de Handy :

- **Capture** : crate `handy-recorder` (WASAPI / PulseAudio, 16 kHz mono).
- **Découpage de la parole** : Silero ou earshot, lissés (pré-roulement 450 ms, attaque 60 ms, traîne 450 ms).
- **Transcription** : crate `transcribe-cpp` (ggml), modèles Parakeet, Whisper et Canary, exécutés dans un processus fils.
- **Nettoyage du texte** : mots de remplissage, bégaiements, mots personnalisés.
- **Sortie** : collage dans l'application au premier plan (presse-papiers + clavier simulé), plus une fenêtre d'état.

Ce qu'en dit le terrain :

- **Le moteur de Handy coûte cher sous Windows ARM64.** `transcribe-cpp` y exige clang-cl, Ninja et des réglages CMake spécifiques (`GGML_NATIVE=OFF`, `GGML_OPENMP=OFF`, `RC=llvm-rc`), sans accélération GPU. Il faudrait aussi 740 Mo (Parakeet V3) ou 886 Mo (Whisper large-v3-turbo) de modèle supplémentaire.
- **Whisper large-v3-turbo n'est pas meilleur en français que Parakeet V3** (5,5 % contre 5,3 % d'erreurs selon le catalogue de Handy) et il est dix fois plus lent sur CPU (1,4× contre 13,7× le temps réel).
- **LFM3 transcrit déjà le français dans Doku** (ADR-0033) : 0,5 s pour une phrase de 2,4 s, nombres et heures exacts. Son seul défaut est le slot unique : la dictée attendrait une réponse de Doku-San en cours. L'utilisateur l'écarte : il ne dicte pas pendant que Doku-San répond.
- **La capture du micro par la webview marche** depuis la bascule automatique d'un micro muet vers le suivant (ADR-0033, correctif du 27/11).

## Décision

1. **La transcription passe par LFM3**, sur le moteur déjà en place (`/v1/audio/transcriptions`, module audio requis, comme le mode vocal). Pas de `transcribe-cpp` ni de modèle supplémentaire.
2. **La capture reste celle de la webview**, partagée avec le mode vocal (`mic.ts`) : micro retenu, bascule si muet, 16 kHz mono. `handy-recorder` n'est pas repris : il dupliquerait une capture qui fonctionne et ajouterait des commandes Rust hors des rôles bornés de l'ADR-0030.
3. **On reprend de Handy :**
   - **le découpage de la parole par énergie avec bruit de fond appris** (`speech-segmenter.ts`, commun avec le mode vocal), avec le pré-roulement de Handy ;
   - **son nettoyage du texte** (`dictation-text.ts`, porté de `audio_toolkit/text.rs`) : mots de remplissage universels plus « euh » en français, majuscule rendue au mot suivant, bégaiements de trois répétitions ou plus réduits à une, espaces ;
   - **ses deux façons de dicter**, adaptées à un éditeur :
     - **Mains libres** : chaque phrase, découpée au silence, est transcrite puis insérée au curseur, jusqu'à l'arrêt.
     - **Espace maintenue** : maintenir Espace (plus de 300 ms) dans la note enregistre, relâcher transcrit et insère. Une frappe brève tape une espace normale. Si une autre touche arrive avant le délai (frappe rapide), l'espace est tapée immédiatement.
   - **son état visible** : la fenêtre d'état de Handy devient une vue de l'îlot (écoute, écriture, niveau du micro).
4. **Le texte s'insère au curseur de l'éditeur actif** : espace de liaison et majuscule de début de phrase selon ce qui précède. Ni collage ni clavier simulé : Doku écrit dans son propre éditeur.
5. **La dictée et le mode vocal s'excluent** : démarrer l'un arrête l'autre (micro et slot uniques).

## Conséquences

- Aucun téléchargement ni aucune compilation native de plus ; même prérequis que le mode vocal (LFM3 + module audio). Module absent : une notice de l'îlot le dit et la page Modèles du copilote s'ouvre.
- Mesure du 27/11 (banc `voice-e2e.manual.test.ts`, deux phrases séparées par 1,5 s de bruit de pièce) : deux segments trouvés, 0,4 à 0,5 s de transcription pour 3 s de parole, raccord correct dans la note.
- Arrêter la dictée écrit quand même ce qui a déjà été dit (phrase en cours comprise) : un arrêt juste après la dernière phrase ne la perd pas.
- Point d'entrée : bouton micro de la barre de titre (documents texte), menu « Mains libres » / « Maintenir pour dicter ». Actif, il arrête la dictée d'un clic.
- La dictée ne fonctionne que dans les documents texte (Markdown, txt, HTML source) ouverts dans l'éditeur. Ailleurs, un message le dit.
- Une dictée lancée pendant une réponse de Doku-San attend la fin de celle-ci (slot unique). C'est accepté.
- Le code repris de Handy porte sa mention MIT (`resources/licenses/Handy-LICENSE.txt`).
- **Non repris, à reconsidérer :**
  - mots personnalisés (correction floue d'un vocabulaire) ;
  - collage hors de Doku ;
  - post-traitement par LLM ;
  - commandes vocales (« à la ligne »).
- **Réouverture de Parakeet V3 / transcribe-cpp si la précision de LFM3 déçoit à l'usage**, avec cette fois un spike ARM64 chronométré.
