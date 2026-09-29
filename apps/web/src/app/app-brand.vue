<script setup lang="ts">
import { ref, useId } from 'vue'

const id = useId()
const arrived = ref(false)
// Один путь без перезапуска: W → короткая дуга → перекладина F → точка i.
const routeTrace = 'M5 9 9 27 16 8 23 27 28 8C31 -2 48 8 66 8H82'
const ayTrace = 'M44 15v12m0-6a6 6 0 1 0-12 0 6 6 0 0 0 12 0M48 15l6 12m6-12-8 18q-1 2-4 2'
const sections = [
  {
    key: 'way',
    color: 'var(--color-brand-way)',
  },
  {
    key: 'fi',
    color: 'var(--color-brand-fi)',
  },
  {
    key: 'n',
    color: 'var(--color-brand-fi)',
  },
  {
    key: 'der',
    color: 'var(--color-brand-der)',
  },
] as const
</script>

<template>
  <a
    class="app-sidebar__brand"
    href="#"
    aria-label="WayFinder — Выезды инженеров"
    @pointerleave="arrived = false"
    @blur="arrived = false"
  >
    <svg
      class="app-sidebar__wordmark"
      viewBox="0 0 160 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient :id="`${id}-comet-light`">
          <stop
            offset="0"
            stop-color="var(--color-brand-highlight)"
            stop-opacity="0.8"
          />
          <stop
            offset="1"
            stop-color="var(--color-brand-highlight)"
            stop-opacity="0"
          />
        </radialGradient>
        <clipPath :id="`${id}-travel-hatching`">
          <path d="M125 36H174V42H122Z" />
        </clipPath>
        <clipPath :id="`${id}-schedule-strip`">
          <rect
            x="112"
            y="36"
            width="42"
            height="6"
            rx="1"
          />
        </clipPath>
        <clipPath :id="`${id}-flight`">
          <rect
            x="28"
            y="0"
            width="38"
            height="12"
          />
        </clipPath>
        <filter
          :id="`${id}-f-shadow`"
          x="-40%"
          y="-25%"
          width="160%"
          height="150%"
          color-interpolation-filters="sRGB"
        >
          <feMorphology
            in="SourceAlpha"
            operator="dilate"
            radius="0.8"
          />
          <feGaussianBlur stdDeviation="1.4" />
          <feOffset
            dx="-4"
            dy="0.5"
            result="shadow"
          />
          <feFlood
            flood-color="var(--color-brand-shadow)"
            flood-opacity="0.5"
          />
          <feComposite
            in2="shadow"
            operator="in"
          />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter
          :id="`${id}-halo`"
          x="-15%"
          y="-25%"
          width="130%"
          height="150%"
          color-interpolation-filters="sRGB"
        >
          <feMorphology
            in="SourceAlpha"
            operator="dilate"
            radius="1"
          />
          <feGaussianBlur
            stdDeviation="1.1"
            result="halo"
          />
          <feFlood flood-color="var(--color-sidebar)" />
          <feComposite
            in2="halo"
            operator="in"
          />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <text
          :id="`${id}-way`"
          class="app-sidebar__font-text"
          x="3"
          y="27"
          textLength="57"
          lengthAdjust="spacingAndGlyphs"
        >
          Way
        </text>
        <g :id="`${id}-fi`">
          <path
            d="M64.55 27V6.55H81.6L80.1 9.45H67.45V15.55H79V18.45H67.45V27Z"
            fill="currentColor"
          />
          <path
            d="M85 14v13"
            stroke="currentColor"
            stroke-width="2.9"
            stroke-linecap="butt"
          />
        </g>
        <text
          :id="`${id}-n`"
          class="app-sidebar__font-text"
          x="90"
          y="27"
          textLength="16"
          lengthAdjust="spacingAndGlyphs"
        >
          n
        </text>
        <g :id="`${id}-der`">
          <text
            class="app-sidebar__font-text"
            x="107"
            y="27"
            textLength="16"
            lengthAdjust="spacingAndGlyphs"
          >
            d
          </text>
          <text
            class="app-sidebar__font-text"
            x="123"
            y="27"
            textLength="31"
            lengthAdjust="spacingAndGlyphs"
          >
            er
          </text>
        </g>
        <!-- Маска удерживает маршрут и цветные участки внутри штрихов Onest. -->
        <mask
          :id="`${id}-way-mask`"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="160"
          height="40"
        >
          <use
            :href="`#${id}-way`"
            color="white"
          />
        </mask>
      </defs>
      <g
        v-for="section in sections"
        :key="section.key"
        class="app-sidebar__word-part"
        :class="{
          'app-sidebar__word-part--joined': section.key !== 'way',
          'app-sidebar__word-part--overlap': section.key === 'der',
        }"
        :style="{ color: section.color }"
        :filter="section.key === 'der' ? `url(#${id}-halo)` : undefined"
      >
        <use
          :href="`#${id}-${section.key}`"
          :filter="section.key === 'fi' ? `url(#${id}-f-shadow)` : undefined"
        />
        <template v-if="section.key === 'fi'">
          <path
            d="M73 5l-2 6m7-6-2 6M82 22l6-2"
            stroke="var(--color-sidebar)"
            stroke-width="1.4"
          />
          <circle
            class="app-sidebar__route-stop"
            :class="{ 'app-sidebar__route-stop--arrived': arrived }"
            cx="85"
            cy="8"
            r="1.7"
            fill="currentColor"
            @animationend="arrived = false"
          />
        </template>
        <template v-if="section.key === 'way'">
          <g :mask="`url(#${id}-way-mask)`">
            <path
              d="M20 8H30L26 17L23 18L20 27H16L20 15L23 13Z"
              fill="var(--color-brand-der)"
            />
            <path
              d="M3 17L17 14M4 22L16 19"
              stroke="var(--color-sidebar)"
              stroke-width="1.5"
            />
          </g>
          <circle
            cx="5"
            cy="9"
            r="1.8"
            fill="var(--color-sidebar)"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <g
            :mask="`url(#${id}-way-mask)`"
            stroke="var(--color-sidebar)"
            stroke-width="0.9"
            stroke-linecap="round"
          >
            <path
              class="app-sidebar__route-trace app-sidebar__route-trace--ay"
              :d="ayTrace"
              pathLength="100"
            />
          </g>
        </template>
      </g>
      <g :mask="`url(#${id}-way-mask)`">
        <ellipse
          class="app-sidebar__comet-reflection"
          cx="0"
          cy="18"
          rx="9"
          ry="16"
          :fill="`url(#${id}-comet-light)`"
        />
      </g>
      <!-- Светлый участок перекрывает тёмный штрих только на перелёте. -->
      <g
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          class="app-sidebar__route-trace app-sidebar__route-trace--journey"
          :d="routeTrace"
          pathLength="100"
          stroke="var(--color-sidebar)"
          stroke-width="0.9"
        />
        <path
          class="app-sidebar__route-trace app-sidebar__route-trace--journey"
          :d="routeTrace"
          :clip-path="`url(#${id}-flight)`"
          pathLength="100"
          stroke="var(--color-text)"
          stroke-width="1.8"
          @animationend="arrived = true"
        />
      </g>
      <g :clip-path="`url(#${id}-schedule-strip)`">
        <rect
          x="112"
          y="36"
          width="42"
          height="6"
          fill="var(--color-brand-fi)"
        />
        <g class="app-sidebar__route-slot app-sidebar__route-slot--travel">
          <path
            d="M125 36H174V42H122Z"
            fill="currentColor"
          />
          <g :clip-path="`url(#${id}-travel-hatching)`">
            <path
              class="app-sidebar__hatching-flow"
              d="M110 39H190"
              transform="matrix(1 0 -0.5 1 19.5 0)"
              stroke="var(--color-sidebar)"
              stroke-width="6"
            />
          </g>
        </g>
        <path
          class="app-sidebar__route-slot app-sidebar__route-slot--work"
          d="M147 36H174V42H144Z"
          fill="var(--color-brand-der)"
        />
      </g>
      <text
        class="app-sidebar__tagline"
        x="3"
        y="43"
        textLength="102"
        lengthAdjust="spacing"
      >
        Выезды инженеров
      </text>
    </svg>
  </a>
</template>
