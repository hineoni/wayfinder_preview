<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
} from 'reka-ui'
import { formatMinute } from '../../../../shared/lib/format'
const props = defineProps<{
  start: number
  end: number
  atMin: number | undefined
  visits: readonly {
    key: string
    startMin: number
    endMin: number
    row: number
    color: string
    title: string
    address: string
    orderId: string
  }[]
  rows: readonly { name: string; color: string }[]
}>()
const selectedKey = ref<string>()
const selected = computed(() => props.visits.find((visit) => visit.key === selectedKey.value))
// Не переносим закреплённую карточку на другую ревизию или сценарий.
watch(
  () => props.visits,
  () => {
    selectedKey.value = undefined
  },
)
const span = computed(() => Math.max(1, props.end - props.start))
const at = (minute: number) =>
  `${Math.min(100, Math.max(0, ((minute - props.start) / span.value) * 100))}%`
const hours = computed(() => {
  const values = [props.start]
  for (let hour = Math.ceil((props.start + 30) / 60) * 60; hour < props.end - 30; hour += 60)
    values.push(hour)
  values.push(props.end)
  return values
})
function details(visit: (typeof props.visits)[number]) {
  return `${props.rows[visit.row]?.name}: ${visit.title}. По плану ${formatMinute(visit.startMin)}–${formatMinute(visit.endMin)}. ${visit.address}. Заявка № ${visit.orderId}`
}
</script>
<template>
  <div class="day-ruler">
    <p
      v-if="atMin !== undefined"
      class="day-ruler__event-label"
    >
      Время события: {{ formatMinute(atMin) }}
    </p>
    <TooltipProvider :delay-duration="150">
      <div
        class="day-ruler__scroll"
        role="region"
        aria-label="Начала визитов по бригадам; шкала прокручивается по горизонтали"
        tabindex="0"
      >
        <div class="day-ruler__canvas">
          <div class="day-ruler__header">
            <span class="day-ruler__name">Бригада</span>
            <div
              class="day-ruler__axis"
              aria-hidden="true"
            >
              <span
                v-for="hour in hours"
                :key="hour"
                class="day-ruler__tick"
                :style="{ left: at(hour) }"
              >
                {{ formatMinute(hour) }}
              </span>
            </div>
          </div>
          <div
            v-for="(row, rowIndex) in rows"
            :key="rowIndex"
            class="day-ruler__row"
          >
            <span class="day-ruler__name">
              <i :style="{ background: row.color }" />
              {{ row.name }}
            </span>
            <div class="day-ruler__track">
              <span
                v-if="atMin !== undefined"
                class="day-ruler__past"
                :style="{ width: at(atMin) }"
              />
              <i
                v-for="hour in hours"
                :key="hour"
                class="day-ruler__grid"
                :style="{ left: at(hour) }"
              />
              <i
                v-if="atMin !== undefined"
                class="day-ruler__marker"
                :style="{ left: at(atMin) }"
              />
              <TooltipRoot
                v-for="visit in visits.filter((item) => item.row === rowIndex)"
                :key="visit.key"
              >
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    class="day-ruler__point"
                    :class="{
                      'day-ruler__point--past': atMin !== undefined && visit.startMin < atMin,
                      'day-ruler__point--selected': selectedKey === visit.key,
                    }"
                    :style="{ left: at(visit.startMin), '--crew': visit.color }"
                    :aria-label="details(visit)"
                    :aria-pressed="selectedKey === visit.key"
                    @click="selectedKey = selectedKey === visit.key ? undefined : visit.key"
                  >
                    <span />
                  </button>
                </TooltipTrigger>
                <TooltipPortal>
                  <TooltipContent
                    class="day-ruler__tooltip"
                    :side-offset="6"
                    :collision-padding="12"
                  >
                    <strong>{{ row.name }} · {{ visit.title }}</strong>
                    <span>
                      По плану {{ formatMinute(visit.startMin) }}–{{ formatMinute(visit.endMin) }}
                    </span>
                    <span>{{ visit.address }}</span>
                    <small>Заявка № {{ visit.orderId }} · Нажмите, чтобы закрепить детали</small>
                  </TooltipContent>
                </TooltipPortal>
              </TooltipRoot>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
    <p
      v-if="!rows.length"
      class="day-ruler__help"
    >
      В плане нет визитов.
    </p>
    <div
      v-if="selected"
      class="day-ruler__details"
      aria-live="polite"
    >
      <p>{{ details(selected) }}</p>
      <button
        type="button"
        @click="selectedKey = undefined"
      >
        Закрыть детали
      </button>
    </div>
    <div class="day-ruler__help">
      <strong>Как читать график</strong>
      <p>
        Каждая строка — бригада, точка — начало визита, цвет — бригада. Слева направо идёт время.
        Вертикальная линия отмечает время события, штриховка — время до него.
      </p>
      <p>
        Наведите на точку, выберите её клавишей Tab или нажмите, чтобы узнать детали. Нажатие
        закрепляет их под графиком. Промежутки между точками не означают, что бригада свободна.
        Время визитов указано по плану, а не как подтверждение выполнения.
      </p>
    </div>
  </div>
