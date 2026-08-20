import { describe, expect, it } from 'vitest'
import { finishRunningCopilotActivities, upsertCopilotActivity, type CopilotActivity } from './copilot-activity'

describe('copilot activity', () => {
  it('met à jour une étape sans changer son ordre', () => {
    const initial: CopilotActivity[] = [
      { id: 'context', kind: 'context', label: 'Lecture', state: 'done' },
      { id: 'web', kind: 'web-search', label: 'Recherche', state: 'running' },
    ]
    expect(upsertCopilotActivity(initial, {
      id: 'web', kind: 'web-search', label: 'Recherche', detail: '4 sources', state: 'done',
    })).toEqual([
      initial[0],
      expect.objectContaining({ id: 'web', detail: '4 sources', state: 'done' }),
    ])
  })

  it('termine seulement les étapes encore ouvertes', () => {
    const activities: CopilotActivity[] = [
      { id: 'context', kind: 'context', label: 'Lecture', state: 'done' },
      { id: 'web', kind: 'web-search', label: 'Recherche', state: 'running' },
      { id: 'answer', kind: 'answer', label: 'Réponse', state: 'pending' },
    ]
    expect(finishRunningCopilotActivities(activities, 'error')).toEqual([
      activities[0],
      expect.objectContaining({ id: 'web', state: 'error' }),
      expect.objectContaining({ id: 'answer', state: 'error' }),
    ])
  })
})
