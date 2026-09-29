<script setup lang="ts">
import { computed } from 'vue'
import { formatMinute } from '../../../../shared/lib/format'
/**
 * Окно заявки и визит на одной оси: видно, где внутри окна стоит работа
 * и сколько бригада ждёт после прибытия. Без визита показывает только окно.
 */
const props = defineProps<{
  windowStart: number
  windowEnd: number
  visit?: { arrivalMin: number; startMin: number; endMin: number } | undefined
  color?: string | undefined
  /** Обводка блока работы; в светлой теме заливка пастельная, обводка чуть плотнее. */
  edge?: string | undefined
}>()
const PAD = 20
const domain = computed(() => {
  const from = Math.min(props.windowStart, props.visit?.arrivalMin ?? props.windowStart) - PAD
  const to = Math.max(props.windowEnd, props.visit?.endMin ?? props.windowEnd) + PAD
  return { from, span: Math.max(1, to - from) }
})
const at = (minute: number) => `${((minute - domain.value.from) / domain.value.span) * 100}%`
const size = (from: number, to: number) => `${((to - from) / domain.value.span) * 100}%`
const label = computed(() => {
  const window = `Окно ${formatMinute(props.windowStart)}–${formatMinute(props.windowEnd)}`
  const visit = props.visit
  if (visit === undefined) return `${window}, визит не назначен`
  return `${window}; прибытие ${formatMinute(visit.arrivalMin)}, работа ${formatMinute(visit.startMin)}–${formatMinute(visit.endMin)}`
})
</script>
<template>
  <div
    class="visit-window"
    role="img"
    :aria-label="label"
  >
    <div class="visit-window__track">
      <span
        class="visit-window__band"
        :style="{ left: at(windowStart), width: size(windowStart, windowEnd) }"
      ></span>
      <template v-if="visit">
        <span
          v-if="visit.startMin > visit.arrivalMin"
          class="visit-window__wait"
          :style="{ left: at(visit.arrivalMin), width: size(visit.arrivalMin, visit.startMin) }"
        ></span>
        <span
          class="visit-window__work"
          :style="{
            left: at(visit.startMin),
            width: size(visit.startMin, visit.endMin),
            background: color,
            borderColor: edge,
          }"
        ></span>
        <span
          class="visit-window__arrival"
          :style="{ left: at(visit.arrivalMin) }"
        ></span>
      </template>
    </div>
    <div class="visit-window__axis">
      <span :style="{ left: at(windowStart) }">{{ formatMinute(windowStart) }}</span>
      <span :style="{ left: at(windowEnd) }">{{ formatMinute(windowEnd) }}</span>
    </div>
  </div>
</template>

<style lang="scss">
.visit-window {
  display: grid;
  gap: var(--space-4);
  padding-top: var(--space-4);

  &__track {
    position: relative;
    height: 22px;
    background: var(--color-surface-hover);
    border-radius: var(--radius-xs);
  }

  &__band {
    position: absolute;
    inset-block: 0;
    background: var(--color-accent-soft);
    border: 1px dashed var(--color-focus);
    border-radius: var(--radius-xs);
  }

  &__wait {
    position: absolute;
    inset-block: 7px;
    background: repeating-linear-gradient(
      135deg,
      var(--color-text-subtle) 0 2px,
      transparent 2px 5px
    );
    opacity: 0.5;
  }

  &__work {
    position: absolute;
    inset-block: 3px;
    background: var(--color-text);
    border: 1px solid transparent;
    border-radius: 5px;
  }

  &__arrival {
    position: absolute;
    inset-block: 2px;
    width: 2px;
    background: var(--color-text-muted);
    border-radius: 1px;
    transform: translateX(-1px);
  }

  &__axis {
    position: relative;
    height: 14px;
    color: var(--color-text-subtle);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;

    span {
      position: absolute;
      transform: translateX(-50%);
    }
  }
}
</style>
