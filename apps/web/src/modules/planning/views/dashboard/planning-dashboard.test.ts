// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { parsePreparedDataset, toPlanInput } from '@wayfinder/dataset'
import {
  comparePlans,
  engineerLowerBound,
  planBaseline,
  planOptimized,
  replanAfterEvent,
} from '@wayfinder/planner'
import eastSource from '../../../../../../../datasets/prepared/east.json'
import PlanningDashboard from './planning-dashboard.vue'

vi.mock('./planning-map.vue', () => ({ default: { render: () => null } }))
vi.mock('./planning-schedule.vue', () => ({ default: { render: () => null } }))

const dataset = parsePreparedDataset(eastSource)
const input = toPlanInput(dataset)
const baseline = planBaseline(input)
const optimized = planOptimized(input)
const atMin = 810
const facts = optimized.plan.routes.flatMap((route) =>
  route.visits
    .filter((visit) => visit.endMin <= atMin)
    .map((visit) => ({
      orderId: visit.orderId,
      status: 'completed' as const,
    })),
)
const replan = replanAfterEvent(
  input,
  optimized.plan,
  {
    kind: 'engineer-unavailable',
    engineerId: 'E01',
    atMin,
  },
  facts,
)

let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})

const screen = ref<'plan' | 'events' | 'analysis'>('plan')

function mount(selectedOrderId: string) {
  screen.value = 'plan'
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(PlanningDashboard, {
        screen: screen.value,
        dataset,
        plan: replan.plan,
        baseline,
        optimized: optimized.plan,
        comparison: comparePlans(baseline, optimized.plan),
        lowerBound: engineerLowerBound(input),
        search: replan.search,
        violations: replan.violations.length,
        elapsedMs: 0,
        selectedOrderId,
        visibleKind: 'optimized',
        replan,
        manualAssignment: undefined,
        eventPoint: undefined,
      }),
  })
  app.mount(host)
  return host.querySelector('.workspace__details')!
}

describe('карточка заявки после недоступности инженера', () => {
  it('показывает причину неназначения прерванной работы без прежнего назначения', () => {
    expect(replan.violations).toEqual([])
    expect(replan.history).toContainEqual(
      expect.objectContaining({
        state: 'interrupted',
        visit: expect.objectContaining({ orderId: '54964' }),
      }),
    )
    expect(replan.plan.unassigned.some((item) => item.orderId === '54964')).toBe(true)
    const card = mount('54964')
    expect(card.querySelector('.status')?.textContent).toContain('Не назначена')
    expect(card.querySelector('.explanation--warning')?.textContent).toContain(
      'Заявка не помещается',
    )
    expect(card.querySelectorAll('.rejections li').length).toBeGreaterThan(0)
    expect(card.querySelector('.order-card__engineer')).toBeNull()
    expect(card.querySelector('.visit-time__label')?.textContent).toContain('Окно заявки')
    expect(card.querySelector('.order-history')?.textContent).toContain('Работа прервана')
  })

  it('сохраняет выполненный визит в карточке истории', () => {
    const completed = replan.history.find((item) => item.state === 'completed')!
    const card = mount(completed.visit.orderId)
    expect(card.querySelector('.status')?.textContent).toContain('Выполнена')
    expect(card.querySelector('.order-card__engineer')?.textContent).toContain(
      dataset.engineers.find((engineer) => engineer.id === completed.engineerId)!.name,
    )
    expect(card.querySelector('.explanation--warning')).toBeNull()
  })
})

describe('разделы рабочего места', () => {
  it('разделяет план, события и анализ, сохраняя выбранную заявку', async () => {
    const visit = replan.history.find((item) => item.state === 'completed')!.visit
    const card = mount(visit.orderId)
    const workspace = card.closest('.workspace')!
    expect(workspace.querySelector('.workspace__event')).toBeNull()
    expect(workspace.querySelector('.workspace__settings')).toBeNull()
    const selectScreen = async (value: 'plan' | 'events' | 'analysis') => {
      screen.value = value
      await nextTick()
    }
    await selectScreen('events')
    expect(workspace.querySelector('.workspace__details')).toBeNull()
    expect(workspace.textContent).toContain('История событий')
    expect(workspace.textContent).toContain('Следующее событие')
    expect(workspace.querySelector('.workspace__settings')).toBeNull()
    await selectScreen('analysis')
    expect(workspace.querySelector('.workspace__settings')).not.toBeNull()
    expect(workspace.querySelector('.workspace__event')).toBeNull()
    await selectScreen('plan')
    expect(workspace.querySelector('.workspace__details')?.textContent).toContain(
      dataset.orders.find((order) => order.id === visit.orderId)!.address,
    )
    expect(workspace.querySelector('.order-card__summary')?.textContent).toContain(
      'Другие варианты',
    )
    const briefingButton = [...workspace.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === 'Сводка',
    )!
    briefingButton.click()
    await nextTick()
    expect(workspace.querySelector('.crew-briefing')?.textContent).toContain(
      'остаток дня после 13:30',
    )
    expect(workspace.querySelector('.crew-briefing')?.textContent).toContain('Выполнено')
  })
})
