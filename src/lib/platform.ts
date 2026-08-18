// Où vivent les secrets, selon le système (ADR-0026) : Gestionnaire d'identifiants sous
// Windows, Secret Service de la session ailleurs.
//
// Pourquoi ça mérite un module : l'interface l'annonçait EN DUR (« la clé vit dans le
// coffre Windows ») sur les quatre cartes de connexion cloud. Un utilisateur Linux à qui
// l'on parle d'un coffre Windows en conclut, à raison, que la fonctionnalité ne le
// concerne pas — un texte faux vaut une fonctionnalité muette (règle Epic 19).
//
// La détection passe par l'agent utilisateur de la webview, seul signal disponible sans
// aller-retour IPC : WebView2 annonce « Windows NT », WebKitGTK annonce « Linux ». Ce
// n'est qu'un LIBELLÉ — aucune décision de sécurité n'en dépend, le vrai choix de coffre
// est fait côté Rust par `#[cfg(windows)]`, qui lui ne peut pas se tromper.

export function isWindowsPlatform(userAgent: string = globalThis.navigator?.userAgent ?? ''): boolean {
  return /Windows/i.test(userAgent)
}

/** « le coffre Windows » / « le trousseau de votre session » — au fil du texte. */
export function vaultLabel(userAgent?: string): string {
  return isWindowsPlatform(userAgent) ? 'le coffre Windows' : 'le trousseau de votre session'
}

/** « Windows » / « votre session » — pour un titre court. */
export function vaultShortLabel(userAgent?: string): string {
  return isWindowsPlatform(userAgent) ? 'Windows' : 'votre session'
}
