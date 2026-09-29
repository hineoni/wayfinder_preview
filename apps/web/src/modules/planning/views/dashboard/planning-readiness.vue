<script setup lang="ts">
import { computed, ref, type DeepReadonly } from 'vue'
import { parseClock, type PreparedDataset } from '@wayfinder/dataset'
import type { EmergencyProbe, ReadinessReport, EquipmentPreparation } from '@wayfinder/planner'
import UiButton from '../../../../shared/ui/ui-button.vue'
import UiCombobox from '../../../../shared/ui/ui-combobox.vue'
import UiTimeField from '../../../../shared/ui/ui-time-field.vue'
import { formatMinute } from '../../../../shared/lib/format'

const props = defineProps<{
  dataset: DeepReadonly<PreparedDataset>
  busy: boolean
  report?: ReadinessReport | undefined
  equipment?: EquipmentPreparation | undefined
}>()
const emit = defineEmits<{
  run: [kind: 'readiness' | 'equipment', probes: EmergencyProbe[]]
  cancel: []
  apply: []
}>()
const points = computed(() => [
  ...new Map(
    props.dataset.orders.map((o) => [o.pointId, { value: o.pointId, label: o.address }]),
  ).values(),
])
const pointId = ref(props.dataset.orders[0]?.pointId ?? '')
const at = ref('14:00')
const valid = computed(
  () =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(at.value) &&
    at.value >= props.dataset.assumptions.shift.start &&
    at.value <= props.dataset.assumptions.shift.end &&
    points.value.some((p) => p.value === pointId.value),
)
function grid(): EmergencyProbe[] {
  const sample = [
    ...new Set([
      points.value[0]?.value,
      points.value[Math.floor(points.value.length / 2)]?.value,
      points.value.at(-1)?.value,
    ]),
  ].filter((id): id is string => id !== undefined)
  const times = ['09:30', '12:00', '14:00', '16:00'].filter(
    (t) => t >= props.dataset.assumptions.shift.start && t <= props.dataset.assumptions.shift.end,
  )
  return sample.flatMap((point, i) =>
    times.map((time) => ({
      id: `${i}-${time}`,
      pointId: point,
      atMin: parseClock(time),
      windowMin: 60,
    })),
  )
}
const names = computed(() => new Map(props.dataset.engineers.map((e) => [e.id, e.name])))
</script>
<template>
  <section class="planning-analysis planning-analysis--flat">
    <p>
      Проверочные аварии: 100 минут работы, автомобиль, аварийная квалификация и один комплект.
      Начало — в течение часа после поступления. Завершение прошлых работ моделируется; действующий
      день не меняется.
    </p>
    <div class="planning-analysis__actions">
      <UiButton
        variant="primary"
        :disabled="busy"
        @click="emit('run', 'readiness', grid())"
      >
        Проверить {{ grid().length }} случаев
      </UiButton>
      <UiButton
        :disabled="busy"
        @click="emit('run', 'equipment', grid())"
      >
        Подобрать утренние комплекты
      </UiButton>
      <UiButton
        v-if="busy"
        variant="ghost"
        @click="emit('cancel')"
      >
        Остановить проверку
      </UiButton>
    </div>
    <fieldset class="planning-analysis__fields">
      <legend>Проверить свою аварию</legend>
      <label class="ui-field planning-analysis__wide">
        <span class="ui-field__label">Адрес</span>
        <UiCombobox
          v-model="pointId"
          :options="points"
          label="Точка проверочной аварии"
        />
      </label>
      <label class="ui-field">
        <span class="ui-field__label">Поступление</span>
        <UiTimeField
          v-model="at"
          label="Время проверочной аварии"
        />
      </label>
      <UiButton
        :disabled="busy || !valid"
        @click="
          emit('run', 'readiness', [
            { id: 'custom', pointId, atMin: parseClock(at), windowMin: 60 },
          ])
        "
      >
        Проверить этот случай
      </UiButton>
    </fieldset>
    <p
      v-if="busy"
      role="status"
    >
      Расчёт в отдельном рабочем потоке…
    </p>
    <template v-if="report">
      <p>
        <strong>{{ report.withoutDisruption }} из {{ report.cases.length }}</strong>
        проверок — авария назначена без изменений прежних визитов. Всего аварий назначено:
        {{ report.assigned }}.
      </p>
      <p>
        Это проверка выбранных адресов и времён, не вероятность и не гарантия. Бюджет поиска:
        {{ report.candidateCheckBudget }} проверок на случай; отсутствие назначения не доказывает
        невозможность.
      </p>
      <div class="planning-analysis__table">
        <table>
          <thead>
            <tr>
              <th>Адрес / поступление</th>
              <th>Авария</th>
              <th>Прежние заявки</th>
              <th>Расчёт</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in report.cases"
              :key="item.id"
            >
              <td>
                {{ points.find((p) => p.value === item.pointId)?.label }} ·
                {{ formatMinute(item.atMin) }}
              </td>
              <td>
                {{ item.assigned ? `Начало ${formatMinute(item.startMin!)}` : 'Не назначена' }}
                <br />
                {{ names.get(item.engineerId ?? '') }}
              </td>
              <td>
                Изменено {{ item.changedOrderIds.length }}; снято {{ item.lostOrderIds.length }}
                <br />
                {{ item.changedOrderIds.join(', ') }}
              </td>
              <td>
                {{ item.budgetExhausted ? 'Бюджет исчерпан' : 'Поиск завершён'
                }}{{ item.approximate ? ' · приближённые переезды' : '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <template v-if="equipment">
      <h3>Утренний комплект</h3>
      <p>
        Проверено переносов: {{ equipment.checkedTransfers }} из {{ equipment.possibleTransfers }}.
        Поиск ограничен одним аварийным комплектом и 12 вариантами; остальные ресурсы сохраняются.
        Общий запас не увеличивается.
      </p>
      <template v-if="equipment.transfer">
        <p>
          Передать один аварийный комплект: {{ names.get(equipment.transfer.fromEngineerId) }} →
          {{ names.get(equipment.transfer.toEngineerId) }}.
        </p>
        <p>
          Без изменений прежних визитов: {{ equipment.before.withoutDisruption }} →
          {{ equipment.after.withoutDisruption }}. Назначенные аварии:
          {{ equipment.before.assigned }} → {{ equipment.after.assigned }}.
        </p>
        <p>
          Передача в офисе до выезда. Исходные назначения, время и общий запас сохраняются;
          обеспечьте доставку комплекта к стартовой точке бригады, если она начинает не из офиса.
        </p>
        <UiButton
          variant="primary"
          :disabled="busy"
          @click="emit('apply')"
        >
          Подтвердить утреннюю выдачу и применить
        </UiButton>
      </template>
      <p v-else>Среди проверенных переносов улучшение не найдено. Текущие комплекты сохранены.</p>
    </template>
  </section>
</template>
