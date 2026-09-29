import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GROUPS,
  checkPreparedConsistency,
  createConflictScenario,
  parsePreparedDataset,
  toPlanInput,
  toUrgentOrderEvent,
} from '@wayfinder/dataset'
import { planOptimized, replanAfterEvent, validatePlan } from '@wayfinder/planner'
import { describe, expect, it } from 'vitest'
import { ASSESSMENT_CASES, assessDataset } from '../src/assessment'
import { PREPARED_DIR } from '../src/io'

describe('доказательства качества', () => {
  it.each(GROUPS)(
    '%s: независимые стресс-сценарии сохраняют ограничения и гарантию относительно baseline',
    (group) => {
      const dataset = parsePreparedDataset(
        JSON.parse(readFileSync(resolve(PREPARED_DIR, `${group}.json`), 'utf8')) as unknown,
      )
      for (const scenario of ASSESSMENT_CASES) {
        const result = assessDataset(dataset, scenario)
        expect(result.violations).toEqual([])
        expect(result.comparison.result).not.toBe('worse')
      }
    },
    // Шесть полных оптимизаций до локального оптимума: на Юго-востоке ~20 с.
    60_000,
  )

  it('учебная авария меняет время клиента, сохраняет историю и не пополняет комплект', () => {
    const source = parsePreparedDataset(
      JSON.parse(readFileSync(resolve(PREPARED_DIR, 'east.json'), 'utf8')) as unknown,
    )
    const dataset = createConflictScenario(source)
    expect(parsePreparedDataset(dataset)).toEqual(dataset)
    expect(checkPreparedConsistency(dataset)).toEqual([])
    expect(dataset.travel).toBe(source.travel)
    const input = toPlanInput(dataset)
    const previous = planOptimized(input).plan
    expect(previous.unassigned.map((o) => o.orderId)).toEqual(['DEMO-RESOURCE'])
    expect(validatePlan(input, previous)).toEqual([])
    const event = toUrgentOrderEvent(dataset.events[0]!)
    const result = replanAfterEvent(input, previous, event, [
      { orderId: 'DEMO-DONE', status: 'completed' },
    ])
    expect(result.violations).toEqual([])
    expect(result.plan.unassigned.map((o) => o.orderId)).toEqual(['DEMO-RESOURCE'])
    expect(result.history.find((h) => h.visit.orderId === 'DEMO-DONE')?.state).toBe('completed')
    expect(result.history.find((h) => h.visit.orderId === 'DEMO-WORK')?.state).toBe('in-progress')
    expect(result.changes).toContainEqual(
      expect.objectContaining({
        orderId: 'DEMO-CLIENT',
        kind: 'time-changed',
        previousStartMin: 870,
        startMin: 950,
      }),
    )
    expect(
      result.plan.routes
        .find((r) => r.engineerId === 'DEMO-READY')
        ?.visits.find((v) => v.orderId === 'DEMO-URGENT')?.startMin,
    ).toBe(850)
    expect(
      result.equipment.find((e) => e.engineerId === 'DEMO-READY')?.afterPlan['emergency-kit'],
    ).toBe(0)
    expect(
      result.equipment.find((e) => e.engineerId === 'DEMO-NEAR')?.actualAtEvent['emergency-kit'],
    ).toBe(0)
    expect(source.orders).toHaveLength(66)
  })
})
