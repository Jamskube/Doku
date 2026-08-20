import {
  applyMemoryMutations,
  buildMemoryExtractionPrompt,
  buildMemorySelectionPrompt,
  memoryFileName,
  memoryIndexMarkdown,
  memoryRecallCandidates,
  memoryRecallLocalCandidates,
  parseMemory,
  parseMemoryMutations,
  parseSelectedMemoryIds,
  serializeMemory,
  type AppliedMemoryBatch,
  type CloudMemoryProvider,
  type MemoryPromptSource,
  type MemoryRecord,
  type MemoryType,
} from './copilot-memory'
import { ragDirKey } from './rag'
import {
  isTauri,
  readMemoryMarkdownFiles,
  readMemoryUndo,
  removeMemoryMarkdownFile,
  writeMemoryMarkdownFile,
  writeMemoryUndo,
} from './tauri'

export interface MemoryWorkspace {
  path: string
  key: string
  label: string
  kind: 'document' | 'folder'
}

export type MemoryGenerate = (prompt: string, signal?: AbortSignal) => Promise<string>

export interface MemoryBatchNotice {
  created: number
  updated: number
  deleted: number
  changedIds: string[]
  at: string
}

interface UndoSnapshot {
  schema: 1
  workspaceLabel: string
  records: MemoryRecord[]
  at: string
}

export const cloudMemory = $state({
  workspace: null as MemoryWorkspace | null,
  records: [] as MemoryRecord[],
  loading: false,
  extracting: false,
  pendingExtractions: 0,
  error: '',
  lastBatch: null as MemoryBatchNotice | null,
  undoAvailable: false,
})

let loadNonce = 0
let mutationChain: Promise<void> = Promise.resolve()

export async function memoryWorkspace(
  path: string,
  label: string,
  kind: MemoryWorkspace['kind'] = 'folder',
): Promise<MemoryWorkspace> {
  // Les anciennes mémoires de dossier conservent leur clé historique. Les documents
  // utilisent un namespace distinct : une note et son dossier ne peuvent jamais se
  // retrouver dans le même espace, même si leurs chemins se ressemblent.
  const keyPath = kind === 'document' ? `document:${path}` : path
  return { path, label, kind, key: await ragDirKey(keyPath) }
}

function validUndo(raw: string | null): UndoSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<UndoSnapshot>
    if (parsed.schema !== 1 || !Array.isArray(parsed.records) || typeof parsed.workspaceLabel !== 'string') return null
    const records = parsed.records.flatMap((record) => {
      if (!record || typeof record !== 'object') return []
      try {
        const normalized = parseMemory(serializeMemory(record as MemoryRecord))
        return normalized ? [normalized] : []
      } catch {
        return []
      }
    })
    if (records.length !== parsed.records.length) return null
    return { schema: 1, workspaceLabel: parsed.workspaceLabel, records, at: typeof parsed.at === 'string' ? parsed.at : '' }
  } catch {
    return null
  }
}

export async function loadCloudMemory(workspace: MemoryWorkspace, force = false): Promise<MemoryRecord[]> {
  const scopeChanged = cloudMemory.workspace?.key !== workspace.key
  if (scopeChanged) {
    cloudMemory.lastBatch = null
    cloudMemory.undoAvailable = false
  }
  if (!isTauri) {
    cloudMemory.workspace = workspace
    if (import.meta.env.DEV && new URLSearchParams(globalThis.location?.search ?? '').has('memory-demo')) {
      cloudMemory.records = [
        {
          id: 'demo-decision',
          name: 'Vocabulaire des verdicts',
          description: 'Conserver les libellés validés par l’équipe dans les tableaux d’audit.',
          type: 'decision',
          content: 'Utiliser uniquement « pub », « jingle », « promo », « habillage » ou « autre ».\n\n**Pourquoi :** garder des exports comparables entre les audits.',
          createdAt: '2026-08-10T10:00:00.000Z',
          updatedAt: '2026-08-12T09:30:00.000Z',
          sourceProvider: 'openai',
          sourceDocument: 'verdicts.md',
        },
        {
          id: 'demo-preference',
          name: 'Forme des synthèses',
          description: 'Présenter les décisions avant les détails techniques.',
          type: 'preference',
          content: 'Commencer les synthèses par les décisions et les questions ouvertes, puis détailler les preuves.',
          createdAt: '2026-08-11T14:00:00.000Z',
          updatedAt: '2026-08-11T14:00:00.000Z',
          sourceProvider: 'openai',
        },
      ]
      cloudMemory.undoAvailable = true
    }
    return cloudMemory.records
  }
  if (!force && cloudMemory.workspace?.key === workspace.key && !cloudMemory.loading) return cloudMemory.records
  const nonce = ++loadNonce
  cloudMemory.loading = true
  cloudMemory.error = ''
  try {
    const [files, undo] = await Promise.all([readMemoryMarkdownFiles(workspace.key), readMemoryUndo(workspace.key)])
    if (nonce !== loadNonce) return cloudMemory.records
    const records = files.map((file) => parseMemory(file.content)).filter((record): record is MemoryRecord => !!record)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    cloudMemory.workspace = workspace
    cloudMemory.records = records
    cloudMemory.undoAvailable = validUndo(undo) !== null
    return records
  } catch (error) {
    if (nonce === loadNonce) cloudMemory.error = error instanceof Error ? error.message : 'Lecture de la mémoire impossible.'
    return []
  } finally {
    if (nonce === loadNonce) cloudMemory.loading = false
  }
}

