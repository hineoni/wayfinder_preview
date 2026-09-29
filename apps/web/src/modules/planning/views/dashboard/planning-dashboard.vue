<script setup lang="ts">
import {
  parseClock,
  toUrgentOrderEvent,
  type GeoPoint,
  type PreparedDataset,
} from '@wayfinder/dataset'
import type {
  Plan,
  CustomerAgreement,
  ReadinessReport,
  EquipmentPreparation,
  EmergencyProbe,
  assessDelay,
  AssignmentOption,
  EngineerLowerBound,
  PlanComparison,
  PlanningEvent,
  ReplanResult,
  SearchStats,
  UnassignedOrder,
} from '@wayfinder/planner'
import UiButton from '../../../../shared/ui/ui-button.vue'
import UiInput from '../../../../shared/ui/ui-input.vue'
import UiChoiceList from '../../../../shared/ui/ui-choice-list.vue'
import UiCombobox from '../../../../shared/ui/ui-combobox.vue'
import UiIcon from '../../../../shared/ui/ui-icon.vue'
import UiSegmented from '../../../../shared/ui/ui-segmented.vue'
import UiTimeField from '../../../../shared/ui/ui-time-field.vue'
import UiDisclosure from '../../../../shared/ui/ui-disclosure.vue'
import { computed, ref, watch, type DeepReadonly } from 'vue'
import {
  formatDistance,
  formatMinute,
  priorityLabels,
  transportLabels,
  equipmentLabels,
  skillLabels,
  workLabel,
  workTypeLabel,
  plural,
} from '../../../../shared/lib/format'
import { alternativeText } from './assignment-alternatives'
import { crewColor, crewFill } from '../../../../shared/lib/crew-colors'
import { useTheme } from '../../../../shared/lib/theme'
import type { PlanKind } from '../../model/session'
import UiCopyValue from '../../../../shared/ui/ui-copy-value.vue'
import PlanningSchedule from './planning-schedule.vue'
import PlanningMap from './planning-map.vue'
import { reserveSummary, scheduleSegments } from './schedule-segments'
import { isUrgentOrderDraftValid } from './urgent-order-draft'
import type { GeometryState } from './route-geometry'
import AssignmentOptions from './assignment-options.vue'
import CrewRoster from './crew-roster.vue'
import DayRuler from './day-ruler.vue'
import VisitWindow from './visit-window.vue'
import PlanningOperations from './planning-operations.vue'
import PlanningReadiness from './planning-readiness.vue'
import { briefingText, crewBriefing } from './crew-briefing'

