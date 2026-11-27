# 0033. Mode vocal local : conversation parlée avec LFM3 (transcription + synthèse sur llama-server)

**Date** : 2026-11-27 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : ia, voix, lfm3, llamacpp, ux, îlot · **Spike** : `spike/llamacpp-lfm3/` (§ 5) · **S'appuie sur** : ADR-0032

## Contexte

LFM3-Omni-2B sait entendre et parler, à condition que son module multimodal (`mmproj`, 507 Mo) soit chargé avec le modèle. Le spike du 2026-11-27 puis une sonde dédiée ont mesuré ces capacités sur la Surface :

- **Transcription** (`/v1/audio/transcriptions`, WAV 16 kHz mono) : 0,5 s pour une phrase de 2,4 s, quasi parfaite. Les nombres reviennent en chiffres.
- **Synthèse vocale** (`/v1/audio/speech`, WAV 24 kHz) : environ 1,1 s pour 2,4 s d'audio (facteur temps réel ≈ 0,5). Deux voix, `female` et `male`.
- **Les nombres écrits en chiffres sont massacrés à la synthèse** (« salle 212 » → « salle Ludo's Total »). Écrits en lettres, l'aller-retour synthèse → transcription est parfait.
- **Slot unique** (`parallel = 1`, ADR-0032) : une synthèse lancée pendant une réponse en flux **attend la fin de cette réponse**. Mesure : synthèse démarrée à 1,0 s, terminée à 5,4 s, chat terminé à 4,3 s.
- `/v1/realtime` (WebSocket voix ↔ voix) fonctionne en texte → voix. Il **court-circuite** cependant le chemin du copilote : contexte du document, historique, citations, mémoire.

L'utilisateur a choisi une **conversation complète** (il parle, Doku-San répond à voix haute, en boucle), avec le micro dans le composeur et l'état vocal dans l'îlot.

## Décision

**Le vocal passe par le chemin normal du copilote.** La boucle est la suivante :

1. micro ;
2. détection de fin de phrase ;
3. transcription ;
4. `sendChat` avec une consigne de style **orale** (deux à quatre phrases, sans liste ni Markdown) ;
5. synthèse **phrase par phrase** ;
6. retour à l'écoute.

La question et la réponse arrivent dans la discussion active, avec le document, l'historique et les citations : la discussion vocale est une discussion comme les autres. `/v1/realtime` est écarté pour cette version, parce qu'il faudrait y réimplanter tout le contexte.

**Ordre imposé par le slot unique** : le texte d'abord, la voix ensuite. La synthèse de la phrase n+1 se prépare pendant la lecture de la phrase n, ce qui évite tout silence entre deux phrases. Le premier son arrive environ 1 s après la fin du texte. Une réponse orale courte garde ce délai bas.

**Texte parlé ≠ texte affiché.** Avant la synthèse, une fonction pure (`voice-text.ts`) :

- retire le Markdown et les numéros d'extraits `[n]` ;
- **écrit les nombres en lettres** (entiers, décimales, %, €, heures « 9 h 30 », ordinaux « 1er ») ;
- découpe en phrases.

**Micro dans la webview** : `getUserMedia` avec annulation d'écho. La capture PCM passe par `ScriptProcessorNode`, puis un encodage WAV 16 kHz côté client, car le serveur ne lit pas le WebM de `MediaRecorder`. La fin de phrase est détectée par l'énergie du signal : environ 1,2 s de silence après la parole. Un plafond de 30 s par tour coupe un micro resté ouvert.

**Pas d'interruption à la voix (barge-in) en v1** : le micro n'écoute pas pendant que Doku-San parle, sinon il s'entendrait lui-même. On interrompt d'un toucher, sur l'îlot ou sur le bouton.

**Module audio = entrée du catalogue rattachée à LFM3** (`lfm3-omni-2b-voice`, révision épinglée, SHA-256 et taille connus, ADR-0032). Une fois installé, le preset ajoute `mmproj = …` à la section de LFM3. Le téléchargement reste une action explicite, proposée au premier usage du micro.

## Conséquences

**Positif**
- Conversation parlée 100 % locale, sans aucun service vocal tiers.
- Le contexte du document et l'historique sont conservés.
- La même discussion se lit ensuite dans le panneau.
- Le module audio ouvre aussi la vision de LFM3 (images), sans autre téléchargement.

**Négatif / à suivre**
- **Environ +0,5 Go de RAM** dès que le module audio est installé : il est chargé avec LFM3, même pour du texte seul.
- La première réponse parlée arrive **après** le texte complet. Faire parler pendant l'écriture demanderait un deuxième slot (`parallel = 2` avec `kv-unified`), qui ferait concourir chat et voix sur les mêmes 4 cœurs. À mesurer avant de l'adopter.
- Les noms propres sont parfois déformés (« Doku » → « Dokou »). Un lexique de prononciation reste possible plus tard.
- Pas de barge-in. L'annulation d'écho du navigateur rendrait possible une écoute pendant la parole ; à tester sur machine.
- Linux (WebKitGTK) : `getUserMedia` dépend de la configuration de WebKit. Si le micro est indisponible, un message le dit (règle « jamais muet »).
