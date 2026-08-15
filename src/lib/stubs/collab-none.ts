// Talon des modules de COLLABORATION TEMPS RÉEL de SuperDoc (`@hocuspocus/provider`,
// `y-websocket`).
//
// SuperDoc les importe pour leur seul effet de bord — `import "@hocuspocus/provider"`,
// sans aucune liaison utilisée — et ils ne servent qu'à l'édition partagée par
// websocket. Doku est mono-poste et hors ligne (principe 8.3) : installer ces paquets
// ajouterait un client réseau que rien n'appellerait jamais.
//
// Si la collaboration devait un jour être ouverte, il faudrait retirer l'alias de
// `vite.config.ts` et installer les vrais paquets — pas modifier ce fichier.
export {}