</template>
<style lang="scss">
.day-ruler {
  display: grid;
  gap: var(--space-16);
  min-width: 0;

  &__event-label {
    margin: 0;
    color: var(--color-accent);
    font-weight: 600;
  }

  &__scroll {
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
  }

  &__canvas {
    min-width: 1100px;
    padding-right: 24px;
  }

  &__header,
  &__row {
    display: grid;
    grid-template-columns: 190px 1fr;
  }

  &__header {
    padding-block: 12px;
  }

  &__row {
    border-top: 1px solid var(--color-border);
  }

  &__row:hover,
  &__row:focus-within {
    background: var(--color-surface-hover);
  }

  &__name {
    position: sticky;
    left: 0;
    z-index: 5;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px;
    font-size: 14px;
    background: var(--color-surface);
  }

  &__name i {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  &__axis {
    position: relative;
    align-self: center;
    height: 20px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  &__tick {
    position: absolute;
    transform: translateX(-50%);
  }

  &__tick:first-child {
    transform: none;
  }

  &__tick:last-child {
    transform: translateX(-100%);
  }

  &__track {
    position: relative;
    min-height: 48px;
  }

  &__past {
    position: absolute;
    inset-block: 0;
    left: 0;
    background: repeating-linear-gradient(
      135deg,
      var(--color-surface-active) 0 1px,
      transparent 1px 6px
    );
  }

  &__grid {
    position: absolute;
    inset-block: 0;
    width: 1px;
    background: var(--color-border);
  }

  &__marker {
    position: absolute;
    z-index: 1;
    inset-block: 0;
    width: 2px;
    background: var(--color-accent);
  }

  &__point {
    position: absolute;
    top: 50%;
    z-index: 2;
    display: grid;
    width: 28px;
    height: 40px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 6px;
    transform: translate(-50%, -50%);
    cursor: pointer;
    place-items: center;
  }

  &__point span {
    width: 12px;
    height: 12px;
    background: var(--crew);
    border: 2px solid var(--color-surface);
    border-radius: 50%;
  }

  &__point--past span {
    opacity: 0.5;
  }

  &__point:hover,
  &__point:focus-visible,
  &__point--selected {
    z-index: 4;
    outline: 2px solid var(--crew);
    outline-offset: -3px;
  }

  &__point:hover span,
  &__point:focus-visible span,
  &__point--selected span {
    opacity: 1;
  }

  &__tooltip {
    z-index: 100;
    display: grid;
    gap: 6px;
    max-width: min(360px, calc(100vw - 24px));
    padding: 14px;
    color: var(--color-text);
    font-size: 14px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: 0 8px 28px #0003;
  }

  &__details {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: var(--color-surface-hover);
    border-radius: var(--radius-sm);
  }

  &__details p {
    margin: 0;
  }

  &__details button {
    min-height: 44px;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  &__help {
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.6;
  }

  &__help p {
    margin: 6px 0 0;
  }
}
</style>
