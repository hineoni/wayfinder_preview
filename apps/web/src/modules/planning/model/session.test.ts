import {
  createConflictScenario,
  parsePreparedDataset,
  toPlanInput,
  toUrgentOrderEvent,
  type PreparedDataset,
} from '@wayfinder/dataset'
import {
  comparePlans,
  engineerLowerBound,
  prepareEmergencyEquipment,
  planBaseline,
  planOptimized,
  validatePlan,
} from '@wayfinder/planner'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import eastSource from '../../../../../../datasets/prepared/east.json'
import southCenterSource from '../../../../../../datasets/prepared/south-center.json'
import { calculatePlanPair, calculateReplan, type PlanningJob } from './plan-calculation'
import { setCalculatePlansForTests, usePlanningSession, type CalculatePlans } from './session'

const east = parsePreparedDataset(eastSource)
const southCenter = parsePreparedDataset(southCenterSource)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function resultFor(dataset: PreparedDataset) {
  const input = toPlanInput(dataset)
  const baseline = planBaseline(input)
  const optimizedResult = planOptimized(input, { candidateCheckBudget: 1, localSearchPasses: 1 })
  return {
    baseline,
    optimized: optimizedResult.plan,
    comparison: comparePlans(baseline, optimizedResult.plan),
    violations: validatePlan(input, optimizedResult.plan),
    search: optimizedResult.search,
    lowerBound: engineerLowerBound(input),
  }
}

