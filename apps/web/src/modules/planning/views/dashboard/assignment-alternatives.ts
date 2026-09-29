import type { AssignmentOption } from '@wayfinder/planner'
import { formatDistance, plural } from '../../../../shared/lib/format'

/**
 * Строка карточки о переносе заявки к другой бригаде: сначала компонента цели плана,
 * по которой вариант проигрывает (или выигрывает), затем пробег и сдвиги времени.
 */
export function alternativeText(option: AssignmentOption): string {
  const name = option.engineer.name
  if (option.kind === 'rejected')
    return `${name}: нет допустимой позиции при сохранении порядка остальных визитов`
  const { result, decisive, delta } = option.comparison
  const distance = `пробег ${formatDistance(delta.distanceM, true)}`
  const verdict =
    result === 'equal'
      ? `равноценно по цели плана, ${distance}`
      : decisive === 'engineersUsed'
        ? result === 'worse'
          ? `ещё ${delta.engineersUsed} ${plural(delta.engineersUsed, ['задействованная бригада', 'задействованные бригады', 'задействованных бригад'])}, хотя ${distance}`
          : `на ${-delta.engineersUsed} ${plural(-delta.engineersUsed, ['бригаду', 'бригады', 'бригад'])} меньше, ${distance}`
        : decisive === 'distanceM'
          ? distance
          : result === 'worse'
            ? 'больше заявок без назначения'
            : 'меньше заявок без назначения'
  const shifts = option.changes.length
  return [
    `${name}: ${verdict}`,
    result === 'better' ? ' — лучше по цели плана' : '',
    shifts > 0
      ? `; сдвиг времени у ${shifts} ${plural(shifts, ['визита', 'визитов', 'визитов'])}`
      : '',
    option.plan.metrics.approximate ? ' (приближённо)' : '',
  ].join('')
}
