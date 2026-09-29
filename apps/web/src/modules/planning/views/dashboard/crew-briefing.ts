import type { PreparedDataset } from '@wayfinder/dataset'
import type { Plan, ReplanResult } from '@wayfinder/planner'
import type { DeepReadonly } from 'vue'
import {
  formatMinute,
  type priorityLabels,
  transportLabels,
  workLabel,
} from '../../../../shared/lib/format'
import { scheduleSegments } from './schedule-segments'

const historyLabels = {
  completed: 'Выполнено',
  'en-route': 'Зафиксирован выезд',
  waiting: 'Зафиксирован визит',
  'in-progress': 'Работа начата',
  'cancelled-en-route': 'Отмена в пути',
  'cancelled-waiting': 'Отмена до работы',
  'cancelled-in-progress': 'Работа отменена',
  interrupted: 'Работа прервана',
  'interrupted-en-route': 'Выезд прерван',
  'interrupted-waiting': 'Визит прерван до работы',
}

/**
 * Сводка текущего плана по бригадам: экран рисует её карточками, `briefingText` превращает в
 * текст для копирования и TXT. История не выдаётся за предстоящую работу.
 */
export function crewBriefing(
  dataset: DeepReadonly<PreparedDataset>,
  plan: Plan,
  orders: ReadonlyMap<
    string,
    { address: string; priority: keyof typeof priorityLabels; hdType?: string }
  >,
  replan?: ReplanResult,
) {
  const crews = dataset.engineers.map((engineer) => {
    const route = plan.routes.find((item) => item.engineerId === engineer.id)
    const records = replan?.history.filter((item) => item.engineerId === engineer.id) ?? []
    const continuation = replan?.continuations.find((item) => item.engineerId === engineer.id)
    const history = records.map((item) => {
      const segments = scheduleSegments(
        item.visit,
        item.state,
        item.recordedAtMin ?? replan?.event.atMin,
      )
      const work = segments.find((segment) => segment.kind === 'work')
      return {
        orderId: item.visit.orderId,
        label: historyLabels[item.state],
        startMin: work?.start ?? segments[0]?.start ?? item.visit.startMin,
        endMin: segments.at(-1)?.end ?? item.visit.startMin,
        address: orders.get(item.visit.orderId)?.address ?? item.visit.orderId,
      }
    })
    let from =
      dataset.points.find((point) => point.id === (continuation?.pointId ?? engineer.startPointId))
        ?.address ?? (replan ? 'точки продолжения маршрута' : 'стартовой точки')
    const visits = (route?.visits ?? []).map((visit) => {
      const order = orders.get(visit.orderId)
      const address = order?.address ?? visit.orderId
      const stop = {
        orderId: visit.orderId,
        departMin: visit.arrivalMin - visit.travel.durationMin,
        from,
        startMin: visit.startMin,
        endMin: visit.endMin,
        kind: order ? workLabel(order) : 'Работа',
        emergency: order?.priority === 'emergency',
        address,
        travelMin: Math.round(visit.travel.durationMin),
        waitMin: Math.round(visit.waitMin),
        approximate: visit.travel.approximate,
      }
      from = address
      return stop
    })
    return {
      id: engineer.id,
      name: engineer.name,
      transport: transportLabels[engineer.transport],
      history,
      visits,
      splitHistory: visits.length > 0 && (history.length > 0 || continuation !== undefined),
      empty:
        visits.length > 0
          ? undefined
          : replan
            ? 'Предстоящих визитов нет.'
            : 'Свободна весь день (резерв).',
    }
  })
  return {
    title: `${dataset.title} · ${dataset.day}`,
    scope: `Модельное время (${dataset.timezone}); ${replan ? `остаток дня после ${formatMinute(replan.event.atMin)}` : plan.kind === 'baseline' ? 'базовый план на день' : 'улучшенный план на день'}.`,
    crews,
    unassigned: plan.unassigned.map((item) => item.orderId),
  }
}

/** Текст сводки для буфера обмена и TXT. */
export function briefingText(briefing: ReturnType<typeof crewBriefing>): string {
  const lines = [briefing.title, briefing.scope]
  for (const crew of briefing.crews) {
    lines.push('', `${crew.name} · ${crew.transport}`)
    for (const item of crew.history)
      lines.push(
        `${item.label}: ${formatMinute(item.startMin)}–${formatMinute(item.endMin)}, ${item.address}.`,
      )
    if (crew.empty !== undefined) {
      lines.push(crew.empty)
      continue
    }
    if (crew.splitHistory)
      lines.push('Начатые и выполненные визиты остаются в истории; ниже — только предстоящие.')
    for (const visit of crew.visits)
      lines.push(
        `${formatMinute(visit.departMin)} выезд от точки «${visit.from}» → ${formatMinute(visit.startMin)}–${formatMinute(visit.endMin)} ${visit.kind}, ${visit.address} (в пути ${visit.travelMin} мин${visit.waitMin > 0 ? `; резерв до визита ${visit.waitMin} мин` : ''}${visit.approximate ? '; переезд приближённый' : ''}).`,
      )
  }
  if (briefing.unassigned.length)
    lines.push('', `Без назначения: ${briefing.unassigned.join(', ')}.`)
  return lines.join('\n')
}
