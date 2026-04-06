/**
 * Egg-Hoc incoming-message bark: real dog sound from `public/sounds/egg-hoc-bark.mp3`
 * (see `public/sounds/ATTRIBUTION.txt`). Falls back to a short synthetic woof if the
 * file fails to play. Call `unlockEggHocNotificationAudio()` from a user gesture so
 * playback isn’t blocked by autoplay rules.
 */

const BARK_URL = "/sounds/egg-hoc-bark.mp3";

let barkAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let lastBarkAt = 0;
const MIN_MS_BETWEEN_BARKS = 900;

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function getBarkAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!barkAudio) {
    barkAudio = new Audio(BARK_URL);
    barkAudio.preload = "auto";
  }
  return barkAudio;
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new Ctx();
  }
  return audioCtx;
}

/** Call from a click/touch (e.g. opening Egg-Hoc) so later barks can play. */
export function unlockEggHocNotificationAudio(): void {
  const ctx = getCtx();
  if (ctx?.state === "suspended") {
    void ctx.resume().catch(() => {});
  }
  const a = getBarkAudio();
  if (a) {
    void a.load();
  }
}

function woof(ctx: AudioContext, start: number, baseHz: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(baseHz, start);
  osc.frequency.exponentialRampToValueAtTime(baseHz * 0.55, start + 0.07);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.12);
}

function playSyntheticFallback(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const runSynth = () => {
    try {
      const t = ctx.currentTime;
      woof(ctx, t, 155);
      woof(ctx, t + 0.14, 135);
    } catch {
      /* ignore */
    }
  };
  if (ctx.state === "suspended") {
    void ctx.resume().then(runSynth).catch(() => {});
  } else {
    runSynth();
  }
}

/** Plays the notification bark; debounced globally. */
export function playEggHocIncomingBark(): void {
  const t0 = nowMs();
  if (t0 - lastBarkAt < MIN_MS_BETWEEN_BARKS) return;
  lastBarkAt = t0;

  const a = getBarkAudio();
  if (a) {
    a.currentTime = 0;
    void a.play().catch(() => {
      playSyntheticFallback();
    });
    return;
  }

  playSyntheticFallback();
}
