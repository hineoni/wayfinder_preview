import type { Theme } from './theme'

/**
 * Постоянные цвета бригады по её порядку в наборе; общие для карты, расписания и инспектора.
 * Построены в OKLCH с общей светлотой и насыщенностью, соседние бригады разнесены по оттенку.
 * `line` — маршруты, кольца, мелкие метки; `fill` — заливки блоков и точек. В тёмной теме они
 * совпадают, в светлой заливки — бледные тона с малой насыщенностью (L 0.94, C 0.03), линии —
 * приглушённая пастель (L 0.79, C 0.055),
 * чтобы оставаться видимыми на белом. Карта рисует на canvas, поэтому значения готовые.
 */
const DARK = [
  '#82d2a8',
  '#f7a597',
  '#9ebdff',
  '#d2acee',
  '#dbb970',
  '#66cfe1',
  '#efa3c7',
  '#afc981',
  '#f0ad7f',
  '#7ac8f5',
  '#b7b5fc',
  '#67d2cc',
] as const
const PALETTES = {
  dark: { line: DARK, fill: DARK },
  light: {
    line: [
      '#9dc6af',
      '#99c1d9',
      '#91c6c5',
      '#b0b8df',
      '#c2bc94',
      '#dcadaf',
      '#92c4d1',
      '#acc3a0',
      '#a3bdde',
      '#94c7bc',
      '#d2b595',
      '#c0b3d9',
    ],
    fill: [
      '#dcf1e5',
      '#daeffc',
      '#d7f1f1',
      '#e5eaff',
      '#efecd7',
      '#fee4e5',
      '#d7f0f7',
      '#e3f0dd',
      '#dfedfe',
      '#d8f2ec',
      '#f8e8d8',
      '#eee7fc',
    ],
  },
} as const

function pick(palette: readonly string[], index: number): string {
  return palette[index % palette.length] ?? palette[0] ?? 'currentColor'
}

/** Цвет линии бригады: маршрут на карте, кольцо занятости, метка. */
export function crewColor(index: number, theme: Theme): string {
  return pick(PALETTES[theme].line, index)
}

/** Цвет заливки бригады: блоки расписания, шкала визита, точки на карте. */
export function crewFill(index: number, theme: Theme): string {
  return pick(PALETTES[theme].fill, index)
}
