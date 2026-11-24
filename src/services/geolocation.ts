/**
 * Browser Geolocation API wrapper for observer location detection.
 *
 * Never assumes permission is granted: every failure (no API, insecure
 * context, denial, no fix, timeout) resolves to a typed result instead of
 * throwing, so the UI can explain what happened and fall back to manual entry.
 *
 * Units and frames: latitude/longitude in degrees (WGS84). Per the W3C
 * Geolocation spec, `coords.altitude` is meters above the WGS84 ellipsoid,
 * the same reference `ObserverLocation.altitudeM` uses, so it is stored as-is.
 * Most desktop browsers locate by Wi-Fi/IP and report no altitude (`null`);
 * callers then keep the previously configured altitude.
 */

export type GeolocationFailureReason = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout';

export interface GeolocationFix {
  ok: true;
  latitudeDeg: number;
  longitudeDeg: number;
  /** Meters above the WGS84 ellipsoid, or null when the device did not report one. */
  altitudeM: number | null;
  /** 95% horizontal accuracy radius, meters. */
  accuracyM: number;
  /** Fix time, UTC ms (wall clock of the device, not simulation time). */
  timestampMs: number;
}

export interface GeolocationFailure {
  ok: false;
  reason: GeolocationFailureReason;
  message: string;
}

export type GeolocationResult = GeolocationFix | GeolocationFailure;

export interface DetectLocationOptions {
  /** Milliseconds before giving up. Default 15 s. */
  timeoutMs?: number;
  /** Accept a cached fix up to this old, ms. Default 5 min. */
  maximumAgeMs?: number;
  /** Ask for GPS-grade accuracy. Slower and not needed for satellite look angles. Default false. */
  highAccuracy?: boolean;
}

/** Minimal surface of `navigator` this module needs; injectable for tests. */
export interface GeolocationEnvironment {
  geolocation?: Pick<Geolocation, 'getCurrentPosition'>;
  /** `window.isSecureContext`. Geolocation only works on https or localhost. */
  isSecureContext?: boolean;
}

const MESSAGES: Record<GeolocationFailureReason, string> = {
  unsupported: 'This browser does not provide the Geolocation API. Enter the location manually.',
  insecure: 'Location access needs a secure context (https or localhost). Enter the location manually.',
  denied: 'Location permission was denied. Allow it in the browser’s site settings, or enter the location manually.',
  unavailable: 'The browser could not determine a position. Enter the location manually.',
  timeout: 'Location request timed out. Try again, or enter the location manually.',
};

function failure(reason: GeolocationFailureReason, detail?: string): GeolocationFailure {
  return { ok: false, reason, message: detail ? `${MESSAGES[reason]} (${detail})` : MESSAGES[reason] };
}

function browserEnvironment(): GeolocationEnvironment {
  if (typeof navigator === 'undefined') return {};
  return {
    geolocation: navigator.geolocation,
    isSecureContext: typeof window === 'undefined' ? undefined : window.isSecureContext,
  };
}

// GeolocationPositionError codes (spec constants; the global class is absent in Node).
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

/** Requests one position fix. Resolves, never rejects. */
export function detectLocation(
  options: DetectLocationOptions = {},
  env: GeolocationEnvironment = browserEnvironment(),
): Promise<GeolocationResult> {
  if (env.isSecureContext === false) return Promise.resolve(failure('insecure'));
  const geo = env.geolocation;
  if (!geo || typeof geo.getCurrentPosition !== 'function') return Promise.resolve(failure('unsupported'));

  const timeoutMs = options.timeoutMs ?? 15_000;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: GeolocationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve(r);
    };
    // Some browsers never call back while the permission prompt is open, and
    // the API's own timeout only starts after permission. This guard bounds
    // the whole request, with slack for the user to answer the prompt.
    const guard = setTimeout(() => finish(failure('timeout')), timeoutMs + 30_000);

    try {
      geo.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, altitude, accuracy } = pos.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            finish(failure('unavailable', 'invalid coordinates'));
            return;
          }
          finish({
            ok: true,
            latitudeDeg: latitude,
            longitudeDeg: longitude,
            altitudeM: altitude != null && Number.isFinite(altitude) ? altitude : null,
            accuracyM: accuracy,
            timestampMs: pos.timestamp,
          });
        },
        (err) => {
          const reason: GeolocationFailureReason =
            err.code === PERMISSION_DENIED ? 'denied' : err.code === TIMEOUT ? 'timeout' : 'unavailable';
          if (err.code !== POSITION_UNAVAILABLE && err.code !== PERMISSION_DENIED && err.code !== TIMEOUT) {
            console.warn('[geolocation] unexpected error code', err.code, err.message);
          }
          finish(failure(reason, err.message || undefined));
        },
        {
          enableHighAccuracy: options.highAccuracy ?? false,
          timeout: timeoutMs,
          maximumAge: options.maximumAgeMs ?? 5 * 60_000,
        },
      );
    } catch (e) {
      // Some embedded browsers throw synchronously (e.g. blocked by a permissions policy).
      console.warn('[geolocation] getCurrentPosition threw', e);
      finish(failure('unavailable', e instanceof Error ? e.message : undefined));
    }
  });
}
