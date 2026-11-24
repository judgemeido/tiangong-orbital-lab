/**
 * True Screen Stack for Modal Overlays (per game-ui-ux SKILL.md):
 * - Push overlays onto stack instead of loose boolean flags
 * - Traps keyboard focus inside top modal
 * - Restores previous focus cleanly on pop
 */

export interface OverlayEntry {
  id: string;
  element: HTMLElement;
  onClose?: () => void;
  previousFocus: HTMLElement | null;
}

export class ScreenStack {
  private stack: OverlayEntry[] = [];
  private root: HTMLElement;
  private onChange?: (hasOverlay: boolean) => void;

  constructor(root: HTMLElement, onChange?: (hasOverlay: boolean) => void) {
    this.root = root;
    this.onChange = onChange;
    window.addEventListener('keydown', this.handleKeyDown, true);
  }

  hasOverlay(): boolean {
    return this.stack.length > 0;
  }

  topId(): string | null {
    return this.stack.length ? this.stack[this.stack.length - 1].id : null;
  }

  push(id: string, element: HTMLElement, onClose?: () => void): void {
    // Avoid duplicating same overlay id
    if (this.topId() === id) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.appendChild(element);
    this.stack.push({ id, element, onClose, previousFocus });
    this.onChange?.(true);

    // Focus first focusable control inside modal (game-ui-ux rule #4)
    requestAnimationFrame(() => {
      const focusable = this.getFocusables(element);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    });
  }

  pop(invokeCallback = true): boolean {
    const entry = this.stack.pop();
    if (!entry) return false;
    entry.element.remove();
    if (invokeCallback) entry.onClose?.();
    this.onChange?.(this.stack.length > 0);
    if (entry.previousFocus && document.contains(entry.previousFocus)) {
      entry.previousFocus.focus();
    }
    return true;
  }

  clear(): void {
    while (this.stack.length > 0) {
      const entry = this.stack.pop()!;
      entry.element.remove();
    }
    this.onChange?.(false);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown, true);
    this.clear();
  }

  private getFocusables(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.stack.length === 0) return;
    const top = this.stack[this.stack.length - 1];

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.pop(true);
      return;
    }

    if (e.key === 'Tab') {
      const focusables = this.getFocusables(top.element);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
}
