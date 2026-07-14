// Helpers purs du collage d'image (12.1). Aucune dépendance Tauri/DOM → testables en Node.
// Le presse-papier peut mentir sur le type MIME ; on renifle les octets (magic bytes) pour
// choisir l'extension. On ne gère que les formats raster courants — un SVG (texte, sans
// signature) renvoie null et est rejeté par l'appelant (hors périmètre).

const pad = (n: number): string => String(n).padStart(2, '0')

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp'

export function sniffImageExt(b: Uint8Array): ImageExt | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  )
    return 'webp'
  return null
}

// Base horodatée (résolution seconde) : « image-YYYYMMDD-HHmmss ». L'unicité fine est
// assurée par candidateName(seq) + la sérialisation des écritures (tauri.ts).
export function imageStamp(d: Date): string {
  return `image-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

// Nom candidat : « stamp.ext » puis « stamp~1.ext », « stamp~2.ext »… (jamais écrasant).
export function candidateName(stamp: string, ext: string, seq: number): string {
  return seq === 0 ? `${stamp}.${ext}` : `${stamp}~${seq}.${ext}`
}

// Premier nom libre : on incrémente le suffixe ~seq tant que `exists` renvoie true.
// `exists` est injecté → cœur anti-écrasement testable sans I/O. La sérialisation des
// écritures (tauri.ts) garantit qu'un collage concurrent voit bien le fichier du précédent.
export async function nextFreeName(
  stamp: string,
  ext: string,
  exists: (name: string) => Promise<boolean>,
): Promise<string> {
  let seq = 0
  let name = candidateName(stamp, ext, seq)
  while (await exists(name)) name = candidateName(stamp, ext, ++seq)
  return name
}

// Markdown inséré au curseur. Les noms générés n'ont ni espace ni parenthèse → aucun
// encodage requis (regex image live-preview : \(([^)\s]+)\)).
export function imageMarkdown(name: string): string {
  return `![](${name})`
}
