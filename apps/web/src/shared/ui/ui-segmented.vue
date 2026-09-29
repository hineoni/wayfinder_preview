<script setup lang="ts" generic="T extends string">
import { RadioGroupRoot, RadioGroupItem } from 'reka-ui'
defineProps<{
  options: readonly { value: T; label: string }[]
  label: string
  disabled?: boolean
}>()
const model = defineModel<T>({ required: true })
</script>
<template>
  <RadioGroupRoot
    v-model="model"
    class="ui-segmented"
    :aria-label="label"
    :disabled="disabled"
    orientation="horizontal"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      class="ui-segmented__item"
    >
      {{ option.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
