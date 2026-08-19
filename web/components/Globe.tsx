/**
 * Auto-rotating lead globe — the centerpiece of the dashboard, built on the
 * mapcn Map component (web/components/ui/map.tsx, installed from the
 * @mapcn/map shadcn registry; MapLibre worker self-hosted in public/maplibre).
 *
 * CARTO dark-matter basemap on the globe projection; yellow dots = discovered
 * leads, brand-green dots = sent leads, each with a soft glow halo. Points
 * refresh every 15s, hovering a dot shows the business + score, clicking it
 * opens the lead. Drag spins the globe by hand — auto-rotation pauses and
 * resumes a moment later.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { Map as MapCN, useMap } from '@/components/ui/map'
import { getGlobePoints } from '../api'
import type { GlobePoint } from '../../shared/types'
import { scoreColor } from './ui'

const SPIN_DEG_PER_SEC = 2.6
const POLL_MS = 15_000
const START_CENTER: [number, number] = [-45, 12] // Atlantic: Brazil + Europe in view

const YELLOW = '#fbbf24'
const GREEN = '#00d492'

const SOURCE_ID = 'leads'
const CORE_LAYERS = ['bs-core-discovered', 'bs-core-sent'] as const

function toFeatureCollection(points: GlobePoint[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, kind: p.kind, name: p.name, score: p.score },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  }
}

/**
 * Zoom that makes the sphere fill ~84% of the stage's short side.
 * Globe diameter ≈ (512 · 2^zoom) / π  →  zoom = log2(d·π / 512).
 */
function fitZoom(width: number, height: number): number {
  const diameter = Math.max(220, Math.min(width, height) * 0.84)
  return Math.min(3.2, Math.max(0.2, Math.log2((diameter * Math.PI) / 512)))
}

type HoverInfo = { name: string; score: number; kind: GlobePoint['kind']; x: number; y: number }

/** Lead dots: halo + core circle layers managed straight on the map instance
 *  (the mapcn-documented path for custom layers via useMap()). */
function LeadPoints({
  theme,
  onHover,
}: {
  theme: 'dark' | 'light'
  onHover: (info: HoverInfo | null) => void
}) {
  const { map, isLoaded } = useMap()
  const navigate = useNavigate()
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    if (!map || !isLoaded) return

    let lastPoints: GlobePoint[] = []

    // A theme change swaps the whole basemap style, wiping custom layers —
    // re-create them (and re-apply the data) every time a style finishes
    // loading, not just on mount.
    const ensureLayers = () => {
      if (map.getSource(SOURCE_ID)) return
      map.addSource(SOURCE_ID, { type: 'geojson', data: toFeatureCollection(lastPoints) })
      const kindFilter = (kind: GlobePoint['kind']) => ['==', ['get', 'kind'], kind] as never
      map.addLayer({
        id: 'bs-halo-discovered',
        type: 'circle',
        source: SOURCE_ID,
        filter: kindFilter('discovered'),
        paint: { 'circle-radius': 9, 'circle-color': YELLOW, 'circle-blur': 1, 'circle-opacity': 0.25 },
      })
      map.addLayer({
        id: 'bs-halo-sent',
        type: 'circle',
        source: SOURCE_ID,
        filter: kindFilter('sent'),
        paint: { 'circle-radius': 12, 'circle-color': GREEN, 'circle-blur': 1, 'circle-opacity': 0.35 },
      })
      map.addLayer({
        id: 'bs-core-discovered',
        type: 'circle',
        source: SOURCE_ID,
        filter: kindFilter('discovered'),
        paint: { 'circle-radius': 3, 'circle-color': YELLOW, 'circle-opacity': 0.95 },
      })
      map.addLayer({
        id: 'bs-core-sent',
        type: 'circle',
        source: SOURCE_ID,
        filter: kindFilter('sent'),
        paint: {
          'circle-radius': 3.8,
          'circle-color': GREEN,
          'circle-stroke-width': 1,
          'circle-stroke-color': themeRef.current === 'dark' ? '#0a0a0b' : '#ffffff',
        },
      })
    }
    ensureLayers()
    map.on('style.load', ensureLayers)

    const refresh = () => {
      void getGlobePoints()
        .then(({ points }) => {
          lastPoints = points
          const src = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
          src?.setData(toFeatureCollection(points))
        })
        .catch(() => {})
    }
    refresh()
    const poll = setInterval(refresh, POLL_MS)

    const onMove = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const p = f.properties as { id: string; kind: GlobePoint['kind']; name: string; score: number }
      map.getCanvas().style.cursor = 'pointer'
      onHover({ name: p.name, score: Number(p.score), kind: p.kind, x: e.point.x, y: e.point.y })
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      onHover(null)
    }
    const onClick = (e: MapLayerMouseEvent) => {
      const id = (e.features?.[0]?.properties as { id?: string } | undefined)?.id
      if (id) navigate(`/leads/${id}`)
    }
    for (const layer of CORE_LAYERS) {
      map.on('mousemove', layer, onMove)
      map.on('mouseleave', layer, onLeave)
      map.on('click', layer, onClick)
    }

    return () => {
      clearInterval(poll)
      onHover(null)
      map.off('style.load', ensureLayers)
      if (map.getStyle()) {
        for (const layer of CORE_LAYERS) {
          map.off('mousemove', layer, onMove)
          map.off('mouseleave', layer, onLeave)
          map.off('click', layer, onClick)
        }
      }
    }
  }, [map, isLoaded, navigate, onHover])

  return null
}

/**
 * Slow eastward spin. Any user interaction (drag, scroll/pinch zoom, touch)
 * hands control over — rotation stops until the Reset control brings the
 * globe back to its home view.
 */
