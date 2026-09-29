import {
  toPlanInput,
  toUrgentOrderEvent,
  formatClock,
  type GeoPoint,
  type Group,
  type PreparedDataset,
} from '@wayfinder/dataset'
import {
  comparePlans,
  reconcileAgreements,
  confirmCustomerTime,
  assessDelay,
  type CustomerAgreement,
  type EmergencyProbe,
  type ReadinessReport,
  type EquipmentPreparation,
  findAssignmentOptions,
  type AssignmentOption,
  assignOrderManually,
  planBaseline,
  validatePlan,
  type EngineerLowerBound,
  type Plan,
  type PlanComparison,
  type PlanningEvent,
  type SearchStats,
  type ReplanResult,
  type Violation,
} from '@wayfinder/planner'
import { defineStore, storeToRefs } from 'pinia'
import { computed, reactive, readonly, shallowRef, ref, toRaw } from 'vue'
import {
  calculatePlanPair,
  calculateReplan,
  type CalculationResult,
  type PlanningJob,
  type ReplanRequest,
} from './plan-calculation'

export type PlanKind = 'baseline' | 'optimized'
type CalculationStatus = 'idle' | 'running' | 'ready' | 'error'

interface PublishedRevision {
  readonly morningTransfer?: EquipmentPreparation['transfer']
  readonly agreements?: readonly CustomerAgreement[]
  readonly eventReference?: Plan
  readonly events?: readonly PlanningEvent[]
  readonly id: number
  readonly scenarioRevision: number
  readonly dataset: PreparedDataset
  readonly baseline: Plan
  readonly optimized: Plan
  readonly comparison: PlanComparison
  readonly violations: readonly Violation[]
  readonly search: SearchStats
  readonly lowerBound: EngineerLowerBound
  readonly elapsedMs: number
  readonly replan?: ReplanResult
  readonly eventPoint?: {
    readonly id: string
    readonly address: string
    readonly coordinates: GeoPoint
  }
  readonly manualAssignment?:
    | {
        readonly orderId: string
        readonly engineerId: string
        readonly previousEngineerId?: string
      }
    | undefined
}

export type CalculatePlans = (dataset: PreparedDataset) => Promise<CalculationResult>

let runningWorker: { readonly cancel: () => void } | undefined

/**
 * Выполняет тяжёлый расчёт в рабочем потоке: поиск до локального оптимума занимает секунды.
 * Новая задача останавливает предыдущую (её промис отклоняется, вызывающий уже сменил
 * `calculationId`); без Worker (тесты) задача считается в текущем потоке через `inline`.
 */
function runInWorker<T>(job: PlanningJob, inline: () => T): Promise<T> {
  runningWorker?.cancel()
  if (typeof Worker === 'undefined') return Promise.resolve().then(inline)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./planning-worker.ts', import.meta.url), { type: 'module' })
    const fail = (message: string) => {
      finish()
      reject(new Error(message))
    }
    const finish = () => {
      worker.terminate()
      if (runningWorker === running) runningWorker = undefined
    }
    const running = { cancel: () => fail('Расчёт заменён новым') }
    runningWorker = running
    worker.onmessage = (
      message: MessageEvent<{ ok: true; result: T } | { ok: false; error: string }>,
    ) => {
      finish()
      if (message.data.ok) resolve(message.data.result)
      else reject(new Error(message.data.error))
    }
    worker.onerror = () => fail('Не удалось выполнить расчёт в рабочем потоке')
    worker.onmessageerror = () => fail('Не удалось прочитать результат рабочего потока')
    try {
      worker.postMessage(job)
    } catch {
      fail('Не удалось передать данные в рабочий поток')
    }
  })
}

function defaultCalculate(dataset: PreparedDataset): Promise<CalculationResult> {
  return runInWorker({ kind: 'plans', dataset }, () => calculatePlanPair(dataset))
}

let calculatePlans: CalculatePlans = defaultCalculate