const props = defineProps<{
  /** Раздел рабочего места; навигация живёт в боковой панели приложения. */
  screen?: 'plan' | 'events' | 'analysis'
  events?: readonly PlanningEvent[] | undefined
  agreements?: readonly CustomerAgreement[] | undefined
  promiseConflict?: readonly string[] | undefined
  readiness?: ReadinessReport | undefined
  equipmentPreparation?: EquipmentPreparation | undefined
  analysisBusy?: boolean
  delay?: ReturnType<typeof assessDelay> | undefined
  assignmentOptions?: readonly AssignmentOption[] | undefined
  busy?: boolean
  isConflict?: boolean
  dataset: DeepReadonly<PreparedDataset>
  /** Геометрия дорог группы; грузится после публикации плана. */
  geometry?: GeometryState
  plan: Plan
  baseline: Plan
  optimized: Plan
  comparison: PlanComparison
  lowerBound: EngineerLowerBound
  search: SearchStats
  violations: number
  elapsedMs: number
  selectedOrderId: string | undefined
  visibleKind: PlanKind
  replan: ReplanResult | undefined
  manualAssignment:
    | {
        readonly orderId: string
        readonly engineerId: string
        readonly previousEngineerId?: string
      }
    | undefined
  eventPoint:
    | { readonly id: string; readonly address: string; readonly coordinates: GeoPoint }
    | undefined
}>()
const emit = defineEmits<{
  confirmTime: [id: string]
  releaseTime: [id: string]
  resolveConflict: []
  runAnalysis: [kind: 'readiness' | 'equipment', probes: EmergencyProbe[]]
  cancelAnalysis: []
  applyEquipment: []
  inspectDelay: [id: string, minutes: number]
  inspectOptions: [orderId: string]
  select: [orderId: string | undefined]
  showPlan: [kind: PlanKind]
  export: []
  replan: [
    event: PlanningEvent,
    completedOrderIds: string[],
    eventPoint?: { id: string; address: string; coordinates: GeoPoint },
  ]
  assignManually: [orderId: string, engineerId: string]
}>()
const theme = useTheme()
const view = computed(() => props.screen ?? 'plan')
const showBriefing = ref(false)
const copyStatus = ref('')
const briefing = computed(() => crewBriefing(props.dataset, props.plan, orders.value, props.replan))
const briefingPlain = computed(() => briefingText(briefing.value))
async function copyBriefing() {
  try {
    await navigator.clipboard.writeText(briefingPlain.value)
    copyStatus.value = 'Сводка скопирована'
  } catch {
    copyStatus.value = 'Не удалось скопировать. Скачайте TXT или выделите текст сводки.'
  }
}
function downloadBriefing() {
  const url = URL.createObjectURL(
    new Blob([briefingPlain.value], { type: 'text/plain;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `wayfinder-${props.dataset.group}-${props.dataset.day}.txt`
  link.click()
  URL.revokeObjectURL(url)
}
function printBriefing() {
  window.print()
}
/** Бригада под курсором в списке или расписании: карта подсвечивает её маршрут. */
const hoveredCrew = ref<string>()
// Выбор меняет состав панели: строка под курсором может исчезнуть без pointerleave.
watch(
  () => props.selectedOrderId,
  () => {
    hoveredCrew.value = undefined
  },
)
watch(
  () => [props.selectedOrderId, props.plan] as const,
  ([id]) => {
    if (
      id &&
      !props.replan &&
      props.plan.routes.some((route) => route.visits.some((visit) => visit.orderId === id))
    )
      emit('inspectOptions', id)
  },
  { immediate: true },
)
const alternativeSummary = computed(() => {
  if (props.replan)
    return 'После события альтернативы не проверяются: нужно учитывать историю и подтверждённое время.'
  if (props.assignmentOptions === undefined)
    return props.busy ? 'Проверяем перенос без изменения условий…' : 'Варианты пока не рассчитаны.'
  if (props.assignmentOptions.length === 0)
    return 'Других бригад с подходящими навыком и транспортом нет.'
  return props.assignmentOptions
    .slice(0, 3)
    .map((option) => ({ id: option.engineer.id, text: alternativeText(option) }))
})
/** Показатель другого варианта рядом с показанным; после события сравнение не показывается. */
const counterpart = computed(() =>
  props.replan === undefined
    ? {
        label: props.visibleKind === 'optimized' ? 'базовый' : 'улучшенный',
        plan: props.visibleKind === 'optimized' ? props.baseline : props.optimized,
      }
    : undefined,
)
/** Дата дня для шапки: число и месяц в плашке, день недели и год подписью. */
const displayDay = computed(() => {
  const date = new Date(`${props.dataset.day}T00:00:00Z`)
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(date)
  return {
    day: part({ day: 'numeric' }),
    month: part({ month: 'short' }).replace('.', ''),
    weekday: part({ weekday: 'long' }),
    year: part({ year: 'numeric' }),
    full: part({ day: 'numeric', month: 'long', year: 'numeric' }),
  }
})
const reserve = computed(() => reserveSummary(props.plan))
const preparedEvent = computed(() => props.dataset.events[0])
const appliedUrgentOrder = computed(() => {
  if (props.replan?.event.kind !== 'urgent-order') return undefined
  const eventId = props.replan.event.order.id
  const saved = props.dataset.orders.find((o) => o.id === eventId)
  if (saved !== undefined) return saved
  const prepared = preparedEvent.value
  if (props.eventPoint === undefined && prepared?.order.id === props.replan.event.order.id)
    return prepared.order
  return {
    ...props.replan.event.order,
    address: props.eventPoint?.address ?? 'Произвольная точка',
    window: {
      start: formatMinute(props.replan.event.order.window.start),
      end: formatMinute(props.replan.event.order.window.end),
    },
  }
})
const eventKind = ref<PlanningEvent['kind']>('urgent-order')
const urgentSource = ref<'prepared' | 'custom'>('prepared')
const customUrgent = ref({
  id: 'U-CUSTOM',
  address: 'Новая точка аварии',
  at: preparedEvent.value?.at ?? '13:30',
  windowStart: '14:00',
  windowEnd: '16:00',
  lat: '55.7512',
  lon: '37.6184',
})
const cancellationTargetId = ref<string>()
const unavailableEngineerId = ref<string>()
const manualEngineerId = ref<string>()
const displayOrders = computed(() => [
  ...props.dataset.orders,
  ...(appliedUrgentOrder.value === undefined ||
  props.dataset.orders.some((o) => o.id === appliedUrgentOrder.value?.id)
    ? []
    : [appliedUrgentOrder.value]),
])
const orders = computed(() => new Map(displayOrders.value.map((order) => [order.id, order])))
const engineers = computed(() => new Map(props.dataset.engineers.map((item) => [item.id, item])))
const engineerColors = computed(
  () =>
    new Map(props.dataset.engineers.map((item, index) => [item.id, crewColor(index, theme.value)])),
)
const engineerFills = computed(
  () =>
    new Map(props.dataset.engineers.map((item, index) => [item.id, crewFill(index, theme.value)])),
)
/** Бригады как варианты выбора: цвет совпадает с картой и расписанием. */
function engineerChoices(
  list: readonly { id: string; name: string; transport: keyof typeof transportLabels }[],
  currentId?: string,
) {
  return list.map((engineer) => ({
    value: engineer.id,
    label: engineer.name,
    description: engineer.id === currentId ? 'Сейчас в плане' : transportLabels[engineer.transport],
    color: engineerColors.value.get(engineer.id),
  }))
}
const eventKinds = [
  {
    value: 'urgent-order',
    label: 'Новая авария',
    description: 'Срочная заявка в остаток дня',
    icon: 'bolt',
  },
  {
    value: 'cancel-order',
    label: 'Отмена заявки',
    description: 'Клиент отказался от невыполненного визита',
    icon: 'cancel',
  },
  {
    value: 'engineer-unavailable',
    label: 'Бригада недоступна',
    description: 'Оставшиеся визиты перераспределяются',
    icon: 'user-off',
  },
] as const
const selectedOrder = computed(() => orders.value.get(props.selectedOrderId ?? ''))
const completedBeforeEvent = computed(() => {
  const atMin = activeEventAtMin.value
  if (atMin === undefined) return []
  return props.optimized.routes.flatMap((route) =>
    route.visits.filter((visit) => visit.endMin <= atMin).map((visit) => visit.orderId),
  )
})
const activeEventAtMin = computed(() => {
  const value =
    eventKind.value === 'urgent-order' && urgentSource.value === 'custom'
      ? customUrgent.value.at
      : preparedEvent.value?.at
  if (value === undefined || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined
  return parseClock(value)
})
const customUrgentValid = computed(() => {
  return isUrgentOrderDraftValid(
    customUrgent.value,
    props.dataset.assumptions.shift,
    new Set(props.dataset.orders.map((order) => order.id)),
  )
})
const eventAtMin = computed(() =>
  preparedEvent.value === undefined ? undefined : parseClock(preparedEvent.value.at),
)
const cancellableOrders = computed(() => {
  const atMin = eventAtMin.value
  if (atMin === undefined) return []
  return props.optimized.routes.flatMap((route) =>
    route.visits
      .filter((visit) => visit.endMin > atMin)
      .map((visit) => props.dataset.orders.find((order) => order.id === visit.orderId)!),
  )
})
const availableEngineers = computed(() =>
  props.optimized.routes
    .filter((route) => route.visits.some((visit) => visit.endMin > (eventAtMin.value ?? Infinity)))
    .map((route) => props.dataset.engineers.find((engineer) => engineer.id === route.engineerId)!),
)
const assignedCount = computed(
  () =>
    props.replan?.dayMetrics.assigned ??
    props.plan.routes.reduce((sum, route) => sum + route.visits.length, 0),
)
const selectedHistory = computed(() =>
  props.replan?.history.findLast((item) => item.visit.orderId === props.selectedOrderId),
)
const selectedInterrupted = computed(
  () => selectedHistory.value?.state.startsWith('interrupted') === true,
)
const cancelledOrderId = computed(() =>
  props.replan?.event.kind === 'cancel-order' ? props.replan.event.orderId : undefined,
)
const selectedVisit = computed(
  () =>
    props.plan.routes
      .flatMap((route) => route.visits)
      .find((visit) => visit.orderId === props.selectedOrderId) ??
    (selectedInterrupted.value ? undefined : selectedHistory.value?.visit),
)
const cancelledOrderIds = computed(() =>
  (props.events ?? []).flatMap((e) => (e.kind === 'cancel-order' ? [e.orderId] : [])),
)
const selectedStatus = computed(() => {
  if (
    props.selectedOrderId === cancelledOrderId.value ||
    cancelledOrderIds.value.includes(props.selectedOrderId ?? '')
  )
    return 'Отменена'
  if (selectedHistory.value?.state === 'completed') return 'Выполнена'
  if (selectedHistory.value?.state.startsWith('cancelled')) return 'Отменена'
  if (selectedInterrupted.value) return selectedVisit.value ? 'Переназначена' : 'Не назначена'
  if (selectedHistory.value !== undefined) return 'Зафиксирована'
  return selectedVisit.value === undefined ? 'Не назначена' : 'Назначена'
})
const selectedUnassigned = computed(() =>
  props.plan.unassigned.find((item) => item.orderId === props.selectedOrderId),
)
const selectedEngineer = computed(() =>
  engineers.value.get(selectedVisit.value?.explanation.engineerId ?? ''),
)
const selectedRoutePosition = computed(() => {
  const route = props.plan.routes.find((item) =>
    item.visits.some((visit) => visit.orderId === props.selectedOrderId),
  )
  if (route === undefined) return undefined
  const index = route.visits.findIndex((visit) => visit.orderId === props.selectedOrderId)
  const previous = route.visits[index - 1]
  const next = route.visits[index + 1]
  return {
    number: index + 1,
    total: route.visits.length,
    previousOrderId: previous?.orderId,
    nextOrderId: next?.orderId,
    previous: previous === undefined ? undefined : orders.value.get(previous.orderId)?.address,
    next: next === undefined ? undefined : orders.value.get(next.orderId)?.address,
  }
})
const selectedEquipment = computed(() => {
  const order = selectedOrder.value
  const visit = selectedVisit.value
  if (order === undefined || visit === undefined) return []
  return (Object.keys(equipmentLabels) as (keyof typeof equipmentLabels)[])
    .filter((kind) => order.equipment[kind] > 0)
    .map((kind) => ({
      label: equipmentLabels[kind],
      used: order.equipment[kind],
      remaining: visit.equipmentRemaining[kind],
    }))
})
const engineerComparison = computed(() => {
  const baseline = new Map(
    props.baseline.metrics.perEngineer.map((item) => [item.engineerId, item.distanceM]),
  )
  const optimized = new Map(
    props.optimized.metrics.perEngineer.map((item) => [item.engineerId, item.distanceM]),
  )
  return props.comparison.delta.distanceByEngineer.map((item) => ({
    ...item,
    name: engineers.value.get(item.engineerId)?.name ?? item.engineerId,
    baseline: baseline.get(item.engineerId) ?? 0,
    optimized: optimized.get(item.engineerId) ?? 0,
  }))
})
const selectedManualAssignment = computed(() => {
  const assignment = props.manualAssignment
  if (assignment === undefined) return undefined
  return props.replan === undefined &&
    props.visibleKind === 'optimized' &&
    assignment.orderId === props.selectedOrderId &&
    assignment.engineerId === selectedVisit.value?.explanation.engineerId
    ? assignment
    : undefined
})
const rejectionLabels = {
  skill: 'не подходит квалификация',
  transport: 'не подходит транспорт',
  equipment: 'не хватает дневного оборудования',
  unreachable: 'точка недостижима',
  window: 'не помещается в окно',
  shift: 'работа завершится после смены',
} as const

/** Показатели над картой; изменение считается к другому статическому варианту. */
const metrics = computed(() => {
  const other = counterpart.value
  const assigned = assignedCount.value
  const distance = props.replan?.dayMetrics.distanceM ?? props.plan.metrics.distanceM
  const engineersUsed = props.replan?.dayMetrics.engineersUsed ?? props.plan.metrics.engineersUsed
  const delta = (value: number, base: number | undefined, more: 'better' | 'worse') => {
    if (base === undefined || value === base) return undefined
    const diff = value - base
    return { diff, good: more === 'better' ? diff > 0 : diff < 0 }
  }
  const otherAssigned =
    other === undefined
      ? undefined
      : props.dataset.orders.length - other.plan.metrics.unassignedTotal
  return [
    {
      key: 'assigned',
      label: 'Назначено',
      value: String(assigned),
      delta: delta(assigned, otherAssigned, 'better'),
      text: (diff: number) => `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`,
      hint: other && `${other.label}: ${otherAssigned}`,
    },
    {
      key: 'unassigned',
      label: 'Без назначения',
      value: String(props.plan.metrics.unassignedTotal),
      delta: delta(
        props.plan.metrics.unassignedTotal,
        other?.plan.metrics.unassignedTotal,
        'worse',
      ),
      text: (diff: number) => `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`,
      hint: other && `${other.label}: ${other.plan.metrics.unassignedTotal}`,
    },
    {
      key: 'engineers',
      label: 'Инженеров',
      value: String(engineersUsed),
      delta: delta(engineersUsed, other?.plan.metrics.engineersUsed, 'worse'),
      text: (diff: number) => `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`,
      hint: other && `${other.label}: ${other.plan.metrics.engineersUsed}`,
    },
    {
      key: 'distance',
      label: 'Пробег',
      value: formatDistance(distance),
      delta: delta(
        Math.round(distance),
        other && Math.round(other.plan.metrics.distanceM),
        'worse',
      ),
      text: (diff: number) => formatDistance(diff, true).replace('-', '−'),
      hint: other && `${other.label}: ${formatDistance(other.plan.metrics.distanceM)}`,
    },
  ]
})
const shiftRange = computed(() => {
  const starts = props.dataset.engineers.map((engineer) => parseClock(engineer.shift.start))
  const ends = props.dataset.engineers.map((engineer) => parseClock(engineer.shift.end))
  return { start: Math.min(...starts), end: Math.max(...ends) }
})
/** Бригады с визитами для пустого инспектора: переезды, резерв и работа на общей шкале смены. */
const crewRows = computed(() => {
  const range = shiftRange.value
  const span = Math.max(1, range.end - range.start)
  return props.plan.routes.flatMap((route) => {
    const first = route.visits[0]
    const last = route.visits.at(-1)
    const engineer = engineers.value.get(route.engineerId)
    if (first === undefined || last === undefined || engineer === undefined) return []
    return [
      {
        id: route.engineerId,
        name: engineer.name,
        meta: `${route.visits.length} ${plural(route.visits.length, ['визит', 'визита', 'визитов'])} · ${formatDistance(route.distanceM)} · ${transportLabels[engineer.transport]}`,
        color: engineerColors.value.get(route.engineerId) ?? 'currentColor',
        span: `${formatMinute(first.startMin)}–${formatMinute(last.endMin)}`,
        segments: route.visits.flatMap((visit) =>
          scheduleSegments(visit).map((segment) => ({
            kind: segment.kind,
            left: Math.max(0, (segment.start - range.start) / span),
            width: (segment.end - Math.max(segment.start, range.start)) / span,
          })),
        ),
        firstOrderId: first.orderId,
      },
    ]
  })
})
/** Точки линейки дня: до события — план до события, после — история и остаточный план. */
const rulerVisits = computed(() => {
  const source = props.replan
    ? [
        ...props.replan.history.map((item) => ({
          engineerId: item.engineerId,
          visit: item.visit,
        })),
        ...props.plan.routes.flatMap((route) =>
          route.visits.map((visit) => ({ engineerId: route.engineerId, visit })),
        ),
      ]
    : props.optimized.routes.flatMap((route) =>
        route.visits.map((visit) => ({ engineerId: route.engineerId, visit })),
      )
  const rows = new Map<string, number>()
  for (const engineer of props.dataset.engineers)
    if (source.some((item) => item.engineerId === engineer.id)) rows.set(engineer.id, rows.size)
  return {
    rows: props.dataset.engineers
      .filter((engineer) => rows.has(engineer.id))
      .map((engineer) => ({
        name: engineer.name,
        color: engineerColors.value.get(engineer.id) ?? 'currentColor',
      })),
    visits: source.map((item, index) => ({
      key: `${item.visit.orderId}-${index}`,
      startMin: item.visit.startMin,
      endMin: item.visit.endMin,
      orderId: item.visit.orderId,
      title: orders.value.get(item.visit.orderId)
        ? workLabel(orders.value.get(item.visit.orderId)!)
        : 'Визит',
      address: orders.value.get(item.visit.orderId)?.address ?? 'Адрес не указан',
      row: rows.get(item.engineerId) ?? 0,
      color: engineerColors.value.get(item.engineerId) ?? 'currentColor',
    })),
  }
})
const rulerAt = computed(() => props.replan?.event.atMin ?? activeEventAtMin.value)
function unassignedReason(value: UnassignedOrder): string {
  if (value.class === 'incompatible')
    return value.withSkill === 0
      ? 'Нет инженера с требуемой квалификацией.'
      : 'Нет инженера с подходящими квалификацией и транспортом.'
  if (value.class === 'infeasible-in-plan')
    return 'Заявка не помещается ни в одну позицию найденных маршрутов при действующих ограничениях.'
  return 'В найденном плане места не нашлось; невозможность назначения не доказана.'
}
function changeTab(value: string | number): void {
  if (value === 'baseline' || value === 'optimized') emit('showPlan', value)
}

function applyEvent(): void {
  const prepared = preparedEvent.value
  if (prepared === undefined) return
  const atMin = parseClock(prepared.at)
  if (eventKind.value === 'urgent-order') {
    if (urgentSource.value === 'custom') {
      const value = customUrgent.value
      const customAtMin = activeEventAtMin.value
      const lat = Number(value.lat)
      const lon = Number(value.lon)
      if (customAtMin === undefined || !customUrgentValid.value) return
      const pointId = `event-${value.id.trim()}`
      const order = {
        ...toUrgentOrderEvent(prepared).order,
        id: value.id.trim(),
        pointId,
        availableFromMin: customAtMin,
        window: { start: parseClock(value.windowStart), end: parseClock(value.windowEnd) },
      }
      emit(
        'replan',
        { kind: 'urgent-order', atMin: customAtMin, order },
        completedBeforeEvent.value,
        {
          id: pointId,
          address: value.address.trim(),
          coordinates: { lat, lon },
        },
      )
      return
    }
    emit('replan', toUrgentOrderEvent(prepared), completedBeforeEvent.value)
    return
  }
  if (eventKind.value === 'cancel-order') {
    const orderId = cancellationTargetId.value ?? cancellableOrders.value[0]?.id
    if (orderId !== undefined) {
      emit('replan', { kind: 'cancel-order', atMin, orderId }, completedBeforeEvent.value)
    }
    return
  }
  const engineerId = unavailableEngineerId.value ?? availableEngineers.value[0]?.id
  if (engineerId !== undefined) {
    emit('replan', { kind: 'engineer-unavailable', atMin, engineerId }, completedBeforeEvent.value)
  }
}

function applyManualAssignment(): void {
  const orderId = props.selectedOrderId
  const engineerId = manualEngineerId.value
  if (orderId !== undefined && engineerId !== undefined) emit('assignManually', orderId, engineerId)
}
</script>

<template>
  <main class="workspace">
    <header class="workspace__topbar">
      <div class="workspace__title">
        <time
          class="workspace__date"
          :datetime="dataset.day"
          :title="displayDay.full"
        >
          <strong class="workspace__date-day">{{ displayDay.day }}</strong>
          <span class="workspace__date-month">{{ displayDay.month }}</span>
        </time>
        <div class="workspace__heading">
          <h1>{{ dataset.title }}</h1>
          <p>
            <span class="workspace__weekday">{{ displayDay.weekday }}, {{ displayDay.year }}</span>
            <span>
              Модельная смена {{ formatMinute(shiftRange.start) }}–{{
                formatMinute(shiftRange.end)
              }}
            </span>
          </p>
        </div>
      </div>
      <div
        class="workspace__tools"
        data-tour="plan-tools"
      >
        <UiSegmented
          v-if="replan === undefined"
          :model-value="visibleKind"
          label="Вариант плана"
          :options="[
            { value: 'baseline', label: 'Базовый' },
            { value: 'optimized', label: 'Улучшенный' },
          ]"
          @update:model-value="changeTab"
        />
        <span
          v-else
          class="status status--info"
        >
          <UiIcon name="bolt" />
          План после события {{ formatMinute(replan.event.atMin) }}
        </span>
        <template v-if="view === 'plan'">
          <UiButton
            :aria-pressed="showBriefing"
            data-tour="briefing-toggle"
            @click="showBriefing = !showBriefing"
          >
            <UiIcon name="text" />
            Сводка
          </UiButton>
          <UiButton
            variant="ghost"
            @click="emit('export')"
            data-tour="export"
          >
            <UiIcon name="download" />
            Экспорт JSON
          </UiButton>
        </template>
      </div>
    </header>

    <div class="workspace__body">
      <section
        v-if="view === 'plan' && showBriefing"
        class="crew-briefing panel"
        data-tour="briefing"
        aria-label="Сводка для бригад"
      >
        <header class="crew-briefing__actions">
          <h2>Сводка для бригад</h2>
          <p
            class="crew-briefing__status"
            role="status"
          >
            {{ copyStatus }}
          </p>
          <UiButton
            size="sm"
            @click="copyBriefing"
          >
            <UiIcon name="copy" />
            Копировать текст
          </UiButton>
          <UiButton
            size="sm"
            @click="downloadBriefing"
          >
            <UiIcon name="download" />
            Скачать TXT
          </UiButton>
          <UiButton
            size="sm"
            @click="printBriefing"
          >
            Печать
          </UiButton>
        </header>
        <p class="crew-briefing__scope">{{ briefing.scope }}</p>
        <ul class="crew-briefing__crews">
          <li
            v-for="crew in briefing.crews"
            :key="crew.id"
            class="crew-briefing__crew"
            :class="{ 'crew-briefing__crew--idle': crew.empty !== undefined }"
          >
            <header class="crew-briefing__head">
              <i
                class="crew-briefing__swatch"
                :style="{ background: engineerColors.get(crew.id) }"
                aria-hidden="true"
              ></i>
              <strong class="crew-briefing__name">{{ crew.name }}</strong>
              <span>
                {{ crew.transport }}
                <template v-if="crew.visits.length">
                  · {{ crew.visits.length }}
                  {{ plural(crew.visits.length, ['визит', 'визита', 'визитов']) }}
                </template>
              </span>
            </header>
            <ol
              v-if="crew.history.length"
              class="crew-briefing__list crew-briefing__list--history"
            >
              <li
                v-for="item in crew.history"
                :key="item.orderId"
                class="crew-briefing__stop"
              >
                <time>{{ formatMinute(item.startMin) }}–{{ formatMinute(item.endMin) }}</time>
                <span class="crew-briefing__what">
                  <strong class="crew-briefing__kind">{{ item.label }}</strong>
                  {{ item.address }}
                </span>
              </li>
            </ol>
            <p
              v-if="crew.splitHistory"
              class="crew-briefing__note"
            >
              Ниже — только предстоящие визиты
            </p>
            <p
              v-if="crew.empty"
              class="crew-briefing__note"
            >
              {{ crew.empty }}
            </p>
            <ol
              v-else
              class="crew-briefing__list"
            >
              <li
                v-for="visit in crew.visits"
                :key="visit.orderId"
                class="crew-briefing__stop"
              >
                <time>{{ formatMinute(visit.startMin) }}–{{ formatMinute(visit.endMin) }}</time>
                <span class="crew-briefing__what">
                  <strong
                    class="crew-briefing__kind"
                    :class="{ 'crew-briefing__kind--danger': visit.emergency }"
                  >
                    {{ visit.kind }}
                  </strong>
                  {{ visit.address }}
                  <small>
                    Выезд {{ formatMinute(visit.departMin) }}, в пути {{ visit.travelMin }} мин{{
                      visit.waitMin > 0 ? `, резерв ${visit.waitMin} мин` : ''
                    }}{{ visit.approximate ? ', переезд приближённый' : '' }}
                  </small>
                </span>
              </li>
            </ol>
          </li>
        </ul>
        <p
          v-if="briefing.unassigned.length"
          class="crew-briefing__unassigned"
        >
          <strong>Без назначения</strong>
          {{ briefing.unassigned.join(', ') }}
        </p>
      </section>

      <section
        v-if="view === 'plan'"
        class="stage"
      >
        <div
          class="stage__map"
          data-tour="map"
        >
          <PlanningMap
            :dataset
            :geometry="geometry ?? { status: 'loading' }"
            :plan
            :selected-order-id
            :event-order="appliedUrgentOrder"
            :event-point="eventPoint"
            :history="replan?.history ?? []"
            :continuations="replan?.continuations ?? []"
            :cancelled-order-id
            :cancelled-order-ids
            :highlighted-engineer-id="hoveredCrew"
            @select="emit('select', $event)"
          />
          <dl
            class="hud"
            data-tour="metrics"
          >
            <div
              v-for="metric in metrics"
              :key="metric.key"
              class="hud__item"
              :title="metric.hint"
            >
              <dt>{{ metric.label }}</dt>
              <dd>
                <span class="hud__value">{{ metric.value }}</span>
                <span
                  v-if="metric.delta"
                  class="hud__delta"
                  :class="metric.delta.good ? 'hud__delta--good' : 'hud__delta--bad'"
                >
                  {{ metric.text(metric.delta.diff) }}
                </span>
              </dd>
            </div>
            <div
              class="hud__item"
              title="Сумма промежутков от прибытия до начала будущих визитов. Не гарантия назначения: нужны проверка ограничений и учёт согласований."
            >
              <dt>Резерв под аварии</dt>
              <dd>
                <span class="hud__value">
                  {{ (reserve.minutes / 60).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) }}
                  ч
                </span>
                <span class="hud__note">
                  у {{ reserve.crews }} {{ plural(reserve.crews, ['бригады', 'бригад', 'бригад'])
                  }}{{ replan ? ' в остатке дня' : '' }}
                </span>
              </dd>
            </div>
            <p
              v-if="counterpart"
              class="hud__caption"
            >
              Цветом — изменение к варианту «{{ counterpart.label }}»
            </p>
            <p
              v-if="replan?.history.some((item) => item.estimatedTravelledDistanceM !== undefined)"
              class="hud__caption"
            >
              Пробег включает оценку прерванного переезда
            </p>
          </dl>
        </div>
        <aside
          class="workspace__details stage__inspector"
          data-tour="inspector"
          aria-label="Выбранная заявка"
        >
          <template v-if="selectedOrder">
            <div class="order-card">
              <nav
                class="visit-nav"
                aria-label="Визиты бригады"
              >
                <template v-if="selectedRoutePosition">
                  <UiButton
                    icon
                    size="sm"
                    aria-label="Предыдущий визит бригады"
                    :disabled="selectedRoutePosition.previousOrderId === undefined"
                    @click="emit('select', selectedRoutePosition.previousOrderId)"
                  >
                    <UiIcon name="chevron-left" />
                  </UiButton>
                  <span class="visit-nav__position">
                    Визит {{ selectedRoutePosition.number }} из {{ selectedRoutePosition.total }}
                  </span>
                  <UiButton
                    icon
                    size="sm"
                    aria-label="Следующий визит бригады"
                    :disabled="selectedRoutePosition.nextOrderId === undefined"
                    @click="emit('select', selectedRoutePosition.nextOrderId)"
                  >
                    <UiIcon name="chevron-right" />
                  </UiButton>
                </template>
                <UiButton
                  class="visit-nav__close"
                  icon
                  size="sm"
                  variant="ghost"
                  aria-label="Закрыть визит и показать все бригады"
                  @click="emit('select', undefined)"
                >
                  <UiIcon name="close" />
                </UiButton>
              </nav>
              <div class="order-card__title">
                <span
                  class="tag"
                  :class="{ 'tag--danger': selectedOrder.priority === 'emergency' }"
                >
                  <UiIcon
                    v-if="selectedOrder.priority === 'emergency'"
                    name="bolt"
                  />
                  {{ priorityLabels[selectedOrder.priority] }}
                </span>
                <span
                  class="status"
                  :class="selectedUnassigned ? 'status--danger' : 'status--success'"
                >
                  {{ selectedStatus }}
                </span>
              </div>
              <h2 class="order-card__address">{{ selectedOrder.address }}</h2>
              <p
                v-if="'hdType' in selectedOrder && selectedOrder.hdType"
                class="order-card__work"
              >
                {{ workLabel(selectedOrder) }}
              </p>
              <p
                v-if="selectedOrder.priority === 'emergency'"
                class="order-card__note"
              >
                Норматив аварийных работ — 100 мин
              </p>
              <div class="visit-time">
                <p class="visit-time__label">
                  {{ selectedVisit ? 'Время визита' : 'Окно заявки' }}
                </p>
                <div class="visit-time__range">
                  <strong class="visit-time__interval">
                    {{
                      selectedVisit
                        ? formatMinute(selectedVisit.startMin)
                        : selectedOrder.window.start
                    }}–{{
                      selectedVisit ? formatMinute(selectedVisit.endMin) : selectedOrder.window.end
                    }}
                  </strong>
                  <span class="visit-time__duration">
                    {{ selectedOrder.durationMin }} мин работы
                  </span>
                </div>
                <VisitWindow
                  :window-start="parseClock(selectedOrder.window.start)"
                  :window-end="parseClock(selectedOrder.window.end)"
                  :visit="selectedVisit"
                  :color="
                    selectedVisit
                      ? engineerFills.get(selectedVisit.explanation.engineerId)
                      : undefined
                  "
                  :edge="
                    selectedVisit
                      ? engineerColors.get(selectedVisit.explanation.engineerId)
                      : undefined
                  "
                />
                <p
                  v-if="selectedVisit"
                  class="visit-time__window"
                >
                  Пунктир — окно заявки {{ selectedOrder.window.start }}–{{
                    selectedOrder.window.end
                  }}, штриховка — ожидание после прибытия
                </p>
              </div>
              <div
                v-if="selectedVisit"
                class="order-card__engineer"
              >
                <i
                  class="order-card__crew"
                  :style="{
                    background: engineerColors.get(selectedVisit.explanation.engineerId),
                  }"
                  aria-hidden="true"
                ></i>
                <strong>{{ engineers.get(selectedVisit.explanation.engineerId)?.name }}</strong>
                <span>
                  Прибытие {{ formatMinute(selectedVisit.arrivalMin) }} · резерв до начала визита
                  {{ selectedVisit.waitMin }} мин
                </span>
              </div>
              <div
                v-if="selectedVisit && !selectedUnassigned"
                class="order-card__summary"
              >
                <dl class="facts">
                  <div class="facts__row">
                    <dt>Навык</dt>
                    <dd>{{ skillLabels[selectedVisit.explanation.requiredSkill] }}</dd>
                  </div>
                  <div class="facts__row">
                    <dt>Транспорт</dt>
                    <dd>
                      {{ selectedEngineer ? transportLabels[selectedEngineer.transport] : '—' }}
                    </dd>
                  </div>
                  <div class="facts__row">
                    <dt>Добавленный пробег</dt>
                    <dd>
                      {{
                        selectedVisit.explanation.addedDistance.status === 'defined'
                          ? formatDistance(selectedVisit.explanation.addedDistance.distanceM)
                          : 'не определён'
                      }}{{ selectedVisit.explanation.approximate ? ' (приближённо)' : '' }}
                    </dd>
                  </div>
                </dl>
                <div class="order-card__alternatives">
                  <h3>Другие варианты</h3>
                  <p v-if="typeof alternativeSummary === 'string'">{{ alternativeSummary }}</p>
                  <ul v-else>
                    <li
                      v-for="line in alternativeSummary"
                      :key="line.id"
                    >
                      {{ line.text }}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <p
              v-if="selectedInterrupted && selectedHistory && replan"
              class="order-history"
            >
              {{ selectedHistory.state === 'interrupted' ? 'Работа прервана' : 'Выезд прерван' }}
              в {{ formatMinute(selectedHistory.recordedAtMin ?? replan.event.atMin) }}. Прежний
              инженер: {{ engineers.get(selectedHistory.engineerId)?.name }}.
              {{
                selectedHistory.state === 'interrupted'
                  ? 'Заявка переоткрыта с полной длительностью.'
                  : 'Заявка возвращена в планирование.'
              }}
            </p>
            <div
              v-if="
                selectedOrder.id === cancelledOrderId && !(selectedVisit && !selectedUnassigned)
              "
              class="explanation explanation--inset"
            >
              <h3>Причина</h3>
              <p>Заявка отменена диспетчером и исключена из остаточного планирования.</p>
            </div>
            <div
              v-else-if="selectedUnassigned && !(selectedVisit && !selectedUnassigned)"
              class="explanation explanation--warning"
            >
              <h3>Почему без назначения</h3>
              <p>{{ unassignedReason(selectedUnassigned) }}</p>
              <p>
                {{ selectedUnassigned.withSkill }} с квалификацией,
                {{ selectedUnassigned.withSkillAndTransport }} также с нужным транспортом.
              </p>
              <ul class="rejections">
                <li
                  v-for="rejection in selectedUnassigned.rejections"
                  :key="rejection.engineerId"
                >
                  {{ engineers.get(rejection.engineerId)?.name ?? rejection.engineerId }} —
                  {{ rejectionLabels[rejection.code] }}
                  <template v-if="rejection.earliestStartMin !== undefined">
                    (не раньше {{ formatMinute(rejection.earliestStartMin) }})
                  </template>
                  <template v-if="rejection.code === 'equipment'">
                    (нужно {{ rejection.requiredUnits }}, доступно {{ rejection.availableUnits }})
                  </template>
                </li>
              </ul>
            </div>
            <AssignmentOptions
              v-if="selectedUnassigned && replan === undefined && visibleKind === 'optimized'"
              :options="assignmentOptions"
              :busy="busy ?? false"
              @inspect="emit('inspectOptions', selectedOrder.id)"
              @assign="emit('assignManually', selectedOrder.id, $event)"
            />
            <UiDisclosure
              v-if="selectedVisit && !selectedUnassigned"
              :key="selectedOrder.id"
              title="Почему выбран этот маршрут"
              data-tour="explanation"
              class="order-details"
            >
              <div class="rationale">
                <p
                  v-if="selectedHistory && !selectedInterrupted"
                  class="rationale__lead"
                >
                  {{
                    selectedHistory.state.startsWith('cancelled')
                      ? 'Отмена зафиксирована в истории вместе с уже выполненным перемещением.'
                      : 'Визит начался до события и зафиксирован в истории; перепланирование его не изменяет.'
                  }}
                </p>
                <p
                  v-else-if="selectedManualAssignment"
                  class="rationale__lead"
                >
                  Назначено диспетчером. Проверены ограничения; выбрана допустимая позиция с
                  наименьшим пробегом маршрута выбранного инженера без перестановки остальных
                  визитов.
                </p>
                <p
                  v-else-if="visibleKind === 'baseline' && !replan"
                  class="rationale__lead"
                >
                  Базовый алгоритм обрабатывает заявки по порядку поступления и добавляет каждую в
                  конец маршрута первого подходящего инженера во входном списке.
                </p>
                <div
                  v-else
                  class="rationale__lead"
                >
                  <p>
                    Алгоритм пробует вставлять заявки в маршруты, менять исполнителей и порядок
                    визитов с учётом квалификации, транспорта, комплектов, переездов, окон заявок и
                    рабочих смен.
                    {{
                      replan
                        ? 'После события поиск учитывает зафиксированную часть дня и стремится меньше менять прежние назначения.'
                        : 'При одинаковом охвате заявок по приоритетам предпочтение отдаётся меньшему числу бригад, затем меньшему общему пробегу.'
                    }}
                  </p>
                  <p>
                    Приоритеты ниже сравниваются по порядку: меньший пробег не оправдывает ухудшение
                    более важного показателя. Поэтому ближайшая бригада не всегда предпочтительна
                    для плана в целом.
                  </p>
                  <span class="rationale__caption">
                    {{ replan ? 'Приоритеты остаточного плана' : 'Приоритеты плана' }}
                  </span>
                  <ol class="rationale__priorities">
                    <li>Меньше неназначенных аварий</li>
                    <li>Меньше неназначенных подключений</li>
                    <li>Меньше неназначенных заявок</li>
                    <template v-if="replan">
                      <li>Меньше изменений прежних назначений, времени и порядка визитов</li>
                      <li>Меньший пробег</li>
                    </template>
                    <template v-else>
                      <li>При одинаковом охвате — меньше инженеров</li>
                      <li>Затем меньший пробег</li>
                    </template>
                  </ol>
                </div>
                <p
                  v-if="
                    !selectedManualAssignment &&
                    (replan || visibleKind === 'optimized') &&
                    (!selectedHistory || selectedInterrupted)
                  "
                  class="rationale__caveat"
                >
                  Поиск эвристический; глобальный оптимум не доказан.
                </p>
                <template v-if="selectedStatus !== 'Отменена'">
                  <span class="rationale__caption">Проверенные ограничения</span>
                  <ul class="rationale__checks">
                    <li class="rationale__check">
                      <UiIcon
                        name="check"
                        class="rationale__mark"
                      />
                      <span class="rationale__name">Квалификация</span>
                      <strong>{{ skillLabels[selectedVisit.explanation.requiredSkill] }}</strong>
                      <small>Требуемый навык есть у инженера</small>
                    </li>
                    <li class="rationale__check">
                      <UiIcon
                        name="check"
                        class="rationale__mark"
                      />
                      <span class="rationale__name">Транспорт</span>
                      <strong>
                        {{ selectedEngineer ? transportLabels[selectedEngineer.transport] : '—' }}
                      </strong>
                      <small>
                        {{
                          selectedVisit.explanation.requiredTransport
                            ? `Требуется: ${transportLabels[selectedVisit.explanation.requiredTransport]}`
                            : 'Ограничение по транспорту не задано'
                        }}
                      </small>
                    </li>
                    <li class="rationale__check">
                      <UiIcon
                        name="check"
                        class="rationale__mark"
                      />
                      <span class="rationale__name">Время и смена</span>
                      <strong>
                        {{ formatMinute(selectedVisit.explanation.startMin) }}–{{
                          formatMinute(selectedVisit.explanation.endMin)
                        }}
                      </strong>
                      <small>
                        В окне {{ selectedOrder.window.start }}–{{ selectedOrder.window.end }},
                        смена до {{ selectedEngineer?.shift.end }}. Резерв после прибытия до начала
                        визита {{ selectedVisit.explanation.waitMin }} мин.
                      </small>
                    </li>
                    <li class="rationale__check">
                      <UiIcon
                        name="check"
                        class="rationale__mark"
                      />
                      <span class="rationale__name">Оборудование</span>
                      <template v-if="selectedEquipment.length === 0">
                        <strong>Не задано</strong>
                        <small>Расход оборудования для этой заявки не задан</small>
                      </template>
                      <template v-else>
                        <strong>
                          {{
                            selectedEquipment
                              .map((item) => `${item.label} × ${item.used}`)
                              .join(', ')
                          }}
                        </strong>
                        <small>
                          Плановый остаток после начала работы:
                          {{
                            selectedEquipment
                              .map((item) => `${item.label.toLowerCase()} ${item.remaining}`)
                              .join(', ')
                          }}
                        </small>
                      </template>
                    </li>
                  </ul>
                  <template v-if="selectedRoutePosition">
                    <span class="rationale__caption">
                      Порядок визитов{{ replan ? ' в остатке дня' : '' }}
                    </span>
                    <ol class="rationale__route">
                      <li class="rationale__stop">
                        <small class="rationale__step">
                          {{ selectedRoutePosition.previous ? 'Перед этим' : 'Отправление' }}
                        </small>
                        {{
                          selectedRoutePosition.previous ??
                          (replan ? 'Точка продолжения маршрута' : 'Стартовая точка инженера')
                        }}
                      </li>
                      <li class="rationale__stop rationale__stop--current">
                        <small class="rationale__step rationale__step--current">
                          Визит № {{ selectedRoutePosition.number }}
                        </small>
                        {{ selectedOrder.address }}
                      </li>
                      <li class="rationale__stop">
                        <small class="rationale__step">
                          {{ selectedRoutePosition.next ? 'Далее' : 'Конец маршрута' }}
                        </small>
                        {{ selectedRoutePosition.next ?? 'Последний визит; возврат не требуется' }}
                      </li>
                    </ol>
                  </template>
                  <div class="rationale__distance">
                    <span class="rationale__caption">Добавленный пробег</span>
                    <strong>
                      {{
                        selectedVisit.explanation.addedDistance.status === 'defined'
                          ? formatDistance(selectedVisit.explanation.addedDistance.distanceM)
                          : 'Не определён'
                      }}
                    </strong>
                    <small class="rationale__footnote">
                      Разница с тем же маршрутом без этой заявки. Это не сравнение со всеми другими
                      инженерами.
                    </small>
                  </div>
                </template>
                <p
                  v-if="selectedVisit.explanation.approximate"
                  class="rationale__caveat"
                >
                  Маршрут и время рассчитаны приближённо.
                </p>
              </div>
            </UiDisclosure>
            <UiDisclosure
              v-if="replan === undefined && visibleKind === 'optimized'"
              :key="`manual-${selectedOrder.id}`"
              title="Назначить вручную"
              data-tour="manual"
              class="order-details"
            >
              <div class="manual-assignment">
                <p class="manual-assignment__intro">
                  Время подберём сами: визит встанет в допустимую позицию с наименьшим пробегом,
                  остальные визиты бригады не переставляются.
                </p>
                <UiChoiceList
                  :model-value="manualEngineerId"
                  label="Инженер для назначения"
                  dense
                  :options="
                    engineerChoices(dataset.engineers, selectedVisit?.explanation.engineerId)
                  "
                  @update:model-value="manualEngineerId = $event"
                />
                <div class="manual-assignment__footer">
                  <UiButton
                    variant="primary"
                    :disabled="manualEngineerId === undefined"
                    class="manual-assignment__submit"
                    @click="applyManualAssignment"
                  >
                    <UiIcon name="check" />
                    {{
                      manualEngineerId === undefined
                        ? 'Выберите бригаду'
                        : `Проверить и назначить: ${engineers.get(manualEngineerId)?.name}`
                    }}
                  </UiButton>
                  <p
                    v-if="selectedManualAssignment"
                    class="manual-assignment__result"
                    role="status"
                  >
                    Последнее действие применено к
                    {{ engineers.get(selectedManualAssignment.engineerId)?.name }}.
                  </p>
                </div>
              </div>
            </UiDisclosure>
            <UiCopyValue
              label="Номер заявки"
              :value="selectedOrder.id"
            />
          </template>
          <template v-else>
            <header class="stage__inspector-head">
              <h2>Бригады дня</h2>
            </header>
            <CrewRoster
              :rows="crewRows"
              @select="emit('select', $event)"
              @hover="hoveredCrew = $event"
            />
          </template>
        </aside>
      </section>

      <PlanningSchedule
        v-if="view === 'plan'"
        :dataset
        :plan
        :replan
        :orders
        :unassigned-reasons="
          new Map(plan.unassigned.map((item) => [item.orderId, unassignedReason(item)]))
        "
        :can-assign="replan === undefined && visibleKind === 'optimized'"
        @assign="(orderId, engineerId) => emit('assignManually', orderId, engineerId)"
        :selected-order-id
        @select="emit('select', $event)"
        @hover="hoveredCrew = $event"
      />

      <template v-if="view === 'events'">
        <section
          class="panel day-panel"
          data-tour="day"
        >
          <header class="panel__header">
            <div>
              <h2>{{ replan ? 'День после события' : 'Ход дня' }}</h2>
              <p class="panel__meta">
                До события:
                {{
                  replan
                    ? `${replan.history.length} ${plural(replan.history.length, ['запись', 'записи', 'записей'])} истории`
                    : `${completedBeforeEvent.length} ${plural(completedBeforeEvent.length, ['визит завершён', 'визита завершены', 'визитов завершены'])}`
                }}.
              </p>
            </div>
          </header>
          <div class="day-panel__ruler">
            <DayRuler
              :start="shiftRange.start"
              :end="shiftRange.end"
              :at-min="rulerAt"
              :visits="rulerVisits.visits"
              :rows="rulerVisits.rows"
            />
          </div>
        </section>
        <div class="workspace__stage">
          <div class="workspace__stack">
            <div
              v-if="isConflict"
              class="scenario-note"
            >
              <p>
                Учебный день команды на точках Востока. Ближайшая бригада без комплекта; бригада с
                комплектом занята до 14:10. Примените подготовленную аварию в 13:30 и проверьте
                изменение визита клиента. Это отдельный модельный сценарий, не исходная выгрузка.
                Все работы расположены в одном здании; комплект получен до начала смены, в том числе
                бригадой со стартом на месте.
              </p>
              <p v-if="!replan">
                До события выберите неназначенную замену роутера и нажмите «Проверить варианты»:
                система проверит дополнительный утренний комплект и привлечение бригады.
              </p>
            </div>
            <section
              v-if="preparedEvent"
              class="workspace__event panel"
              data-tour="event"
            >
              <header class="panel__header">
                <h2>Перепланирование остатка дня</h2>
                <span class="panel__meta">
                  Событие в
                  {{
                    replan
                      ? formatMinute(replan.event.atMin)
                      : activeEventAtMin === undefined
                        ? '—'
                        : formatMinute(activeEventAtMin)
                  }}
                </span>
              </header>
              <div
                v-if="replan === undefined"
                class="event"
              >
                <UiChoiceList
                  :model-value="eventKind"
                  label="Событие"
                  class="event__kinds"
                  :options="eventKinds"
                  @update:model-value="eventKind = $event ?? eventKind"
                />
                <div
                  v-if="eventKind === 'urgent-order'"
                  class="event__row"
                >
                  <span class="event__label">Место аварии</span>
                  <UiSegmented
                    v-model="urgentSource"
                    label="Источник аварии"
                    :options="[
                      { value: 'prepared', label: 'Из сценария' },
                      { value: 'custom', label: 'Новая точка' },
                    ]"
                  />
                </div>
                <label
                  v-if="eventKind === 'cancel-order'"
                  class="ui-field"
                >
                  <span class="ui-field__label">Какую заявку отменить</span>
                  <UiCombobox
                    :model-value="cancellationTargetId ?? cancellableOrders[0]?.id"
                    label="Заявка для отмены"
                    :options="
                      cancellableOrders.map((order) => ({
                        value: order.id,
                        label: order.address,
                        description: `Заявка № ${order.id} · ${priorityLabels[order.priority]}`,
                      }))
                    "
                    @update:model-value="cancellationTargetId = $event"
                  />
                </label>
                <div
                  v-else-if="eventKind === 'engineer-unavailable'"
                  class="ui-field"
                >
                  <span class="ui-field__label">Какая бригада выбывает</span>
                  <UiChoiceList
                    :model-value="unavailableEngineerId ?? availableEngineers[0]?.id"
                    label="Недоступный инженер"
                    :options="engineerChoices(availableEngineers)"
                    @update:model-value="unavailableEngineerId = $event"
                  />
                </div>
                <div
                  v-else-if="urgentSource === 'custom'"
                  class="event__custom"
                >
                  <label class="ui-field event__wide">
                    <span class="ui-field__label">Адрес</span>
                    <UiInput v-model="customUrgent.address" />
                  </label>
                  <label class="ui-field">
                    <span class="ui-field__label">Номер заявки</span>
                    <UiInput v-model="customUrgent.id" />
                  </label>
                  <label class="ui-field">
                    <span class="ui-field__label">Широта</span>
                    <UiInput
                      v-model="customUrgent.lat"
                      inputmode="decimal"
                    />
                  </label>
                  <label class="ui-field">
                    <span class="ui-field__label">Долгота</span>
                    <UiInput
                      v-model="customUrgent.lon"
                      inputmode="decimal"
                    />
                  </label>
                  <label class="ui-field">
                    <span class="ui-field__label">Время события</span>
                    <UiTimeField
                      v-model="customUrgent.at"
                      label="Время события"
                    />
                  </label>
                  <label class="ui-field">
                    <span class="ui-field__label">Окно с</span>
                    <UiTimeField
                      v-model="customUrgent.windowStart"
                      label="Начало окна"
                    />
                  </label>
                  <label class="ui-field">
                    <span class="ui-field__label">Окно до</span>
                    <UiTimeField
                      v-model="customUrgent.windowEnd"
                      label="Конец окна"
                    />
                  </label>
                  <p
                    v-if="!customUrgentValid"
                    class="event__validation"
                    role="alert"
                  >
                    Проверьте уникальный номер, координаты, время события в пределах смены и границы
                    окна.
                  </p>
                </div>
                <div
                  v-else
                  class="event__prepared"
                >
                  <UiIcon name="pin" />
                  <span>
                    <strong>{{ preparedEvent.order.address }}</strong>
                    <small>
                      Окно {{ preparedEvent.order.window.start }}–{{
                        preparedEvent.order.window.end
                      }}
                      · поступает в {{ preparedEvent.at }}
                    </small>
                  </span>
                </div>
              </div>
              <footer
                v-if="replan === undefined && visibleKind === 'optimized'"
                class="event__footer"
              >
                <p
                  id="event-confirmation"
                  class="event__confirmation"
                >
                  Применяя событие, подтверждаю выполненные визиты:
                  <strong>{{ completedBeforeEvent.length }}</strong>
                </p>
                <UiButton
                  aria-describedby="event-confirmation"
                  variant="primary"
                  :disabled="
                    (eventKind === 'urgent-order' &&
                      urgentSource === 'custom' &&
                      !customUrgentValid) ||
                    (eventKind === 'cancel-order' && !cancellableOrders.length) ||
                    (eventKind === 'engineer-unavailable' && !availableEngineers.length)
                  "
                  @click="applyEvent"
                >
                  <UiIcon name="bolt" />
                  Применить событие
                </UiButton>
              </footer>
              <p
                v-else-if="replan === undefined"
                class="event__hint"
              >
                Для перепланирования откройте улучшенный план.
              </p>
              <div
                v-else
                class="event-result"
              >
                <strong>{{ replan.affectedOrderCount }}</strong>
                {{
                  plural(replan.affectedOrderCount, [
                    'прежняя заявка затронута',
                    'прежние заявки затронуты',
                    'прежних заявок затронуто',
                  ])
                }}
                · {{ replan.history.length }}
                {{ plural(replan.history.length, ['запись', 'записи', 'записей']) }} истории
              </div>
            </section>
            <section
              v-if="replan"
              class="panel"
            >
              <header class="panel__header">
                <h2>Изменения относительно плана до события</h2>
              </header>
              <div class="change-list">
                <p
                  v-if="replan.changes.length === 0"
                  class="change-list__empty"
                >
                  Изменений нет.
                </p>
                <div
                  v-for="change in replan.changes"
                  :key="`${change.orderId}-${change.kind}`"
                  class="change-list__item"
                >
                  <strong>{{ change.orderId }}</strong>
                  <span
                    v-if="change.kind === 'new-assignment'"
                    class="change-list__text"
                  >
                    Новая заявка назначена: {{ engineers.get(change.engineerId!)?.name }} ·
                    {{ formatMinute(change.startMin!) }}
                  </span>
                  <span
                    v-else-if="change.kind === 'new-unassigned'"
                    class="change-list__text"
                  >
                    Для новой аварии не найдено допустимого назначения
                  </span>
                  <span
                    v-else-if="change.kind === 'engineer-changed'"
                    class="change-list__text"
                  >
                    Инженер изменён: {{ engineers.get(change.previousEngineerId!)?.name }} →
                    {{ engineers.get(change.engineerId!)?.name }} ·
                    {{ formatMinute(change.previousStartMin!) }} →
                    {{ formatMinute(change.startMin!) }}
                    <template v-if="change.reordered">· порядок изменён</template>
                  </span>
                  <span
                    v-else-if="change.kind === 'unassigned'"
                    class="change-list__text"
                  >
                    Снята с маршрута: в остаточном плане не найдено допустимого места
                  </span>
                  <span
                    v-else-if="change.kind === 'cancelled'"
                    class="change-list__text"
                  >
                    Заявка отменена диспетчером
                  </span>
                  <span
                    v-else-if="change.kind === 'interrupted'"
                    class="change-list__text"
                  >
                    Работа прервана и переоткрыта с полной длительностью
                  </span>
                  <span
                    v-else-if="change.kind === 'time-changed'"
                    class="change-list__text"
                  >
                    Время: {{ formatMinute(change.previousStartMin!) }} →
                    {{ formatMinute(change.startMin!) }}
                    <template v-if="change.reordered && change.timeChanged">
                      · порядок изменён
                    </template>
                  </span>
                  <span
                    v-else
                    class="change-list__text"
                  >
                    Порядок изменён
                  </span>
                </div>
              </div>
              <div class="equipment-balance">
                <h3>Аварийные комплекты после события</h3>
                <span
                  v-for="balance in replan.equipment.filter(
                    (item) => item.actualAtEvent['emergency-kit'] > 0,
                  )"
                  :key="balance.engineerId"
                  class="equipment-balance__item"
                >
                  {{ engineers.get(balance.engineerId)?.name }}:
                  {{ balance.actualAtEvent['emergency-kit'] }} фактически →
                  {{ balance.availableAfterCommitments['emergency-kit'] }} после резерва →
                  {{ balance.afterPlan['emergency-kit'] }} после плана
                </span>
              </div>
            </section>
            <PlanningOperations
              data-tour="operations"
              v-if="visibleKind === 'optimized'"
              :dataset
              :plan
              :replan
              :agreements="agreements ?? []"
              :conflict="promiseConflict"
              :selected-order-id
              :busy="busy ?? false"
              @confirm="emit('confirmTime', $event)"
              @release="emit('releaseTime', $event)"
              @resolve="emit('resolveConflict')"
              @event="(event, facts) => emit('replan', event, facts)"
            />
          </div>
          <aside class="workspace__side panel">
            <header class="panel__header">
              <h2>История событий</h2>
            </header>
            <p
              v-if="!events?.length"
              class="workspace__empty"
            >
              Событий пока нет.
            </p>
            <ol
              v-else
              class="timeline"
            >
              <li
                v-for="(event, index) in events"
                :key="index"
                class="timeline__item"
              >
                <span class="timeline__icon">
                  <UiIcon
                    :name="
                      event.kind === 'urgent-order'
                        ? 'bolt'
                        : event.kind === 'cancel-order'
                          ? 'cancel'
                          : 'user-off'
                    "
                  />
                </span>
                <span class="timeline__text">
                  <strong>
                    {{
                      event.kind === 'urgent-order'
                        ? 'Новая авария'
                        : event.kind === 'cancel-order'
                          ? 'Отмена заявки'
                          : 'Инженер недоступен'
                    }}
                  </strong>
                  <span>
                    {{ formatMinute(event.atMin) }} ·
                    {{
                      event.kind === 'urgent-order'
                        ? event.order.id
                        : event.kind === 'cancel-order'
                          ? event.orderId
                          : engineers.get(event.engineerId)?.name
                    }}
                  </span>
                </span>
              </li>
            </ol>
          </aside>
        </div>
      </template>

      <div
        v-if="view === 'analysis'"
        class="workspace__stage"
      >
        <div class="workspace__stack">
          <section
            class="workspace__comparison panel"
            data-tour="comparison"
          >
            <header class="panel__header">
              <h2>{{ replan ? 'Итог дня после события' : 'Базовый план против улучшенного' }}</h2>
              <span
                v-if="replan === undefined"
                class="status"
                :class="
                  comparison.result === 'better'
                    ? 'status--success'
                    : comparison.result === 'equal'
                      ? 'status--info'
                      : 'status--danger'
                "
              >
                {{
                  comparison.result === 'better'
                    ? 'Улучшение'
                    : comparison.result === 'equal'
                      ? 'Равный результат'
                      : 'Ухудшение'
                }}
              </span>
            </header>
            <div
              v-if="replan === undefined"
              class="versus"
            >
              <div class="versus__side">
                <h3>Базовый</h3>
                <p>По порядку поступления, в конец маршрута первого подходящего</p>
              </div>
              <span
                class="versus__arrow"
                aria-hidden="true"
              >
                <UiIcon name="arrow" />
              </span>
              <div class="versus__side versus__side--accent">
                <h3>Улучшенный</h3>
                <p>Поиск по охвату, затем по числу инженеров и пробегу</p>
              </div>
              <template
                v-for="row in [
                  {
                    label: 'Назначено',
                    base: String(dataset.orders.length - baseline.metrics.unassignedTotal),
                    next: String(dataset.orders.length - optimized.metrics.unassignedTotal),
                  },
                  {
                    label: 'Инженеров',
                    base: String(baseline.metrics.engineersUsed),
                    next: String(optimized.metrics.engineersUsed),
                  },
                  {
                    label: 'Пробег',
                    base: formatDistance(baseline.metrics.distanceM),
                    next: formatDistance(optimized.metrics.distanceM),
                  },
                ]"
                :key="row.label"
              >
                <p class="versus__value">
                  <small>{{ row.label }}</small>
                  {{ row.base }}
                </p>
                <span></span>
                <p class="versus__value versus__value--accent">
                  <small>{{ row.label }}</small>
                  {{ row.next }}
                </p>
              </template>
            </div>
            <div
              v-if="replan === undefined"
              class="comparison-grid"
            >
              <div class="comparison-grid__item">
                <span>Аварий без назначения</span>
                <strong>{{ comparison.delta.unassignedEmergency }}</strong>
              </div>
              <div class="comparison-grid__item">
                <span>Подключений без назначения</span>
                <strong>{{ comparison.delta.unassignedConnection }}</strong>
              </div>
              <div class="comparison-grid__item">
                <span>Всего без назначения</span>
                <strong>{{ comparison.delta.unassignedTotal }}</strong>
              </div>
            </div>
            <div
              v-if="replan === undefined"
              class="plan-comparison"
            >
              <table class="plan-comparison__table">
                <caption>Обязательные метрики: базовый и улучшенный планы</caption>
                <thead>
                  <tr>
                    <th scope="col">Показатель</th>
                    <th scope="col">Базовый</th>
                    <th scope="col">Улучшенный</th>
                    <th scope="col">Разница</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Задействовано инженеров</th>
                    <td>{{ baseline.metrics.engineersUsed }}</td>
                    <td>{{ optimized.metrics.engineersUsed }}</td>
                    <td>
                      {{ comparison.delta.engineersUsed > 0 ? '+' : ''
                      }}{{ comparison.delta.engineersUsed }}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Нижняя граница числа инженеров</th>
                    <td
                      colspan="3"
                      class="plan-comparison__bound"
                    >
                      {{ lowerBound.engineers }} — меньшим составом нельзя выполнить
                      {{
                        lowerBound.orders === dataset.orders.length
                          ? 'все заявки'
                          : `вместе все ${lowerBound.orders} ${plural(lowerBound.orders, ['заявку', 'заявки', 'заявок'])}, для которых есть совместимая бригада и допустимое время`
                      }}. Сравниваются работа, кратчайшие переезды и окна со временем смен; граница
                      может быть недостижимой, но не завышена.
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Общий пробег</th>
                    <td>{{ formatDistance(baseline.metrics.distanceM) }}</td>
                    <td>{{ formatDistance(optimized.metrics.distanceM) }}</td>
                    <td>{{ formatDistance(comparison.delta.distanceM, true) }}</td>
                  </tr>
                  <tr
                    v-for="item in engineerComparison"
                    :key="item.engineerId"
                  >
                    <th scope="row">
                      <span class="plan-comparison__crew">
                        <i
                          :style="{ background: engineerColors.get(item.engineerId) }"
                          aria-hidden="true"
                        ></i>
                        {{ item.name }}
                      </span>
                    </th>
                    <td>{{ formatDistance(item.baseline) }}</td>
                    <td>{{ formatDistance(item.optimized) }}</td>
                    <td>
                      <span class="plan-comparison__delta">
                        <span
                          class="plan-comparison__bar"
                          :class="{ 'plan-comparison__bar--up': item.distanceM > 0 }"
                          :style="{
                            width: `${Math.min(100, (Math.abs(item.distanceM) / Math.max(1, ...engineerComparison.map((row) => Math.abs(row.distanceM)))) * 100)}%`,
                          }"
                          aria-hidden="true"
                        ></span>
                        {{ formatDistance(item.distanceM, true) }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p class="plan-comparison__note">
                Разница = улучшенный − базовый. Отрицательное значение означает уменьшение. Строки с
                именами — пробег каждого инженера.
              </p>
            </div>
            <p
              v-else
              class="panel__text"
            >
              Назначено за день: {{ replan.dayMetrics.assigned }}, без назначения:
              {{ replan.dayMetrics.unassigned }}. Изменения по заявкам — в разделе «События».
            </p>
            <UiDisclosure
              title="Детали расчёта"
              class="calculation-details"
            >
              <p class="technical">
                Нарушений модели: {{ violations }} ·
                {{ search.candidateChecks.toLocaleString('ru-RU') }} проверок маршрута ·
                {{ Math.round(elapsedMs) }} мс · время в пути: подготовленные матрицы OSRM{{
                  plan.metrics.approximate ? ', есть приближённые рёбра' : ''
                }}.
              </p>
            </UiDisclosure>
          </section>
          <section
            v-if="
              selectedOrder &&
              selectedVisit &&
              visibleKind === 'optimized' &&
              (!replan || replan.checkpoint?.orders.some((o) => o.id === selectedOrderId))
            "
            class="panel"
          >
            <UiDisclosure
              title="Проверить последствия задержки"
              :description="selectedOrder.address"
            >
              <div class="delay-check">
                <p>
                  Увеличиваем длительность этой работы, сохраняем порядок маршрута. Это сценарий, не
                  прогноз вероятности.
                </p>
                <div class="delay-check__actions">
                  <UiButton
                    v-for="minutes in [15, 30, 60]"
                    :key="minutes"
                    size="sm"
                    @click="emit('inspectDelay', selectedOrder!.id, minutes)"
                  >
                    +{{ minutes }} мин
                  </UiButton>
                </div>
                <template v-if="delay">
                  <p v-if="delay.approximate">Переезды приближённые.</p>
                  <ul class="delay-check__list">
                    <li
                      v-for="visit in delay.visits"
                      :key="visit.orderId"
                    >
                      {{ orders.get(visit.orderId)?.address ?? visit.orderId }}:
                      {{ formatMinute(visit.previousStartMin) }} →
                      {{ formatMinute(visit.startMin) }}, окончание
                      {{ formatMinute(visit.endMin) }}.
                      {{ visit.windowMissed ? 'За пределами окна.' : 'В окне.' }}
                      {{ visit.shiftMissed ? 'За пределами смены.' : '' }}
                      {{
                        visit.promiseMissed
                          ? 'Подтверждённое время нарушено — нужно пересогласовать.'
                          : ''
                      }}
                    </li>
                  </ul>
                </template>
              </div>
            </UiDisclosure>
          </section>
          <section
            v-if="!replan && visibleKind === 'optimized'"
            class="panel"
          >
            <UiDisclosure
              title="Запас прочности и утренние комплекты"
              data-tour="readiness"
              description="Проверочные аварии по адресам и времени дня"
            >
              <PlanningReadiness
                :key="dataset.title"
                :dataset
                :busy="analysisBusy ?? false"
                :report="readiness"
                :equipment="equipmentPreparation"
                @run="(kind, probes) => emit('runAnalysis', kind, probes)"
                @cancel="emit('cancelAnalysis')"
                @apply="emit('applyEquipment')"
              />
            </UiDisclosure>
          </section>
        </div>
        <aside
          class="workspace__settings workspace__side panel"
          data-tour="assumptions"
        >
          <header class="panel__header">
            <h2>Допущения модели</h2>
          </header>
          <dl class="facts facts--stacked assumptions">
            <div class="facts__row">
              <dt>Авария</dt>
              <dd>
                {{ dataset.assumptions.emergencyDurationMin }} минут
                <span>уточнение организаторов</span>
              </dd>
            </div>
            <div class="facts__row">
              <dt>Приоритет</dt>
              <dd>
                Авария → Подключение → Ремонт / Дозаказ
                <span>уточнение организаторов</span>
              </dd>
            </div>
            <div class="facts__row">
              <dt>Доступность</dt>
              <dd>
                с начала смены
                <span>принято командой из-за отсутствия времени в CSV</span>
              </dd>
            </div>
            <div class="facts__row">
              <dt>Общественный транспорт</dt>
              <dd>
                {{ dataset.assumptions.travelModel.publicTransport.speedKmh }} км/ч +
                {{ dataset.assumptions.travelModel.publicTransport.transferMin }} мин
                <span>принято командой</span>
              </dd>
            </div>
            <div class="facts__row">
              <dt>Длительности прочих работ</dt>
              <dd>
                {{
                  Object.entries(dataset.assumptions.durationMinByHdType)
                    .map(([name, minutes]) => `${workTypeLabel(name)}: ${minutes} мин`)
                    .join(' · ')
                }}
                <span>принято командой</span>
              </dd>
            </div>
            <div class="facts__row">
              <dt>Квалификации</dt>
              <dd>
                {{
                  Object.entries(dataset.assumptions.skillByBkType)
                    .map(([name, skill]) => `${name}: ${skillLabels[skill]}`)
                    .join(' · ')
                }}
                <span>принято командой</span>
              </dd>
            </div>
            <div class="facts__row">
              <dt>Требование автомобиля</dt>
              <dd>
                {{
                  dataset.assumptions.carRequiredHdTypes.map(workTypeLabel).join(', ') ||
                  'не задано'
                }}
                <span>принято командой</span>
              </dd>
            </div>
            <div class="facts__row">
              <dt>Дневной комплект</dt>
              <dd>
                аварийный комплект
                {{ dataset.assumptions.equipmentPerQualifiedEngineer['emergency-kit'] }}, роутеры
                {{ dataset.assumptions.equipmentPerQualifiedEngineer.router }}, ТВ-приставки
                {{ dataset.assumptions.equipmentPerQualifiedEngineer['tv-box'] }}, кабельные
                комплекты
                {{ dataset.assumptions.equipmentPerQualifiedEngineer['cable-kit'] }}
                <span>принято командой; расход не восстанавливается при пересчёте</span>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  </main>
</template>
