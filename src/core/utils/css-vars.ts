/**
 * Shared CSS variable collection and sync utilities.
 *
 * Provides debounced observation to avoid excessive reflow
 * when the host document's styles change frequently.
 */

/**
 * Collect CSS custom properties from :root.
 * Returns a record of `--var-name → value`.
 */
export function collectCssVariables(): Record<string, string> {
  const vars: Record<string, string> = {};
  const rootStyles = getComputedStyle(document.documentElement);
  for (const prop of rootStyles) {
    if (prop.startsWith('--')) {
      vars[prop] = rootStyles.getPropertyValue(prop).trim();
    }
  }
  return vars;
}

/**
 * Build a CSS rule string from a CSS variables record.
 * e.g., `:host { --color: red; --size: 12px; }`
 */
export function buildCssVarsRule(vars: Record<string, string>, selector = ':host'): string {
  const declarations = Object.entries(vars)
    .map(([prop, value]) => `${prop}: ${value};`)
    .join(' ');
  return `${selector} { ${declarations} }`;
}

/**
 * Create a debounced MutationObserver on `document.documentElement`
 * that watches for `style` and `class` attribute changes and calls
 * the callback at most once per animation frame.
 *
 * Returns a cleanup function that disconnects the observer.
 */
export function observeCssVariablesDebounced(
  callback: () => void,
): MutationObserver {
  let rafId: number | null = null;

  const observer = new MutationObserver(() => {
    // Coalesce multiple mutations into a single rAF callback.
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      callback();
    });
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  // Patch disconnect to also cancel pending rAF.
  const originalDisconnect = observer.disconnect.bind(observer);
  observer.disconnect = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    originalDisconnect();
  };

  return observer;
}
