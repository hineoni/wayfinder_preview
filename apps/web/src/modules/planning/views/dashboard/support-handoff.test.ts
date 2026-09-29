import { describe, expect, it } from 'vitest'
import {
  createConflictScenario,
  parsePreparedDataset,
  toPlanInput,
  toUrgentOrderEvent,
} from '@wayfinder/dataset'
import { planOptimized, replanAfterEvent, reconcileAgreements } from '@wayfinder/planner'
import eastSource from '../../../../../../../datasets/prepared/east.json'
import { handoffText } from './support-handoff'

const dataset = createConflictScenario(parsePreparedDataset(eastSource))
const input = toPlanInput(dataset)
const previous = planOptimized(input).plan
const result = replanAfterEvent(input, previous, toUrgentOrderEvent(dataset.events[0]!), [
  { orderId: 'DEMO-DONE', status: 'completed' },
])

describe('передача поддержке', () => {
  it('показывает новый визит и изменение времени, исключает сохранённую историю', () => {
    const rows = reconcileAgreements([], result)
    expect(rows.map((r) => r.orderId).toSorted()).toEqual(['DEMO-CLIENT', 'DEMO-URGENT'])
    expect(rows.find((r) => r.orderId === 'DEMO-CLIENT')).toMatchObject({
      previousStartMin: 870,
      startMin: 950,
      reason: 'time-changed',
    })
    const text = handoffText(rows, () => 'Адрес\tс\nразделителями')
    expect(text).toContain('Сообщения клиентам не отправлены')
    expect(text.split('\n')).toHaveLength(4)
    expect(text).toContain('Адрес с разделителями')
  })

  it('сдвиг на пять минут входит в очередь без порога 15 минут', () => {
    const smallChange = {
      ...result,
      changes: [
        {
          orderId: 'DEMO-CLIENT',
          kind: 'time-changed' as const,
          previousStartMin: 870,
          startMin: 875,
        },
      ],
      plan: {
        ...previous,
        routes: previous.routes.map((r) => ({
          ...r,
          visits: r.visits.map((v) =>
            v.orderId === 'DEMO-CLIENT' ? { ...v, startMin: v.startMin + 5 } : v,
          ),
        })),
      },
    }
    expect(reconcileAgreements([], smallChange)).toEqual([
      expect.objectContaining({ orderId: 'DEMO-CLIENT', previousStartMin: 870, startMin: 875 }),
    ])
  })
})
