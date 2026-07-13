// Encodage d'images locales en data: URI pour l'export HTML autonome (10.3).
// Module pur, sans dépendance Tauri/render-md (évite un cycle d'import : tauri.ts en a
// besoin, or tauri.ts est importé par render-md.ts).

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

export function mimeFromExt(name: string): string {
  const ext = /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

// Octets → data: URI base64. Encodage par lots de 32 Ko : `btoa(String.fromCharCode(...bytes))`
// dépasse la limite d'arguments de la pile (RangeError) dès quelques centaines de Ko.
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return `data:${mime};base64,${btoa(bin)}`
}
