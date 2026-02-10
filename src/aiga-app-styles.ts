/**
 * Styles for the `<aiga-app>` Web Component.
 *
 * Extracted to keep the component file focused on logic.
 */

let cachedSheet: CSSStyleSheet | null = null;

/** Get (and lazily create) the shared stylesheet for all <aiga-app> instances. */
export function getAigaAppStyles(): CSSStyleSheet {
  if (cachedSheet) return cachedSheet;

  cachedSheet = new CSSStyleSheet();
  cachedSheet.replaceSync(`
    :host {
      display: block;
      position: relative;
      width: 100%;
      min-height: 0;
    }
    :host([hidden]) {
      display: none;
    }
    .aiga-container {
      width: 100%;
      height: 100%;
      position: relative;
    }
    .aiga-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      color: #888;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 0.875rem;
    }
    .aiga-error {
      padding: 1rem;
      color: #dc2626;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 0.5rem;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 0.875rem;
    }
    .aiga-spinner {
      width: 1.25rem;
      height: 1.25rem;
      border: 2px solid #e5e7eb;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      margin-right: 0.5rem;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `);

  return cachedSheet;
}
