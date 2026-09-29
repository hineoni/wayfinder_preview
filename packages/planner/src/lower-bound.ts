import { SKILLS, TRANSPORTS, type Engineer, type Order, type PlanInput } from './contracts'

export interface EngineerLowerBound {
  /** Меньше инженеров не хватит ни одному плану, назначающему все учтённые заявки. */
  readonly engineers: number
  /** Учтённые заявки: есть совместимый инженер, достижимый подъезд и допустимое время начала. */
  readonly orders: number
}

interface Demand {
  readonly compatible: readonly Engineer[]
  readonly durationMin: number
  readonly approachMin: number
  readonly earliestStart: number
  readonly latestStart: number
}

/**
 * Нижняя граница числа задействованных инженеров для плана со всеми учтёнными заявками.
 * Два довода, берётся больший:
 * - за день: работа и кратчайший подъезд совместимого инженера укладываются в смены;
 * - за интервал: часть работы, которая при любом допустимом начале попадает в интервал,
 *   укладывается в время смен внутри него (например, вечернее окно у конца смены).
 * Считается по всем заявкам, по каждому навыку и по каждому требуемому транспорту.
 * Порядок визитов и оборудование не учитываются: граница может быть недостижимой,
 * но плана с меньшим числом инженеров не существует.
 */
export function engineerLowerBound(input: PlanInput): EngineerLowerBound {
  const demands = input.orders.flatMap((order) => {
    const demand = demandOf(input, order)
    return demand === undefined ? [] : [{ order, demand }]
  })
  const groups = [
    demands,
    ...SKILLS.map((skill) => demands.filter((item) => item.order.skill === skill)),
    ...TRANSPORTS.map((transport) => demands.filter((item) => item.order.transport === transport)),
  ]
  return {
    engineers: Math.max(0, ...groups.map((group) => groupBound(group.map((i) => i.demand)))),
    orders: demands.length,
  }
}

function demandOf(input: PlanInput, order: Order): Demand | undefined {
  const compatible = input.engineers.filter(
    (engineer) =>
      engineer.skills.includes(order.skill) &&
      (order.transport === undefined || engineer.transport === order.transport),
  )
  let approachMin = Infinity
  for (const transport of new Set(compatible.map((engineer) => engineer.transport))) {
    for (const other of input.orders) {
      if (other.id === order.id) continue
      const leg = input.travel.travel(transport, other.pointId, order.pointId)
      if (leg !== null) approachMin = Math.min(approachMin, leg.durationMin)
    }
  }
  let firstShiftStart = Infinity
  let lastShiftEnd = -Infinity
  for (const engineer of compatible) {
    const leg = input.travel.travel(engineer.transport, engineer.startPointId, order.pointId)
    if (leg !== null) approachMin = Math.min(approachMin, leg.durationMin)
    firstShiftStart = Math.min(firstShiftStart, engineer.shift.start)
    lastShiftEnd = Math.max(lastShiftEnd, engineer.shift.end)
  }
  // Любой визит начинается не раньше начала смены плюс входящий переезд; неравенство
  // треугольника для матриц не предполагается, поэтому берётся минимум по всем входящим рёбрам.
  const earliestStart = Math.max(
    order.window.start,
    order.availableFromMin,
    firstShiftStart + approachMin,
  )
  const latestStart = Math.min(order.window.end, lastShiftEnd - order.durationMin)
  if (!Number.isFinite(approachMin) || earliestStart > latestStart) return undefined
  return { compatible, durationMin: order.durationMin, approachMin, earliestStart, latestStart }
}

function groupBound(group: readonly Demand[]): number {
  if (group.length === 0) return 0
  const engineers = [...new Set(group.flatMap((item) => item.compatible))]
  let best = engineersFor(
    group.reduce((sum, item) => sum + item.durationMin + item.approachMin, 0),
    engineers.map((engineer) => engineer.shift.end - engineer.shift.start),
  )
  // Минимум перекрытия достигается на границе допустимых начал, поэтому достаточно
  // интервалов от самого раннего начала одной заявки до самого позднего окончания другой.
  const starts = [...new Set(group.map((item) => item.earliestStart))]
  const ends = [...new Set(group.map((item) => item.latestStart + item.durationMin))]
  for (const from of starts) {
    for (const to of ends) {
      if (to <= from) continue
      let load = 0
      for (const item of group)
        load += Math.min(
          overlap(item.earliestStart, item.durationMin, from, to),
          overlap(item.latestStart, item.durationMin, from, to),
        )
      const capacities = engineers.map((engineer) =>
        Math.max(0, Math.min(to, engineer.shift.end) - Math.max(from, engineer.shift.start)),
      )
      best = Math.max(best, engineersFor(load, capacities))
    }
  }
  return best
}

function overlap(start: number, duration: number, from: number, to: number): number {
  return Math.max(0, Math.min(start + duration, to) - Math.max(start, from))
}

/** Сколько наибольших ёмкостей нужно, чтобы вместить нагрузку; не больше числа инженеров. */
function engineersFor(load: number, capacities: readonly number[]): number {
  let capacity = 0
  let count = 0
  // Допуск против накопленной ошибки дробных минут переездов: граница не должна вырасти на 1.
  for (const value of capacities.toSorted((a, b) => b - a)) {
    if (capacity >= load - 1e-9) break
    capacity += value
    count += 1
  }
  return count
}
