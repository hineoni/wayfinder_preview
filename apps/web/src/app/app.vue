<script setup lang="ts">
import {
  GROUPS,
  type GeometryFile,
  type GeoPoint,
  type Group,
  type PreparedDataset,
} from '@wayfinder/dataset'
import ScenarioImport from '../modules/scenario/views/import/scenario-import.vue'
import type { PlanningEvent } from '@wayfinder/planner'
import { computed, onMounted, ref, shallowRef } from 'vue'
import { usePlanningSession } from '../modules/planning'
import PlanningDashboard from '../modules/planning/views/dashboard/planning-dashboard.vue'
import type { GeometryState } from '../modules/planning/views/dashboard/route-geometry'
import { groupLabels } from '../shared/lib/format'
import { useTheme } from '../shared/lib/theme'
import UiIcon from '../shared/ui/ui-icon.vue'
import UiNav from '../shared/ui/ui-nav.vue'
import UiSegmented from '../shared/ui/ui-segmented.vue'
import { getConflictScenario, getDataset, getGeometry } from './datasets'
import AppBrand from './app-brand.vue'
import AppOnboarding from './app-onboarding.vue'
import UiButton from '../shared/ui/ui-button.vue'

const onboarding = ref<InstanceType<typeof AppOnboarding>>()
const session = usePlanningSession()
const theme = useTheme()
const screen = ref<'plan' | 'events' | 'analysis'>('plan')
const revision = computed(() => session.published)
let loadId = 0
const loadingError = ref<string>()
const isLoading = ref(false)
const scenarioKey = ref<string>('east')
const importOpen = ref(false)
const importBase = shallowRef<PreparedDataset>()
/** Загруженная геометрия с именем файла: карта получает её только если файл совпадает с опубликованным набором. */
const loadedGeometry = shallowRef<{ file: string; state: GeometryState }>()
const geometry = computed<GeometryState>(() => {
  const file = revision.value?.dataset.travel.geometryFile
  const loaded = loadedGeometry.value
  return loaded !== undefined && loaded.file === file ? loaded.state : { status: 'loading' }
})

/** Геометрия дорог грузится после публикации плана, чтобы первый кадр её не ждал. */
async function loadGeometry(file: string): Promise<void> {
  try {
    const parsed = await getGeometry(file)
    loadedGeometry.value = { file, state: { status: 'ready', file: parsed } }
  } catch (cause) {
    console.error(cause)
    loadedGeometry.value = { file, state: { status: 'unavailable' } }
  }
}

async function loadScenario(key: Group | 'conflict' | 'custom'): Promise<void> {
  if (key === 'custom') {
    importOpen.value = true
    return
  }
  const group = key === 'conflict' ? 'east' : key
  const currentLoad = ++loadId
  loadingError.value = undefined
  isLoading.value = true
  try {
    const dataset = await getDataset(group)
    if (currentLoad !== loadId) return
    await session.setScenario(group, key === 'conflict' ? getConflictScenario(dataset) : dataset)
    if (currentLoad === loadId && session.status === 'ready') {
      scenarioKey.value = key
      importBase.value = dataset
      importOpen.value = false
      void loadGeometry(dataset.travel.geometryFile)
    }
  } catch (cause) {
    if (currentLoad !== loadId) return
    loadingError.value = cause instanceof Error ? cause.message : 'Не удалось загрузить сценарий'
  } finally {
    if (currentLoad === loadId) isLoading.value = false
  }
}

async function buildCustom(dataset: PreparedDataset): Promise<void> {
  const currentLoad = ++loadId
  loadingError.value = undefined
  await session.setScenario('custom', dataset)
  if (currentLoad === loadId && session.status === 'ready') {
    scenarioKey.value = 'custom'
    void loadGeometry(dataset.travel.geometryFile)
  }
}

function applyOperationalEvent(
  event: PlanningEvent,
  completedOrderIds: string[],
  eventPoint?: { id: string; address: string; coordinates: GeoPoint },
): void {
  void session.applyOperationalEvent(event, completedOrderIds, eventPoint)
}

function assignManually(orderId: string, engineerId: string): void {
  void session.assignManually(orderId, engineerId)
}

