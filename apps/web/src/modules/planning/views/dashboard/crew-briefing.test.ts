import { describe, expect, it } from 'vitest'
import { parsePreparedDataset, toPlanInput } from '@wayfinder/dataset'
import { planBaseline, replanAfterEvent } from '@wayfinder/planner'
import source from '../../../../../../../datasets/prepared/east.json'
import { formatMinute } from '../../../../shared/lib/format'
import { briefingText, crewBriefing } from './crew-briefing'

const dataset = parsePreparedDataset(source)
const input = toPlanInput(dataset)
const plan = planBaseline(input)
const orders = new Map(dataset.orders.map((order) => [order.id, order]))

describe('сводка для бригад', () => {
  it('использует показанный план и не выдаёт начало работы за прибытие или выезд', () => {
    const visit = plan.routes[0]!.visits[0]!
    expect(visit.waitMin).toBe(0)
    const text = briefingText(crewBriefing(dataset, plan, orders))
    expect(text).toContain('базовый план на день')
    expect(text).toContain(`${formatMinute(visit.arrivalMin - visit.travel.durationMin)} выезд`)
    expect(text).toContain(`→ ${formatMinute(visit.startMin)}–${formatMinute(visit.endMin)}`)
    expect(text).toContain(`в пути ${visit.travel.durationMin} мин)`)
    const waitingVisit = plan.routes
      .flatMap((route) => route.visits)
      .find((item) => item.waitMin > 0)!
    expect(waitingVisit).toBeDefined()
    expect(text).toContain(
      `в пути ${waitingVisit.travel.durationMin} мин; резерв до визита ${waitingVisit.waitMin} мин`,
    )
    expect(text).toContain(orders.get(visit.orderId)!.address)
    expect(text).toContain(
      `Без назначения: ${plan.unassigned.map((item) => item.orderId).join(', ')}`,
    )
  })

  it('обрезает прерванную работу и отделяет её от предстоящих визитов', () => {
    const route = plan.routes[0]!
    const visit = route.visits[0]!
    const atMin = visit.startMin + 5
    const result = replanAfterEvent(
      input,
      plan,
      {
        kind: 'engineer-unavailable',
        engineerId: route.engineerId,
        atMin,
      },
      plan.routes.flatMap((item) =>
        item.visits
          .filter((entry) => entry.endMin <= atMin)
          .map((entry) => ({ orderId: entry.orderId, status: 'completed' as const })),
      ),
    )
    const text = briefingText(crewBriefing(dataset, result.plan, orders, result))
    expect(text).toContain(`остаток дня после ${formatMinute(atMin)}`)
    expect(text).toContain(
      `Работа прервана: ${formatMinute(visit.startMin)}–${formatMinute(atMin)}`,
    )
    expect(text).not.toContain('Свободна весь день')
    expect(text).not.toContain(
      `Работа прервана: ${formatMinute(visit.startMin)}–${formatMinute(visit.endMin)}`,
    )
  })
})
