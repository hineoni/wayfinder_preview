import { GROUPS } from '@wayfinder/dataset'
import { initLogger, log } from 'evlog'
import { buildGroup } from './build'
import { GROUP_CONFIGS } from './config/groups'

/**
 * `pnpm datasets [east|south-east|south-center|all] [--offline]`
 * Геокодирует адреса, считает матрицы OSRM по трём графам, синтезирует инженеров и пишет
 * datasets/prepared/<group>.json и <group>.geometry.json. `--offline` запрещает сетевые запросы.
 */
async function main(): Promise<void> {
  initLogger({ env: { service: 'wayfinder-prepare', environment: 'local' } })
  const args = process.argv.slice(2)
  const offline = args.includes('--offline')
  const requested = args.filter((arg) => !arg.startsWith('--'))
  const selected = requested.length === 0 || requested.includes('all') ? [...GROUPS] : requested
  for (const name of selected) {
    if (!GROUPS.includes(name as (typeof GROUPS)[number])) {
      throw new Error(`Неизвестная группа «${name}», допустимы: ${GROUPS.join(', ')}`)
    }
  }
  for (const config of GROUP_CONFIGS.filter((item) => selected.includes(item.group))) {
    log.info('prepare', `Группа ${config.title}: старт`)
    await buildGroup(config, { offline })
  }
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error : new Error(String(error)))
  process.exitCode = 1
})
