/**
 * Semver-aware Dependency Version Negotiation.
 *
 * When multiple iframes request the same library at different versions,
 * this module applies semver compatibility logic to serve a single
 * compatible version, reducing cache duplication.
 *
 * Example:
 *   iframe-A requests react@18.2.0
 *   iframe-B requests react@18.3.1
 *   → 18.3.1 is backward compatible → serve single copy of 18.3.1
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/** Parse a semver string like "18.2.0" or "v3.1.4". */
export function parseSemver(version: string): SemVer | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    raw: version,
  };
}

/** Compare two semver versions. Returns <0, 0, or >0. */
export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Check if `candidate` is backward-compatible with `requested`.
 * Follows semver convention: same major, candidate >= requested.
 */
export function isCompatible(requested: SemVer, candidate: SemVer): boolean {
  // Must share the same major version (breaking changes = major bump).
  if (requested.major !== candidate.major) return false;
  // Candidate must be >= requested.
  return compareSemver(candidate, requested) >= 0;
}

/**
 * Given a list of requested versions, find the best single version
 * that satisfies all requests (if possible).
 *
 * Strategy: pick the highest version that shares the same major as all.
 * If multiple major versions are requested, returns `null` (incompatible).
 */
export function negotiateVersion(versions: SemVer[]): SemVer | null {
  if (versions.length === 0) return null;
  if (versions.length === 1) return versions[0];

  // All must share the same major.
  const major = versions[0].major;
  if (!versions.every((v) => v.major === major)) return null;

  // Pick the highest version.
  return versions.reduce((best, v) =>
    compareSemver(v, best) > 0 ? v : best,
  );
}

/** Registry of requested dependency versions across all iframes. */
export class VersionRegistry {
  /** Map from package name → list of requested versions. */
  private requests = new Map<string, SemVer[]>();
  /** Map from package name → negotiated (resolved) version. */
  private resolved = new Map<string, SemVer>();

  /**
   * Register a version request from an iframe.
   * Returns the negotiated version to use.
   */
  register(packageName: string, version: string): SemVer | null {
    const sv = parseSemver(version);
    if (!sv) return null;

    let versions = this.requests.get(packageName);
    if (!versions) {
      versions = [];
      this.requests.set(packageName, versions);
    }

    // Check if already registered.
    if (!versions.some((v) => v.raw === sv.raw)) {
      versions.push(sv);
    }

    // Re-negotiate.
    const negotiated = negotiateVersion(versions);
    if (negotiated) {
      this.resolved.set(packageName, negotiated);
    }
    return negotiated;
  }

  /**
   * Get the resolved version for a package.
   * Returns null if no compatible version could be negotiated.
   */
  getResolved(packageName: string): SemVer | null {
    return this.resolved.get(packageName) ?? null;
  }

  /** Check if a URL matches a known versioned package pattern. */
  matchPackageUrl(url: string): { name: string; version: string } | null {
    // Match patterns like:
    //   /node_modules/react@18.2.0/...
    //   /npm/react@18.2.0
    //   /@scope/pkg@1.2.3
    //   /react/18.2.0/react.production.min.js
    const patterns = [
      // npm CDN pattern: /npm/package@version
      /\/npm\/(@?[^@/]+)@(\d+\.\d+\.\d+[^/]*)/,
      // node_modules pattern
      /\/node_modules\/(@?[^@/]+)@(\d+\.\d+\.\d+[^/]*)/,
      // unpkg/skypack pattern: /package@version
      /\/(@?[^@/]+)@(\d+\.\d+\.\d+[^/]*)/,
      // CDN path pattern: /package/version/
      /\/([a-z][\w.-]+)\/(\d+\.\d+\.\d+)\//,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return { name: match[1], version: match[2] };
      }
    }
    return null;
  }

  /** Rewrite a URL to use the negotiated version. */
  rewriteUrl(url: string, packageName: string, newVersion: SemVer): string {
    const match = this.matchPackageUrl(url);
    if (match && match.name === packageName) {
      return url.replace(match.version, newVersion.raw);
    }
    return url;
  }

  /** Get all tracked packages and their status. */
  status(): Array<{
    name: string;
    requested: string[];
    resolved: string | null;
  }> {
    const result: Array<{
      name: string;
      requested: string[];
      resolved: string | null;
    }> = [];

    for (const [name, versions] of this.requests) {
      result.push({
        name,
        requested: versions.map((v) => v.raw),
        resolved: this.resolved.get(name)?.raw ?? null,
      });
    }

    return result;
  }

  clear(): void {
    this.requests.clear();
    this.resolved.clear();
  }
}
