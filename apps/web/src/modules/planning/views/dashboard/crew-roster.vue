<script setup lang="ts">
/**
 * Бригады дня в пустом инспекторе: цвет маршрута, объём работы и день бригады на общей шкале
 * смены — работа, переезды и резерв в тех же обозначениях, что в расписании.
 * Клик выбирает первый визит бригады, наведение подсвечивает её маршрут на карте.
 * Подсветка снимается только при уходе со всего списка: зазор между строками не мигает картой.
 */
defineProps<{
  rows: readonly {
    id: string
    name: string
    meta: string
    color: string
    span: string
    segments: readonly { kind: 'travel' | 'wait' | 'work'; left: number; width: number }[]
    firstOrderId: string
  }[]
}>()
const emit = defineEmits<{
  select: [orderId: string]
  hover: [engineerId: string | undefined]
}>()
</script>
<template>
  <ul
    class="crew-roster"
    @pointerleave="emit('hover', undefined)"
  >
    <li
      v-for="row in rows"
      :key="row.id"
    >
      <button
        type="button"
        class="crew-roster__item"
        @click="emit('select', row.firstOrderId)"
        @pointerenter="emit('hover', row.id)"
      >
        <i
          class="crew-roster__dot"
          :style="{ background: row.color }"
          aria-hidden="true"
        ></i>
        <span class="crew-roster__text">
          <strong>{{ row.name }}</strong>
          <small>{{ row.meta }}</small>
        </span>
        <span class="crew-roster__span">{{ row.span }}</span>
        <span
          class="crew-roster__day"
          :style="{ '--crew': row.color }"
          aria-hidden="true"
        >
          <i
            v-for="(segment, index) in row.segments"
            :key="index"
            class="crew-roster__part"
            :class="`crew-roster__part--${segment.kind}`"
            :style="{ left: `${segment.left * 100}%`, width: `${segment.width * 100}%` }"
          ></i>
        </span>
      </button>
    </li>
  </ul>
</template>

<style lang="scss">
.crew-roster {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0 var(--space-8) var(--space-12);
  list-style: none;

  &__item {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-4) var(--space-12);
    align-items: center;
    width: 100%;
    padding: var(--space-8) var(--space-12);
    color: var(--color-text);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    transition: background-color var(--motion-fast) var(--ease);

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  &__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  &__text {
    display: grid;
    min-width: 0;

    strong {
      overflow: hidden;
      font-weight: 500;
      font-size: var(--text-sm);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    small {
      color: var(--color-text-subtle);
      font-size: var(--text-xs);
    }
  }

  &__span {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  &__day {
    position: relative;
    grid-column: 2 / -1;
    height: 6px;
    overflow: hidden;
    background: var(--color-surface-active);
    border-radius: 3px;
  }

  &__part {
    position: absolute;
    inset-block: 0;

    &--work {
      background: var(--crew);
      border-radius: 1px;
    }

    &--travel {
      background: var(--color-info);
      opacity: 0.55;
    }

    // Мелкая штриховка как у полосы занятости в расписании: крупная на 6px не читается.
    &--wait {
      background: repeating-linear-gradient(
        135deg,
        var(--color-text-subtle) 0 1.5px,
        transparent 1.5px 3.5px
      );
      opacity: 0.7;
    }
  }
}
</style>
