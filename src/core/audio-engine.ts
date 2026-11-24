import type { AudioAPI } from './game-interface';

/**
 * Procedural Web Audio synthesizer for aerospace HUD and mission feedback.
 * Zero external audio files required; lazily initializes AudioContext on user gesture.
 */
export class AudioEngine implements AudioAPI {
  private ctx: AudioContext | null = null;
  private muted = false;
  private lastThrusterAt = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.ctx = new AudioCtx();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  playClick(): void {
    this.tone(720, 0.045, 'triangle', 0.06, 980);
  }

  playHover(): void {
    this.tone(540, 0.025, 'sine', 0.025, 620);
  }

  playSwitch(): void {
    this.tone(420, 0.05, 'square', 0.035, 680);
  }

  playBeep(freq = 880, duration = 0.08): void {
    this.tone(freq, duration, 'sine', 0.055);
  }

  playThruster(intensity = 0.7): void {
    const now = performance.now();
    if (now - this.lastThrusterAt < 75) return;
    this.lastThrusterAt = now;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const dur = 0.09;
    const sampleRate = ctx.sampleRate;
    const bufferSize = Math.floor(sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.65));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400 + intensity * 600;
    filter.Q.value = 1.1;

    const gain = ctx.createGain();
    const vol = Math.min(0.08, 0.035 + intensity * 0.04);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  }

  playLock(): void {
    this.tone(180, 0.14, 'sawtooth', 0.08, 95);
    setTimeout(() => this.tone(520, 0.12, 'triangle', 0.07, 780), 90);
  }

  playWarning(): void {
    this.tone(620, 0.11, 'sawtooth', 0.045, 520);
  }

  playCritical(): void {
    this.tone(860, 0.1, 'square', 0.05, 640);
    setTimeout(() => this.tone(860, 0.1, 'square', 0.05, 640), 130);
  }

  playSuccess(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      setTimeout(() => this.tone(n, 0.18, 'triangle', 0.065), idx * 85);
    });
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    endFreq?: number
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }
}
