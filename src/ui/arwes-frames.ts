import {
  createFrame,
  createFrameCornersSettings,
  createFrameKranoxSettings,
  createFrameNefrexSettings,
  createFrameOctagonSettings,
} from '@arwes/frames';

export type ArwesFrameVariant = 'kranox' | 'nefrex' | 'corners' | 'octagon';

/**
 * Attaches a live responsive SVG sci-fi frame powered by GitHub's `@arwes/frames`
 * (`arwes/arwes`) behind any aerospace HUD box, modal, or mission deck card.
 * Uses ResizeObserver on the host container so frames render crisply even when
 * attached prior to DOM insertion or across viewport resizes.
 */
export function attachArwesFrame(
  host: HTMLElement,
  variant: ArwesFrameVariant = 'nefrex',
  options?: { strokeWidth?: number; cornerLength?: number; squareSize?: number }
): () => void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('arwes-frame-svg', `arwes-frame-${variant}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');

  host.classList.add('has-arwes-frame');
  host.insertBefore(svg, host.firstChild);

  const settings =
    variant === 'kranox'
      ? createFrameKranoxSettings({
          styled: true,
          animated: false,
          padding: 2,
          strokeWidth: options?.strokeWidth ?? 1.6,
          bgStrokeWidth: 0,
          squareSize: options?.squareSize ?? 14,
          smallLineLength: 10,
          largeLineLength: 28,
        })
      : variant === 'corners'
        ? createFrameCornersSettings({
            styled: true,
            animated: false,
            padding: 1,
            strokeWidth: options?.strokeWidth ?? 1.8,
            cornerLength: options?.cornerLength ?? 14,
          })
        : variant === 'octagon'
          ? createFrameOctagonSettings({
              styled: true,
              animated: false,
              padding: 1,
              strokeWidth: options?.strokeWidth ?? 1.5,
              squareSize: options?.squareSize ?? 12,
            })
          : createFrameNefrexSettings({
              styled: true,
              animated: false,
              padding: 1,
              strokeWidth: options?.strokeWidth ?? 1.6,
              squareSize: options?.squareSize ?? 12,
              smallLineLength: 12,
              largeLineLength: 34,
            });

  const frame = createFrame(svg, settings);
  const rerender = () => {
    try {
      frame.render();
    } catch {
      // Ignore transient detached layout measurements
    }
  };

  const ro = new ResizeObserver(rerender);
  ro.observe(host);
  const raf = requestAnimationFrame(rerender);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    frame.remove();
    svg.remove();
  };
}
