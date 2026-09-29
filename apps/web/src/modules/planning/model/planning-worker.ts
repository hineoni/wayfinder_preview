import { calculatePlanPair, calculateReplan, type PlanningJob } from './plan-calculation'

self.onmessage = (message: MessageEvent<PlanningJob>) => {
  try {
    const job = message.data
    const result =
      job.kind === 'plans' ? calculatePlanPair(job.dataset) : calculateReplan(job.request)
    self.postMessage({ ok: true, result })
  } catch (cause) {
    self.postMessage({
      ok: false,
      error: cause instanceof Error ? cause.message : 'Ошибка расчёта плана',
    })
  }
}
