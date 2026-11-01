import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom n'a ni matchMedia, ni ResizeObserver, ni capture du pointeur : Radix et vaul s'en servent.
if (!window.matchMedia) {
  window.matchMedia = (requete: string) =>
    ({
      matches: false,
      media: requete,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
