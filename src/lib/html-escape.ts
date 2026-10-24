// Échappement HTML minimal (texte d'élément : `&`, `<`, `>`). Module feuille, sans
// dépendance : l'importer ne tire pas le pipeline d'impression (`print` + `marked`) dans
// le bundle de démarrage, contrairement à l'ancien import depuis `export/print`.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
