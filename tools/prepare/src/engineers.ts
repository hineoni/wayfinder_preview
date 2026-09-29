import type { BkType, ControlRecord, PreparedEngineer } from '@wayfinder/dataset'
import { SKILLS, type Skill, type Transport } from '@wayfinder/planner'
import {
  EMPTY_EQUIPMENT,
  EQUIPMENT_PER_QUALIFIED_ENGINEER,
  SHIFT,
  SKILL_BY_BK_TYPE,
} from './config/common'

/**
 * Бригада контрольного файла = одна выездная единица. Навыки — по категориям BK, которые бригада
 * выполняла в контрольном распределении (любой статус). Порядок инженеров — порядок первого
 * появления бригады в файле; он же порядок входных данных для базового алгоритма.
 */
export function synthesizeEngineers(
  records: readonly ControlRecord[],
  transportByTeam: Readonly<Record<string, Transport>>,
  startPointId: string,
): PreparedEngineer[] {
  const teams = new Map<string, Set<BkType>>()
  for (const record of records) {
    if (record.team === null) continue
    const bkTypes = teams.get(record.team) ?? new Set<BkType>()
    bkTypes.add(record.bkType)
    teams.set(record.team, bkTypes)
  }
  for (const team of Object.keys(transportByTeam)) {
    if (!teams.has(team))
      throw new Error(`Бригада «${team}» из настроек транспорта не найдена в контрольном файле`)
  }
  return [...teams.entries()].map(([team, bkTypes], index) => {
    const skillSet = new Set<Skill>()
    for (const bkType of bkTypes) skillSet.add(SKILL_BY_BK_TYPE[bkType])
    return {
      id: `E${String(index + 1).padStart(2, '0')}`,
      name: team,
      controlTeam: team,
      startPointId,
      shift: { ...SHIFT },
      skills: SKILLS.filter((skill) => skillSet.has(skill)),
      transport: transportByTeam[team] ?? 'car',
      equipment:
        (transportByTeam[team] ?? 'car') === 'car'
          ? {
              'emergency-kit': skillSet.has('emergency')
                ? EQUIPMENT_PER_QUALIFIED_ENGINEER['emergency-kit']
                : 0,
              router: skillSet.has('connection') ? EQUIPMENT_PER_QUALIFIED_ENGINEER.router : 0,
              'tv-box': skillSet.has('local') ? EQUIPMENT_PER_QUALIFIED_ENGINEER['tv-box'] : 0,
              'cable-kit': skillSet.has('local')
                ? EQUIPMENT_PER_QUALIFIED_ENGINEER['cable-kit']
                : 0,
            }
          : EMPTY_EQUIPMENT,
      skillBasis: [...bkTypes].toSorted(),
    }
  })
}
