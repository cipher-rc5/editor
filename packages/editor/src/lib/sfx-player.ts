import useAudio from '../store/use-audio'

// Per-sound variation config. Playback rate also shifts pitch (one semitone ≈ 1.0595×),
// so a rate range of ~0.88–1.12 reads as a subtle ±2 semitones — enough to kill the
// machine-gun feeling when the same SFX fires in rapid succession.
type SFXConfig = {
  // One file, or several pre-rendered variations cycled round-robin per play.
  src: string | string[]
  // Random playback-rate range applied per play (1 = unchanged).
  rateRange?: [number, number]
  // Random volume multiplier range applied per play (1 = unchanged).
  volumeRange?: [number, number]
  // Minimum gap between two plays of this SFX. Triggers within this window
  // are silently dropped so bursty sequences don't phase-stack into noise.
  minIntervalMs?: number
  // Random stereo pan per play — max absolute offset (0 = center, 1 = hard
  // right). A small value like 0.15 keeps things centred but adds just enough
  // spread to stop repeats from stacking on the same point in the field.
  panJitter?: number
}

const DEFAULT_MIN_INTERVAL_MS = 30

// SFX sound definitions
export const SFX: Record<string, SFXConfig> = {
  gridSnap: {
    src: [
      '/audios/sfx/grid_snap_0.mp3',
      '/audios/sfx/grid_snap_1.mp3',
      '/audios/sfx/grid_snap_2.mp3',
    ],
    rateRange: [0.98, 1.02],
    volumeRange: [0.5, 0.6],
    panJitter: 0.15,
    minIntervalMs: 50,
  },
  itemDelete: {
    src: '/audios/sfx/item_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
    panJitter: 0.05,
  },
  itemPick: {
    src: '/audios/sfx/item_pick.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.92, 1.0],
    panJitter: 0.15,
  },
  itemPlace: {
    src: '/audios/sfx/item_place.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.9, 1.0],
    panJitter: 0.15,
  },
  itemRotate: {
    src: '/audios/sfx/item_rotate.mp3',
    rateRange: [0.94, 1.06],
    volumeRange: [0.92, 1.0],
    panJitter: 0.15,
  },
  // Fired when a structure draft begins (first click of a wall/slab/etc).
  structureBuildStart: {
    src: '/audios/sfx/structure_build_start.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
    panJitter: 0.15,
  },
  // Fired when a structure is committed (segment placed / polygon closed).
  structureBuildEnd: {
    src: '/audios/sfx/structure_build_end.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
    panJitter: 0.15,
  },
  structureDelete: {
    src: '/audios/sfx/structure_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
    panJitter: 0.08,
  },
  snapshotCapture: {
    // Shutter should sound consistent — no variation.
    src: '/audios/sfx/snapshot_capture.mp3',
  },
  // Soft tick when hovering a main category in the Build / Items panels.
  // Kept quiet and rate-locked so sweeping across the grid reads as texture,
  // not a melody.
  menuHover: {
    src: '/audios/sfx/menu_hover.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.2, 0.3],
    panJitter: 0.1,
    minIntervalMs: 0,
  },
  // Fired when a main category in the Build / Items panels is clicked.
  menuClick: {
    src: '/audios/sfx/menu_click.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.5, 0.6],
    panJitter: 0.1,
  },
} as const

export type SFXName = keyof typeof SFX

function randomInRange([min, max]: [number, number]): number {
  return min + Math.random() * (max - min)
}

const lastPlayedAt = new Map<SFXName, number>()
const lastVariation = new Map<SFXName, number>()

// Native Web Audio replaces the previous howler backend. The graph is created
// lazily — browsers block audio until a user gesture, and the first playSFX
// call always originates from one (a tool click / placement). Each sound may
// carry several pre-rendered variations, so buffers are cached per-variation
// and cycled round-robin at play time.
let audioContext: AudioContext | null = null
const bufferCache = new Map<SFXName, AudioBuffer[]>()
const bufferLoads = new Map<SFXName, Promise<AudioBuffer[] | null>>()

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return null
  }
  if (!audioContext) {
    audioContext = new AudioContext()
    // Warm the decode cache once a context exists so later plays are instant.
    for (const name of Object.keys(SFX) as SFXName[]) {
      void loadBuffers(name)
    }
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }
  return audioContext
}

function loadBuffers(name: SFXName): Promise<AudioBuffer[] | null> {
  const cached = bufferCache.get(name)
  if (cached) return Promise.resolve(cached)
  const inFlight = bufferLoads.get(name)
  if (inFlight) return inFlight

  const ctx = audioContext
  const config = SFX[name]
  if (!ctx || !config) return Promise.resolve(null)

  const sources = Array.isArray(config.src) ? config.src : [config.src]
  const load = Promise.all(
    sources.map((src) =>
      fetch(src)
        .then((res) => res.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data)),
    ),
  )
    .then((buffers) => {
      bufferCache.set(name, buffers)
      return buffers
    })
    .catch((err: unknown) => {
      console.warn(`SFX failed to load: ${name}`, err)
      return null
    })
  bufferLoads.set(name, load)
  return load
}

/**
 * Play a sound effect with volume based on audio settings
 */
export function playSFX(name: SFXName) {
  const config = SFX[name]
  if (!config) {
    console.warn(`SFX not found: ${name}`)
    return
  }

  // Drop rapid repeats — two plays of the same SFX within minIntervalMs just
  // smear into noise, they don't add useful information.
  const now = performance.now()
  const minInterval = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const last = lastPlayedAt.get(name)
  if (last !== undefined && now - last < minInterval) return
  lastPlayedAt.set(name, now)

  const { masterVolume, sfxVolume, muted } = useAudio.getState()
  if (muted) return

  const ctx = getAudioContext()
  if (!ctx) return

  // Calculate final volume (masterVolume and sfxVolume are 0-100)
  const baseVolume = (masterVolume / 100) * (sfxVolume / 100)
  const volumeJitter = config.volumeRange ? randomInRange(config.volumeRange) : 1
  const rate = config.rateRange ? randomInRange(config.rateRange) : 1
  const pan = config.panJitter ? (Math.random() * 2 - 1) * config.panJitter : 0

  void loadBuffers(name).then((buffers) => {
    if (!buffers || buffers.length === 0) return

    // Pick a random variation, avoiding an immediate repeat of the last one so
    // consecutive plays don't land on the same file.
    let index = Math.floor(Math.random() * buffers.length)
    if (buffers.length > 1 && index === lastVariation.get(name)) {
      index = (index + 1) % buffers.length
    }
    lastVariation.set(name, index)
    const buffer = buffers[index]
    if (!buffer) return

    // Fresh nodes per play so overlapping triggers don't fight over shared
    // state (this is what howler's voice pooling did for us before).
    const source = ctx.createBufferSource()
    source.buffer = buffer
    // playbackRate shifts pitch too, matching the previous howler `rate`.
    source.playbackRate.value = rate

    const gain = ctx.createGain()
    gain.gain.value = baseVolume * volumeJitter

    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner()
      panner.pan.value = pan
      source.connect(panner).connect(gain).connect(ctx.destination)
    } else {
      source.connect(gain).connect(ctx.destination)
    }

    source.start()
  })
}

/**
 * Retained for API compatibility. Volume is now read from the audio store on
 * every play, so there is no cached per-sound volume left to update.
 */
export function updateSFXVolumes() {
  // no-op
}