function exportPlan(): void {
  const current = session.published
  if (current === undefined) return
  const dataset = current.dataset
  const common = {
    exportedAt: new Date().toISOString(),
    scenario: {
      group: dataset.group,
      title: dataset.title,
      day: dataset.day,
      timezone: dataset.timezone,
    },
    input: {
      sources: dataset.sources,
      orders: dataset.orders,
      engineers: dataset.engineers,
      events: dataset.events,
    },
    assumptions: dataset.assumptions,
    agreements: current.agreements ?? [],
    events: current.events ?? [],
    morningTransfer: current.morningTransfer,
  }
  const exported =
    current.replan === undefined
      ? {
          format: 'wayfinder-plan-v1',
          ...common,
          baseline: current.baseline,
          optimized: current.optimized,
          comparison: current.comparison,
          validation: { violations: current.violations },
        }
      : {
          format: 'wayfinder-plan-v2',
          ...common,
          static: {
            baseline: current.baseline,
            optimized: current.optimized,
            comparison: current.comparison,
          },
          replan: current.replan,
          ...(current.eventPoint === undefined ? {} : { eventPoint: current.eventPoint }),
          validation: { replanViolations: current.violations },
        }
  const content = JSON.stringify(exported, undefined, 2)
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `wayfinder-${dataset.group}-${dataset.day}.json`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(() => loadScenario('east'))
</script>

<template>
  <div class="app-shell">
    <aside class="app-sidebar">
      <AppBrand />
      <UiNav
        v-model="screen"
        class="app-sidebar__screens"
        data-tour="navigation"
        label="Раздел рабочего места"
        :disabled="!revision"
        :options="[
          {
            value: 'plan',
            label: 'План',
            icon: 'map',
            badge: session.plan?.metrics.unassignedTotal || undefined,
            tone: 'danger',
          },
          {
            value: 'events',
            label: 'События',
            icon: 'pulse',
            badge: revision?.events?.length || undefined,
          },
          { value: 'analysis', label: 'Анализ', icon: 'chart' },
        ]"
      />
      <section
        class="app-sidebar__section"
        data-tour="scenarios"
        aria-labelledby="sidebar-scenario"
      >
        <h2
          id="sidebar-scenario"
          class="app-sidebar__caption"
        >
          Данные дня
        </h2>
        <UiNav
          :model-value="importOpen ? 'custom' : scenarioKey"
          label="Сценарий"
          :disabled="isLoading || session.status === 'running'"
          :options="[
            ...GROUPS.map((group) => ({
              value: group,
              label: groupLabels[group],
              icon: 'pin' as const,
            })),
            { value: 'conflict', label: 'Демо: авария', icon: 'bolt' },
            { value: 'custom', label: 'Свои данные', icon: 'upload' },
          ]"
          @update:model-value="loadScenario($event as Group | 'conflict' | 'custom')"
        />
      </section>
      <footer class="app-sidebar__footer">
        <UiButton
          data-tour="help"
          :disabled="!revision || isLoading || session.status === 'running'"
          @click="onboarding?.open()"
        >
          <UiIcon name="text" />
          Пройти обучение
        </UiButton>
        <p
          class="app-sidebar__state"
          :class="{ 'app-sidebar__state--busy': isLoading || session.status === 'running' }"
          role="status"
        >
          {{
            isLoading
              ? 'Загружаем данные…'
              : session.status === 'running'
                ? 'Рассчитываем план…'
                : revision?.replan
                  ? 'План после события'
                  : 'План на день'
          }}
        </p>
        <UiSegmented
          v-model="theme"
          class="app-sidebar__theme"
          data-tour="theme"
          label="Тема оформления"
          :options="[
            { value: 'dark', label: 'Тёмная' },
            { value: 'light', label: 'Светлая' },
          ]"
        />
      </footer>
    </aside>
    <div class="app-main">
      <p
        v-if="revision && (loadingError || session.error)"
        class="app-banner app-banner--error"
        role="alert"
      >
        {{ loadingError ?? `Не удалось обновить план: ${session.error}` }}
      </p>
      <ScenarioImport
        v-if="importOpen && importBase"
        :base="importBase"
        :busy="isLoading || session.status === 'running'"
        @build="buildCustom"
      />
      <p
        v-if="session.plan?.metrics.approximate"
        class="app-banner"
        role="status"
      >
        Для части адресов маршрут и время в пути рассчитаны приближённо.
      </p>
      <PlanningDashboard
        v-if="revision && session.dataset && session.plan"
        :key="revision.dataset.title"
        :screen
        :dataset="revision.dataset"
        :plan="session.plan"
        :baseline="revision.baseline"
        :optimized="revision.optimized"
        :comparison="revision.comparison"
        :lower-bound="revision.lowerBound"
        :search="revision.search"
        :violations="revision.violations.length"
        :elapsed-ms="revision.elapsedMs"
        :selected-order-id="session.selectedOrderId"
        :visible-kind="session.visibleKind"
        :replan="revision.replan"
        :manual-assignment="revision.manualAssignment"
        :event-point="revision.eventPoint"
        :geometry
        :assignment-options="session.assignmentOptions"
        :busy="session.status === 'running'"
        :is-conflict="scenarioKey === 'conflict'"
        :agreements="revision.agreements"
        :events="revision.events"
        :promise-conflict="session.promiseConflict"
        :readiness="session.analysis?.readiness"
        :equipment-preparation="session.analysis?.equipment"
        :analysis-busy="session.analysisBusy"
        :delay="session.delay"
        @confirm-time="session.confirmTime"
        @release-time="session.releaseTime"
        @resolve-conflict="session.resolvePromiseConflict"
        @run-analysis="session.runAnalysis"
        @cancel-analysis="session.cancelAnalysis"
        @apply-equipment="session.applyEquipmentPreparation"
        @inspect-delay="session.inspectDelay"
        @inspect-options="session.inspectAssignmentOptions"
        @select="session.selectOrder"
        @show-plan="session.showPlan"
        @replan="applyOperationalEvent"
        @assign-manually="assignManually"
        @export="exportPlan"
      />
      <main
        v-else
        class="app-loading"
        aria-live="polite"
      >
        <p v-if="loadingError">Не удалось загрузить сценарий: {{ loadingError }}</p>
        <p v-else-if="session.error">Не удалось построить план: {{ session.error }}</p>
        <p v-else>Строим базовый и улучшенный планы…</p>
      </main>
    </div>
    <AppOnboarding
      ref="onboarding"
      :ready="!!revision && !isLoading && session.status === 'ready'"
      :screen
    />
  </div>
</template>
