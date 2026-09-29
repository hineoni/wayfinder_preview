// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { parsePreparedDataset, toPlanInput } from '@wayfinder/dataset'
import { planBaseline } from '@wayfinder/planner'
import eastSource from '../../../../../../../datasets/prepared/east.json'
import PlanningSchedule from './planning-schedule.vue'

const dataset = parsePreparedDataset(eastSource)
const input = toPlanInput(dataset)
const plan = planBaseline({ ...input, orders: input.orders.slice(0, 1), engineers: [] })
const orderId = plan.unassigned[0]!.orderId
let app: App | undefined
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
})
function mount(canAssign: boolean, selectedOrderId: string | undefined = orderId) {
  const assigned: string[][] = []
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () =>
      h(PlanningSchedule, {
        dataset,
        plan,
        orders: new Map(dataset.orders.map((o) => [o.id, o])),
        replan: undefined,
        selectedOrderId,
        canAssign,
        unassignedReasons: new Map([[orderId, 'Нет подходящей бригады']]),
        onAssign: (order, engineer) => assigned.push([order, engineer]),
      }),
  })
  app.mount(host)
  return { host, assigned }
}
function dragEvent(
  type: string,
  dataTransfer: {
    getData: () => string
    setData: (type: string, value: string) => void
    effectAllowed: string
    dropEffect: string
  },
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}
describe('назначение из карточек расписания', () => {
  it('передаёт выбранную заявку и бригаду без выдуманного времени старта', async () => {
    const { host, assigned } = mount(true)
    await nextTick()
    host.querySelector<HTMLButtonElement>('.day-schedule__reserve-assign')!.click()
    expect(assigned).toEqual([[orderId, dataset.engineers[0]!.id]])
  })
  it('принимает только перенос карточки из текущего списка, а не внешний текст', async () => {
    const { host, assigned } = mount(true)
    await nextTick()
    let value = orderId
    const transfer = {
      effectAllowed: '',
      dropEffect: '',
      getData: () => value,
      setData: (_type: string, data: string) => {
        value = data
      },
    }
    const row = host.querySelector('.day-schedule__reserve-assign')!
    row.dispatchEvent(dragEvent('drop', transfer))
    expect(assigned).toEqual([])
    host.querySelector('.backlog__card')!.dispatchEvent(dragEvent('dragstart', transfer))
    row.dispatchEvent(dragEvent('drop', transfer))
    expect(assigned).toEqual([[orderId, dataset.engineers[0]!.id]])
    row.dispatchEvent(dragEvent('drop', transfer))
    expect(assigned).toHaveLength(1)
  })
  it('открывает цели резерва при переносе без предварительного выбора заявки', async () => {
    const { host, assigned } = mount(true, '')
    expect(host.querySelector('.day-schedule__row')).toBeNull()
    expect(host.querySelector('.day-schedule__reserve-assign')).toBeNull()
    const transfer = {
      effectAllowed: '',
      dropEffect: '',
      getData: () => orderId,
      setData: () => {},
    }
    host.querySelector('.backlog__card')!.dispatchEvent(dragEvent('dragstart', transfer))
    await nextTick()
    host.querySelector('.day-schedule__reserve-assign')!.dispatchEvent(dragEvent('drop', transfer))
    expect(assigned).toEqual([[orderId, dataset.engineers[0]!.id]])
  })
  it('не позволяет назначение в режиме просмотра', async () => {
    const { host, assigned } = mount(false)
    await nextTick()
    expect(host.querySelector('.day-schedule__reserve-assign')).toBeNull()
    expect(host.querySelector('.backlog__card')?.getAttribute('draggable')).toBe('false')
    const transfer = {
      effectAllowed: '',
      dropEffect: '',
      getData: () => orderId,
      setData: () => {},
    }
    host.querySelector('.backlog__card')!.dispatchEvent(dragEvent('dragstart', transfer))
    host.querySelector('.day-schedule__reserve')!.dispatchEvent(dragEvent('drop', transfer))
    expect(assigned).toEqual([])
  })
})
