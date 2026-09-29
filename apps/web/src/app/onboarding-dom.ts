export interface TourRect {
  left: number
  top: number
  width: number
  height: number
}

export function findTourTarget(selector: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.getClientRects().length > 0 && !element.hidden,
  )
}

/** Учитываем не только экран, но и обрезку внутри расписания / инспектора. */
export function visibleTourRect(element: HTMLElement): TourRect | undefined {
  const rect = element.getBoundingClientRect()
  let left = Math.max(4, rect.left - 5)
  let top = Math.max(4, rect.top - 5)
  let right = Math.min(window.innerWidth - 4, rect.right + 5)
  let bottom = Math.min(window.innerHeight - 4, rect.bottom + 5)
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const bounds = parent.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, bounds.left)
      right = Math.min(right, bounds.right)
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, bounds.top)
      bottom = Math.min(bottom, bounds.bottom)
    }
  }
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : undefined
}

export function tourPanelPosition(
  rect: TourRect | undefined,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: string; top: string } {
  const gap = 16
  const clampX = (value: number) => Math.max(12, Math.min(value, viewport.width - panel.width - 12))
  const clampY = (value: number) =>
    Math.max(12, Math.min(value, viewport.height - panel.height - 12))
  let left = (viewport.width - panel.width) / 2
  let top = (viewport.height - panel.height) / 2
  if (rect) {
    const right = rect.left + rect.width
    const bottom = rect.top + rect.height
    if (right + gap + panel.width <= viewport.width - 12) {
      left = right + gap
      top = rect.top
    } else if (rect.left - gap - panel.width >= 12) {
      left = rect.left - gap - panel.width
      top = rect.top
    } else if (bottom + gap + panel.height <= viewport.height - 12) {
      left = rect.left
      top = bottom + gap
    } else if (rect.top - gap - panel.height >= 12) {
      left = rect.left
      top = rect.top - gap - panel.height
    } else {
      left = viewport.width - panel.width - 12
      top = viewport.height - panel.height - 12
    }
  }
  return { left: `${clampX(left)}px`, top: `${clampY(top)}px` }
}

/** Вне карточки и целевого контрола нет ни случайных кликов, ни скрытых Tab-остановок. */
export function isolateTour(allowed: readonly HTMLElement[]): () => void {
  const changed: { element: HTMLElement; inert: boolean }[] = []
  function visit(element: HTMLElement): void {
    if (allowed.includes(element)) return
    if (allowed.some((root) => element.contains(root))) {
      for (const child of element.children) {
        if (child instanceof HTMLElement) visit(child)
      }
    } else {
      changed.push({ element, inert: element.inert })
      element.inert = true
    }
  }
  for (const child of document.body.children) {
    if (child instanceof HTMLElement) visit(child)
  }
  return () => {
    for (const { element, inert } of changed) element.inert = inert
  }
}

export function tourFocusable(roots: readonly HTMLElement[]): HTMLElement[] {
  const selector = 'button, a[href], input, select, textarea, [tabindex]'
  return roots
    .flatMap((root) => [root, ...root.querySelectorAll<HTMLElement>(selector)])
    .filter(
      (element) =>
        element.matches(selector) &&
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[inert]') &&
        element.getClientRects().length > 0,
    )
}
