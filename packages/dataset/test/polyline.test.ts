import { describe, expect, it } from 'vitest'
import { decodePolyline } from '../src/polyline'

describe('decodePolyline', () => {
  it('декодирует пример из спецификации', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ])
  })

  it('пустая строка — пустая линия', () => {
    expect(decodePolyline('')).toEqual([])
  })
})
