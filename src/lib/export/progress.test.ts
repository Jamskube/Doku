import { describe, expect, it } from 'vitest'
import { exportJob, reportExportProgress, trackExport, type ExportJob } from './progress'

describe('trackExport', () => {
  it('publie le travail, sa progression, puis le retire même sur échec', async () => {
    const seen: (ExportJob | null)[] = []
    const stop = exportJob.subscribe((job) => seen.push(job))
    await expect(trackExport('Gravure', async () => {
      reportExportProgress(1, 4)
      throw new Error('boom')
    })).rejects.toThrow('boom')
    stop()
    expect(seen).toEqual([null, { label: 'Gravure', done: 0, total: 0 }, { label: 'Gravure', done: 1, total: 4 }, null])
  })
})
