<script setup lang="ts">
import { Time } from '@internationalized/date'
import { TimeFieldRoot, TimeFieldInput, type TimeValue } from 'reka-ui'
import { computed } from 'vue'
import UiIcon from './ui-icon.vue'
defineProps<{ label: string }>()
const model = defineModel<string>({ required: true })
const value = computed(() => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(model.value)) return null
  const [hour, minute] = model.value.split(':').map(Number)
  return new Time(hour, minute)
})
function update(time: TimeValue | undefined) {
  model.value = time
    ? `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
    : ''
}
</script>
<template>
  <TimeFieldRoot
    v-slot="{ segments }"
    class="ui-time"
    :model-value="value"
    :aria-label="label"
    locale="ru-RU"
    :hour-cycle="24"
    granularity="minute"
    @update:model-value="update"
  >
    <TimeFieldInput
      v-for="segment in segments"
      :key="segment.part"
      :part="segment.part"
      class="ui-time__segment"
    >
      {{ segment.value }}
    </TimeFieldInput>
    <UiIcon
      name="clock"
      class="ui-time__icon"
    />
  </TimeFieldRoot>
</template>
