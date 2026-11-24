import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import { AdditiveBlending, BackSide, SRGBColorSpace, ShaderMaterial, Vector3, type Group } from 'three';
import { sunDirectionTeme } from '../../core/orbit/sun-position';
import { gmstRad } from '../../core/orbit/time-utils';
import { useSettingsStore } from '../../stores/settings-store';
import { getSimTimeMs } from '../../stores/time-store';
import { EARTH_POLAR_SCALE } from './scene-frame';

const TEXTURE_BASE = `${import.meta.env.BASE_URL}textures/`;
export const EARTH_DAY_URL = `${TEXTURE_BASE}earth-day.jpg`;
export const EARTH_NIGHT_URL = `${TEXTURE_BASE}earth-night.jpg`;

/**
 * Group fixed to the rotating Earth. Its rotation about the scene's y axis
 * (the TEME/ECEF z axis) is GMST at the simulation time, which is exactly
 * the TEME -> ECEF rotation of the orbit module (see scene-frame.ts). Children
 * are placed in Earth-fixed scene coordinates.
 */
export function EarthFixedFrame({ children }: { children: ReactNode }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = gmstRad(getSimTimeMs());
  });
  return <group ref={ref}>{children}</group>;
}

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/*
 * Day/night shading. cosSun is the cosine of the Sun's zenith angle at the
 * surface point. The smoothstep over cosSun in [-0.1, 0.1] (about +/- 6
 * degrees around the terminator) stands in for civil twilight. City lights
 * fade in on the night side. With uTerminator = 0 the globe is evenly lit.
 */
const earthFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSunDir;
  uniform float uTerminator;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vPosW);
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;
    float cosSun = dot(n, uSunDir);
    float dayMix = smoothstep(-0.1, 0.1, cosSun);
    vec3 lit = day * (0.45 + 0.75 * clamp(cosSun, 0.0, 1.0));
    vec3 dark = day * 0.07 + night * vec3(1.0, 0.82, 0.55) * 1.1;
    vec3 shaded = mix(dark, lit, dayMix);
    vec3 color = mix(day * 0.95, shaded, uTerminator);
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    float rimLight = mix(1.0, 0.2 + 0.8 * dayMix, uTerminator);
    color += vec3(0.28, 0.55, 1.0) * fresnel * 0.45 * rimLight;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Textured WGS84-shaped Earth with optional day/night terminator. Place inside `EarthFixedFrame`. */
export function Earth() {
  const [day, night] = useTexture([EARTH_DAY_URL, EARTH_NIGHT_URL]);
  const material = useMemo(() => {
    for (const t of [day, night]) {
      if (!t) continue;
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
    }
    return new ShaderMaterial({
      uniforms: {
        uDay: { value: day },
        uNight: { value: night },
        uSunDir: { value: new Vector3(1, 0, 0) },
        uTerminator: { value: 1 },
      },
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
    });
  }, [day, night]);

  useFrame(() => {
    const sun = sunDirectionTeme(getSimTimeMs());
    // TEME -> scene axes (scene-frame.ts): (x, z, -y).
    material.uniforms.uSunDir!.value.set(sun.x, sun.z, -sun.y).normalize();
    material.uniforms.uTerminator!.value = useSettingsStore.getState().showTerminator ? 1 : 0;
  });

  return (
    <mesh scale={[1, EARTH_POLAR_SCALE, 1]} material={material}>
      <sphereGeometry args={[1, 192, 96]} />
    </mesh>
  );
}

/** Untextured stand-in while the textures load. */
export function EarthPlaceholder() {
  return (
    <mesh scale={[1, EARTH_POLAR_SCALE, 1]}>
      <sphereGeometry args={[1, 64, 32]} />
      <meshBasicMaterial color="#0d1626" />
    </mesh>
  );
}

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormalV;
  void main() {
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragment = /* glsl */ `
  varying vec3 vNormalV;
  void main() {
    // Only the shell beyond the Earth's limb is visible. There the back-face
    // normal's view-space z runs from 0 (outer edge) to about -0.29 (at the
    // limb, for a shell 1.045 Earth radii wide), so fade in along -z.
    float t = clamp(-vNormalV.z / 0.29, 0.0, 1.0);
    float intensity = pow(t, 2.4) * 0.85;
    gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * intensity, intensity);
  }
`;

/** Thin additive glow around the limb (back faces of a slightly larger sphere). */
export function Atmosphere() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: atmosphereVertex,
        fragmentShader: atmosphereFragment,
        side: BackSide,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  return (
    <mesh scale={1.045} material={material}>
      <sphereGeometry args={[1, 96, 48]} />
    </mesh>
  );
}
