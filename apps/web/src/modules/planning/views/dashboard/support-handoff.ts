import { formatMinute } from '../../../../shared/lib/format'

interface HandoffRow {
  readonly orderId: string
  readonly previousStartMin?: number | undefined
  readonly startMin?: number | undefined
  readonly previousEngineerId?: string | undefined
  readonly engineerId?: string | undefined
  readonly reason: string
}

export function handoffText(rows: readonly HandoffRow[], address: (id: string) => string) {
  return [
    'Для согласования службой поддержки. Сообщения клиентам не отправлены.',
    'Заявка\tАдрес\tПрежнее время\tНовое время\tПрежняя бригада (ID)\tНовая бригада (ID)\tПричина',
    ...rows.map((r) =>
      [
        r.orderId,
        address(r.orderId),
        r.previousStartMin === undefined ? '—' : formatMinute(r.previousStartMin),
        r.startMin === undefined ? 'Не назначена' : formatMinute(r.startMin),
        r.previousEngineerId ?? '—',
        r.engineerId ?? '—',
        r.reason,
      ]
        .map((cell) => cell.replace(/[\t\r\n]/g, ' '))
        .join('\t'),
    ),
  ].join('\n')
}