describe('сессия планирования', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => {
    setCalculatePlansForTests(undefined)
    vi.unstubAllGlobals()
  })

  it('публикует custom и отбрасывает устаревший расчёт территории', async () => {
    const pending = deferred<ReturnType<typeof resultFor>>()
    const oldResult = resultFor(east)
    setCalculatePlansForTests(() => pending.promise)
    const session = usePlanningSession()
    const stale = session.setScenario('east', east)
    const custom = { ...east, title: 'scenario.json', orders: east.orders.slice(0, 8), events: [] }
    setCalculatePlansForTests(async (input) => resultFor(input))
    await session.setScenario('custom', custom)
    const published = session.published
    expect(published?.dataset.title).toBe('scenario.json')
    pending.resolve(oldResult)
    await stale
    expect(session.published).toBe(published)
    setCalculatePlansForTests(async () => {
      throw new Error('Ошибка расчёта')
    })
    await session.setScenario('custom', { ...custom, title: 'broken.json' })
    expect(session.published).toBe(published)
    expect(session.status).toBe('error')
  })

  it('передаёт в Worker только простые данные, в том числе на втором событии дня', async () => {
    // Как настоящий Worker: клонирует сообщение и падает на Vue Proxy.
    class CloningWorker {
      onmessage?: (event: { data: unknown }) => void
      terminate = vi.fn<() => void>()
      postMessage(message: PlanningJob) {
        const job = structuredClone(message)
        const result =
          job.kind === 'plans' ? calculatePlanPair(job.dataset) : calculateReplan(job.request)
        setTimeout(() => this.onmessage?.({ data: { ok: true, result } }))
      }
    }
    vi.stubGlobal('Worker', CloningWorker)
    const session = usePlanningSession()
    await session.setScenario('east', createConflictScenario(east))
    const prepared = session.dataset!.events[0]!
    await session.applyOperationalEvent(toUrgentOrderEvent(prepared), ['DEMO-DONE'])
    expect(session.error).toBeUndefined()
    await session.applyOperationalEvent(
      { kind: 'cancel-order', atMin: 820, orderId: 'DEMO-RESOURCE' },
      [],
    )
    expect(session.error).toBeUndefined()
    expect(session.status).toBe('ready')
    expect(session.published?.events).toHaveLength(2)
  })

  it('конфликт времени не публикует событие до явного разрешения пересогласования', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', createConflictScenario(east))
    session.confirmTime('DEMO-CLIENT')
    const original = session.published
    await session.applyPreparedUrgentEvent(['DEMO-DONE'])
    expect(session.published).toBe(original)
    expect(session.promiseConflict).toEqual(['DEMO-CLIENT'])
    await session.resolvePromiseConflict()
    expect(session.published?.replan).toBeDefined()
    expect(session.published?.agreements?.find((a) => a.orderId === 'DEMO-CLIENT')).toMatchObject({
      status: 'pending',
      startMin: 950,
    })
    session.confirmTime('DEMO-CLIENT')
    await session.applyOperationalEvent(
      { kind: 'cancel-order', atMin: 820, orderId: 'DEMO-RESOURCE' },
      [],
    )
    expect(session.published?.events).toHaveLength(2)
    expect(
      session.published?.replan?.history.find((h) => h.visit.orderId === 'DEMO-DONE')?.state,
    ).toBe('completed')
    expect(session.published?.agreements?.find((a) => a.orderId === 'DEMO-CLIENT')?.status).toBe(
      'confirmed',
    )
    expect(session.dataset?.orders.filter((o) => o.id === 'DEMO-URGENT')).toHaveLength(1)
    session.confirmTime('DEMO-RESOURCE')
    expect(session.published?.agreements?.find((a) => a.orderId === 'DEMO-RESOURCE')?.status).toBe(
      'confirmed',
    )
  })

  it('результат остановленного worker не отменяет новый расчёт; выдача сохраняет общий запас', async () => {
    class FakeWorker {
      onmessage?: (event: { data: unknown }) => void
      onerror?: () => void
      terminate = vi.fn<() => void>()
      postMessage = vi.fn<(message: unknown) => void>()
      constructor() {
        workers.push(this)
      }
    }
    const workers: FakeWorker[] = []
    const session = usePlanningSession()
    const demo = createConflictScenario(east)
    await session.setScenario('east', demo)
    vi.stubGlobal('Worker', FakeWorker)
    const probes = [{ id: 'one', pointId: demo.orders[0]!.pointId, atMin: 810, windowMin: 30 }]
    session.runAnalysis('readiness', probes)
    session.cancelAnalysis()
    session.runAnalysis('equipment', probes)
    workers[0]!.onmessage?.({ data: { ok: false, error: 'Устаревший результат' } })
    expect(session.analysisBusy).toBe(true)
    expect(workers[1]!.terminate).not.toHaveBeenCalled()
    const proposal = prepareEmergencyEquipment(
      toPlanInput(demo),
      session.published!.optimized,
      probes,
    )
    expect(proposal.transfer).toBeDefined()
    workers[1]!.onmessage?.({ data: { ok: true, result: proposal } })
    expect(session.analysisBusy).toBe(false)
    session.applyEquipmentPreparation()
    expect(session.published?.morningTransfer).toBeDefined()
    expect(
      session.dataset?.engineers.reduce((sum, e) => sum + e.equipment['emergency-kit'], 0),
    ).toBe(1)
    expect(session.analysis?.readiness?.withoutDisruption).toBe(1)
  })

  it('варианты привязаны к выбранной заявке и ревизии, исходный план не меняется', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', createConflictScenario(east))
    session.selectOrder('DEMO-RESOURCE')
    const before = session.published
    await session.inspectAssignmentOptions('DEMO-RESOURCE')
    expect(session.assignmentOptions?.map((o) => o.kind)).toEqual(['equipment', 'extra-engineer'])
    expect(session.published).toBe(before)
    session.selectOrder('DEMO-CLIENT')
    expect(session.assignmentOptions).toBeUndefined()
    session.selectOrder('DEMO-RESOURCE')
    expect(session.assignmentOptions).toHaveLength(2)
    const inspecting = session.inspectAssignmentOptions('DEMO-RESOURCE')
    await session.setScenario('south-center', southCenter)
    await inspecting
    expect(session.assignmentOptions).toBeUndefined()
    expect(session.dataset?.group).toBe('south-center')
    expect(session.status).toBe('ready')
  })

  it('альтернативы назначенной заявки относятся к показанному варианту и не отменяют пересчёт', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const id = session.plan!.routes.flatMap((route) => route.visits)[0]!.orderId
    session.selectOrder(id)
    const before = session.published
    await session.inspectAssignmentOptions(id)
    expect(session.assignmentOptions).toBeDefined()
    expect(session.published).toBe(before)
    session.showPlan('baseline')
    expect(session.assignmentOptions).toBeUndefined()
    await session.inspectAssignmentOptions(id)
    expect(session.assignmentOptions).toBeDefined()
    session.showPlan('optimized')
    expect(session.assignmentOptions).toBeUndefined()
    const calculating = session.calculate()
    const inspecting = session.inspectAssignmentOptions(id)
    await Promise.all([calculating, inspecting])
    expect(session.published).not.toBe(before)
    expect(session.status).toBe('ready')
    expect(session.assignmentOptions).toBeUndefined()
  })

  it('отбрасывает запоздавший результат предыдущего сценария', async () => {
    const first = deferred<ReturnType<typeof resultFor>>()
    const second = deferred<ReturnType<typeof resultFor>>()
    const inputs: PreparedDataset[] = []
    const calculator: CalculatePlans = (input) => {
      inputs.push(input)
      return inputs.length === 1 ? first.promise : second.promise
    }
    setCalculatePlansForTests(calculator)
    const session = usePlanningSession()
    const firstRun = session.setScenario('east', east)
    const secondRun = session.setScenario('south-center', southCenter)
    first.resolve(resultFor(inputs[0]!))
    await firstRun
    expect(session.published).toBeUndefined()
    second.resolve(resultFor(inputs[1]!))
    await secondRun
    expect(session.published?.scenarioRevision).toBe(2)
    expect(session.group).toBe('south-center')
  })

  it('повторный выбор набора публикует уже рассчитанный план без нового поиска', async () => {
    const inputs: PreparedDataset[] = []
    setCalculatePlansForTests(async (input) => {
      inputs.push(input)
      return resultFor(input)
    })
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const first = session.published!
    await session.setScenario('south-center', southCenter)
    await session.setScenario('east', east)
    expect(inputs).toHaveLength(2)
    expect(session.published).not.toBe(first)
    expect(session.published?.optimized).toBe(first.optimized)
    expect(session.published?.elapsedMs).toBe(first.elapsedMs)
    expect(session.published?.scenarioRevision).toBe(3)
  })

  it('сохраняет согласованные план и данные при ошибке другого сценария', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const published = session.published
    setCalculatePlansForTests(async () => {
      throw new Error('расчёт недоступен')
    })
    await session.setScenario('south-center', southCenter)
    expect(session.status).toBe('error')
    expect(session.error).toBe('расчёт недоступен')
    expect(session.published).toBe(published)
    expect(session.dataset?.group).toBe('east')
  })

  it('не публикует результат с нарушением модели', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const published = session.published
    setCalculatePlansForTests(async (input) => ({
      ...resultFor(input),
      violations: [{ code: 'order-missing', detail: 'тестовое нарушение' }],
    }))
    await session.calculate()
    expect(session.status).toBe('error')
    expect(session.published).toBe(published)
  })

  it('публикует остаточный план только после явного подтверждения завершённых визитов', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const before = session.published
    const completed = before!.optimized.routes.flatMap((route) =>
      route.visits.filter((visit) => visit.endMin <= 13 * 60 + 30).map((visit) => visit.orderId),
    )
    await session.applyPreparedUrgentEvent(completed)
    expect(session.published?.id).toBe(before!.id + 1)
    expect(session.published?.replan?.event).toMatchObject({
      kind: 'urgent-order',
      order: { id: 'U-1' },
    })
    expect(session.published?.replan?.violations).toEqual([])
    expect(session.selectedOrderId).toBe('U-1')
    expect(session.reference).toBe(before)
    const afterEvent = session.published
    await session.calculate()
    expect(session.published).toBe(afterEvent)
    expect(session.published?.replan?.history.length).toBeGreaterThan(0)
  })

  it('публикует отмену будущей заявки через общую команду события', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const before = session.published!
    const atMin = 13 * 60 + 30
    const completed = before.optimized.routes.flatMap((route) =>
      route.visits.filter((visit) => visit.endMin <= atMin).map((visit) => visit.orderId),
    )
    const target = before.optimized.routes
      .flatMap((route) => route.visits)
      .find((visit) => visit.endMin > atMin)!

    await session.applyOperationalEvent(
      { kind: 'cancel-order', atMin, orderId: target.orderId },
      completed,
    )

    expect(session.published?.replan?.event).toEqual({
      kind: 'cancel-order',
      atMin,
      orderId: target.orderId,
    })
    expect(session.published?.replan?.changes).toContainEqual({
      orderId: target.orderId,
      kind: 'cancelled',
    })
    expect(session.selectedOrderId).toBe(target.orderId)
  })

  it('подключает произвольную точку аварии к приближённым переездам', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const before = session.published!
    const atMin = 13 * 60 + 30
    const completed = before.optimized.routes.flatMap((route) =>
      route.visits.filter((visit) => visit.endMin <= atMin).map((visit) => visit.orderId),
    )
    const sourcePoint = east.points[0]!
    const eventPoint = {
      id: 'event-U-CUSTOM',
      address: 'Произвольная точка',
      coordinates: { lat: sourcePoint.lat + 0.001, lon: sourcePoint.lon + 0.001 },
    }

    await session.applyOperationalEvent(
      {
        kind: 'urgent-order',
        atMin,
        order: {
          id: 'U-CUSTOM',
          pointId: eventPoint.id,
          durationMin: 100,
          availableFromMin: atMin,
          window: { start: 14 * 60, end: 18 * 60 },
          priority: 'emergency',
          skill: 'emergency',
          transport: 'car',
          equipment: { 'emergency-kit': 1, router: 0, 'tv-box': 0, 'cable-kit': 0 },
        },
      },
      completed,
      eventPoint,
    )

    expect(session.published?.eventPoint).toEqual(eventPoint)
    expect(session.published?.replan?.event).toMatchObject({
      kind: 'urgent-order',
      order: { id: 'U-CUSTOM', pointId: eventPoint.id },
    })
    expect(session.published?.replan?.violations).toEqual([])
    expect(session.selectedOrderId).toBe('U-CUSTOM')
  })

  it('исключает недоступного инженера из остаточного плана', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const before = session.published!
    const atMin = 13 * 60 + 30
    const completed = before.optimized.routes.flatMap((route) =>
      route.visits.filter((visit) => visit.endMin <= atMin).map((visit) => visit.orderId),
    )
    const engineerId = before.optimized.routes.find((route) =>
      route.visits.some((visit) => visit.endMin > atMin),
    )!.engineerId

    await session.applyOperationalEvent(
      { kind: 'engineer-unavailable', atMin, engineerId },
      completed,
    )

    expect(session.published?.replan?.plan.routes.map((route) => route.engineerId)).not.toContain(
      engineerId,
    )
    expect(session.published?.replan?.event).toEqual({
      kind: 'engineer-unavailable',
      atMin,
      engineerId,
    })
  })

  it('не применяет событие при просмотре baseline', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const before = session.published
    session.showPlan('baseline')
    await session.applyPreparedUrgentEvent(
      before!.optimized.routes.flatMap((route) =>
        route.visits.filter((visit) => visit.endMin <= 810).map((visit) => visit.orderId),
      ),
    )
    expect(session.published).toBe(before)
    expect(session.published?.replan).toBeUndefined()
  })

  it('не применяет событие устаревшей ревизии во время смены сценария', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const eastRevision = session.published
    const pending = deferred<ReturnType<typeof resultFor>>()
    setCalculatePlansForTests((input) => {
      pending.resolve(resultFor(input))
      return pending.promise
    })
    const changing = session.setScenario('south-center', southCenter)
    await session.applyPreparedUrgentEvent(
      eastRevision!.optimized.routes.flatMap((route) =>
        route.visits.filter((visit) => visit.endMin <= 810).map((visit) => visit.orderId),
      ),
    )
    await changing
    expect(session.group).toBe('south-center')
    expect(session.published?.dataset.group).toBe('south-center')
    expect(session.published?.replan).toBeUndefined()
  })

  it('публикует ручное назначение одной транзакцией и сохраняет план при отказе', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const before = session.published!
    const orderId = before.optimized.routes.flatMap((route) => route.visits)[0]!.orderId
    const currentEngineerId = before.optimized.routes.find((route) =>
      route.visits.some((visit) => visit.orderId === orderId),
    )!.engineerId

    await session.assignManually(orderId, currentEngineerId)
    expect(session.published?.id).toBe(before.id + 1)
    expect(session.published?.manualAssignment).toMatchObject({
      orderId,
      engineerId: currentEngineerId,
    })
    expect(session.published?.violations).toEqual([])

    const accepted = session.published
    await session.assignManually(orderId, 'missing-engineer')
    expect(session.status).toBe('error')
    expect(session.published).toBe(accepted)
  })

  it('не применяет ручное назначение к baseline или плану после события', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const before = session.published!
    const orderId = before.optimized.routes.flatMap((route) => route.visits)[0]!.orderId
    const engineerId = before.optimized.routes[0]!.engineerId

    session.showPlan('baseline')
    await session.assignManually(orderId, engineerId)
    expect(session.published).toBe(before)

    session.showPlan('optimized')
    const completed = before.optimized.routes.flatMap((route) =>
      route.visits.filter((visit) => visit.endMin <= 810).map((visit) => visit.orderId),
    )
    await session.applyPreparedUrgentEvent(completed)
    const afterEvent = session.published
    await session.assignManually(orderId, engineerId)
    expect(session.published).toBe(afterEvent)
  })

  it('отбрасывает ручное назначение при начавшейся смене сценария', async () => {
    const session = usePlanningSession()
    await session.setScenario('east', east)
    const before = session.published!
    const orderId = before.optimized.routes.flatMap((route) => route.visits)[0]!.orderId
    const engineerId = before.optimized.routes[0]!.engineerId

    const assigning = session.assignManually(orderId, engineerId)
    const changing = session.setScenario('south-center', southCenter)
    await Promise.all([assigning, changing])

    expect(session.published?.dataset.group).toBe('south-center')
    expect(session.published?.manualAssignment).toBeUndefined()
  })
})
