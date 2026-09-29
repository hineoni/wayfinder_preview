import type { BkType, Group, HdType } from '@wayfinder/dataset'
import type { Transport } from '@wayfinder/planner'

export interface UrgentOrderSpec {
  readonly id: string
  /** Модельное время появления, HH:MM. */
  readonly at: string
  readonly bkType: BkType
  readonly hdType: HdType
  readonly district: string
  readonly address: string
  readonly window: { readonly start: string; readonly end: string }
}

export interface GroupConfig {
  readonly group: Group
  readonly title: string
  readonly syntheticFile: string
  readonly controlFile: string
  /** Транспорт бригад без автомобиля; остальные — автомобиль. Принято командой. */
  readonly transportByTeam: Readonly<Record<string, Transport>>
  readonly events: readonly UrgentOrderSpec[]
}

export const GROUP_CONFIGS: readonly GroupConfig[] = [
  {
    group: 'east',
    title: 'Восток',
    syntheticFile: 'Восток Синтетические данные.csv',
    controlFile: 'Восток Контрольное распределение..csv',
    transportByTeam: {
      'Бригада Зверев': 'foot',
      'Бригада Комарь': 'bicycle',
      'Бригада Арташкин': 'public',
    },
    events: [
      {
        id: 'U-1',
        at: '13:30',
        bkType: 'Глобальная проблема',
        hdType: 'Авария',
        district: 'Текстильщики',
        address: 'Город Москва, ул.Артюхиной, д. 27',
        window: { start: '14:00', end: '16:00' },
      },
    ],
  },
  {
    group: 'south-east',
    title: 'Юго-восток',
    syntheticFile: 'Юго-восток Синтетические данные.csv',
    controlFile: 'Юго-восток Контрольное распределение.csv',
    transportByTeam: {},
    events: [],
  },
  {
    group: 'south-center',
    title: 'Югоцентр',
    syntheticFile: 'Югоцентр Синтетические данные.csv',
    controlFile: 'Югоцентр Контрольное распределение..csv',
    transportByTeam: {},
    events: [],
  },
]
