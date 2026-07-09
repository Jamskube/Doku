// Prépare un document HTML pour l'aperçu sandboxé (FR-8) : on injecte une CSP
// stricte (aucun script, aucun réseau) dans le document. Le rendu se fait dans
// un `<iframe sandbox="">` (pas de scripts) — la CSP bloque en plus tout réseau.
const CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`

export function sandboxDoc(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + CSP)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${CSP}</head>`)
  return CSP + html
}