async function persistRecords(workspace: MemoryWorkspace, records: readonly MemoryRecord[]): Promise<void> {
  const existing = await readMemoryMarkdownFiles(workspace.key)
  const desired = new Set(records.map(memoryFileName))
  for (const record of records) {
    await writeMemoryMarkdownFile(workspace.key, memoryFileName(record), serializeMemory(record))
  }
  for (const file of existing) {
    if (!desired.has(file.name)) await removeMemoryMarkdownFile(workspace.key, file.name)
  }
  const now = new Date().toISOString()
  await writeMemoryMarkdownFile(workspace.key, 'MEMORY.md', memoryIndexMarkdown(records, workspace.label, now))
}

async function commitBatch(
  workspace: MemoryWorkspace,
  previous: readonly MemoryRecord[],
  result: AppliedMemoryBatch,
): Promise<MemoryBatchNotice | null> {
  if (result.created + result.updated + result.deleted === 0) return null
  const undo: UndoSnapshot = {
    schema: 1,
    workspaceLabel: workspace.label,
    records: previous.map((record) => ({ ...record })),
    at: new Date().toISOString(),
  }
  // Le snapshot précède les mutations : même après un crash à mi-écriture, « Annuler »
  // dispose de l'état complet antérieur. Les fichiers Markdown sont chacun atomiques.
  await writeMemoryUndo(workspace.key, JSON.stringify(undo))
  try {
    await persistRecords(workspace, result.records)
  } catch (error) {
    // Réparation best-effort immédiate ; le snapshot persiste si Windows bloque un fichier.
    await persistRecords(workspace, undo.records).catch(() => {})
    throw error
  }
  const notice: MemoryBatchNotice = {
    created: result.created,
    updated: result.updated,
    deleted: result.deleted,
    changedIds: result.changedIds,
    at: new Date().toISOString(),
  }
  cloudMemory.workspace = workspace
  cloudMemory.records = result.records
  cloudMemory.lastBatch = notice
  cloudMemory.undoAvailable = true
  return notice
}

export async function recallCloudMemories(
  query: string,
  workspace: MemoryWorkspace,
  generate: MemoryGenerate,
  signal?: AbortSignal,
  localSelection = false,
): Promise<MemoryPromptSource[]> {
  cloudMemory.error = ''
  // Une extraction du tour précédent peut encore être en arrière-plan. Attendre sa
  // transaction garantit que la question suivante voit la mémoire la plus récente.
  await mutationChain
  const records = await loadCloudMemory(workspace)
  if (signal?.aborted || records.length === 0) return []
  const candidates = memoryRecallCandidates(query, records)
  if (candidates.length === 0) return []
  if (localSelection) {
    return memoryRecallLocalCandidates(query, records).map((record) => ({
      id: record.id,
      name: record.name,
      type: record.type,
      content: record.content,
      updatedAt: record.updatedAt,
    }))
  }
  try {
    const raw = await generate(buildMemorySelectionPrompt(query, candidates), signal)
    if (signal?.aborted) return []
    const allowed = new Set(candidates.map((record) => record.id))
    const ids = parseSelectedMemoryIds(raw, allowed)
    const selected = ids.map((id) => records.find((record) => record.id === id)).filter((record): record is MemoryRecord => !!record)
    return selected.map((record) => ({
      id: record.id,
      name: record.name,
      type: record.type,
      content: record.content,
      updatedAt: record.updatedAt,
    }))
  } catch {
    if (signal?.aborted) return []
    // Le sélecteur cloud est une optimisation sémantique, pas une condition de
    // disponibilité de la mémoire. Une indisponibilité fournisseur ne doit jamais
    // faire perdre les souvenirs que Doku peut encore sélectionner localement.
    return memoryRecallLocalCandidates(query, records).map((record) => ({
      id: record.id,
      name: record.name,
      type: record.type,
      content: record.content,
      updatedAt: record.updatedAt,
    }))
  }
}