const usePlanningStore = defineStore('planning-session', () => {
  const group = ref<Group | 'custom'>('east')
  const dataset = shallowRef<PreparedDataset>()
  const scenarioRevision = ref(0)
  const published = shallowRef<PublishedRevision>()
  const reference = shallowRef<PublishedRevision>()
  const status = ref<CalculationStatus>('idle')
  const error = ref<string>()
  const selectedOrderId = ref<string>()
  const visibleKind = ref<PlanKind>('optimized')
  const analysisBusy = ref(false)
  const analysisResult = shallowRef<{
    revision: PublishedRevision
    readiness?: ReadinessReport
    equipment?: EquipmentPreparation
  }>()
  const analysis = computed(() =>
    analysisResult.value?.revision === published.value ? analysisResult.value : undefined,
  )
  const delayResult = shallowRef<{
    revision: PublishedRevision
    value: ReturnType<typeof assessDelay>
  }>()
  const delay = computed(() =>
    delayResult.value !== undefined &&
    delayResult.value.revision === published.value &&
    delayResult.value.value.orderId === selectedOrderId.value
      ? delayResult.value.value
      : undefined,
  )
  let analysisWorker: Worker | undefined
  function cancelAnalysis() {
    analysisWorker?.terminate()
    analysisWorker = undefined
    analysisBusy.value = false
  }
  const conflict = shallowRef<{
    revision: PublishedRevision
    event: PlanningEvent
    facts: readonly string[]
    point?: { id: string; address: string; coordinates: GeoPoint }
    orderIds: readonly string[]
  }>()
  const promiseConflict = computed(() =>
    conflict.value !== undefined && conflict.value.revision === published.value
      ? conflict.value.orderIds
      : undefined,
  )
  const inspectedOptions = shallowRef<{
    revision: PublishedRevision
    orderId: string
    options: readonly AssignmentOption[]
    kind: PlanKind
  }>()
  const assignmentOptions = computed(() =>
    inspectedOptions.value?.revision === published.value &&
    inspectedOptions.value?.orderId === selectedOrderId.value &&
    inspectedOptions.value?.kind === visibleKind.value &&
    published.value?.replan === undefined
      ? inspectedOptions.value?.options
      : undefined,
  )
  let optionsRequestId = 0
  let calculationId = 0
  /** Статический расчёт детерминирован по набору: повторный выбор того же набора публикуется без поиска. */
  const scenarioPlans = new WeakMap<
    PreparedDataset,
    { readonly result: CalculationResult; readonly elapsedMs: number }
  >()

  async function setScenario(
    nextGroup: Group | 'custom',
    nextDataset: PreparedDataset,
  ): Promise<void> {
    cancelAnalysis()
    group.value = nextGroup
    scenarioRevision.value += 1
    await calculate(nextDataset)
  }

  async function calculate(nextDataset?: PreparedDataset): Promise<void> {
    if (nextDataset === undefined && published.value?.replan !== undefined) return
    if (
      nextDataset === undefined &&
      published.value?.agreements?.some((a) => a.status === 'confirmed')
    )
      return
    const snapshot = nextDataset ?? dataset.value
    if (snapshot === undefined) return
    const startedForRevision = scenarioRevision.value
    const currentCalculation = ++calculationId
    status.value = 'running'
    error.value = undefined
    const startedAt = performance.now()
    const cached = nextDataset === undefined ? undefined : scenarioPlans.get(toRaw(snapshot))
    if (cached !== undefined) runningWorker?.cancel()
    try {
      const result = cached?.result ?? (await calculatePlans(toRaw(snapshot)))
      if (
        currentCalculation !== calculationId ||
        startedForRevision !== scenarioRevision.value ||
        (nextDataset === undefined && snapshot !== dataset.value)
      ) {
        return
      }
      if (result.violations.length > 0) {
        throw new Error(`План не прошёл проверку модели: ${result.violations.length}`)
      }
      const elapsedMs = cached?.elapsedMs ?? performance.now() - startedAt
      if (nextDataset !== undefined) scenarioPlans.set(toRaw(snapshot), { result, elapsedMs })
      const next: PublishedRevision = {
        id: (published.value?.id ?? 0) + 1,
        scenarioRevision: startedForRevision,
        dataset: snapshot,
        ...result,
        elapsedMs,
      }
      reference.value = published.value
      published.value = next
      dataset.value = snapshot
      // Новый день открывается обзором всех бригад, без выбранного визита.
      selectedOrderId.value = undefined
      status.value = 'ready'
    } catch (cause) {
      if (currentCalculation !== calculationId) return
      error.value = cause instanceof Error ? cause.message : 'Неизвестная ошибка расчёта'
      status.value = 'error'
    }
  }

  async function applyOperationalEvent(
    incomingEvent: PlanningEvent,
    completedOrderIds: readonly string[],
    eventPoint?: {
      readonly id: string
      readonly address: string
      readonly coordinates: GeoPoint
    },
  ): Promise<void> {
    // Событие собирается из реактивных props; дальше оно попадает в набор, историю и Worker,
    // которому нужны простые данные.
    const event = JSON.parse(JSON.stringify(incomingEvent)) as PlanningEvent
    const snapshot = published.value
    const source = dataset.value
    if (
      snapshot === undefined ||
      source === undefined ||
      visibleKind.value !== 'optimized' ||
      snapshot.scenarioRevision !== scenarioRevision.value ||
      (group.value !== 'custom' && source.group !== group.value)
    )
      return
    const startedForRevision = scenarioRevision.value
    const currentCalculation = ++calculationId
    status.value = 'running'
    error.value = undefined
    const startedAt = performance.now()
    try {
      const request: ReplanRequest = {
        dataset: toRaw(source),
        ...(eventPoint === undefined
          ? {}
          : { eventPoint: { id: eventPoint.id, coordinates: toRaw(eventPoint.coordinates) } }),
        previous:
          snapshot.replan === undefined
            ? { kind: 'plan', plan: snapshot.optimized }
            : { kind: 'replan', replan: snapshot.replan },
        event,
        completedOrderIds: [...completedOrderIds],
        promises: Object.fromEntries(
          (snapshot.agreements ?? [])
            .filter((a) => a.promisedStartMin !== undefined)
            .map((a) => [a.orderId, a.promisedStartMin!]),
        ),
      }
      const result = await runInWorker({ kind: 'replan', request }, () => calculateReplan(request))
      if (
        currentCalculation !== calculationId ||
        startedForRevision !== scenarioRevision.value ||
        snapshot !== published.value
      )
        return
      if (result.violations.length > 0) {
        throw new Error(`Остаточный план не прошёл проверку модели: ${result.violations.length}`)
      }
      if (result.promiseConflicts?.length) {
        conflict.value = {
          revision: snapshot,
          event,
          facts: completedOrderIds,
          ...(eventPoint === undefined ? {} : { point: eventPoint }),
          orderIds: result.promiseConflicts,
        }
        status.value = 'ready'
        return
      }
      cancelAnalysis()
      let nextDataset = source
      if (event.kind === 'urgent-order') {
        const template = source.events[0]?.order ?? source.orders[0]!
        const point = source.points.find((p) => p.id === event.order.pointId)
        nextDataset = {
          ...source,
          points:
            eventPoint === undefined
              ? source.points
              : [
                  ...source.points,
                  {
                    id: eventPoint.id,
                    ...eventPoint.coordinates,
                    address: eventPoint.address,
                    query: eventPoint.address,
                    displayName: eventPoint.address,
                    precision: 'locality',
                    osm: null,
                  },
                ],
          orders: [
            ...source.orders,
            {
              ...template,
              ...event.order,
              address: eventPoint?.address ?? point?.address ?? template.address,
              availableFrom: formatClock(event.order.availableFromMin),
              window: {
                start: formatClock(event.order.window.start),
                end: formatClock(event.order.window.end),
              },
              sourceWindow: {
                start: formatClock(event.order.window.start),
                end: formatClock(event.order.window.end),
              },
              source: { file: 'Событие диспетчера', row: (snapshot.events?.length ?? 0) + 1 },
              control: { id: event.order.id, status: 'Новое событие', team: null },
            },
          ],
        }
      }
      conflict.value = undefined
      reference.value = snapshot
      published.value = {
        ...snapshot,
        id: snapshot.id + 1,
        search: result.search,
        violations: result.violations,
        elapsedMs: performance.now() - startedAt,
        replan: result,
        dataset: nextDataset,
        eventReference: snapshot.replan?.checkpoint?.plan ?? snapshot.optimized,
        agreements: reconcileAgreements(snapshot.agreements ?? [], result),
        events: [...(snapshot.events ?? []), event],
        ...(eventPoint === undefined ? {} : { eventPoint }),
        manualAssignment: undefined,
      }
      dataset.value = nextDataset
      selectedOrderId.value =
        event.kind === 'urgent-order'
          ? event.order.id
          : event.kind === 'cancel-order'
            ? event.orderId
            : snapshot.optimized.routes.find((route) => route.engineerId === event.engineerId)
                ?.visits[0]?.orderId
      visibleKind.value = 'optimized'
      status.value = 'ready'
    } catch (cause) {
      if (currentCalculation !== calculationId) return
      error.value = cause instanceof Error ? cause.message : 'Неизвестная ошибка перепланирования'
      status.value = 'error'
    }
  }

  function confirmTime(orderId: string): void {
    const snapshot = published.value
    if (snapshot === undefined) return
    calculationId += 1
    status.value = 'ready'
    cancelAnalysis()
    const current = snapshot.replan?.checkpoint?.plan ?? snapshot.optimized
    try {
      const item = snapshot.agreements?.find((a) => a.orderId === orderId)
      if (item !== undefined && item.startMin === undefined) {
        published.value = {
          ...snapshot,
          id: snapshot.id + 1,
          agreements: (snapshot.agreements ?? []).map((a) =>
            a.orderId === orderId ? { ...a, status: 'confirmed' as const } : a,
          ),
        }
        return
      }
      const agreements = confirmCustomerTime(snapshot.agreements ?? [], current, orderId)
      cancelAnalysis()
      published.value = { ...snapshot, id: snapshot.id + 1, agreements }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось подтвердить время'
    }
  }

  function releaseTime(orderId: string): void {
    const snapshot = published.value
    if (snapshot === undefined) return
    calculationId += 1
    status.value = 'ready'
    cancelAnalysis()
    published.value = {
      ...snapshot,
      id: snapshot.id + 1,
      agreements: (snapshot.agreements ?? []).map((a) =>
        a.orderId === orderId
          ? { ...a, status: 'pending' as const, promisedStartMin: undefined }
          : a,
      ),
    }
  }

  async function resolvePromiseConflict(): Promise<void> {
    const pending = conflict.value
    if (pending === undefined || pending.revision !== published.value) return
    const snapshot = published.value
    published.value = {
      ...snapshot,
      id: snapshot.id + 1,
      agreements: (snapshot.agreements ?? []).map((a) =>
        pending.orderIds.includes(a.orderId)
          ? { ...a, status: 'pending' as const, promisedStartMin: undefined }
          : a,
      ),
    }
    conflict.value = undefined
    await applyOperationalEvent(pending.event, pending.facts, pending.point)
  }

  function runAnalysis(kind: 'readiness' | 'equipment', probes: EmergencyProbe[]): void {
    const snapshot = published.value
    if (
      snapshot === undefined ||
      snapshot.replan !== undefined ||
      visibleKind.value !== 'optimized'
    )
      return
    cancelAnalysis()
    analysisBusy.value = true
    error.value = undefined
    let worker: Worker
    try {
      worker = new Worker(new URL('./resilience-worker.ts', import.meta.url), { type: 'module' })
    } catch {
      analysisBusy.value = false
      error.value = 'Рабочий поток недоступен; проверка не запущена'
      return
    }
    analysisWorker = worker
    worker.onmessage = (
      message: MessageEvent<
        { ok: true; result: ReadinessReport | EquipmentPreparation } | { ok: false; error: string }
      >,
    ) => {
      if (analysisWorker !== worker) return
      cancelAnalysis()
      if (snapshot !== published.value) return
      if (!message.data.ok) {
        error.value = message.data.error
        return
      }
      const result = message.data.result
      analysisResult.value = {
        revision: snapshot,
        ...('cases' in result
          ? { readiness: result }
          : { equipment: result, readiness: result.after }),
      }
    }
    worker.onerror = () => {
      if (analysisWorker !== worker) return
      cancelAnalysis()
      if (snapshot === published.value)
        error.value = 'Не удалось выполнить проверку в рабочем потоке'
    }
    worker.postMessage({ kind, dataset: snapshot.dataset, plan: snapshot.optimized, probes })
  }

  function applyEquipmentPreparation(): void {
    const snapshot = published.value
    const proposal = analysis.value?.equipment
    if (snapshot === undefined || snapshot.replan !== undefined || proposal?.transfer === undefined)
      return
    if (snapshot.agreements?.some((a) => a.status === 'confirmed')) {
      error.value = 'Утренние комплекты меняются до согласования времени и выезда'
      return
    }
    const nextDataset = {
      ...snapshot.dataset,
      engineers: snapshot.dataset.engineers.map((e) => ({
        ...e,
        equipment: proposal.engineers.find((p) => p.id === e.id)!.equipment,
      })),
    }
    const input = toPlanInput(nextDataset)
    const violations = validatePlan(input, proposal.plan)
    if (violations.length) {
      error.value = 'Предложение не прошло проверку модели'
      return
    }
    cancelAnalysis()
    const baseline = planBaseline(input)
    scenarioRevision.value += 1
    reference.value = snapshot
    published.value = {
      ...snapshot,
      id: snapshot.id + 1,
      scenarioRevision: scenarioRevision.value,
      dataset: nextDataset,
      baseline,
      optimized: proposal.plan,
      comparison: comparePlans(baseline, proposal.plan),
      violations,
      morningTransfer: proposal.transfer,
    }
    dataset.value = nextDataset
    analysisResult.value = { revision: published.value, readiness: proposal.after }
  }

  function inspectDelay(orderId: string, minutes: number): void {
    const snapshot = published.value
    if (snapshot === undefined || visibleKind.value !== 'optimized') return
    const baseInput = toPlanInput(snapshot.dataset)
    const checkpoint = snapshot.replan?.checkpoint
    const input =
      checkpoint === undefined
        ? baseInput
        : {
            ...baseInput,
            engineers: checkpoint.engineers,
            orders: checkpoint.orders.map((o) => ({
              ...o,
              window: baseInput.orders.find((original) => original.id === o.id)!.window,
            })),
          }
    const promises = Object.fromEntries(
      (snapshot.agreements ?? [])
        .filter((a) => a.promisedStartMin !== undefined)
        .map((a) => [a.orderId, a.promisedStartMin!]),
    )
    try {
      delayResult.value = {
        revision: snapshot,
        value: assessDelay(
          input,
          checkpoint?.plan ?? snapshot.optimized,
          orderId,
          minutes,
          promises,
        ),
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось проверить задержку'
    }
  }

  async function applyPreparedUrgentEvent(completedOrderIds: readonly string[]): Promise<void> {
    const event = dataset.value?.events[0]
    if (event !== undefined) {
      await applyOperationalEvent(toUrgentOrderEvent(event), completedOrderIds)
    }
  }

  async function assignManually(orderId: string, engineerId: string): Promise<void> {
    const snapshot = published.value
    const source = dataset.value
    const currentPlan = plan.value
    if (
      snapshot === undefined ||
      source === undefined ||
      currentPlan === undefined ||
      snapshot.replan !== undefined ||
      visibleKind.value !== 'optimized' ||
      snapshot.scenarioRevision !== scenarioRevision.value
    )
      return
    const currentCalculation = ++calculationId
    status.value = 'running'
    error.value = undefined
    const startedAt = performance.now()
    try {
      await Promise.resolve()
      const input = toPlanInput(source)
      const result = assignOrderManually(input, currentPlan, orderId, engineerId)
      if (currentCalculation !== calculationId || snapshot !== published.value) return
      if (!result.ok) {
        const messages = {
          'order-not-found': 'Заявка отсутствует в текущем сценарии',
          'engineer-not-found': 'Инженер отсутствует в текущем сценарии',
          'no-feasible-position': 'Заявка не помещается в маршрут выбранного инженера',
        } as const
        throw new Error(messages[result.code])
      }
      const violations = validatePlan(input, result.plan)
      if (
        snapshot.agreements?.some(
          (a) =>
            a.promisedStartMin !== undefined &&
            result.plan.routes.flatMap((r) => r.visits).find((v) => v.orderId === a.orderId)
              ?.startMin !== a.promisedStartMin,
        )
      ) {
        throw new Error(
          'Ручное назначение изменяет подтверждённое время. Сначала разрешите пересогласование.',
        )
      }
      if (violations.length > 0) {
        throw new Error(`Ручной план не прошёл проверку модели: ${violations.length}`)
      }
      reference.value = snapshot
      published.value = {
        ...snapshot,
        id: snapshot.id + 1,
        optimized: result.plan,
        comparison: comparePlans(snapshot.baseline, result.plan),
        violations,
        elapsedMs: performance.now() - startedAt,
        manualAssignment: {
          orderId,
          engineerId,
          ...(result.previousEngineerId === undefined
            ? {}
            : { previousEngineerId: result.previousEngineerId }),
        },
      }
      selectedOrderId.value = orderId
      visibleKind.value = 'optimized'
      status.value = 'ready'
    } catch (cause) {
      if (currentCalculation !== calculationId) return
      error.value = cause instanceof Error ? cause.message : 'Неизвестная ошибка ручного назначения'
      status.value = 'error'
    }
  }

  function selectOrder(orderId: string | undefined): void {
    selectedOrderId.value = orderId
  }

  async function inspectAssignmentOptions(orderId: string): Promise<void> {
    const snapshot = published.value
    const source = dataset.value
    if (
      snapshot === undefined ||
      source === undefined ||
      snapshot.replan !== undefined ||
      snapshot.scenarioRevision !== scenarioRevision.value
    )
      return
    const kind = visibleKind.value
    const currentCalculation = calculationId
    const requestId = ++optionsRequestId
    try {
      await Promise.resolve()
      const options = findAssignmentOptions(toPlanInput(source), snapshot[kind], orderId)
      if (
        requestId !== optionsRequestId ||
        currentCalculation !== calculationId ||
        snapshot !== published.value ||
        kind !== visibleKind.value
      )
        return
      inspectedOptions.value = { revision: snapshot, orderId, options, kind }
    } catch (cause) {
      if (requestId !== optionsRequestId || currentCalculation !== calculationId) return
      error.value = cause instanceof Error ? cause.message : 'Не удалось проверить варианты'
    }
  }

  function showPlan(kind: PlanKind): void {
    visibleKind.value = kind
  }

  const plan = computed(() => {
    const revision = published.value
    if (revision?.replan !== undefined) return revision.replan.plan
    return visibleKind.value === 'baseline' ? revision?.baseline : revision?.optimized
  })

  return {
    group: readonly(group),
    dataset: readonly(dataset),
    published: readonly(published),
    reference: readonly(reference),
    status: readonly(status),
    error: readonly(error),
    selectedOrderId: readonly(selectedOrderId),
    visibleKind: readonly(visibleKind),
    plan,
    analysis,
    analysisBusy,
    delay,
    promiseConflict,
    runAnalysis,
    cancelAnalysis,
    applyEquipmentPreparation,
    inspectDelay,
    confirmTime,
    releaseTime,
    resolvePromiseConflict,
    assignmentOptions,
    inspectAssignmentOptions,
    setScenario,
    calculate,
    applyOperationalEvent,
    applyPreparedUrgentEvent,
    assignManually,
    selectOrder,
    showPlan,
  }
})

/** Публичный интерфейс модуля: команды и чтение, сам Pinia-стор наружу не экспортируется. */
export function usePlanningSession() {
  const store = usePlanningStore()
  const state = storeToRefs(store)
  return reactive({
    ...state,
    setScenario: store.setScenario,
    calculate: store.calculate,
    applyOperationalEvent: store.applyOperationalEvent,
    applyPreparedUrgentEvent: store.applyPreparedUrgentEvent,
    assignManually: store.assignManually,
    runAnalysis: store.runAnalysis,
    cancelAnalysis: store.cancelAnalysis,
    applyEquipmentPreparation: store.applyEquipmentPreparation,
    inspectDelay: store.inspectDelay,
    confirmTime: store.confirmTime,
    releaseTime: store.releaseTime,
    resolvePromiseConflict: store.resolvePromiseConflict,
    inspectAssignmentOptions: store.inspectAssignmentOptions,
    selectOrder: store.selectOrder,
    showPlan: store.showPlan,
  })
}

/** Внутренняя точка подмены вычисления для тестов переходов; не входит в публичный вход модуля. */
export function setCalculatePlansForTests(next: CalculatePlans | undefined): void {
  calculatePlans = next ?? defaultCalculate
}
