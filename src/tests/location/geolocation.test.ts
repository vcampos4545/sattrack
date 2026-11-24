import { describe, expect, it, vi } from 'vitest';
import { detectLocation, type GeolocationEnvironment } from '../../services/geolocation';

type Success = PositionCallback;
type Failure = PositionErrorCallback;

function env(impl: (ok: Success, fail: Failure, opts?: PositionOptions) => void, isSecureContext = true): GeolocationEnvironment {
  return {
    isSecureContext,
    geolocation: { getCurrentPosition: impl as Geolocation['getCurrentPosition'] },
  };
}

function position(coords: Partial<GeolocationCoordinates>): GeolocationPosition {
  return {
    timestamp: 1_700_000_000_000,
    coords: {
      latitude: 0,
      longitude: 0,
      altitude: null,
      accuracy: 50,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...coords,
    },
  } as GeolocationPosition;
}

const positionError = (code: number, message = '') => ({ code, message }) as GeolocationPositionError;

describe('detectLocation', () => {
  it('returns the fix with altitude when the device reports one', async () => {
    const r = await detectLocation(
      {},
      env((ok) => ok(position({ latitude: 39.7392, longitude: -104.9847, altitude: 1620.5, accuracy: 12 }))),
    );
    expect(r).toEqual({
      ok: true,
      latitudeDeg: 39.7392,
      longitudeDeg: -104.9847,
      altitudeM: 1620.5,
      accuracyM: 12,
      timestampMs: 1_700_000_000_000,
    });
  });

  it('reports a null altitude when the browser has none', async () => {
    const r = await detectLocation({}, env((ok) => ok(position({ latitude: 10, longitude: 20 }))));
    expect(r.ok && r.altitudeM).toBeNull();
  });

  it('passes timeout, cache age and accuracy options through', async () => {
    const spy = vi.fn((ok: Success, _fail: Failure, _opts?: PositionOptions) => ok(position({})));
    await detectLocation({ timeoutMs: 5000, maximumAgeMs: 0, highAccuracy: true }, env(spy));
    expect(spy.mock.calls[0]?.[2]).toEqual({ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('maps error code %i to %s', async (code, reason) => {
    const r = await detectLocation({}, env((_ok, fail) => fail(positionError(code, 'browser says no'))));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe(reason);
      expect(r.message).toContain('browser says no');
    }
  });

  it('fails cleanly without the API', async () => {
    const r = await detectLocation({}, { isSecureContext: true });
    expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('fails cleanly in an insecure context without prompting', async () => {
    const spy = vi.fn();
    const r = await detectLocation({}, env(spy, false));
    expect(r).toMatchObject({ ok: false, reason: 'insecure' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats a synchronous throw as unavailable', async () => {
    const r = await detectLocation(
      {},
      env(() => {
        throw new Error('blocked by permissions policy');
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('rejects non-finite coordinates', async () => {
    const r = await detectLocation({}, env((ok) => ok(position({ latitude: NaN, longitude: 3 }))));
    expect(r).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('times out on its own if the browser never calls back', async () => {
    vi.useFakeTimers();
    try {
      const p = detectLocation({ timeoutMs: 1000 }, env(() => {}));
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await p).toMatchObject({ ok: false, reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores callbacks after it has settled', async () => {
    let fail: Failure | undefined;
    const r = await detectLocation(
      {},
      env((ok, f) => {
        fail = f;
        ok(position({ latitude: 1, longitude: 2 }));
      }),
    );
    fail?.(positionError(1));
    expect(r.ok).toBe(true);
  });
});
