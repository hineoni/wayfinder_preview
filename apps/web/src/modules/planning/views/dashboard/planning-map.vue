<script setup lang="ts">
import type { GeoPoint, LatLon, PreparedDataset } from '@wayfinder/dataset'
import type { Plan, ReplanContinuation, ReplanHistoryVisit, Transport } from '@wayfinder/planner'
import UiIcon from '../../../../shared/ui/ui-icon.vue'
import UiButton from '../../../../shared/ui/ui-button.vue'
import { crewColor, crewFill } from '../../../../shared/lib/crew-colors'
import { formatDuration, formatMinute } from '../../../../shared/lib/format'
import { useTheme } from '../../../../shared/lib/theme'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { onBeforeUnmount, onMounted, shallowRef, watch, type DeepReadonly } from 'vue'
import {
  createEdgeResolver,
  midpointBearing,
  type Coordinates,
  type EdgeResolver,
  type GeometryState,
  type RouteEdge,
} from './route-geometry'

const props = defineProps<{
  cancelledOrderIds?: readonly string[]
  dataset: DeepReadonly<PreparedDataset>
  geometry: GeometryState
  plan: Plan
  selectedOrderId: string | undefined
  eventOrder:
    | { readonly id: string; readonly pointId: string; readonly address: string }
    | undefined
  eventPoint:
    | { readonly id: string; readonly address: string; readonly coordinates: GeoPoint }
    | undefined
  history: readonly ReplanHistoryVisit[]
  continuations: readonly ReplanContinuation[]
  cancelledOrderId: string | undefined
  /** Бригада под курсором в списке или расписании: её маршрут подсвечивается без смены кадра. */
  highlightedEngineerId?: string | undefined
}>()
const emit = defineEmits<{ select: [orderId: string | undefined] }>()
const theme = useTheme()
const host = shallowRef<HTMLElement>()
let map: L.Map | undefined
let layer: L.LayerGroup | undefined
// Карта монтируется заново при возврате на «План»: геометрия к этому моменту уже может быть загружена.
let resolver: EdgeResolver = createEdgeResolver(
  props.geometry.status === 'ready' ? props.geometry.file : undefined,
)
/** Маркер заявки и бригада, к которой она относится (undefined — без назначения). */
const markers = new Map<string, { marker: L.Marker; engineerId: string | undefined }>()
/** Линии бригады с базовым стилем: фокус и подсветка меняют стиль и видимость без пересоздания. */
const routeLines = new Map<string, { line: L.Polyline; opacity: number; weight: number }[]>()
/** Точки маршрута каждой бригады и всего дня — рамки для fitBounds. */
const crewBounds = new Map<string, L.LatLngTuple[]>()
let dayBounds: L.LatLngTuple[] = []
/** Бригада, в чей маршрут сейчас кадрирована карта (undefined — весь день). */
let framed: string | undefined
/** Бригада под курсором на самой карте (наведение на линию маршрута). */
let hoveredLine: string | undefined
let fade: number | undefined
/** Переезды оставшегося плана каждой бригады: из них строятся подписи переездов. */
const crewLegs = new Map<
  string,
  { legs: Leg[]; transport: Transport; color: string; weight: number }
>()
let coordinates: Coordinates = new Map()
/** Подписи переездов выделенной бригады; пересобираются при смене выделения. */
let decorations: L.LayerGroup | undefined
/** Показаны ли на карте переезд к выбранному визиту и следующий за ним — для легенды. */
const tripShown = shallowRef(false)

/** Ребро маршрута с временем в пути до следующей точки. */
interface Leg extends RouteEdge {
  readonly durationMin: number
  /** Визит, к которому ведёт переезд. */
  readonly orderId: string
}