export function queueMemoryExtraction(params: {
  question: string
  answer: string
  documentName?: string | null
  workspace: MemoryWorkspace
  provider: CloudMemoryProvider
  generate: MemoryGenerate
}): void {
  cloudMemory.pendingExtractions++
  cloudMemory.extracting = true
  mutationChain = mutationChain.then(async () => {
    const records = await loadCloudMemory(params.workspace, true)
    const candidates = memoryRecallCandidates(`${params.question}\n${params.answer}`, records)
    const prompt = buildMemoryExtractionPrompt({
      question: params.question,
      answer: params.answer,
      documentName: params.documentName,
      provider: params.provider,
      records: candidates,
      allRecords: records,
    })
    const raw = await params.generate(prompt)
    const mutations = parseMemoryMutations(raw)
    if (!mutations.length) return
    const result = applyMemoryMutations(records, mutations, params.provider, new Date().toISOString(), params.documentName)
    await commitBatch(params.workspace, records, result)
  }).catch((error) => {
    cloudMemory.error = error instanceof Error ? error.message : 'Mise à jour de la mémoire impossible.'
  }).finally(() => {
    cloudMemory.pendingExtractions = Math.max(0, cloudMemory.pendingExtractions - 1)
    cloudMemory.extracting = cloudMemory.pendingExtractions > 0
  })
}

export function updateCloudMemoryRecord(params: {
  workspace: MemoryWorkspace
  id: string
  name: string
  description: string
  type: MemoryType
  content: string
  provider: CloudMemoryProvider
}): Promise<void> {
  mutationChain = mutationChain.then(async () => {
    const records = await loadCloudMemory(params.workspace, true)
    const result = applyMemoryMutations(records, [{
      op: 'update', id: params.id, name: params.name, description: params.description,
      type: params.type, content: params.content,
    }], params.provider)
    await commitBatch(params.workspace, records, result)
  }).catch((error) => {
    cloudMemory.error = error instanceof Error ? error.message : 'Modification de la mémoire impossible.'
  })
  return mutationChain
}

export function deleteCloudMemoryRecord(workspace: MemoryWorkspace, id: string, provider: CloudMemoryProvider): Promise<void> {
  mutationChain = mutationChain.then(async () => {
    const records = await loadCloudMemory(workspace, true)
    const result = applyMemoryMutations(records, [{ op: 'delete', id }], provider)
    await commitBatch(workspace, records, result)
  }).catch((error) => {
    cloudMemory.error = error instanceof Error ? error.message : 'Suppression de la mémoire impossible.'
  })
  return mutationChain
}

export function undoCloudMemory(workspace: MemoryWorkspace): Promise<boolean> {
  let restored = false
  mutationChain = mutationChain.then(async () => {
    const undo = validUndo(await readMemoryUndo(workspace.key))
    if (!undo) return
    const current = await loadCloudMemory(workspace, true)
    await persistRecords(workspace, undo.records)
    // L'annulation elle-même devient annulable : un second clic restaure l'état courant.
    await writeMemoryUndo(workspace.key, JSON.stringify({
      schema: 1, workspaceLabel: workspace.label, records: current, at: new Date().toISOString(),
    } satisfies UndoSnapshot))
    cloudMemory.workspace = workspace
    cloudMemory.records = undo.records
    cloudMemory.lastBatch = null
    cloudMemory.undoAvailable = true
    cloudMemory.error = ''
    restored = true
  }).catch((error) => {
    cloudMemory.error = error instanceof Error ? error.message : "Impossible d'annuler la mémoire."
  })
  return mutationChain.then(() => restored)
}
