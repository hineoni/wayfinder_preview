/**
 * Правила зависимостей ARCH-01…08 из docs/internals/project-structure.md.
 * Используется `pnpm arch` и негативными примерами в tools/arch-check.
 */
const NODE_BUILTINS =
  '^(node:|fs$|path$|os$|http$|https$|net$|child_process$|crypto$|stream$|url$|util$|events$|worker_threads$|zlib$)'
const UI_LIBRARIES = '^(vue|pinia|@vueuse|reka-ui|leaflet)'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'ARCH-01-planner-is-pure',
      comment:
        'planner не зависит от проекта, Vue, Pinia, DOM и Node API, включая type-only импорты',
      severity: 'error',
      from: { path: '^packages/planner/src' },
      to: { pathNot: '^packages/planner/src' },
    },
    {
      name: 'ARCH-02-dataset-only-planner',
      comment: 'dataset использует только планировщик и valibot; без fs, сети и prepare',
      severity: 'error',
      from: { path: '^packages/dataset/src' },
      to: {
        pathNot:
          '^(packages/dataset/src|packages/planner/src/index\\.ts|node_modules/valibot/|node_modules/\\.pnpm/valibot@)',
      },
    },
    {
      name: 'ARCH-02-dataset-no-node',
      severity: 'error',
      from: { path: '^packages/dataset/src' },
      to: { path: NODE_BUILTINS, dependencyTypes: ['core'] },
    },
    {
      name: 'ARCH-03-prepare-public-entries-only',
      comment: 'prepare использует только публичные входы planner и dataset',
      severity: 'error',
      from: { path: '^tools/prepare/src' },
      to: {
        path: '^packages/(planner|dataset)/',
        pathNot: '^packages/(planner|dataset)/src/index\.ts$',
      },
    },
    {
      name: 'ARCH-03-prepare-no-web',
      comment: 'prepare зависит от dataset и planner, не от web',
      severity: 'error',
      from: { path: '^tools/prepare/src' },
      to: { path: '^apps/' },
    },
    {
      name: 'ARCH-04-web-public-entries-only',
      comment: 'web использует только публичные входы planner и dataset',
      severity: 'error',
      from: { path: '^apps/web/src' },
      to: {
        path: '^packages/(planner|dataset)/',
        pathNot: '^packages/(planner|dataset)/src/index\\.ts$',
      },
    },
    {
      name: 'ARCH-04-web-no-tools',
      severity: 'error',
      from: { path: '^apps/web/src' },
      to: { path: '^tools/' },
    },
    {
      name: 'ARCH-06-shared-not-modules',
      comment: 'shared не зависит от modules',
      severity: 'error',
      from: { path: '^apps/web/src/shared' },
      to: { path: '^apps/web/src/modules' },
    },
    {
      name: 'ARCH-06-modules-isolated',
      comment: 'модули не импортируют друг друга; связывает их app',
      severity: 'error',
      from: { path: '^apps/web/src/modules/([^/]+)/' },
      to: { path: '^apps/web/src/modules/', pathNot: '^apps/web/src/modules/$1/' },
    },
    {
      name: 'ARCH-06-shared-modules-not-app',
      severity: 'error',
      from: { path: '^apps/web/src/(shared|modules)' },
      to: { path: '^apps/web/src/app' },
    },
    {
      name: 'ARCH-07-model-not-views',
      comment: 'внутри модуля модель не импортирует представления',
      severity: 'error',
      from: { path: '^apps/web/src/modules/([^/]+)/model' },
      to: { path: '^apps/web/src/modules/$1/views' },
    },
    {
      name: 'ARCH-07-views-isolated',
      comment: 'представления не импортируют друг друга',
      severity: 'error',
      from: { path: '^apps/web/src/modules/([^/]+)/views/([^/]+)/' },
      to: {
        path: '^apps/web/src/modules/$1/views/',
        pathNot: '^apps/web/src/modules/$1/views/$2/',
      },
    },
    {
      name: 'ARCH-08-no-cycles',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'ARCH-08-no-unresolved',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'ARCH-01-no-ui-libraries-in-domain',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: UI_LIBRARIES },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['\\.d\\.ts$', 'tools/arch-check/fixtures'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default'],
      extensions: ['.ts', '.vue', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
