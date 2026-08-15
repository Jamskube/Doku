// Export « PDF annoté » (ADR-0022) : une COPIE du document contenant réellement les
// surlignages, tracés et notes, pour l'envoyer à quelqu'un qui n'a pas Doku.
//
// Le carnet reste la source de vérité : graver est à SENS UNIQUE. Rien ici ne réécrit
// le document source, et la copie produite n'est jamais relue comme un carnet.
//
// Les entrées/sorties sont injectées (motif des exports HTML et DOCX) : la logique se
// teste avec de faux ports, sans Tauri ni navigateur.
import { parsePdfAnnotationManifest, pdfAnnotationIdentity } from '../pdf-annotations'
import { PdfBurnError, burnPdfAnnotations } from '../pdf-write'

export interface AnnotatedPdfPorts {
  readFileBytes: (path: string) => Promise<Uint8Array | null>
  readManifest: (key: string) => Promise<string | null>
  save: (defaultName: string, bytes: Uint8Array) => Promise<boolean>
}

export interface AnnotatedPdfReport {
  // false = l'utilisateur a fermé le dialogue ; ce n'est pas une erreur.
  saved: boolean
  burned: number
  notes: number
  skipped: number
}

export function annotatedPdfName(path: string): string {
  const base = (path.split(/[\\/]/).pop() ?? 'document.pdf').replace(/\.pdf$/i, '')
  return `${base} — annoté.pdf`
}

export async function exportAnnotatedPdf(path: string, ports: AnnotatedPdfPorts): Promise<AnnotatedPdfReport> {
  const bytes = await ports.readFileBytes(path)
  if (!bytes) throw new PdfBurnError('Le document source est introuvable.')

  const identity = await pdfAnnotationIdentity(path, bytes)
  const parsed = parsePdfAnnotationManifest(await ports.readManifest(identity.key), identity)
  // Un carnet illisible n'est pas un carnet vide : le graver produirait un PDF « propre »
  // qui ferait croire à l'utilisateur qu'il n'avait rien annoté.
  if (parsed.unreadable) throw new PdfBurnError('Le carnet d’annotations de ce PDF est illisible.')

  const drawings = parsed.manifest.drawings.filter((drawing) => drawing.status === 'active')
  if (!drawings.length) {
    throw new PdfBurnError(parsed.stale
      ? 'Ce PDF a changé depuis les annotations : elles ne correspondent plus à ses pages.'
      : 'Ce PDF n’a aucune annotation à graver.')
  }

  const result = await burnPdfAnnotations(bytes, drawings)
  const saved = await ports.save(annotatedPdfName(path), result.bytes)
  return { saved, burned: result.burned, notes: result.notes, skipped: result.skipped }
}

// Phrase de compte rendu : dire ce qui a été écarté plutôt que de laisser croire à un
// export complet (règle « branché ou retiré, jamais muet »).
export function annotatedPdfSummary(report: AnnotatedPdfReport): string {
  const plural = (count: number, singular: string, suffix = 's') => `${count} ${singular}${count > 1 ? suffix : ''}`
  const notes = report.notes ? `, dont ${plural(report.notes, 'note')}` : ''
  const gravees = report.burned > 1 ? 'gravées' : 'gravée'
  const skipped = report.skipped
    ? ` ${plural(report.skipped, 'annotation')} sur une page absente ${report.skipped > 1 ? 'n’ont' : 'n’a'} pas pu être ${report.skipped > 1 ? 'gravées' : 'gravée'}.`
    : ''
  return `${plural(report.burned, 'annotation')} ${gravees}${notes}. Le document d’origine est intact.${skipped}`
}
