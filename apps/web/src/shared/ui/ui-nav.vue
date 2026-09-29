<script setup lang="ts" generic="T extends string">
import { RadioGroupRoot, RadioGroupItem } from 'reka-ui'
import UiIcon from './ui-icon.vue'
import type { IconName } from './icons'
/**
 * Вертикальная навигация боковой панели: обязательный выбор одного пункта.
 * `badge` — короткое число рядом с подписью, `tone: 'danger'` выделяет его как проблему.
 */
defineProps<{
  options: readonly {
    value: T
    label: string
    icon: IconName
    badge?: string | number | undefined
    tone?: 'danger' | undefined
  }[]
  label: string
  disabled?: boolean
}>()
const model = defineModel<T>({ required: true })
</script>
<template>
  <RadioGroupRoot
    v-model="model"
    class="ui-nav"
    :aria-label="label"
    :disabled="disabled"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :data-nav-value="option.value"
      class="ui-nav__item"
    >
      <UiIcon :name="option.icon" />
      <span class="ui-nav__label">{{ option.label }}</span>
      <span
        v-if="option.badge !== undefined"
        class="ui-nav__badge"
        :class="{ 'ui-nav__badge--danger': option.tone === 'danger' }"
      >
        {{ option.badge }}
      </span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
