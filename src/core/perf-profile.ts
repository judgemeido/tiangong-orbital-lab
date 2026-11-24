/**
 * Hardware-aware Graphics & Performance Profile Controller
 * - Defaults to 'low' (极速模式, 1.0x DPR, minimal GPU fill-rate & zero heavy shaders)
 * - Allows user toggle between 'low' (极速) and 'high' (高清, 1.25x max DPR)
 * - Synchronizes `html.perf-low` class and notifies canvas resize listeners immediately
 */

export type PerfPreference = 'auto' | 'high' | 'low';
export type EffectiveQuality = 'high' | 'low';

let preference: PerfPreference = 'auto';
let effective: EffectiveQuality = 'low';

const listeners = new Set<(quality: EffectiveQuality, pref: PerfPreference) => void>();

function recompute(): void {
  // 'auto' now defaults straight to 'low' (极速模式) so all PCs run at peak smoothness out of the box
  const next: EffectiveQuality = preference === 'high' ? 'high' : 'low';
  const changed = next !== effective;
  effective = next;

  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('perf-low', effective === 'low');
  }

  if (changed) {
    listeners.forEach((fn) => fn(effective, preference));
  }
}

export function initPerfProfile(pref: PerfPreference = 'auto'): void {
  preference = pref;
  recompute();
}

export function setPerfPreference(pref: PerfPreference): void {
  preference = pref;
  const prev = effective;
  recompute();
  if (effective === prev) {
    listeners.forEach((fn) => fn(effective, preference));
  }
}

export function getPerfPreference(): PerfPreference {
  return preference;
}

export function getEffectiveQuality(): EffectiveQuality {
  return effective;
}

export function isLowPerf(): boolean {
  return effective === 'low';
}

export function getMaxDpr(): number {
  return effective === 'low' ? 1 : 1.25;
}

export function reportFrameDelta(_dtMs: number): void {
  // Default profile is already ultra-low GPU compute; kept as no-op API compatibility hook
}

export function subscribePerf(
  listener: (quality: EffectiveQuality, pref: PerfPreference) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

initPerfProfile('auto');