const HISTORY_STYLE: L.PolylineOptions = {
  color: '#8b8e97',
  weight: 3,
  opacity: 0.5,
  dashArray: '6 6',
}
const ROUTE_OPACITY = 0.9
const DIMMED_OPACITY = 0.2
/** Остальной маршрут бригады, пока выделены подъезд к выбранному визиту и путь дальше. */
const BEHIND_TRIP_OPACITY = 0.4
const HIGHLIGHT_WEIGHT = 2
/** Длительность смены прозрачности линий — как --motion-fast у точек. */
const LINE_FADE_MS = 120
// Сверху карту перекрывает сводка показателей, снизу — легенда, справа — кнопки масштаба.
const FRAME_PADDING: L.FitBoundsOptions = { paddingTopLeft: [24, 88], paddingBottomRight: [64, 88] }
const PIN_ICON = L.divIcon({ className: 'map-pin-host', iconSize: [32, 32], html: '' })
// Порядок в слое маркеров: подписи переездов под точками, точки выделенной бригады над прочими.
const LEG_Z = -1000
const EMPHASIS_Z = 500
const SELECTED_Z = 1000
const NO_GEOMETRY_HINT = 'Точный путь неизвестен: точки соединены прямой'
const notes: Record<GeometryState['status'], string> = {
  loading: 'Загружаем дороги; пока точки соединены прямыми',
  ready: 'Пунктир — точный путь по дороге неизвестен',
  unavailable: 'Дороги недоступны: точки соединены прямыми',
}

/** Бригада физически была в точке: переезд к ней не прерван и не отменён в пути. */
const arrived = (item: ReplanHistoryVisit) =>
  item.state !== 'interrupted-en-route' && item.state !== 'cancelled-en-route'

const toLatLngs = (line: readonly LatLon[]): L.LatLngTuple[] => line.map(([lat, lon]) => [lat, lon])

function pinClass(
  orderId: string,
  engineerId: string | undefined,
  emphasis: string | undefined,
): string {
  const cancelled =
    orderId === props.cancelledOrderId || props.cancelledOrderIds?.includes(orderId) === true
  const classes = ['map-pin']
  if (cancelled) classes.push('map-pin--cancelled')
  else if (engineerId === undefined) classes.push('map-pin--missed')
  if (emphasis !== undefined && engineerId === emphasis) classes.push('map-pin--timed')
  if (orderId === props.selectedOrderId) classes.push('map-pin--selected')
  return classes.join(' ')
}

const selectedEngineer = () =>
  props.selectedOrderId === undefined ? undefined : markers.get(props.selectedOrderId)?.engineerId

/** Кадрирует карту по маршруту бригады или по всему дню. */
function frame(engineerId: string | undefined, animate: boolean): void {
  framed = engineerId
  const target = engineerId === undefined ? dayBounds : crewBounds.get(engineerId)
  if (map === undefined || target === undefined || target.length === 0) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  map.fitBounds(L.latLngBounds(target), { ...FRAME_PADDING, animate: animate && !reduced })
}

/**
 * Фокус — бригада выбранного визита: чужие линии скрыты, кадр по её маршруту.
 * Подсветка (наведение) временно показывает и выделяет другую бригаду, не двигая карту.
 * Выделенная бригада — подсвеченная, иначе в фокусе: у её точек время, у переездов стрелки.
 */
