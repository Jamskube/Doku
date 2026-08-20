export type CopilotActivityKind = 'context' | 'memory' | 'web-plan' | 'web-search' | 'answer'
export type CopilotActivityState = 'pending' | 'running' | 'done' | 'error'

export interface CopilotActivity {
  id: string
  kind: CopilotActivityKind
  label: string
  detail?: string
  state: CopilotActivityState
}

export function upsertCopilotActivity(
  activities: readonly CopilotActivity[] | undefined,
  next: CopilotActivity,
): CopilotActivity[] {
  const current = activities ?? []
  const index = current.findIndex((activity) => activity.id === next.id)
  if (index < 0) return [...current, next]
  return current.map((activity, activityIndex) => activityIndex === index ? { ...activity, ...next } : activity)
}

export function finishRunningCopilotActivities(
  activities: readonly CopilotActivity[] | undefined,
  state: Extract<CopilotActivityState, 'done' | 'error'>,
): CopilotActivity[] | undefined {
  if (!activities?.length) return activities ? [...activities] : undefined
  return activities.map((activity) => activity.state === 'running' || activity.state === 'pending'
    ? { ...activity, state }
    : activity)
}
