<script setup lang="ts">
import { computed, ref, watch, type DeepReadonly } from 'vue'
import { parseClock, toUrgentOrderEvent, type PreparedDataset } from '@wayfinder/dataset'
import type { CustomerAgreement, Plan, PlanningEvent, ReplanResult } from '@wayfinder/planner'
import UiButton from '../../../../shared/ui/ui-button.vue'
import UiCombobox from '../../../../shared/ui/ui-combobox.vue'
import UiSegmented from '../../../../shared/ui/ui-segmented.vue'
import UiInput from '../../../../shared/ui/ui-input.vue'
import UiTimeField from '../../../../shared/ui/ui-time-field.vue'
import { formatMinute } from '../../../../shared/lib/format'
import { handoffText } from './support-handoff'

const props = defineProps<{
  dataset: DeepReadonly<PreparedDataset>
  plan: Plan
  replan?: ReplanResult | undefined
  agreements: readonly CustomerAgreement[]
  conflict?: readonly string[] | undefined
  selectedOrderId?: string | undefined
  busy: boolean
}>()
const emit = defineEmits<{
  confirm: [id: string]
  release: [id: string]
  resolve: []
  event: [event: PlanningEvent, facts: string[]]
}>()
const at = ref('15:00')
const id = ref('U-NEXT')
const pointId = ref(props.dataset.orders[0]?.pointId ?? '')
const kind = ref<PlanningEvent['kind']>('urgent-order')
const target = ref('')
const nextPlan = computed(() => props.replan?.checkpoint?.plan ?? props.plan)
const selectable = computed(() =>
  kind.value === 'cancel-order'
    ? (props.replan?.checkpoint?.orders ?? []).map((o) => ({
        value: o.id,
        label: `${o.id} · ${props.dataset.orders.find((item) => item.id === o.id)?.address ?? o.pointId}`,
      }))
    : (props.replan?.checkpoint?.engineers ?? []).map((e) => ({ value: e.id, label: e.name })),
)
const facts = computed(() =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(at.value)
    ? nextPlan.value.routes.flatMap((r) =>
        r.visits.filter((v) => v.endMin <= parseClock(at.value)).map((v) => v.orderId),
      )
    : [],
)
const valid = computed(
  () =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(at.value) &&
    parseClock(at.value) >= (props.replan?.event.atMin ?? 0) &&
    at.value <= props.dataset.assumptions.shift.end &&
    (kind.value === 'urgent-order'
      ? id.value.trim().length > 0 &&
        !props.dataset.orders.some((o) => o.id === id.value.trim()) &&
        props.dataset.points.some((p) => p.id === pointId.value)
      : selectable.value.some((item) => item.value === target.value)),
)
const selectedVisit = computed(() =>
  nextPlan.value.routes.flatMap((r) => r.visits).find((v) => v.orderId === props.selectedOrderId),
)
const selectedAgreement = computed(() =>
  props.agreements.find((a) => a.orderId === props.selectedOrderId),
)
const reasons = {
  'new-assignment': 'Новое назначение',
  'new-unassigned': 'Авария без назначения',
  'engineer-changed': 'Изменён исполнитель',
  'time-changed': 'Изменено время',
  unassigned: 'Потеряно назначение',
  reordered: 'Изменён порядок',
  cancelled: 'Отмена',
  interrupted: 'Работа прервана',
}
const rows = computed(() =>
  props.agreements
    .toSorted((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
      if ((a.startMin === undefined) !== (b.startMin === undefined))
        return a.startMin === undefined ? -1 : 1
      return (
        Math.min(a.previousStartMin ?? Infinity, a.startMin ?? Infinity) -
          Math.min(b.previousStartMin ?? Infinity, b.startMin ?? Infinity) ||
        Math.abs((b.startMin ?? 0) - (b.previousStartMin ?? b.startMin ?? 0)) -
          Math.abs((a.startMin ?? 0) - (a.previousStartMin ?? a.startMin ?? 0))
      )
    })
    .map((a) => ({
      ...a,
      previousStartMin: a.previousStartMin,
      startMin: a.startMin,
      engineerId: a.engineerId,
      previousEngineerId: undefined,
      reason: reasons[a.reason],
    })),
)
watch(
  () => props.replan?.event.atMin,
  (value) => {
    if (value !== undefined) at.value = formatMinute(Math.min(1439, value + 15))
    while (props.dataset.orders.some((o) => o.id === id.value)) id.value += '-1'
  },
  { immediate: true },
)
function apply() {
  if (!valid.value) return
  const atMin = parseClock(at.value)
  if (kind.value === 'urgent-order') {
    const template = props.dataset.events[0]
    if (template === undefined) return
    const event = toUrgentOrderEvent(template)
    emit(
      'event',
      {
        kind: 'urgent-order',
        atMin,
        order: {
          ...event.order,
          id: id.value.trim(),
          pointId: pointId.value,
          availableFromMin: atMin,
          window: { start: atMin, end: Math.min(atMin + 60, 1439) },
        },
      },
      facts.value,
    )
  } else if (kind.value === 'cancel-order')
    emit('event', { kind: kind.value, atMin, orderId: target.value }, facts.value)
  else emit('event', { kind: kind.value, atMin, engineerId: target.value }, facts.value)
}
function download() {
  const text = handoffText(
    rows.value.filter((r) => r.status === 'pending'),
    (orderId) => props.dataset.orders.find((o) => o.id === orderId)?.address ?? orderId,
  )
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `wayfinder-support-${props.dataset.day}.txt`
  link.click()
  URL.revokeObjectURL(url)
}
</script>
<template>
  <section class="planning-analysis panel">
    <h2>Согласования с клиентами</h2>
    <p v-if="replan">
      Назначено за день: {{ replan.dayMetrics.assigned }}. Без назначения:
      {{ replan.dayMetrics.unassigned }}. Затронуто прежних заявок по критерию поиска:
      {{ replan.affectedOrderCount }}.
    </p>
    <p>
      Сначала — потерянные назначения, затем ближайшие визиты; при равном времени — больший сдвиг.
      Подтверждение фиксирует точное время начала. Сообщения клиентам не отправляются.
    </p>
    <div
      v-if="selectedVisit"
      class="planning-analysis__actions"
    >
      <span>
        Выбранная заявка {{ selectedOrderId }}:
        <strong>{{ formatMinute(selectedVisit.startMin) }}</strong>
      </span>
      <UiButton
        v-if="selectedAgreement?.promisedStartMin === undefined"
        size="sm"
        :disabled="busy"
        @click="emit('confirm', selectedOrderId!)"
      >
        Клиент подтвердил — зафиксировать время
      </UiButton>
      <UiButton
        v-else
        size="sm"
        :disabled="busy"
        @click="emit('release', selectedOrderId!)"
      >
        Снять фиксацию для пересогласования
      </UiButton>
    </div>
    <div
      v-if="conflict?.length"
      class="planning-analysis__alert"
      role="alert"
    >
      <p>
        Не удалось сохранить подтверждённое время заявок: {{ conflict.join(', ') }}. Событие не
        применено; действующий план сохранён. Это результат ограниченного поиска, не доказательство
        невозможности.
      </p>
      <UiButton
        :disabled="busy"
        @click="emit('resolve')"
      >
        Разрешить пересогласование этих заявок и повторить расчёт
      </UiButton>
    </div>
    <div
      v-if="rows.length"
      class="planning-analysis__table"
    >
      <table>
        <thead>
          <tr>
            <th>Заявка</th>
            <th>Было → стало</th>
            <th>Причина / состояние</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.orderId"
          >
            <td>
              {{ row.orderId }} · {{ dataset.orders.find((o) => o.id === row.orderId)?.address }}
            </td>
            <td>
              {{ row.previousStartMin === undefined ? '—' : formatMinute(row.previousStartMin) }} →
              {{ row.startMin === undefined ? 'Без назначения' : formatMinute(row.startMin) }}
            </td>
            <td>
              {{ row.reason }} ·
              {{ row.status === 'confirmed' ? 'Подтверждено' : 'Нужно согласовать' }}
            </td>
            <td>
              <div class="planning-analysis__row-actions">
                <UiButton
                  v-if="row.status === 'pending'"
                  size="sm"
                  :disabled="busy"
                  @click="emit('confirm', row.orderId)"
                >
                  {{ row.startMin === undefined ? 'Клиент уведомлён' : 'Подтверждено клиентом' }}
                </UiButton>
                <UiButton
                  v-if="row.promisedStartMin !== undefined"
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  @click="emit('release', row.orderId)"
                >
                  Пересогласовать
                </UiButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else>Очередь согласований пуста.</p>
    <div
      v-if="rows.some((r) => r.status === 'pending')"
      class="planning-analysis__actions"
    >
      <UiButton @click="download">Скачать очередь для поддержки</UiButton>
    </div>
    <fieldset
      v-if="replan"
      class="planning-analysis__fields"
    >
      <legend>Следующее событие рабочего дня</legend>
      <div class="ui-field planning-analysis__wide">
        <span class="ui-field__label">Событие</span>
        <UiSegmented
          v-model="kind"
          label="Следующее событие"
          :options="[
            { value: 'urgent-order', label: 'Авария' },
            { value: 'cancel-order', label: 'Отмена' },
            { value: 'engineer-unavailable', label: 'Недоступность бригады' },
          ]"
        />
      </div>
      <label class="ui-field">
        <span class="ui-field__label">Время</span>
        <UiTimeField
          v-model="at"
          label="Время следующего события"
        />
      </label>
      <template v-if="kind === 'urgent-order'">
        <label class="ui-field">
          <span class="ui-field__label">Номер заявки</span>
          <UiInput v-model="id" />
        </label>
        <label class="ui-field planning-analysis__wide">
          <span class="ui-field__label">Адрес</span>
          <UiCombobox
            v-model="pointId"
            label="Адрес следующей аварии"
            :options="[
              ...new Map(
                dataset.orders.map((o) => [o.pointId, { value: o.pointId, label: o.address }]),
              ).values(),
            ]"
          />
        </label>
        <p class="planning-analysis__wide">
          Авария: 100 минут, начало в течение часа, автомобиль, аварийная квалификация и комплект.
        </p>
      </template>
      <label
        v-else
        class="ui-field"
      >
        <span class="ui-field__label">{{ kind === 'cancel-order' ? 'Заявка' : 'Бригада' }}</span>
        <UiCombobox
          v-model="target"
          label="Цель события"
          :placeholder="kind === 'cancel-order' ? 'Найдите заявку' : 'Найдите бригаду'"
          :options="selectable"
        />
      </label>
      <p class="planning-analysis__wide">
        Применяя событие, подтверждаю выполненные визиты: {{ facts.length }}. {{ facts.join(', ') }}
      </p>
      <UiButton
        variant="primary"
        :disabled="busy || !valid"
        @click="apply"
      >
        Применить следующее событие
      </UiButton>
    </fieldset>
  </section>
</template>
