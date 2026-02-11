/**
 * Route matching engine for Aiga Router.
 *
 * Pure functions for matching URL paths against route patterns.
 * Supports static segments, dynamic params (:id), wildcards (*),
 * and nested routes with prefix matching.
 */

import type { RouteConfig, MatchedRoute } from './router.js';

/**
 * Match a path against the route definitions (supports nested routes).
 * Returns the matched route with params and full match chain.
 */
export function matchRoute(
  path: string,
  routes: RouteConfig[],
  parentChain: RouteConfig[],
  query: Record<string, string>,
  base: string,
): MatchedRoute | null {
  const [pathOnly] = path.split('?');

  for (const route of routes) {
    const params: Record<string, string> = {};

    // Try children first with prefix matching.
    if (route.children?.length) {
      const prefixResult = matchPrefix(pathOnly, route.path, params);
      if (prefixResult !== null) {
        const chain = [...parentChain, route];
        const remainder = prefixResult || '/';
        const childMatch = matchRoute(remainder, route.children, chain, query, base);
        if (childMatch) {
          childMatch.params = { ...params, ...childMatch.params };
          return childMatch;
        }
      }
    }

    // Exact match for leaf routes.
    const matched = matchPath(pathOnly, route.path, params);
    if (matched) {
      const chain = [...parentChain, route];
      return {
        path: pathOnly,
        config: route,
        params,
        matched: chain,
        fullPath: base + path,
        query,
        meta: route.meta ?? {},
      };
    }
  }

  return null;
}

/**
 * Match a URL path against a route pattern.
 * Supports:
 * - Static segments: '/dashboard'
 * - Dynamic params: '/users/:id'
 * - Wildcards: '/docs/*' (catch-all)
 */
export function matchPath(
  urlPath: string,
  pattern: string,
  params: Record<string, string>,
): boolean {
  const urlParts = urlPath.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  // Wildcard catch-all.
  if (patternParts[patternParts.length - 1] === '*') {
    const staticParts = patternParts.slice(0, -1);
    if (urlParts.length < staticParts.length) return false;
    for (let i = 0; i < staticParts.length; i++) {
      if (staticParts[i].startsWith(':')) {
        params[staticParts[i].slice(1)] = urlParts[i];
      } else if (staticParts[i] !== urlParts[i]) {
        return false;
      }
    }
    params['*'] = urlParts.slice(staticParts.length).join('/');
    return true;
  }

  if (urlParts.length !== patternParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Match a URL path as a prefix of a route pattern (for nested routes).
 * Returns the remainder path if the prefix matches, or null if no match.
 */
export function matchPrefix(
  urlPath: string,
  pattern: string,
  params: Record<string, string>,
): string | null {
  const urlParts = urlPath.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  if (urlParts.length < patternParts.length) return null;

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }

  // Return the remaining path segments.
  const remainder = '/' + urlParts.slice(patternParts.length).join('/');
  return remainder;
}
