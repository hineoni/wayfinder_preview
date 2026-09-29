<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import UiButton from '../shared/ui/ui-button.vue'
import UiIcon from '../shared/ui/ui-icon.vue'
import { onboardingSteps, screenTarget } from './onboarding-steps'
import {
  findTourTarget,
  isolateTour,
  tourFocusable,
  tourPanelPosition,
  visibleTourRect,
  type TourRect,
} from './onboarding-dom'

const props = defineProps<{ ready: boolean; screen: 'plan' | 'events' | 'analysis' }>()
const storageKey = 'wayfinder-onboarding-v1'
const phase = ref<'idle' | 'welcome' | 'tour' | 'done'>('idle')
const index = ref(0)
const layer = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const heading = ref<HTMLElement>()
const rect = ref<TourRect>()
const position = ref({ left: '12px', top: '12px' })
const missing = ref(false)
const actionDone = ref(false)
const id = useId()
const step = computed(() => onboardingSteps[index.value]!)
const screenNames = { plan: 'План', events: 'События', analysis: 'Анализ' }
const needsScreen = computed(
  () =>
    phase.value === 'tour' && step.value.screen !== undefined && props.screen !== step.value.screen,
)
const selector = computed(() =>
  needsScreen.value ? screenTarget(step.value.screen!) : step.value.target,
)
const interactive = computed(
  () => phase.value === 'tour' && (needsScreen.value || !!step.value.action) && !missing.value,
)
const title = computed(() =>
  needsScreen.value ? `Откройте раздел «${screenNames[step.value.screen!]}»` : step.value.title,
)
const instruction = computed(() =>
  needsScreen.value ? 'Нажмите выделенный раздел, чтобы продолжить этот шаг.' : step.value.action,
)
const highlightStyle = computed(() =>
  rect.value
    ? {
        left: `${rect.value.left}px`,
        top: `${rect.value.top}px`,
        width: `${rect.value.width}px`,
        height: `${rect.value.height}px`,
      }
    : undefined,
)
let checked = false
let previousFocus: HTMLElement | undefined
let target: HTMLElement | undefined
let releaseIsolation: (() => void) | undefined
let observer: MutationObserver | undefined
let resizeObserver: ResizeObserver | undefined
let frame = 0
let moving = false
let disposed = false
let stepVersion = 0

