<script setup lang="ts">
import { computed, ref, type DeepReadonly } from 'vue'
import { parseClock, type PreparedDataset } from '@wayfinder/dataset'
import type { Plan, ReplanResult, Priority } from '@wayfinder/planner'
import {
  Primitive,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
} from 'reka-ui'
import UiButton from '../../../../shared/ui/ui-button.vue'
import UiIcon from '../../../../shared/ui/ui-icon.vue'
import UiSegmented from '../../../../shared/ui/ui-segmented.vue'
import {
  formatDistance,
  formatDuration,
  formatMinute,
  plural,
  transportLabels,
  workLabel as orderWorkLabel,
} from '../../../../shared/lib/format'
import { crewColor, crewFill } from '../../../../shared/lib/crew-colors'
import { useTheme } from '../../../../shared/lib/theme'
import { occupiedMinutes, scheduleSegments } from './schedule-segments'
const props = defineProps<{
  dataset: DeepReadonly<PreparedDataset>
  plan: Plan
  replan: ReplanResult | undefined
  orders: ReadonlyMap<
    string,
    {
      readonly address: string
      readonly priority: Priority
      readonly hdType?: string
      readonly durationMin: number
      readonly window: { readonly start: string; readonly end: string }
    }
  >
  unassignedReasons: ReadonlyMap<string, string>
  canAssign: boolean
  selectedOrderId: string | undefined
}>()
const emit = defineEmits<{
  select: [id: string]
  assign: [orderId: string, engineerId: string]
  /** Наведение на строку бригады: карта подсвечивает её маршрут. */
  hover: [engineerId: string | undefined]
}>()
const theme = useTheme()
const dragging = ref<string>()
const dropTarget = ref<string>()
const selectedPending = computed(() =>
  props.plan.unassigned.some((item) => item.orderId === props.selectedOrderId),
)
function startDrag(event: DragEvent, orderId: string) {
  if (!props.canAssign || !event.dataTransfer) {
    event.preventDefault()
    return
  }
  dragging.value = orderId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', orderId)
  emit('select', orderId)
}
function endDrag() {
  dragging.value = undefined
  dropTarget.value = undefined
}
function dragOver(event: DragEvent, engineerId: string) {
  if (!props.canAssign || !dragging.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTarget.value = engineerId
}
function leaveRow(event: DragEvent) {
  if (
    event.currentTarget instanceof Element &&
    event.relatedTarget instanceof Node &&
    event.currentTarget.contains(event.relatedTarget)
  )
    return
  dropTarget.value = undefined
}
function assign(orderId: string | undefined, engineerId: string) {
  if (props.canAssign && orderId && props.plan.unassigned.some((item) => item.orderId === orderId))
    emit('assign', orderId, engineerId)
}
function drop(event: DragEvent, engineerId: string) {
  event.preventDefault()
  if (dragging.value === event.dataTransfer?.getData('text/plain'))
    assign(dragging.value, engineerId)
  endDrag()
}
function workLabel(id: string) {
  const order = props.orders.get(id)
  if (!order) return 'Работа'
  return orderWorkLabel(order)
}
const zoom = ref('day')
const start = computed(() =>
  Math.min(...props.dataset.engineers.map((e) => parseClock(e.shift.start))),
)
const end = computed(() => Math.max(...props.dataset.engineers.map((e) => parseClock(e.shift.end))))
const duration = computed(() => end.value - start.value)
const hours = computed(() => {
  const values = [start.value]
  for (let hour = Math.ceil((start.value + 1) / 60) * 60; hour < end.value; hour += 60)
    values.push(hour)
  values.push(end.value)
  return values
})
const position = (minute: number) => `${((minute - start.value) / duration.value) * 100}%`
const interval = (from: number, to: number) => ({
  left: position(from),
  width: `${((to - from) / duration.value) * 100}%`,
})
const historyLabels = {
  completed: 'Выполнено',
  'en-route': 'Переезд зафиксирован',
  waiting: 'Резерв до визита зафиксирован',
  'in-progress': 'Начатый визит',
  'cancelled-en-route': 'Отмена в пути',
  'cancelled-waiting': 'Отмена в резерве до визита',
  'cancelled-in-progress': 'Работа отменена',
  interrupted: 'Работа прервана',
  'interrupted-en-route': 'Переезд прерван · пробег оценён по времени',
  'interrupted-waiting': 'Резерв до визита прерван',
} as const
const rows = computed(() =>
  props.dataset.engineers.map((engineer, index) => {
    const route = props.plan.routes.find((r) => r.engineerId === engineer.id)
    const history = props.replan?.history.filter((h) => h.engineerId === engineer.id) ?? []
    const visits = [
      ...history.map((h) => ({
        visit: h.visit,
        state: h.state,
        label: historyLabels[h.state],
        recordedAtMin: h.recordedAtMin,
      })),
      ...(route?.visits ?? []).map((visit) => ({
        visit,
        state: undefined,
        label: 'В плане',
        recordedAtMin: undefined,
      })),
    ]
      .toSorted((a, b) => a.visit.startMin - b.visit.startMin)
      .map((entry, index) => ({
        visit: entry.visit,
        state: entry.state,
        label: entry.label,
        key: `${entry.visit.orderId}-${index}`,
        segments: scheduleSegments(
          entry.visit,
          entry.state,
          entry.recordedAtMin ?? props.replan?.event.atMin,
        ),
      }))
    const segments = visits.flatMap((v) => v.segments)
    const busy = occupiedMinutes(segments)
    const work = segments
      .filter((s) => s.kind === 'work')
      .reduce((sum, s) => sum + s.end - s.start, 0)
    const travel = segments
      .filter((s) => s.kind === 'travel')
      .reduce((sum, s) => sum + s.end - s.start, 0)
    const waiting = segments
      .filter((s) => s.kind === 'wait')
      .reduce((sum, s) => sum + s.end - s.start, 0)
    const shiftStart = parseClock(engineer.shift.start)
    const shiftEnd = parseClock(engineer.shift.end)
    const unavailableAt =
      props.replan?.event.kind === 'engineer-unavailable' &&
      props.replan.event.engineerId === engineer.id
        ? props.replan.event.atMin
        : undefined
    return {
      engineer,
      color: crewColor(index, theme.value),
      fill: crewFill(index, theme.value),
      visits,
      busy,
      work,
      travel,
      waiting,
      shiftStart,
      shiftEnd,
      unavailableAt,
      load: Math.round((busy / Math.max(1, shiftEnd - shiftStart)) * 100),
      distance:
        (route?.distanceM ?? 0) +
        history.reduce(
          (sum, h) => sum + (h.estimatedTravelledDistanceM ?? h.visit.travel.distanceM),
          0,
        ),
    }
  }),
)
/**
 * Клик по строке бригады вне визитов выбирает её ближайший визит плана (или визит истории),
 * и карта фокусируется на её маршруте. Визиты и «Назначить сюда» обрабатывают клик сами.
 */
function selectCrew(event: MouseEvent, row: (typeof rows.value)[number]) {
  const button = event.target instanceof Element ? event.target.closest('button') : null
  if (button !== null && !button.classList.contains('crew__heading')) return
  const entry = row.visits.find((item) => item.state === undefined) ?? row.visits[0]
  if (entry !== undefined) emit('select', entry.visit.orderId)
}
const activeRows = computed(() =>
  rows.value.filter((row) => row.visits.length > 0 || row.unavailableAt !== undefined),
)
const reserveRows = computed(() =>
  rows.value.filter((row) => row.visits.length === 0 && row.unavailableAt === undefined),
)
const selected = computed(() => {
  const matches = rows.value
    .flatMap((row) => row.visits.map((v) => ({ ...v, engineer: row.engineer.name })))
    .filter((v) => v.visit.orderId === props.selectedOrderId)
  const entry = matches.find((v) => v.state === undefined) ?? matches[0]
  if (!entry) return undefined
  const work = entry.segments.find((s) => s.kind === 'work')
  return {
    ...entry,
    from: work?.start ?? entry.segments[0]?.start ?? entry.visit.startMin,
    to: work?.end ?? entry.segments.at(-1)?.end ?? entry.visit.startMin,
  }
})
function shortAddress(address: string | undefined) {
  return address?.replace(/^(?:г\.\s*)?(?:Город\s+)?Москва,\s*/i, '') ?? ''
}
</script>
<template>
  <section
    class="day-schedule panel"
    data-tour="schedule"
    aria-label="Расписание бригад на день"
  >
    <header class="day-schedule__header">
      <div class="day-schedule__title">
        <h2>Расписание бригад</h2>
        <p>Модельное время {{ formatMinute(start) }}–{{ formatMinute(end) }}</p>
      </div>
      <div class="day-schedule__legend">
        <span>
          <i class="day-schedule__key day-schedule__key--work" />
          Работа
        </span>
        <span>
          <i class="day-schedule__key day-schedule__key--travel" />
          Переезд
        </span>
        <span>
          <i class="day-schedule__key day-schedule__key--wait" />
          Резерв
        </span>
        <span>
          <i class="day-schedule__key" />
          Свободно
        </span>
        <span v-if="replan">
          Событие в {{ formatMinute(replan.event.atMin) }}, история приглушена
        </span>
      </div>
      <UiSegmented
        v-model="zoom"
        label="Масштаб расписания"
        :options="[
          { value: 'day', label: 'Обзор' },
          { value: 'detail', label: 'Крупнее' },
        ]"
      />
    </header>
    <section
      v-if="plan.unassigned.length"
      class="backlog"
      aria-label="Неназначенные заявки"
    >
      <header class="backlog__header">
        <h3>
          Без назначения
          <span class="backlog__count">{{ plan.unassigned.length }}</span>
        </h3>
        <p v-if="canAssign">
          Перетащите заявку на бригаду или выберите «Назначить сюда». Время подберётся
          автоматически.
        </p>
        <p v-else>
          Выберите карточку для просмотра причин. Назначение доступно в улучшенном плане до
          применения события.
        </p>
      </header>
      <div class="backlog__cards">
        <Primitive
          v-for="item in plan.unassigned"
          :key="item.orderId"
          as="button"
          type="button"
          class="backlog__card"
          :class="{ 'backlog__card--selected': selectedOrderId === item.orderId }"
          :draggable="canAssign"
          :aria-pressed="selectedOrderId === item.orderId"
          @click="emit('select', item.orderId)"
          @dragstart="startDrag($event, item.orderId)"
          @dragend="endDrag"
        >
          <span class="backlog__task">
            <strong>{{ workLabel(item.orderId) }}</strong>
            <UiIcon
              v-if="canAssign"
              name="grip"
            />
          </span>
          <span class="backlog__address">
            {{ shortAddress(orders.get(item.orderId)?.address) }}
          </span>
          <span class="backlog__facts">
            {{ formatDuration(orders.get(item.orderId)!.durationMin) }} · окно
            {{ orders.get(item.orderId)?.window.start }}–{{
              orders.get(item.orderId)?.window.end
            }}
            · № {{ item.orderId }}
          </span>
          <span class="backlog__reason">{{ unassignedReasons.get(item.orderId) }}</span>
        </Primitive>
      </div>
    </section>
    <TooltipProvider :delay-duration="200">
      <div
        class="day-schedule__scroll"
        tabindex="0"
        role="region"
        aria-label="Временная шкала, прокрутка по горизонтали и вертикали"
      >
        <div
          class="day-schedule__canvas"
          :class="{ 'day-schedule__canvas--detail': zoom === 'detail' }"
        >
          <div class="day-schedule__axis">
            <div class="day-schedule__corner">Бригада · занятость смены, %</div>
            <div class="day-schedule__hours">
              <span
                v-for="hour in hours"
                :key="hour"
                :style="{ left: position(hour) }"
              >
                {{ formatMinute(hour) }}
              </span>
            </div>
          </div>
          <div
            v-for="row in activeRows"
            :key="row.engineer.id"
            class="day-schedule__row"
            :class="{ 'day-schedule__row--drop': dropTarget === row.engineer.id }"
            :style="{ '--crew': row.color }"
            @dragover="dragOver($event, row.engineer.id)"
            @dragleave="leaveRow($event)"
            @drop="drop($event, row.engineer.id)"
            @click="selectCrew($event, row)"
            @pointerenter="emit('hover', row.engineer.id)"
            @pointerleave="emit('hover', undefined)"
          >
            <div class="crew">
              <button
                type="button"
                class="crew__heading"
                :aria-label="`Показать маршрут: ${row.engineer.name}`"
                :disabled="row.visits.length === 0"
              >
                <svg
                  class="crew__ring"
                  viewBox="0 0 36 36"
                  role="img"
                  :aria-label="`Занятость смены ${row.load}%`"
                >
                  <circle
                    class="crew__ring-track"
                    cx="18"
                    cy="18"
                    r="15"
                  />
                  <circle
                    class="crew__ring-value"
                    cx="18"
                    cy="18"
                    r="15"
                    :stroke="row.color"
                    :stroke-dasharray="`${Math.min(100, row.load) * 0.9425} 94.25`"
                  />
                  <text
                    x="18"
                    y="18"
                  >
                    {{ row.load }}
                  </text>
                </svg>
                <span class="crew__name">
                  <strong>{{ row.engineer.name }}</strong>
                  <span class="crew__meta">
                    {{ transportLabels[row.engineer.transport] }} · {{ row.visits.length }}
                    {{ plural(row.visits.length, ['визит', 'визита', 'визитов']) }} ·
                    {{ formatDistance(row.distance) }}
                  </span>
                </span>
              </button>
              <div
                class="crew__meter"
                aria-hidden="true"
              >
                <i
                  class="crew__part crew__part--work"
                  :style="{
                    width: `${(row.work / (row.shiftEnd - row.shiftStart)) * 100}%`,
                    background: row.color,
                  }"
                />
                <i
                  class="crew__part crew__part--travel"
                  :style="{ width: `${(row.travel / (row.shiftEnd - row.shiftStart)) * 100}%` }"
                />
                <i
                  class="crew__part crew__part--wait"
                  :style="{ width: `${(row.waiting / (row.shiftEnd - row.shiftStart)) * 100}%` }"
                />
              </div>
              <dl class="crew__breakdown">
                <div>
                  <dt>Работа</dt>
                  <dd>{{ formatDuration(row.work) }}</dd>
                </div>
                <div>
                  <dt>Дорога</dt>
                  <dd>{{ formatDuration(row.travel) }}</dd>
                </div>
                <div>
                  <dt>Резерв</dt>
                  <dd>{{ formatDuration(row.waiting) }}</dd>
                </div>
              </dl>
              <small
                v-if="row.engineer.transport === 'public'"
                class="crew__meta"
              >
                Условная модель без расписаний
              </small>
              <UiButton
                v-if="canAssign && selectedPending"
                class="crew__assign"
                size="sm"
                variant="primary"
                @click="assign(selectedOrderId, row.engineer.id)"
              >
                Назначить сюда
              </UiButton>
            </div>
            <div class="day-schedule__track">
              <i
                v-for="hour in hours"
                :key="hour"
                class="day-schedule__grid-line"
                :style="{ left: position(hour) }"
              />
              <div
                v-if="row.shiftStart > start"
                class="day-schedule__off"
                :style="interval(start, row.shiftStart)"
              >
                Вне смены
              </div>
              <div
                v-if="row.shiftEnd < end"
                class="day-schedule__off"
                :style="interval(row.shiftEnd, end)"
              >
                Вне смены
              </div>
              <div
                v-if="row.unavailableAt !== undefined"
                class="day-schedule__off"
                :style="interval(Math.max(row.shiftStart, row.unavailableAt), row.shiftEnd)"
              >
                Недоступен
              </div>
              <template
                v-for="entry in row.visits"
                :key="entry.key"
              >
                <TooltipRoot
                  v-for="segment in entry.segments"
                  :key="segment.kind"
                >
                  <TooltipTrigger as-child>
                    <Primitive
                      as="button"
                      type="button"
                      class="day-schedule__segment"
                      :data-tour="segment.kind === 'work' ? 'visit' : undefined"
                      :class="[
                        `day-schedule__segment--${segment.kind}`,
                        {
                          'day-schedule__segment--history': entry.state,
                          'day-schedule__segment--selected':
                            selectedOrderId === entry.visit.orderId,
                        },
                      ]"
                      :style="{
                        ...interval(segment.start, segment.end),
                        '--span': segment.end - segment.start,
                        '--crew': row.color,
                        '--crew-fill': row.fill,
                      }"
                      :aria-label="`${row.engineer.name}: ${segment.kind === 'work' ? workLabel(entry.visit.orderId) : segment.kind === 'travel' ? 'Переезд' : 'Резерв'}, ${formatMinute(segment.start)}–${formatMinute(segment.end)}, ${formatDuration(segment.end - segment.start)}. ${orders.get(entry.visit.orderId)?.address}. ${entry.label}`"
                      :aria-pressed="selectedOrderId === entry.visit.orderId"
                      @click="emit('select', entry.visit.orderId)"
                    >
                      <template v-if="segment.kind === 'work'">
                        <strong>{{ workLabel(entry.visit.orderId) }}</strong>
                        <span>{{ Math.round(segment.end - segment.start) }} мин</span>
                        <span>{{ shortAddress(orders.get(entry.visit.orderId)?.address) }}</span>
                      </template>
                      <template v-else>
                        <UiIcon
                          v-if="segment.end - segment.start >= 12"
                          :name="segment.kind === 'travel' ? 'route' : 'clock'"
                        />
                        <template v-if="segment.end - segment.start >= 35">
                          <strong>{{ segment.kind === 'travel' ? 'Переезд' : 'Резерв' }}</strong>
                          <span>{{ formatDuration(segment.end - segment.start) }}</span>
                        </template>
                      </template>
                    </Primitive>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent
                      class="day-schedule__tooltip"
                      :side-offset="8"
                      :collision-padding="12"
                    >
                      <strong>
                        {{ formatMinute(segment.start) }}–{{ formatMinute(segment.end) }} ·
                        {{ formatDuration(segment.end - segment.start) }}
                      </strong>
                      <span>
                        {{
                          segment.kind === 'work'
                            ? workLabel(entry.visit.orderId)
                            : segment.kind === 'travel'
                              ? 'Переезд'
                              : 'Резерв'
                        }}
                        · {{ entry.label }}
                      </span>
                      <p v-if="segment.kind === 'wait'">
                        Свободен {{ formatDuration(segment.end - segment.start) }} у точки
                        {{ orders.get(entry.visit.orderId)?.address }}.
                        {{
                          entry.state === undefined
                            ? 'В этот интервал можно поставить аварию, если расчёт подтвердит переезды, навык, комплект и согласованные визиты.'
                            : 'Зафиксированный интервал до визита; это история дня.'
                        }}
                      </p>
                      <p v-else>{{ orders.get(entry.visit.orderId)?.address }}</p>
                      <small>{{ row.engineer.name }}</small>
                    </TooltipContent>
                  </TooltipPortal>
                </TooltipRoot>
              </template>
              <i
                v-if="replan"
                class="day-schedule__event"
                :style="{ left: position(replan.event.atMin) }"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
    <div
      v-if="reserveRows.length"
      class="day-schedule__reserve"
    >
      <p>
        {{ reserveRows.length }}
        {{ reserveRows.length === 1 ? 'бригада' : reserveRows.length < 5 ? 'бригады' : 'бригад' }}
        {{
          replan
            ? 'без визитов в остатке дня'
            : reserveRows.length === 1
              ? 'свободна весь день (резерв)'
              : 'свободны весь день (резерв)'
        }}.
      </p>
      <span v-if="!canAssign || (!selectedPending && !dragging)">
        {{ reserveRows.map((row) => row.engineer.name).join(', ') }}
      </span>
      <template v-else>
        <UiButton
          v-for="row in reserveRows"
          :key="row.engineer.id"
          size="sm"
          class="day-schedule__reserve-assign"
          @click="assign(selectedOrderId, row.engineer.id)"
          @dragover="dragOver($event, row.engineer.id)"
          @dragleave="leaveRow($event)"
          @drop="drop($event, row.engineer.id)"
        >
          Назначить: {{ row.engineer.name }}
        </UiButton>
      </template>
    </div>
    <footer class="day-schedule__footer">
      <template v-if="selected">
        <strong>{{ selected.engineer }}</strong>
        <span>
          {{ selected.label }} · {{ formatMinute(selected.from) }}–{{ formatMinute(selected.to) }} ·
          {{ orders.get(selected.visit.orderId)?.address }}
        </span>
      </template>
      <small>
        Занятость = (работа + переезды + резерв до визита) / длительность смены. Возврат не
        требуется.
      </small>
    </footer>
  </section>
</template>
