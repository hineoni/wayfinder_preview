import { toPlanInput, type PreparedDataset } from '@wayfinder/dataset'
import {
  assessReadiness,
  prepareEmergencyEquipment,
  type EmergencyProbe,
  type Plan,
} from '@wayfinder/planner'

self.onmessage = (
  message: MessageEvent<{
    kind: 'readiness' | 'equipment'
    dataset: PreparedDataset
    plan: Plan
    probes: EmergencyProbe[]
  }>,
) => {
  try {
    const { kind, dataset, plan, probes } = message.data
    const input = toPlanInput(dataset)
    const result =
      kind === 'readiness'
        ? assessReadiness(input, plan, probes)
        : prepareEmergencyEquipment(input, plan, probes)
    self.postMessage({ ok: true, result })
  } catch (cause) {
    self.postMessage({
      ok: false,
      error: cause instanceof Error ? cause.message : 'Ошибка проверки',
    })
  }
}
