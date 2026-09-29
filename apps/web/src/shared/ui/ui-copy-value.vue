<script setup lang="ts">
import { ref, watch } from 'vue'
import UiIcon from './ui-icon.vue'
/**
 * Служебное значение с копированием: номер и иконка — одна компактная кнопка. Результат
 * копирования на две секунды заменяет подпись на месте, не сдвигая строку.
 */
const props = defineProps<{ label: string; value: string }>()
const status = ref<'idle' | 'copied' | 'error'>('idle')
watch(
  () => props.value,
  () => {
    status.value = 'idle'
  },
)
async function copy() {
  const value = props.value
  try {
    await navigator.clipboard.writeText(value)
    if (props.value !== value) return
    status.value = 'copied'
    setTimeout(() => {
      if (status.value === 'copied' && props.value === value) status.value = 'idle'
    }, 2000)
  } catch {
    if (props.value === value) status.value = 'error'
  }
}
</script>
<template>
  <div class="ui-copy-value">
    <span
      class="ui-copy-value__label"
      :class="status !== 'idle' && `ui-copy-value__label--${status}`"
      role="status"
    >
      {{
        status === 'copied' ? 'Скопировано' : status === 'error' ? 'Не удалось скопировать' : label
      }}
    </span>
    <button
      type="button"
      class="ui-copy-value__button"
      :aria-label="`Скопировать ${label.toLowerCase()} ${value}`"
      @click="copy"
    >
      <code class="ui-copy-value__value">{{ value }}</code>
      <UiIcon
        :name="status === 'copied' ? 'check' : 'copy'"
        class="ui-copy-value__icon"
      />
    </button>
  </div>
</template>
