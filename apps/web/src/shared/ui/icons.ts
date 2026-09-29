/** Контуры иконок 24×24 для `ui-icon`; одна обводка, без заливки. */
export const iconPaths = {
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  route: 'M5 4v10a5 5 0 0 0 10 0V4m-3 3 3-3 3 3',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-up': 'm6 15 6-6 6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  'chevron-right': 'm9 6 6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H3V3h12v2',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-3.5-3.5',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
  upload: 'M12 20V9m-5 5 5-5 5 5M5 4h14',
  text: 'M5 6h14M5 10h14M5 14h9M5 18h6',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21M12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  pulse: 'M3 12h4l3-7 4 14 3-7h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  cancel: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 9l6 6M15 9l-6 6',
  'user-off': 'M9 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M2 20a7 7 0 0 1 11.5-5.4M16 16l5 5M21 16l-5 5',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  users:
    'M9 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 7M22 20a6 6 0 0 0-4-5.6',
} as const

export type IconName = keyof typeof iconPaths
