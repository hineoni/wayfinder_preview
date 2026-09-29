import { createHash } from 'node:crypto'
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GROUPS, parsePreparedDataset } from '@wayfinder/dataset'
import { ASSESSMENT_CASES, assessDataset } from './assessment'
import { PREPARED_DIR } from './io'

const args = process.argv.slice(2)
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output'))
  throw new Error('Использование: pnpm benchmark [--output абсолютный-путь.json]')
const datasets = GROUPS.map((group) => {
  const raw = readFileSync(resolve(PREPARED_DIR, `${group}.json`), 'utf8')
  return {
    dataset: parsePreparedDataset(JSON.parse(raw) as unknown),
    sha256: createHash('sha256').update(raw).digest('hex'),
  }
})
const results = datasets.flatMap(({ dataset }) =>
  ASSESSMENT_CASES.map((scenario) => assessDataset(dataset, scenario)),
)
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
function gitMetadata(): { revision: string | null; dirty: boolean | null } {
  if (!existsSync(resolve(projectRoot, '.git'))) return { revision: null, dirty: null }
  try {
    const options: ExecFileSyncOptionsWithStringEncoding = {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }
    return {
      revision: execFileSync('git', ['rev-parse', 'HEAD'], options).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], options).trim().length > 0,
    }
  } catch {
    return { revision: null, dirty: null }
  }
}
const report = {
  format: 'wayfinder-assessment-v1',
  ...gitMetadata(),
  node: process.version,
  assumptions: {
    baseline: 'Порядок поступления, первый допустимый инженер, вставка в конец маршрута',
    scope: 'Три территории отдельно; модельные компетенции, транспорт, оборудование и длительности',
    timing: 'Один запуск оптимизации на случай, без прогрева; не замер интерфейса и не SLA',
    stress:
      'Увеличение переездов и неаварийных работ на 20% с округлением вверх; аварии 100 минут. Дефицит: минус единица каждого ресурса у каждой бригады. Недоступность: первая аварийная бригада (или первая бригада) исключена до начала дня.',
    interpretation:
      'Сравнение с алгоритмом ТЗ, не с фактической эффективностью диспетчеров. Пробег сравнивать вместе с охватом по приоритетам.',
  },
  datasets: datasets.map(({ dataset, sha256 }) => ({
    group: dataset.group,
    formatVersion: dataset.formatVersion,
    sha256,
    sources: dataset.sources,
  })),
  results,
}
const text = JSON.stringify(report, null, 2)
if (args[1] !== undefined) writeFileSync(resolve(args[1]), `${text}\n`, 'utf8')
else process.stdout.write(`${text}\n`)
if (results.some((r) => r.violations.length > 0 || r.comparison.result === 'worse'))
  process.exitCode = 1
