/**
 * Разбор CSV с разделителем `;` и кавычками по RFC 4180. Возвращает строки как массивы ячеек;
 * пустые строки не отбрасываются, чтобы номера строк совпадали с исходным файлом.
 */
export function parseCsv(text: string, delimiter = ';'): string[][] {
  return parseCsvRows(text, delimiter).map((record) => record.cells)
}

/** Физическая строка начала записи, в том числе после многострочной ячейки. */
export function parseCsvRows(text: string, delimiter = ';'): { row: number; cells: string[] }[] {
  const rows: { row: number; cells: string[] }[] = []
  let line = 1
  let startLine = 1
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const source = text.startsWith('﻿') ? text.slice(1) : text
  while (i < source.length) {
    const ch = source.charAt(i)
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      if (ch === '\n' || (ch === '\r' && source[i + 1] !== '\n')) line += 1
      cell += ch
      i += 1
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
      i += 1
      continue
    }
    if (ch === delimiter) {
      row.push(cell)
      cell = ''
      i += 1
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(cell)
      rows.push({ row: startLine, cells: row })
      line += 1
      startLine = line
      row = []
      cell = ''
      i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1
      continue
    }
    cell += ch
    i += 1
  }
  if (quoted) throw new Error(`строка ${startLine}: незакрытая кавычка CSV`)
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push({ row: startLine, cells: row })
  }
  return rows
}
