import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { cruise, type ICruiseOptions, type IReporterOutput } from 'dependency-cruiser'
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config'
import { describe, expect, it } from 'vitest'

/**
 * Негативные примеры для правил ARCH-01…08: каждый файл в fixtures нарушает ровно одно правило,
 * и dependency-cruiser с боевым конфигом обязан его поймать. Запуск из каталога fixtures,
 * чтобы пути совпадали с реальной структурой репозитория.
 */
const require = createRequire(import.meta.url)
const FIXTURES = resolve(import.meta.dirname, '../fixtures')
const CONFIG_PATH = resolve(import.meta.dirname, '../../../.dependency-cruiser.cjs')

interface Config {
  forbidden: unknown[]
  options: { exclude?: unknown; tsConfig?: unknown }
}

const EXPECTED: readonly [file: string, rule: string][] = [
  ['packages/planner/src/bad-planner.ts', 'ARCH-01-planner-is-pure'],
  ['packages/planner/src/bad-npm.ts', 'ARCH-01-planner-is-pure'],
  ['packages/planner/src/bad-cycle-a.ts', 'ARCH-08-no-cycles'],
  ['packages/dataset/src/bad-node.ts', 'ARCH-02-dataset-no-node'],
  ['packages/dataset/src/bad-prepare.ts', 'ARCH-02-dataset-only-planner'],
  ['tools/prepare/src/bad-internal.ts', 'ARCH-03-prepare-public-entries-only'],
  ['apps/web/src/modules/planning/model/bad-alias.ts', 'ARCH-04-web-public-entries-only'],
  ['apps/web/src/modules/planning/model/bad-relative.ts', 'ARCH-04-web-public-entries-only'],
  ['apps/web/src/modules/planning/model/bad-type.ts', 'ARCH-04-web-public-entries-only'],
  ['apps/web/src/modules/planning/model/bad-views.ts', 'ARCH-07-model-not-views'],
  ['apps/web/src/modules/planning/views/map/bad-view.ts', 'ARCH-07-views-isolated'],
  ['apps/web/src/modules/scenario/model/bad-cross-module.ts', 'ARCH-06-modules-isolated'],
  ['apps/web/src/shared/ui/bad-shared.ts', 'ARCH-06-shared-not-modules'],
]

const CLEAN = ['apps/web/src/app/main.ts', 'apps/web/src/modules/planning/views/schedule/index.ts']

async function cruiseFixtures(): Promise<IReporterOutput> {
  const config = require(CONFIG_PATH) as Config
  const previousCwd = process.cwd()
  process.chdir(FIXTURES)
  try {
    const forbidden = config.forbidden as NonNullable<ICruiseOptions['ruleSet']>['forbidden']
    const options: ICruiseOptions = {
      ...(config.options as ICruiseOptions),
      validate: true,
      ruleSet: forbidden === undefined ? {} : { forbidden },
      exclude: { path: ['\\.d\\.ts$'] },
      tsConfig: { fileName: 'tsconfig.json' },
      outputType: 'json',
    }
    return await cruise(['.'], options, undefined, { tsConfig: extractTSConfig('tsconfig.json') })
  } finally {
    process.chdir(previousCwd)
  }
}

describe('правила ARCH на негативных примерах', () => {
  it('каждое нарушение поймано нужным правилом, чистые файлы без замечаний', async () => {
    const result = await cruiseFixtures()
    const output =
      typeof result.output === 'string'
        ? (JSON.parse(result.output) as {
            summary: { violations: { from: string; rule: { name: string } }[] }
          })
        : null
    expect(output).not.toBeNull()
    const violations = (output as NonNullable<typeof output>).summary.violations.map(
      (v) => [v.from, v.rule.name] as const,
    )
    for (const [file, rule] of EXPECTED) {
      expect(violations, `${file} должен нарушать ${rule}`).toContainEqual([file, rule])
    }
    for (const file of CLEAN) {
      expect(
        violations.filter(([from]) => from === file),
        `${file} должен быть чистым`,
      ).toEqual([])
    }
    expect(violations.some(([, rule]) => rule === 'ARCH-08-no-unresolved')).toBe(false)
  })
})
