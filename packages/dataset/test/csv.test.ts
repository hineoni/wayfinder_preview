import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/csv'

describe('parseCsv', () => {
  it('разбирает `;`, CRLF, кавычки и сохраняет пустые строки', () => {
    const text = 'a;b;c\r\n1;"x;y";"он сказал ""да"""\r\n;;\r\n﻿'
    expect(parseCsv('﻿' + text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x;y', 'он сказал "да"'],
      ['', '', ''],
      ['﻿'],
    ])
  })

  it('не требует перевода строки в конце', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})
