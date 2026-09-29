import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../../..')
const RAW_DIR = resolve(REPO_ROOT, 'datasets/raw')
export const PREPARED_DIR = resolve(REPO_ROOT, 'datasets/prepared')
export const CACHE_DIR = resolve(PREPARED_DIR, 'cache')

const cp1251 = new TextDecoder('windows-1251')

export interface RawFile {
  readonly text: string
  readonly sha256: string
}

/** Исходные CSV в cp1251; хеш считается по байтам файла. */
export function readRawCsv(name: string): RawFile {
  const bytes = readFileSync(resolve(RAW_DIR, name))
  return { text: cp1251.decode(bytes), sha256: sha256(bytes) }
}

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function readJson(path: string): unknown {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyPretty(data) + '\n', 'utf8')
}

/** JSON с отступами, но длинные числовые и строковые массивы (строки матриц) — одной строкой. */
function stringifyPretty(data: unknown): string {
  const rows: string[] = []
  const json = JSON.stringify(
    data,
    (_key, value: unknown) => {
      if (Array.isArray(value) && value.length > 8 && value.every(isScalar)) {
        return `@@ROW${rows.push(JSON.stringify(value)) - 1}@@`
      }
      return value
    },
    2,
  )
  return json.replace(/"@@ROW(\d+)@@"/g, (_match, index: string) => rows[Number(index)] ?? 'null')
}

function isScalar(value: unknown): boolean {
  return value === null || typeof value === 'number' || typeof value === 'string'
}
