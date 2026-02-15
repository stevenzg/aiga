/**
 * Shared error boundary for sandbox adapters (ERR-01).
 *
 * Registers global error and unhandled rejection listeners
 * scoped to a specific sandbox app instance.
 */

export interface ErrorHandlers {
  error: (e: ErrorEvent) => void;
  rejection: (e: PromiseRejectionEvent) => void;
}

/**
 * Set up a global error boundary that logs uncaught errors
 * attributed to the given sandbox.
 */
export function setupErrorBoundary(
  sandboxName: string,
  appName: string,
): ErrorHandlers {
  const onError = (e: ErrorEvent) => {
    console.error(`[aiga] Uncaught error in ${sandboxName} sandbox "${appName}":`, e.error);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    console.error(`[aiga] Unhandled rejection in ${sandboxName} sandbox "${appName}":`, e.reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return { error: onError, rejection: onRejection };
}

/**
 * Remove error boundary listeners.
 */
export function cleanupErrorBoundary(handlers: ErrorHandlers): void {
  window.removeEventListener('error', handlers.error);
  window.removeEventListener('unhandledrejection', handlers.rejection);
}
