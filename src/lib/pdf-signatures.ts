// Signatures numériques d'un PDF — lecture des MÉTADONNÉES seulement.
//
// Ce que Doku dit : « ce document porte une signature, déposée par X le Y ».
// Ce que Doku ne dit PAS, et ne doit jamais laisser croire : que la signature est
// valide. Le vérifier demande de traiter le blob PKCS#7, de valider une chaîne de
// certificats et de recalculer les condensats des plages signées. pdf.js fournit la
// matière (`getSignatureData`), pas le verdict — et un faux « document intact » serait
// plus dangereux que le silence, parce qu'il porte sur des documents contractuels.
//
// Le libellé rendu ici porte donc TOUJOURS la réserve. Elle n'est pas décorative.

/** Objet rendu par `PDFDocumentProxy.getSignatures()` — champs tous faillibles. */
export interface RawPdfSignature {
  id?: unknown
  fieldName?: unknown
  signerName?: unknown
  reason?: unknown
  location?: unknown
  signingTime?: unknown
  subFilter?: unknown
}

export interface PdfSignature {
  id: string
  /** Nom déclaré par le signataire — déclaré, pas prouvé. */
  signer: string | null
  /** Date de signature, si elle est lisible. Déclarative elle aussi. */
  signedAt: Date | null
  reason: string | null
  location: string | null
}

export interface PdfSignatureReport {
  signatures: PdfSignature[]
  /** Phrase prête à afficher, réserve comprise. Vide s'il n'y a aucune signature. */
  summary: string
}

/**
 * Date PDF : `D:YYYYMMDDHHmmSS±HH'mm'`, dont tout est facultatif après l'année.
 * Rendue `null` au moindre doute — une date fausse est pire qu'une date absente.
 */
export function parsePdfDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+-Z])(\d{2})'?(\d{2})?'?)?/.exec(raw.trim())
  if (!m) return null
  const [, year, month, day, hour, minute, second, sign, tzH, tzM] = m
  const y = Number(year)
  if (y < 1000 || y > 9999) return null
  const mo = month ? Number(month) : 1
  const d = day ? Number(day) : 1
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const h = hour ? Number(hour) : 0
  const mi = minute ? Number(minute) : 0
  const s = second ? Number(second) : 0
  if (h > 23 || mi > 59 || s > 59) return null
  let ms = Date.UTC(y, mo - 1, d, h, mi, s)
  if (sign && sign !== 'Z') {
    // Le décalage dit « cette heure locale vaut UTC∓décalage » : on le RETIRE pour
    // revenir à UTC, sens inverse de l'intuition.
    const offset = (Number(tzH) * 60 + Number(tzM ?? 0)) * 60_000
    ms += sign === '+' ? -offset : offset
  }
  const date = new Date(ms)
  // Un 31 février donnerait une date valide décalée : on refuse plutôt que de mentir.
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeSignatures(raw: readonly RawPdfSignature[] | null | undefined): PdfSignature[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry, index) => ({
    id: typeof entry?.id === 'string' && entry.id ? entry.id : `signature-${index}`,
    signer: text(entry?.signerName),
    signedAt: parsePdfDate(entry?.signingTime),
    reason: text(entry?.reason),
    location: text(entry?.location),
  }))
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

/**
 * Phrase d'affichage. La réserve « Doku ne vérifie pas » est TOUJOURS présente : c'est
 * la seule chose que ce module puisse honnêtement garantir.
 */
export function describeSignatures(raw: readonly RawPdfSignature[] | null | undefined): PdfSignatureReport {
  const signatures = normalizeSignatures(raw)
  if (signatures.length === 0) return { signatures, summary: '' }

  const reserve = 'Doku ne vérifie pas sa validité.'
  if (signatures.length === 1) {
    const [only] = signatures
    const parts: string[] = []
    if (only.signer) parts.push(`par ${only.signer}`)
    if (only.signedAt) parts.push(`le ${formatDate(only.signedAt)}`)
    const qui = parts.length > 0 ? ` ${parts.join(' ')}` : ''
    return { signatures, summary: `Ce document porte une signature${qui}. ${reserve}` }
  }

  const signataires = [...new Set(signatures.map((s) => s.signer).filter((s): s is string => Boolean(s)))]
  const qui = signataires.length > 0 ? ` (${signataires.join(', ')})` : ''
  return {
    signatures,
    summary: `Ce document porte ${signatures.length} signatures${qui}. ${reserve}`,
  }
}
