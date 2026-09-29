<script setup lang="ts">
import type { AssignmentOption } from '@wayfinder/planner'
import UiButton from '../../../../shared/ui/ui-button.vue'
import {
  formatDistance,
  formatMinute,
  skillLabels,
  transportLabels,
  equipmentLabels,
} from '../../../../shared/lib/format'
defineProps<{ options: readonly AssignmentOption[] | undefined; busy: boolean }>()
defineEmits<{ inspect: []; assign: [engineerId: string] }>()
const titles = {
  existing: 'Назначить без изменения условий',
  window: 'Согласовать более позднее окно',
  equipment: 'Выдать дополнительный комплект до выезда',
  'extra-engineer': 'Привлечь дополнительную бригаду',
}
</script>
<template>
  <section class="assignment-options">
    <div class="assignment-options__header">
      <h3>Что изменить, чтобы назначить заявку?</h3>
      <UiButton
        size="sm"
        :disabled="busy"
        @click="$emit('inspect')"
      >
        Проверить варианты
      </UiButton>
    </div>
    <p class="assignment-options__intro">
      Проверяем вставку, расширение конца окна на 30/60/120 минут, утренний комплект и
      дополнительную бригаду. Исходный план сохраняется.
    </p>
    <p
      v-if="options?.length === 0"
      role="status"
    >
      Среди проверенных действий варианта не найдено. Это не доказательство невозможности.
    </p>
    <article
      v-for="option in options?.filter((item) => item.kind !== 'rejected')"
      :key="option.kind"
      class="assignment-options__item"
    >
      <h4>{{ titles[option.kind] }}</h4>
      <p>
        {{ option.engineer.name }} · начало {{ formatMinute(option.startMin) }} · изменение пробега
        {{ formatDistance(option.comparison.delta.distanceM, true) }}.
      </p>
      <p v-if="option.kind === 'window'">
        Конец окна позже на {{ option.windowExtensionMin }} мин. Требуется согласование клиента.
      </p>
      <p v-if="option.extraEquipment">
        Выдать дополнительно:
        <template
          v-for="(units, kind) in option.extraEquipment"
          :key="kind"
        >
          <span v-if="units">{{ equipmentLabels[kind] }} — {{ units }}.</span>
        </template>
        Только до выезда; наличие на складе не подтверждено.
      </p>
      <p v-if="option.kind === 'extra-engineer'">
        Модельная бригада: {{ option.engineer.skills.map((s) => skillLabels[s]).join(', ') }},
        {{ transportLabels[option.engineer.transport] }}; стартовая точка
        {{ option.engineer.startPointId }}, смена {{ formatMinute(option.engineer.shift.start) }}–{{
          formatMinute(option.engineer.shift.end)
        }}. Комплект:
        <template
          v-for="(units, kind) in option.engineer.equipment"
          :key="kind"
        >
          <span v-if="units">{{ equipmentLabels[kind] }} — {{ units }}.</span>
        </template>
        Наличие бригады и комплекта нужно подтвердить; выдача до выезда.
      </p>
      <p>
        Прежних назначений потеряно: 0. Изменений времени: {{ option.changes.length }}. Нарушений
        модели: 0.
      </p>
      <ul v-if="option.changes.length">
        <li
          v-for="change in option.changes"
          :key="change.orderId"
        >
          {{ change.orderId }}: {{ formatMinute(change.previousStartMin) }} →
          {{ formatMinute(change.startMin) }}
        </li>
      </ul>
      <p v-if="option.plan.metrics.approximate">Расчёт содержит приближённые переезды.</p>
      <UiButton
        v-if="option.kind === 'existing'"
        variant="primary"
        size="sm"
        @click="$emit('assign', option.engineer.id)"
      >
        Назначить
      </UiButton>
      <p v-else>Это проверенный сценарий для согласования, а не изменение действующего плана.</p>
    </article>
  </section>
</template>