function applyFocus(): void {
  const focused = selectedEngineer()
  const highlighted = props.highlightedEngineerId ?? hoveredLine
  const emphasis = highlighted ?? focused
  const trip = emphasis === undefined ? undefined : selectedTrip(emphasis)
  for (const [orderId, { marker, engineerId }] of markers) {
    const host = marker.getElement()
    const pin = host?.firstElementChild
    if (pin instanceof HTMLElement) pin.className = pinClass(orderId, engineerId, emphasis)
    // Приглушение — на обёртке: полупрозрачная точка стала бы stacking context,
    // и ярлык времени под ней на время перехода оказался бы поверх кружка.
    host?.classList.toggle(
      'map-pin-host--muted',
      orderId !== props.selectedOrderId &&
        emphasis !== undefined &&
        engineerId !== undefined &&
        engineerId !== emphasis,
    )
    marker.setZIndexOffset(
      orderId === props.selectedOrderId
        ? SELECTED_Z
        : engineerId !== undefined && engineerId === emphasis
          ? EMPHASIS_Z
          : 0,
    )
  }
  const targets = new Map<L.Polyline, number>()
  for (const [engineerId, lines] of routeLines) {
    const visible = focused === undefined || engineerId === focused || engineerId === highlighted
    const dimmed = highlighted !== undefined && engineerId !== highlighted
    for (const { line, opacity, weight } of lines) {
      if (!visible) {
        if (layer?.hasLayer(line) === true) targets.set(line, 0)
        continue
      }
      if (layer?.hasLayer(line) === false) {
        line.setStyle({ opacity: 0 })
        layer.addLayer(line)
      }
      line.setStyle({ weight: engineerId === highlighted ? weight + HIGHLIGHT_WEIGHT : weight })
      targets.set(
        line,
        dimmed
          ? DIMMED_OPACITY
          : engineerId === emphasis && trip !== undefined
            ? BEHIND_TRIP_OPACITY
            : opacity,
      )
      if (engineerId === highlighted) line.bringToFront()
    }
  }
  fadeLines(targets)
  decorate(emphasis, trip)
  // Внутри одной бригады кадр не меняется, чтобы сохранить ручной масштаб диспетчера;
  // карта лишь сдвигается, если выбранная точка ушла за край.
  if (focused !== framed) frame(focused, true)
  else revealSelected()
}

/**
 * Плавно переводит линии к целевой прозрачности; линии с нулевой целью в конце убирает со слоя.
 * Новый вызов прерывает предыдущий переход с текущих значений, поэтому быстрое наведение не дёргает карту.
 */
function fadeLines(targets: Map<L.Polyline, number>): void {
  if (fade !== undefined) cancelAnimationFrame(fade)
  fade = undefined
  const changes = [...targets].map(([line, to]) => ({ line, from: line.options.opacity ?? to, to }))
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const started = performance.now()
  const step = (now: number): void => {
    const progress = reduced ? 1 : Math.min(1, (now - started) / LINE_FADE_MS)
    const eased = 1 - (1 - progress) ** 3
    for (const { line, from, to } of changes) {
      if (from !== to) line.setStyle({ opacity: from + (to - from) * eased })
    }
    if (progress < 1) {
      fade = requestAnimationFrame(step)
      return
    }
    fade = undefined
    for (const { line, to } of changes) if (to === 0) layer?.removeLayer(line)
  }
  step(started)
}

function revealSelected(): void {
  const marker =
    props.selectedOrderId === undefined ? undefined : markers.get(props.selectedOrderId)
  if (map === undefined || marker === undefined) return
  const point = marker.marker.getLatLng()
  if (map.getBounds().pad(-0.15).contains(point)) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  map.panTo(point, { animate: !reduced })
}

/** Переезд к выбранному визиту и следующий за ним — если визит в оставшемся плане бригады. */
function selectedTrip(engineerId: string): { into: Leg; onward: Leg | undefined } | undefined {
  const legs = crewLegs.get(engineerId)?.legs ?? []
  const index = legs.findIndex((leg) => leg.orderId === props.selectedOrderId)
  const into = legs[index]
  return into === undefined ? undefined : { into, onward: legs[index + 1] }
}

/**
 * Подпись в середине каждого переезда: стрелка по направлению движения и время в пути.
 * При выбранном визите поверх маршрута — подъезд к нему сплошной линией и путь дальше пунктиром.
 */
