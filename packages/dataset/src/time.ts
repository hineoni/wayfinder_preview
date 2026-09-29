import type { Minute } from '@wayfinder/planner'

/** `H:MM` или `HH:MM` → минуты от полуночи. */
export function parseClock(text: string): Minute {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (match === null) throw new Error(`Неверное время «${text}», ожидается HH:MM`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error(`Неверное время «${text}»`)
  return hours * 60 + minutes
}

export function formatClock(minute: Minute): string {
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export interface SourceDateTime {
  /** ISO-дата `YYYY-MM-DD`. */
  readonly day: string
  readonly minute: Minute
}

/** `DD.MM.YYYY H:MM` из исходных CSV. Часовой пояс в файлах не указан. */
export function parseSourceDateTime(text: string): SourceDateTime {
  const match = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{1,2}:\d{2})$/.exec(text.trim())
  const clock = match?.[4]
  if (match === null || clock === undefined) {
    throw new Error(`Неверная дата «${text}», ожидается DD.MM.YYYY H:MM`)
  }
  return { day: `${match[3]}-${match[2]}-${match[1]}`, minute: parseClock(clock) }
}
