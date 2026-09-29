<script setup lang="ts" generic="T extends string">
import { RadioGroupRoot, RadioGroupItem, RadioGroupIndicator } from 'reka-ui'
import UiIcon from './ui-icon.vue'
import type { IconName } from './icons'
/**
 * Обязательный выбор из короткого списка, где у варианта есть пояснение или цвет:
 * тип события (с иконкой), бригада (с цветом). `dense` — строки в одну колонку для списков
 * длиннее пяти вариантов. Для длинных списков с поиском — `ui-combobox`.
 */
defineProps<{
  options: readonly {
    value: T
    label: string
    description?: string | undefined
    color?: string | undefined
    icon?: IconName | undefined
  }[]
  label: string
  disabled?: boolean
  dense?: boolean
}>()
const model = defineModel<T | undefined>()
function update(value: unknown) {
  if (typeof value === 'string') model.value = value as T
}
</script>
<template>
  <RadioGroupRoot
    :model-value="model ?? null"
    class="ui-choice-list"
    :class="{ 'ui-choice-list--dense': dense }"
    :aria-label="label"
    :disabled="disabled"
    @update:model-value="update"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      class="ui-choice-list__item"
    >
      <span
        v-if="option.icon"
        class="ui-choice-list__icon"
        aria-hidden="true"
      >
        <UiIcon :name="option.icon" />
      </span>
      <span
        v-else
        class="ui-choice-list__mark"
        :style="option.color ? { '--choice-color': option.color } : undefined"
        aria-hidden="true"
      >
        <RadioGroupIndicator class="ui-choice-list__dot" />
      </span>
      <span class="ui-choice-list__text">
        <span class="ui-choice-list__label">{{ option.label }}</span>
        <span
          v-if="option.description"
          class="ui-choice-list__description"
        >
          {{ option.description }}
        </span>
      </span>
    </RadioGroupItem>
    <p
      v-if="options.length === 0"
      class="ui-choice-list__empty"
    >
      Нет доступных вариантов
    </p>
  </RadioGroupRoot>
</template>