function decorate(
  engineerId: string | undefined,
  trip: { into: Leg; onward: Leg | undefined } | undefined,
): void {
  decorations?.clearLayers()
  tripShown.value = false
  const route = engineerId === undefined ? undefined : crewLegs.get(engineerId)
  if (decorations === undefined || route === undefined) return
  if (trip !== undefined) {
    const into = resolver.line(trip.into, route.transport, coordinates)
    const onward =
      trip.onward === undefined
        ? undefined
        : resolver.line(trip.onward, route.transport, coordinates)
    if (onward !== undefined) {
      L.polyline(toLatLngs(onward.points), {
        color: route.color,
        weight: route.weight + 1,
        dashArray: '1 8',
        lineCap: 'round',
        interactive: false,
      }).addTo(decorations)
    }
    if (into !== undefined) {
      L.polyline(toLatLngs(into.points), {
        color: route.color,
        weight: route.weight + 3,
        interactive: false,
      }).addTo(decorations)
    }
    tripShown.value = into !== undefined || onward !== undefined
  }
  for (const leg of route.legs) {
    const line = resolver.line(leg, route.transport, coordinates)
    const middle = line === undefined ? undefined : midpointBearing(line.points)
    if (middle === undefined) continue
    const chip = document.createElement('span')
    chip.className =
      leg === trip?.into
        ? 'map-leg map-leg--into'
        : leg === trip?.onward
          ? 'map-leg map-leg--onward'
          : 'map-leg'
    chip.style.setProperty('--crew', route.color)
    const arrow = document.createElement('i')
    arrow.className = 'map-leg__arrow'
    arrow.style.setProperty('--bearing', `${middle.bearing.toFixed(1)}deg`)
    chip.append(arrow)
    if (Math.round(leg.durationMin) > 0) chip.append(formatDuration(leg.durationMin))
    L.marker([middle.at[0], middle.at[1]], {
      icon: L.divIcon({ className: 'map-mark-host', iconSize: [0, 0], html: chip }),
      interactive: false,
      keyboard: false,
      zIndexOffset: LEG_Z,
    }).addTo(decorations)
  }
}

/** Переезды от стартовой точки через визиты; визит с неизвестной заявкой выпадает вместе с флагом. */
function legsFrom(
  start: string,
  visits: readonly {
    readonly orderId: string
    readonly pointId: string | undefined
    readonly approximate: boolean
    readonly durationMin: number
  }[],
): Leg[] {
  const legs: Leg[] = []
  let from = start
  for (const visit of visits) {
    if (visit.pointId === undefined) continue
    legs.push({
      from,
      to: visit.pointId,
      approximate: visit.approximate,
      durationMin: visit.durationMin,
      orderId: visit.orderId,
    })
    from = visit.pointId
  }
  return legs
}

