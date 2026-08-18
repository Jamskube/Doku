# Next session pointer
_Updated: 2026-08-18 11:05_

## Where I left off
Journée en quatre temps, tous terminés : **v3.0.0** (installateurs Windows ARM64 et x64 reconstruits), **MiniMax rendu rapide** — c'était une asymétrie de Doku, pas une lenteur du fournisseur —, **ouverture à Linux** (AppImage construite en CI du premier coup, plus le coffre de secrets multiplateforme qui débloque le copilote cloud), et un **passage de documentation** qui remet le README en anglais et le reste d'aplomb.

8 commits, **tous poussés**. 815 tests front, 9 tests Rust, 0 erreur de type. Rien en attente, aucune PR.

## Open work
- Branche : `main` — propre, **à jour avec `origin/main`**
- PR ouvertes : aucune
- Artefacts prêts :
  - `src-tauri/target/{aarch64,x86_64}-pc-windows-msvc/release/bundle/nsis/Doku_3.0.0_*-setup.exe`
  - `dist-linux/Doku_3.0.0_amd64.AppImage` (87 Mo, empreinte vérifiée) — dossier ignoré par git
- Plans : `docs/plans/` (8 plans, tous exécutés ou clos) · `docs/planning/feasibility-pdf-edition.md` — palier 4 (formulaires AcroForm) toujours non commencé

## Ce qui attend une vraie machine
Deux choses sont **écrites, compilées, mais jamais exécutées** :

1. **L'AppImage sur Arch.** La CI prouve qu'elle compile et qu'elle est bien formée ; elle n'ouvre aucune fenêtre. WebKitGTK sur Arch est souvent en avance sur ce qu'attend Tauri. Le collègue est le premier essai réel — récupérer ses messages d'erreur **tels quels**.
2. **Le coffre de secrets Linux.** `keyring` compile et la caisse installe son magasin toute seule (vérifié dans son code source), mais **rien n'a jamais échangé un mot avec un vrai Secret Service**. Premier contact = première connexion cloud chez lui.

Et toujours : **rien n'a jamais tourné en natif sur la Surface** hors des installateurs fraîchement posés. Le parcours DOCX de bout en bout (ouvrir un `.docx`, bulle de format, question au copilote, enregistrer, exporter en PDF) reste le maillon jamais exercé hors navigateur.

## À trancher par toi
1. **Le modèle MiniMax par défaut est `MiniMax-M2.5`** (`src/lib/compat.ts:10`) — un modèle dont la réflexion **ne peut pas être coupée** : le correctif d'aujourd'hui ne vaut que pour M3. Un nouvel utilisateur atterrit donc sur le modèle lent. Passer le défaut à `MiniMax-M3` serait cohérent, mais c'est un choix produit.
2. **La réflexion est coupée pour la conversation aussi**, pas seulement pour les appels internes. C'est ce qui rend M3 vif ; on y perd de la profondeur sur les questions difficiles. Un `"disabled"` à passer en `"adaptive"` dans `chat_body` (`src-tauri/src/compat.rs`) si l'arbitrage change — dis-le et j'en fais un réglage plutôt qu'une constante.
3. **Les ~100 modes de langage CodeMirror — 416 Ko d'installateur.** Toujours en attente de ta liste de langages à garder.
4. **Un dossier `tmp/pdfs` vide traîne à la racine** — ni suivi ni vu par git, donc inoffensif ; à supprimer si tu veux la racine nette.

## Rappels d'outillage (deux pièges vécus aujourd'hui)
- **Les installateurs se construisent depuis PowerShell**, jamais depuis Git Bash : `prepare-ollama-sidecar.mjs` exige le `tar.exe` de Windows (bsdtar), le GNU tar de Git Bash ne lit pas les zip. Et un `| tail` derrière la commande **masque le code de sortie** — l'échec passe inaperçu.
- **L'AppImage se déclenche** par `gh workflow run "Build Linux x64" --ref main`, puis `gh run download <id> -n Doku-main-linux-x64`.

## Next concrete step
Envoyer `dist-linux/Doku_3.0.0_amd64.AppImage` au collègue sous Arch et **le regarder la lancer** : c'est le seul moyen de savoir si l'ouverture à Linux tient debout, et les deux inconnues qui restent (WebKitGTK, Secret Service) se révèlent toutes les deux dans les trente premières secondes d'usage.