function remember(value: 'started' | 'skipped' | 'completed'): void {
  try {
    localStorage.setItem(storageKey, value)
  } catch {
    /* Хранилище может быть закрыто настройками браузера. */
  }
}
function offer(): void {
  if (!props.ready || checked) return
  checked = true
  try {
    if (localStorage.getItem(storageKey)) return
  } catch {
    /* Обучение доступно и без хранилища. */
  }
  open()
}
function open(): void {
  if (!props.ready || phase.value !== 'idle') return
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  phase.value = 'welcome'
}
function start(): void {
  remember('started')
  index.value = 0
  phase.value = 'tour'
}
function close(): void {
  if (phase.value === 'welcome') remember('skipped')
  phase.value = 'idle'
  cleanup()
  const focus =
    previousFocus?.isConnected && previousFocus !== document.body
      ? previousFocus
      : document.querySelector<HTMLElement>('[data-tour="help"]')
  focus?.focus({ preventScroll: true })
}
function advance(): void {
  if (index.value < onboardingSteps.length - 1) index.value += 1
  else {
    remember('completed')
    phase.value = 'done'
  }
}
function cleanup(): void {
  stepVersion += 1
  cancelAnimationFrame(frame)
  observer?.disconnect()
  resizeObserver?.disconnect()
  releaseIsolation?.()
  releaseIsolation = undefined
  target = undefined
}
function refresh(): void {
  if (phase.value === 'idle' || !panel.value || !layer.value) return
  releaseIsolation?.()
  target = phase.value === 'tour' ? findTourTarget(selector.value) : undefined
  missing.value = phase.value === 'tour' && !target
  actionDone.value =
    phase.value === 'tour' &&
    !needsScreen.value &&
    !!step.value.allowOpen &&
    !!step.value.result &&
    !!findTourTarget(step.value.result)
  rect.value = target ? visibleTourRect(target) : undefined
  const bounds = panel.value.getBoundingClientRect()
  position.value = tourPanelPosition(rect.value, bounds, {
    width: window.innerWidth,
    height: window.innerHeight,
  })
  releaseIsolation = isolateTour(
    interactive.value && target ? [layer.value, target] : [layer.value],
  )
}
function scheduleRefresh(): void {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(refresh)
}
async function showStep(): Promise<void> {
  cleanup()
  if (phase.value === 'idle') return
  const version = stepVersion
  await nextTick()
  if (disposed || version !== stepVersion || !panel.value) return
  const element = phase.value === 'tour' ? findTourTarget(selector.value) : undefined
  element?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  refresh()
  heading.value?.focus({ preventScroll: true })
  observer = new MutationObserver(scheduleRefresh)
  observer.observe(document.body, { childList: true, subtree: true })
  resizeObserver = new ResizeObserver(scheduleRefresh)
  resizeObserver.observe(panel.value)
  if (element) resizeObserver.observe(element)
}
async function onClick(event: MouseEvent): Promise<void> {
  if (
    moving ||
    phase.value !== 'tour' ||
    !interactive.value ||
    !target ||
    !(event.target instanceof Node) ||
    !target.contains(event.target)
  )
    return
  // Переход ждёт обработчика настоящей кнопки и обновления Vue. Программных кликов нет.
  if (needsScreen.value) return
  const clickedIndex = index.value
  moving = true
  // Нативный click может отдавать микрозадачи между capture и обработчиком контрола.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await nextTick()
  if (
    !disposed &&
    phase.value === 'tour' &&
    index.value === clickedIndex &&
    (!step.value.result || findTourTarget(step.value.result))
  )
    advance()
  moving = false
}
function onKeydown(event: KeyboardEvent): void {
  if (phase.value === 'idle') return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'Tab' && panel.value) {
    const roots = interactive.value && target ? [target, panel.value] : [panel.value]
    const items = tourFocusable(roots)
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next = event.shiftKey
      ? current <= 0
        ? items.length - 1
        : current - 1
      : (current + 1) % items.length
    items[next]?.focus({ preventScroll: true })
  }
}
watch(() => props.ready, offer)
watch([phase, index, needsScreen], () => {
  void showStep()
})
onMounted(() => {
  offer()
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', scheduleRefresh)
  window.addEventListener('scroll', scheduleRefresh, true)
})
onBeforeUnmount(() => {
  disposed = true
  cleanup()
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', scheduleRefresh)
  window.removeEventListener('scroll', scheduleRefresh, true)
})
defineExpose({ open })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="phase !== 'idle'"
      ref="layer"
      class="onboarding"
    >
      <div
        v-if="rect && phase === 'tour'"
        class="onboarding__spotlight"
        :style="highlightStyle"
        aria-hidden="true"
      />
      <div
        v-else
        class="onboarding__shade"
        aria-hidden="true"
      />
      <section
        ref="panel"
        class="onboarding__panel"
        :class="{ 'onboarding__panel--intro': phase !== 'tour' }"
        :style="position"
        role="dialog"
        :aria-modal="!interactive"
        :aria-labelledby="`${id}-title`"
        :aria-describedby="`${id}-description`"
      >
        <header class="onboarding__header">
          <span
            v-if="phase === 'tour'"
            class="onboarding__eyebrow"
          >
            {{ step.chapter }}
          </span>
          <UiButton
            variant="ghost"
            icon
            size="sm"
            class="onboarding__close"
            aria-label="Закрыть обучение"
            @click="close"
          >
            <UiIcon name="close" />
          </UiButton>
        </header>
        <template v-if="phase === 'welcome'">
          <div
            class="onboarding__symbol"
            aria-hidden="true"
          >
            <UiIcon name="route" />
          </div>
          <h2
            :id="`${id}-title`"
            ref="heading"
            class="onboarding__title"
            tabindex="-1"
          >
            Первый день в WayFinder?
          </h2>
          <p
            :id="`${id}-description`"
            class="onboarding__text"
          >
            Давайте пройдём рабочий день вместе: от маршрута бригады до событий и анализа. Вы
            нажимаете кнопки, мы подсказываем следующий шаг.
          </p>
          <ol class="onboarding__chapters">
            <li>
              <span>01</span>
              План, карта и заявки
            </li>
            <li>
              <span>02</span>
              События и изменения дня
            </li>
            <li>
              <span>03</span>
              Анализ и свои данные
            </li>
          </ol>
          <p class="onboarding__meta">
            {{ onboardingSteps.length }} коротких шагов · можно выйти в любой момент
          </p>
          <footer class="onboarding__footer">
            <UiButton
              variant="ghost"
              @click="close"
            >
              Пропустить
            </UiButton>
            <UiButton
              variant="primary"
              @click="start"
            >
              Пройти обучение
              <UiIcon name="chevron-right" />
            </UiButton>
          </footer>
        </template>
        <template v-else-if="phase === 'done'">
          <div
            class="onboarding__symbol"
            aria-hidden="true"
          >
            <UiIcon name="check" />
          </div>
          <h2
            :id="`${id}-title`"
            ref="heading"
            class="onboarding__title"
            tabindex="-1"
          >
            Теперь можно работать с планом
          </h2>
          <p
            :id="`${id}-description`"
            class="onboarding__text"
          >
            Вы дошли до конца знакомства. Возвращайтесь к подсказкам через «Пройти обучение» в
            боковой панели, когда понадобится.
          </p>
          <footer class="onboarding__footer">
            <UiButton
              variant="primary"
              @click="close"
            >
              Готово
            </UiButton>
          </footer>
        </template>
        <template v-else>
          <div
            class="onboarding__progress"
            role="progressbar"
            aria-label="Прогресс обучения"
            :aria-valuenow="index + 1"
            :aria-valuemin="0"
            :aria-valuemax="onboardingSteps.length"
          >
            <span :style="{ width: `${((index + 1) / onboardingSteps.length) * 100}%` }" />
          </div>
          <div
            :key="`${index}-${needsScreen}`"
            class="onboarding__copy"
            aria-live="polite"
            aria-atomic="true"
          >
            <p class="onboarding__meta">Шаг {{ index + 1 }} из {{ onboardingSteps.length }}</p>
            <h2
              :id="`${id}-title`"
              ref="heading"
              class="onboarding__title"
              tabindex="-1"
            >
              {{ title }}
            </h2>
            <p
              :id="`${id}-description`"
              class="onboarding__text"
            >
              {{
                needsScreen
                  ? 'Этот шаг находится в другом разделе. Перейдите в него сами — обучение продолжится на том же месте.'
                  : step.text
              }}
            </p>
            <p
              v-if="missing"
              class="onboarding__hint"
            >
              Этот элемент недоступен в текущем состоянии плана. Можно пропустить шаг или вернуться
              к нему позже.
            </p>
            <p
              v-else-if="interactive"
              class="onboarding__hint"
            >
              <UiIcon name="chevron-right" />
              {{ actionDone ? 'Блок уже открыт — можно продолжить.' : instruction }}
            </p>
          </div>
          <footer class="onboarding__footer">
            <UiButton
              variant="ghost"
              :disabled="index === 0"
              @click="index -= 1"
            >
              Назад
            </UiButton>
            <UiButton
              v-if="!interactive || actionDone"
              variant="primary"
              @click="advance"
            >
              {{
                missing
                  ? 'Пропустить шаг'
                  : index === onboardingSteps.length - 1
                    ? 'Завершить'
                    : 'Далее'
              }}
              <UiIcon name="chevron-right" />
            </UiButton>
            <span
              v-else
              class="onboarding__waiting"
            >
              Ваш ход
            </span>
          </footer>
          <div class="onboarding__bottom">
            <span>Esc — выйти</span>
            <UiButton
              v-if="interactive && !actionDone"
              variant="ghost"
              size="sm"
              @click="advance"
            >
              Пропустить шаг
            </UiButton>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>