function AutoRotate({
  spinning,
  onUserInteraction,
}: {
  spinning: boolean
  onUserInteraction: () => void
}) {
  const { map, isLoaded } = useMap()
  const spinningRef = useRef(spinning)
  spinningRef.current = spinning
  const interactRef = useRef(onUserInteraction)
  interactRef.current = onUserInteraction

  useEffect(() => {
    if (!map || !isLoaded) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let last: number | null = null

    const frame = (ts: number) => {
      if (last != null && spinningRef.current) {
        const center = map.getCenter()
        map.jumpTo({ center: [center.lng + SPIN_DEG_PER_SEC * ((ts - last) / 1000), center.lat] })
      }
      last = ts
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const takeOver = () => interactRef.current()
    map.on('dragstart', takeOver)
    map.on('wheel', takeOver)
    map.on('touchstart', takeOver)
    map.on('dblclick', takeOver)

    return () => {
      cancelAnimationFrame(raf)
      map.off('dragstart', takeOver)
      map.off('wheel', takeOver)
      map.off('touchstart', takeOver)
      map.off('dblclick', takeOver)
    }
  }, [map, isLoaded])

  return null
}

/** Zoom in / zoom out / reset-and-resume controls, bottom-right of the stage. */
function GlobeControls({
  onTakeOver,
  onReset,
}: {
  onTakeOver: () => void
  onReset: () => void
}) {
  const { map, isLoaded } = useMap()
  if (!map || !isLoaded) return null

  const zoomBy = (delta: number) => {
    onTakeOver()
    map.stop()
    map.easeTo({ zoom: map.getZoom() + delta, duration: 350 })
  }

  const reset = () => {
    map.stop()
    const el = map.getContainer()
    map.easeTo({
      center: START_CENTER,
      zoom: fitZoom(el.clientWidth, el.clientHeight),
      bearing: 0,
      pitch: 0,
      duration: 1100,
    })
    map.once('moveend', onReset)
  }

  const btn =
    'hud flex size-8 items-center justify-center rounded-lg text-gray-1 transition-colors hover:text-ink'

  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1.5">
      <button className={btn} aria-label="Globe zoom in" title="Zoom in" onClick={() => zoomBy(0.7)}>
        <Plus className="size-4" />
      </button>
      <button className={btn} aria-label="Globe zoom out" title="Zoom out" onClick={() => zoomBy(-0.7)}>
        <Minus className="size-4" />
      </button>
      <button
        className={btn}
        aria-label="Globe reset view"
        title="Reset view & resume rotation"
        onClick={reset}
      >
        <RotateCcw className="size-4" />
      </button>
    </div>
  )
}

/**
 * Keeps the sphere sized to the stage (ResizeObserver on the map container) —
 * only while in ambient auto-rotate mode, so a user-chosen zoom is never
 * snapped back by a window resize.
 */
function FitToStage({ active }: { active: boolean }) {
  const { map, isLoaded } = useMap()
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!map || !isLoaded) return
    const apply = () => {
      if (!activeRef.current) return
      const el = map.getContainer()
      map.setZoom(fitZoom(el.clientWidth, el.clientHeight))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map, isLoaded])

  return null
}

/** No sunlight on this planet: fully disable MapLibre's globe atmosphere halo. */
function NoAtmosphere() {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded) return
    try {
      map.setSky({
        'sky-color': '#0a0a0b',
        'horizon-color': '#0a0a0b',
        'fog-color': '#0a0a0b',
        'atmosphere-blend': 0,
      })
    } catch {
      /* sky is cosmetic — ignore engines without it */
    }
  }, [map, isLoaded])

  return null
}

export function LeadGlobe({
  className = '',
  theme = 'dark',
}: {
  className?: string
  theme?: 'dark' | 'light'
}) {
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const hoverRef = useRef(setHover)
  hoverRef.current = setHover
  /** false once the user takes over (drag / zoom); Reset turns it back on. */
  const [spinning, setSpinning] = useState(true)

  // The caller positions/sizes the wrapper (e.g. `absolute inset-0`); it must
  // NOT also be `relative` — conflicting position utilities break the height
  // the map canvas is measured from. The tooltip anchors to it either way.
  return (
    <div className={className}>
      <MapCN
        theme={theme}
        projection={{ type: 'globe' }}
        center={START_CENTER}
        zoom={1.6}
        minZoom={0.2}
        maxZoom={17}
        attributionControl={false}
        dragRotate={false}
        pitchWithRotate={false}
        keyboard={false}
      >
        <LeadPoints theme={theme} onHover={(info) => hoverRef.current(info)} />
        <AutoRotate spinning={spinning} onUserInteraction={() => setSpinning(false)} />
        <FitToStage active={spinning} />
        <NoAtmosphere />
        <GlobeControls onTakeOver={() => setSpinning(false)} onReset={() => setSpinning(true)} />
      </MapCN>

      {hover && (
        <div
          className="hud pointer-events-none absolute z-20 -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-[11.5px]"
          style={{ left: hover.x, top: hover.y - 14, transform: 'translate(-50%, -100%)' }}
        >
          <span className="font-mono font-bold tabular-nums" style={{ color: scoreColor(hover.score) }}>
            {hover.score.toFixed(1)}
          </span>{' '}
          <span className="text-ink">{hover.name}</span>{' '}
          <span style={{ color: hover.kind === 'sent' ? GREEN : YELLOW }}>
            {hover.kind === 'sent' ? '· sent' : '· discovered'}
          </span>
        </div>
      )}
    </div>
  )
}