function draw(fit: boolean): void {
  if (map === undefined) return
  if (fade !== undefined) cancelAnimationFrame(fade)
  fade = undefined
  layer?.remove()
  layer = L.layerGroup().addTo(map)
  decorations = L.layerGroup().addTo(layer)
  markers.clear()
  routeLines.clear()
  crewBounds.clear()
  crewLegs.clear()
  const points = new Map(props.dataset.points.map((point) => [point.id, point]))
  if (props.eventPoint !== undefined) {
    points.set(props.eventPoint.id, {
      ...props.eventPoint.coordinates,
      id: props.eventPoint.id,
      address: props.eventPoint.address,
      query: props.eventPoint.address,
      precision: 'locality',
      displayName: props.eventPoint.address,
      osm: null,
    })
  }
  coordinates = new Map(
    [...points.values()].map((point) => [point.id, [point.lat, point.lon] as LatLon]),
  )
  const engineers = new Map(
    props.dataset.engineers.map((engineer, index) => [engineer.id, { engineer, index }]),
  )
  const displayOrders = [
    ...props.dataset.orders,
    ...(props.eventOrder === undefined ? [] : [props.eventOrder]),
  ]
  const orders = new Map(displayOrders.map((order) => [order.id, order]))
  const pointOf = (orderId: string) => orders.get(orderId)?.pointId
  /** Бригада и номер визита в её дне: история, где бригада была в точке, затем оставшийся план. */
  const assignment = new Map<string, { engineerId: string; number: number }>()
  for (const { engineer } of engineers.values()) {
    const sequence = new Set([
      ...props.history
        .filter((item) => item.engineerId === engineer.id && arrived(item))
        .map((item) => item.visit.orderId),
      ...(props.plan.routes.find((route) => route.engineerId === engineer.id)?.visits ?? []).map(
        (visit) => visit.orderId,
      ),
    ])
    let number = 0
    for (const orderId of sequence) {
      assignment.set(orderId, { engineerId: engineer.id, number: ++number })
    }
  }
  /** Время работы на визите: история, где бригада была в точке, и оставшийся план. */
  const visitTimes = new Map<string, { start: number; end: number }>()
  for (const item of props.history) {
    if (arrived(item)) {
      visitTimes.set(item.visit.orderId, { start: item.visit.startMin, end: item.visit.endMin })
    }
  }
  for (const visit of props.plan.routes.flatMap((route) => route.visits)) {
    visitTimes.set(visit.orderId, { start: visit.startMin, end: visit.endMin })
  }
  const bounds: L.LatLngTuple[] = []
  const extend = (engineerId: string | undefined, point: L.LatLngTuple): void => {
    bounds.push(point)
    if (engineerId !== undefined)
      crewBounds.set(engineerId, [...(crewBounds.get(engineerId) ?? []), point])
  }

  /** Линии бригады; без firstOrderId — история, иначе клик по линии выбирает первый визит плана. */
  const addLines = (engineerId: string, legs: Leg[], firstOrderId?: string): void => {
    const entry = engineers.get(engineerId)
    if (entry === undefined || layer === undefined || legs.length === 0) return
    const color = crewColor(entry.index, theme.value)
    const style: L.PolylineOptions =
      firstOrderId === undefined
        ? { ...HISTORY_STYLE, interactive: false }
        : {
            color,
            weight: theme.value === 'light' ? 4 : 3,
            opacity: ROUTE_OPACITY,
            bubblingMouseEvents: false,
          }
    if (firstOrderId !== undefined) {
      crewLegs.set(engineerId, {
        legs,
        transport: entry.engineer.transport,
        color,
        weight: style.weight ?? 3,
      })
    }
    const lines = resolver.route(legs, entry.engineer.transport, coordinates)
    const created: L.Polyline[] = []
    if (lines.road.length > 0) {
      created.push(L.polyline(lines.road.map(toLatLngs), style).addTo(layer))
    }
    if (lines.straight.length > 0) {
      const straight = L.polyline(lines.straight.map(toLatLngs), {
        ...style,
        dashArray: '6 6',
      }).addTo(layer)
      if (firstOrderId !== undefined) straight.bindTooltip(NO_GEOMETRY_HINT)
      created.push(straight)
    }
    if (firstOrderId !== undefined) {
      for (const line of created) {
        line.on('click', () => emit('select', firstOrderId))
        line.on('mouseover', () => hover(engineerId))
        line.on('mouseout', () => hover(undefined))
      }
    }
    const start = coordinates.get(legs[0]?.from ?? '')
    if (start !== undefined) extend(engineerId, [start[0], start[1]])
    routeLines.set(engineerId, [
      ...(routeLines.get(engineerId) ?? []),
      ...created.map((line) => ({
        line,
        opacity: style.opacity ?? 1,
        weight: style.weight ?? 3,
      })),
    ])
  }

  for (const { engineer } of engineers.values()) {
    addLines(
      engineer.id,
      legsFrom(
        engineer.startPointId,
        props.history
          .filter(
            (item) => item.engineerId === engineer.id && item.state !== 'interrupted-en-route',
          )
          .map((item) => ({
            orderId: item.visit.orderId,
            pointId: pointOf(item.visit.orderId),
            approximate: item.visit.travel.approximate,
            durationMin: item.visit.travel.durationMin,
          })),
      ),
    )
  }
  for (const route of props.plan.routes) {
    const start =
      props.continuations.find((item) => item.engineerId === route.engineerId)?.pointId ??
      engineers.get(route.engineerId)?.engineer.startPointId
    const first = route.visits[0]?.orderId
    if (start === undefined || first === undefined) continue
    addLines(
      route.engineerId,
      legsFrom(
        start,
        route.visits.map((visit) => ({
          orderId: visit.orderId,
          pointId: pointOf(visit.orderId),
          approximate: visit.travel.approximate,
          durationMin: visit.travel.durationMin,
        })),
      ),
      first,
    )
  }
  for (const order of displayOrders) {
    const point = points.get(order.pointId)
    if (point === undefined) continue
    const entry = assignment.get(order.id)
    const marker = L.marker([point.lat, point.lon], {
      icon: PIN_ICON,
      keyboard: false,
      riseOnHover: true,
    }).addTo(layer)
    const pin = document.createElement('span')
    pin.className = pinClass(order.id, entry?.engineerId, undefined)
    if (entry !== undefined) {
      const index = engineers.get(entry.engineerId)?.index ?? 0
      pin.style.setProperty('--crew', crewColor(index, theme.value))
      pin.style.setProperty('--crew-fill', crewFill(index, theme.value))
      pin.textContent = String(entry.number)
      const time = visitTimes.get(order.id)
      if (time !== undefined) {
        const label = document.createElement('span')
        label.className = 'map-pin__time'
        label.textContent = formatMinute(time.start)
        pin.append(label)
      }
    }
    marker.getElement()?.replaceChildren(pin)
    markers.set(order.id, { marker, engineerId: entry?.engineerId })
    const tooltip = document.createElement('span')
    const time = visitTimes.get(order.id)
    tooltip.textContent = [
      order.id,
      time === undefined ? undefined : `${formatMinute(time.start)}–${formatMinute(time.end)}`,
      order.address,
    ]
      .filter((part) => part !== undefined)
      .join(' · ')
    marker.bindTooltip(tooltip)
    marker.on('click', () => emit('select', order.id))
    extend(entry?.engineerId, [point.lat, point.lon])
  }
  dayBounds = bounds
  applyFocus()
  if (fit) frame(framed, false)
}

