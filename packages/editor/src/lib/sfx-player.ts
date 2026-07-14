import useAudio from '../store/use-audio'

// Per-sound variation config. Playback rate also shifts pitch (one semitone ≈ 1.0595×),
// so a rate range of ~0.88–1.12 reads as a subtle ±2 semitones — enough to kill the
// machine-gun feeling when the same SFX fires in rapid succession.
type SFXConfig = {
  src: string
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
    src: '/audios/sfx/grid_snap.mp3',
    rateRange: [0.94, 1.06],
    volumeRange: [0.92, 1.0],
    panJitter: 0.15,
  },
  itemDelete: {
    src: '/audios/sfx/item_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
    panJitter: 0.15,
  },
  itemPick: {
    src: '/audios/sfx/item_pick.mp3',
    rateRange: [0.92, 1.08],
    volumeRange: [0.92, 1.0],
    panJitter: 0.15,
  },
  itemPlace: {
    src: '/audios/sfx/item_place.mp3',
    rateRange: [0.98, 1.06],
    volumeRange: [0.9, 1.0],
    panJitter: 0.15,
  },
  itemRotate: {
    src: '/audios/sfx/item_rotate.mp3',
    rateRange: [0.94, 1.06],
    volumeRange: [0.92, 1.0],
    panJitter: 0.15,
  },
  structureBuild: {
    src: '/audios/sfx/structure_build.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
    panJitter: 0.15,
  },
  structureDelete: {
    src: '/audios/sfx/structure_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
    panJitter: 0.15,
  },
  snapshotCapture: {
    // Shutter should sound consistent — no variation.
    src: '/audios/sfx/snapshot_capture.mp3',
  },
} as const

export type SFXName = keyof typeof SFX

function randomInRange([min, max]: [number, number]): number {
  return min + Math.random() * (max - min)
}

const lastPlayedAt = new Map<SFXName, number>()

// Native Web Audio replaces the previous howler backend. The graph is created
// lazily — browsers block audio until a user gesture, and the first playSFX
// call always originates from one (a tool click / placement).
let audioContext: AudioContext | null = null
const bufferCache = new Map<SFXName, AudioBuffer>()
const bufferLoads = new Map<SFXName, Promise<AudioBuffer | null>>()

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return null
  }
  if (!audioContext) {
    audioContext = new AudioContext()
    // Warm the decode cache once a context exists so later plays are instant.
    for (const name of Object.keys(SFX) as SFXName[]) {
      void loadBuffer(name)
    }
  }
  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }
  return audioContext
}

function loadBuffer(name: SFXName): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(name)
  if (cached) return Promise.resolve(cached)
  const inFlight = bufferLoads.get(name)
  if (inFlight) return inFlight

  const ctx = audioContext
  const config = SFX[name]
  if (!ctx || !config) return Promise.resolve(null)

  const load = fetch(config.src)
    .then((res) => res.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      bufferCache.set(name, buffer)
      return buffer
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

  void loadBuffer(name).then((buffer) => {
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
