import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  checkPreparedConsistency,
  GROUPS,
  parseGeometryFile,
  parsePreparedDataset,
  toPlanInput,
} from '@wayfinder/dataset'
import {
  compareObjective,
  objectiveOf,
  planBaseline,
  planOptimized,
  validatePlan,
} from '@wayfinder/planner'
import { describe, expect, it } from 'vitest'
import { PREPARED_DIR } from '../src/io'

/** Данные из `pnpm check`: формат, согласованность, базовый план без нарушений. Без сети. */
const datasets = GROUPS.map((group) => ({ group, file: resolve(PREPARED_DIR, `${group}.json`) }))

describe('datasets/prepared', () => {
  it('содержит все три группы', () => {
    const present = readdirSync(PREPARED_DIR).filter(
      (name) => name.endsWith('.json') && !name.includes('geometry'),
    )
    expect(present.toSorted()).toEqual(GROUPS.map((group) => `${group}.json`).toSorted())
  })

  describe.each(datasets)('$group', ({ file }) => {
    const raw = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : null

    it('соответствует схеме и согласован', () => {
      expect(raw).not.toBeNull()
      const dataset = parsePreparedDataset(raw)
      expect(checkPreparedConsistency(dataset)).toEqual([])
      expect(dataset.points.every((point) => point.precision !== 'locality')).toBe(true)
    })

    it('применяет норматив и приоритеты организаторов, включая глобальную проблему с HD Информация', () => {
      const dataset = parsePreparedDataset(raw)
      const orders = [...dataset.orders, ...dataset.events.map((event) => event.order)]
      for (const order of orders) {
        const expectedPriority =
          order.bkType === 'Глобальная проблема'
            ? 'emergency'
            : order.bkType === 'Подключение'
              ? 'connection'
              : 'normal'
        expect(order.priority).toBe(expectedPriority)
      }
      for (const order of orders.filter((item) => item.bkType === 'Глобальная проблема')) {
        expect(order.durationMin).toBe(100)
      }
      expect(dataset.orders.every((order) => order.availableFrom === '09:00')).toBe(true)
      expect(dataset.events.every((event) => event.order.availableFrom === event.at)).toBe(true)
      expect(dataset.assumptions.provenance).toEqual({
        model: 'team',
        emergencyDurationMin: 'organizer',
        priorityOrder: 'organizer',
      })
    })

    it('геометрия совпадает с матрицами по размеру и достижимости', () => {
      const dataset = parsePreparedDataset(raw)
      const geometry = parseGeometryFile(
        JSON.parse(
          readFileSync(resolve(PREPARED_DIR, dataset.travel.geometryFile), 'utf8'),
        ) as unknown,
      )
      expect(geometry.pointIds).toEqual(dataset.travel.pointIds)
      expect(geometry.pointIds).toEqual(dataset.points.map((point) => point.id))
      const n = dataset.travel.pointIds.length
      for (const name of ['car', 'bicycle', 'foot'] as const) {
        const edges = geometry.profiles[name]
        const gaps = dataset.travel.profiles[name].geometryGaps
        expect(edges).toHaveLength(n)
        let missing = 0
        let unexpected = 0
        for (let i = 0; i < n; i += 1) {
          expect(edges[i]).toHaveLength(n)
          for (let j = 0; j < n; j += 1) {
            const reachable = dataset.travel.profiles[name].distanceM[i]?.[j] !== null
            const edge = edges[i]?.[j]
            const from = dataset.travel.pointIds[i]
            const to = dataset.travel.pointIds[j]
            const listed = gaps.some((gap) => gap.from === from && gap.to === to)
            if (i !== j && reachable && edge === null && !listed) missing += 1
            if (!reachable && edge !== null) unexpected += 1
          }
        }
        expect(missing, `${name}: рёбра без геометрии`).toBe(0)
        expect(unexpected, `${name}: геометрия у недостижимых пар`).toBe(0)
      }
    })

    it('базовый план проходит независимый валидатор', () => {
      const dataset = parsePreparedDataset(raw)
      const input = toPlanInput(dataset)
      const plan = planBaseline(input)
      expect(validatePlan(input, plan)).toEqual([])
      expect(plan.routes.length).toBe(dataset.engineers.length)
      expect(plan.metrics.approximate).toBe(false)
      expect(plan.routes.every((route) => (route.visits[0]?.waitMin ?? 0) === 0)).toBe(true)
    })

    it('оптимизированный план допустим и не хуже базового', () => {
      const dataset = parsePreparedDataset(raw)
      const input = toPlanInput(dataset)
      const baseline = planBaseline(input)
      const optimized = planOptimized(input)
      expect(validatePlan(input, optimized.plan)).toEqual([])
      expect(optimized.plan.routes.every((route) => (route.visits[0]?.waitMin ?? 0) === 0)).toBe(
        true,
      )
      expect(
        compareObjective(objectiveOf(optimized.plan.metrics), objectiveOf(baseline.metrics)),
      ).toBeLessThanOrEqual(0)
      expect(optimized.search.candidateChecks).toBeLessThanOrEqual(optimized.search.budget)
    })
  })
})