onMounted(() => {
  if (host.value === undefined) return
  // Допуск canvas-рендера расширяет зону клика по тонкой линии маршрута.
  map = L.map(host.value, {
    zoomControl: false,
    preferCanvas: true,
    renderer: L.canvas({ tolerance: 6 }),
  })
  // Клик по пустому месту карты снимает выбор и возвращает обзор всех бригад.
  map.on('click', () => emit('select', undefined))
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map)
  draw(true)
})
// Один проход на любое изменение входа; масштаб сбрасывается только при смене набора или плана,
// приход геометрии заменяет слой на месте.
watch(
  () => [props.dataset, props.plan, props.geometry] as const,
  ([dataset, plan, geometry], [previousDataset, previousPlan, previousGeometry]) => {
    if (geometry !== previousGeometry) {
      resolver = createEdgeResolver(geometry.status === 'ready' ? geometry.file : undefined)
    }
    draw(dataset !== previousDataset || plan !== previousPlan)
  },
)
watch(() => [props.selectedOrderId, props.highlightedEngineerId], applyFocus)

function hover(engineerId: string | undefined): void {
  hoveredLine = engineerId
  applyFocus()
}
watch(theme, () => draw(false))
onBeforeUnmount(() => {
  if (fade !== undefined) cancelAnimationFrame(fade)
  map?.remove()
})
</script>

<template>
  <div class="map-frame">
    <div
      ref="host"
      class="map-frame__map"
      aria-label="Карта маршрутов и заявок"
    ></div>
    <div
      class="map-frame__controls"
      role="group"
      aria-label="Масштаб карты"
    >
      <UiButton
        icon
        aria-label="Приблизить карту"
        @click="map?.zoomIn()"
      >
        <UiIcon name="plus" />
      </UiButton>
      <UiButton
        icon
        aria-label="Отдалить карту"
        @click="map?.zoomOut()"
      >
        <UiIcon name="minus" />
      </UiButton>
    </div>
    <div class="map-frame__legend">
      <span class="map-frame__key">
        <i class="map-frame__swatch"></i>
        номер — порядок визита
      </span>
      <span class="map-frame__key">
        <i class="map-frame__swatch map-frame__swatch--missed"></i>
        без назначения
      </span>
      <template v-if="tripShown">
        <span class="map-frame__key">
          <i class="map-frame__line"></i>
          путь к выбранному визиту
        </span>
        <span class="map-frame__key">
          <i class="map-frame__line map-frame__line--onward"></i>
          дальше по маршруту
        </span>
      </template>
      <p class="map-frame__note">{{ notes[geometry.status] }}</p>
    </div>
  </div>
</template>
