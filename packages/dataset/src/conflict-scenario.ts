import type { PreparedDataset, PreparedOrder } from './prepared'

/** Отдельный учебный день на подготовленных точках Востока; исходная выгрузка не меняется. */
export function createConflictScenario(source: PreparedDataset): PreparedDataset {
  const event = source.events[0]
  const template = source.orders[0]
  const engineer = source.engineers[0]
  if (
    source.group !== 'east' ||
    event === undefined ||
    template === undefined ||
    engineer === undefined
  )
    throw new Error('Для конфликтного сценария нужен подготовленный Восток с аварией')
  const empty = { 'emergency-kit': 0, router: 0, 'tv-box': 0, 'cable-kit': 0 }
  const shift = { start: '09:00', end: '18:00' }
  const makeOrder = (
    id: string,
    start: string,
    end: string,
    durationMin: number,
    connection: boolean,
  ): PreparedOrder => ({
    ...template,
    id,
    pointId: event.order.pointId,
    address: event.order.address,
    bkType: connection ? 'Подключение' : 'Локальная заявка',
    hdType: connection
      ? 'Подключение (учебный сценарий)'
      : `Ремонт ${durationMin} мин (учебный сценарий)`,
    skill: connection ? 'connection' : 'local',
    priority: connection ? 'connection' : 'normal',
    durationMin,
    availableFrom: shift.start,
    transport: 'car',
    equipment: empty,
    window: { start, end },
    sourceWindow: { start, end },
    source: { file: 'Учебный сценарий команды, не исходная выгрузка', row: 1 },
    control: { id, status: 'Учебный сценарий', team: null },
  })
  return {
    ...source,
    title: 'Учебный сценарий: авария без свободного резерва',
    sources: [],
    assumptions: {
      ...source.assumptions,
      shift,
      durationMinByHdType: {
        'Ремонт 60 мин (учебный сценарий)': 60,
        'Ремонт 100 мин (учебный сценарий)': 100,
        'Подключение (учебный сценарий)': 30,
        'Замена роутера (учебный сценарий)': 30,
      },
      carRequiredHdTypes: [
        'Ремонт 60 мин (учебный сценарий)',
        'Ремонт 100 мин (учебный сценарий)',
        'Подключение (учебный сценарий)',
        'Замена роутера (учебный сценарий)',
        event.order.hdType,
      ],
      equipmentPerQualifiedEngineer: { ...empty, 'emergency-kit': 1 },
      equipmentByHdType: {
        [event.order.hdType]: { ...empty, 'emergency-kit': 1 },
        'Замена роутера (учебный сценарий)': { ...empty, router: 1 },
      },
    },
    orders: [
      makeOrder('DEMO-DONE', '10:00', '11:00', 60, false),
      makeOrder('DEMO-WORK', '12:30', '12:30', 100, false),
      makeOrder('DEMO-CLIENT', '14:30', '17:00', 30, true),
      {
        ...makeOrder('DEMO-RESOURCE', '16:00', '17:00', 30, false),
        hdType: 'Замена роутера (учебный сценарий)',
        equipment: { ...empty, router: 1 },
      },
    ],
    engineers: [
      {
        ...engineer,
        id: 'DEMO-READY',
        name: 'Бригада с комплектом',
        controlTeam: 'Учебная',
        skills: ['local', 'connection', 'emergency'],
        skillBasis: ['Модель команды'],
        transport: 'car',
        shift,
        equipment: { ...empty, 'emergency-kit': 1 },
      },
      {
        ...engineer,
        id: 'DEMO-NEAR',
        name: 'Ближайшая — без комплекта',
        controlTeam: 'Учебная',
        startPointId: event.order.pointId,
        skills: ['emergency'],
        skillBasis: ['Модель команды'],
        transport: 'car',
        shift,
        equipment: empty,
      },
    ],
    events: [
      {
        ...event,
        at: '13:30',
        order: {
          ...event.order,
          id: 'DEMO-URGENT',
          availableFrom: '13:30',
          window: { start: '14:00', end: '14:20' },
          sourceWindow: { start: '14:00', end: '14:20' },
          equipment: { ...empty, 'emergency-kit': 1 },
        },
      },
    ],
  }
}
