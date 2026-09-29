import {
  createConflictScenario,
  parseGeometryFile,
  parsePreparedDataset,
  type GeometryFile,
  type Group,
  type PreparedDataset,
} from '@wayfinder/dataset'

const loaders: Record<Group, () => Promise<{ default: unknown }>> = {
  east: () => import('../../../../datasets/prepared/east.json'),
  'south-east': () => import('../../../../datasets/prepared/south-east.json'),
  'south-center': () => import('../../../../datasets/prepared/south-center.json'),
}

const cache = new Map<Group, PreparedDataset>()

export async function getDataset(group: Group): Promise<PreparedDataset> {
  const cached = cache.get(group)
  if (cached !== undefined) return cached
  const dataset = parsePreparedDataset((await loaders[group]()).default)
  cache.set(group, dataset)
  return dataset
}

const conflictCache = new WeakMap<PreparedDataset, PreparedDataset>()

/** Один объект демо-сценария на набор, чтобы сессия узнавала уже рассчитанный план. */
export function getConflictScenario(source: PreparedDataset): PreparedDataset {
  const cached = conflictCache.get(source)
  if (cached !== undefined) return cached
  const scenario = createConflictScenario(source)
  conflictCache.set(source, scenario)
  return scenario
}

const geometryCache = new Map<string, Promise<GeometryFile>>()

/** Файл из `dataset.travel.geometryFile` лежит статикой в `geometry/` (плагин в vite.config.ts), не в JS-бандле. */
export function getGeometry(file: string): Promise<GeometryFile> {
  const cached = geometryCache.get(file)
  if (cached !== undefined) return cached
  const request = fetch(`${import.meta.env.BASE_URL}geometry/${file}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Геометрия ${file}: HTTP ${response.status}`)
      return parseGeometryFile(await response.json())
    })
    .catch((cause: unknown) => {
      geometryCache.delete(file)
      throw cause
    })
  geometryCache.set(file, request)
  return request
}
