"use client"

import { useRef, useEffect, useMemo } from "react"
import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"

interface AccretionDiskUniforms {
  [uniform: string]: { value: unknown }
  uTime: { value: number }
  uResolution: { value: THREE.Vector2 }
  uBlackHoleRadius: { value: number }
  uInnerRadius: { value: number }
  uOuterRadius: { value: number }
  uCameraPos: { value: THREE.Vector3 }
  uDiskColor1: { value: THREE.Color }
  uDiskColor2: { value: THREE.Color }
  uDiskColor3: { value: THREE.Color }
  uIntensity: { value: number }
}

interface GravParticle {
  angle: number
  radius: number
  speed: number
  size: number
  baseOpacity: number
  y: number
}

interface BlackHoleThreeProps {
  onReady?: () => void
}

export default function BlackHoleThree({ onReady }: BlackHoleThreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mouseRef = useRef({
    x: 0.5,
    y: 0.5,
    targetX: 0.5,
    targetY: 0.5,
  })
  const scrollRef = useRef({ progress: 0, targetProgress: 0 })
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const frameIdRef = useRef<number>(0)

  const accretionVertexShader = useMemo(
    () => `
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vWorldPosition;

    void main() {
      vUv = uv;
      vPosition = position;
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    []
  )

  const accretionFragmentShader = useMemo(
    () => `
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uBlackHoleRadius;
    uniform float uInnerRadius;
    uniform float uOuterRadius;
    uniform vec3 uCameraPos;
    uniform vec3 uDiskColor1;
    uniform vec3 uDiskColor2;
    uniform vec3 uDiskColor3;
    uniform float uIntensity;

    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vWorldPosition;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);

      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);

      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;

      i = mod289(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;

      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);

      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);

      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);

      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));

      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);

      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;

      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    float fbm(vec3 p) {
      float value = 0.0;
      float amplitude = 0.5;
      float frequency = 1.0;
      for (int i = 0; i < 5; i++) {
        value += amplitude * snoise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
      }
      return value;
    }

    void main() {
      vec2 center = vec2(0.5);
      vec2 uv = vUv - center;
      float dist = length(uv);

      float angle = atan(uv.y, uv.x);

      float innerEdge = smoothstep(uInnerRadius - 0.02, uInnerRadius, dist);
      float outerEdge = 1.0 - smoothstep(uOuterRadius - 0.05, uOuterRadius, dist);
      float diskMask = innerEdge * outerEdge;

      if (diskMask < 0.001) {
        discard;
      }

      float spiralSpeed = uTime * 0.3;
      float spiralTightness = 3.0;
      float spiral = sin(angle * spiralTightness + dist * 15.0 - spiralSpeed);
      spiral = spiral * 0.5 + 0.5;

      vec3 noisePos = vec3(uv * 3.0, uTime * 0.1);
      float turbulence = fbm(noisePos) * 0.5 + 0.5;

      float density = spiral * turbulence;
      density = pow(density, 1.5);

      float tempGradient = 1.0 - smoothstep(uInnerRadius, uOuterRadius, dist);

      vec3 hotColor = uDiskColor1;
      vec3 midColor = uDiskColor2;
      vec3 coolColor = uDiskColor3;

      vec3 color = mix(coolColor, midColor, tempGradient * 0.7);
      color = mix(color, hotColor, tempGradient * tempGradient * density);

      float beaming = sin(angle - 1.0) * 0.5 + 0.5;
      color *= 0.7 + beaming * 0.6;

      color *= (0.8 + density * 0.4);

      float alpha = density * diskMask * uIntensity;
      alpha *= smoothstep(uInnerRadius, uInnerRadius + 0.05, dist);
      alpha *= 1.0 - smoothstep(uOuterRadius - 0.08, uOuterRadius, dist);

      float innerGlow = 1.0 - smoothstep(uInnerRadius, uInnerRadius + 0.08, dist);
      color += hotColor * innerGlow * 0.5;
      alpha += innerGlow * 0.3;

      gl_FragColor = vec4(color, alpha);
    }
  `,
    []
  )

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Scene
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.z = 6

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.5
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // ── Event Horizon ──
    const blackHoleGeometry = new THREE.SphereGeometry(0.92, 64, 64)
    const blackHoleMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
          vec3 color = mix(vec3(0.0), vec3(0.02, 0.02, 0.03), fresnel);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: false,
      depthWrite: true,
    })
    const blackHole = new THREE.Mesh(blackHoleGeometry, blackHoleMaterial)
    scene.add(blackHole)

    // ── Photon Ring Primary ──
    const photonRingGeometry = new THREE.TorusGeometry(1.15, 0.025, 32, 128)
    const photonRingMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float pulse = sin(uTime * 2.0) * 0.3 + 0.7;
          vec3 color = vec3(0.0, 0.9, 0.63) * pulse;
          float alpha = 0.6 * pulse;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const photonRing = new THREE.Mesh(photonRingGeometry, photonRingMaterial)
    photonRing.rotation.x = Math.PI / 2.3
    scene.add(photonRing)

    // ── Photon Ring Secondary ──
    const photonRing2Geometry = new THREE.TorusGeometry(1.28, 0.012, 32, 128)
    const photonRing2Material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float pulse = sin(uTime * 1.5 + 1.0) * 0.2 + 0.5;
          vec3 color = vec3(0.66, 0.33, 0.97) * pulse;
          float alpha = 0.35 * pulse;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const photonRing2 = new THREE.Mesh(photonRing2Geometry, photonRing2Material)
    photonRing2.rotation.x = Math.PI / 2.3
    scene.add(photonRing2)

    // ── Accretion Disk (front) ──
    const diskGeometry = new THREE.PlaneGeometry(6, 6, 128, 128)
    const diskUniforms: AccretionDiskUniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
      uBlackHoleRadius: { value: 0.92 },
      uInnerRadius: { value: 0.18 },
      uOuterRadius: { value: 0.48 },
      uCameraPos: { value: camera.position },
      uDiskColor1: { value: new THREE.Color(0.7, 1.0, 0.9) },
      uDiskColor2: { value: new THREE.Color(0.0, 0.9, 0.63) },
      uDiskColor3: { value: new THREE.Color(0.66, 0.33, 0.97) },
      uIntensity: { value: 1.2 },
    }
    const diskMaterial = new THREE.ShaderMaterial({
      uniforms: diskUniforms,
      vertexShader: accretionVertexShader,
      fragmentShader: accretionFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const accretionDisk = new THREE.Mesh(diskGeometry, diskMaterial)
    accretionDisk.rotation.x = -Math.PI / 2.3
    scene.add(accretionDisk)

    // ── Accretion Disk (back, dimmer) ──
    const backDiskMaterial = new THREE.ShaderMaterial({
      uniforms: { ...diskUniforms, uIntensity: { value: 0.4 } },
      vertexShader: accretionVertexShader,
      fragmentShader: accretionFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const backAccretionDisk = new THREE.Mesh(diskGeometry, backDiskMaterial)
    backAccretionDisk.rotation.x = -Math.PI / 2.3
    backAccretionDisk.rotation.z = Math.PI
    scene.add(backAccretionDisk)

    // ── Starfield ──
    const starsGeometry = new THREE.BufferGeometry()
    const starsCount = 4000
    const starPositions = new Float32Array(starsCount * 3)
    const starSizes = new Float32Array(starsCount)
    const starColors = new Float32Array(starsCount * 3)

    for (let i = 0; i < starsCount; i++) {
      const i3 = i * 3
      const r = 10 + Math.random() * 50
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)

      starPositions[i3] = r * Math.sin(phi) * Math.cos(theta)
      starPositions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      starPositions[i3 + 2] = r * Math.cos(phi)

      starSizes[i] = Math.random() * 0.08 + 0.02

      const colorType = Math.random()
      if (colorType < 0.6) {
        starColors[i3] = 1.0
        starColors[i3 + 1] = 1.0
        starColors[i3 + 2] = 1.0
      } else if (colorType < 0.8) {
        starColors[i3] = 0.7
        starColors[i3 + 1] = 0.85
        starColors[i3 + 2] = 1.0
      } else if (colorType < 0.92) {
        starColors[i3] = 0.0
        starColors[i3 + 1] = 0.9
        starColors[i3 + 2] = 0.63
      } else {
        starColors[i3] = 0.66
        starColors[i3 + 1] = 0.33
        starColors[i3 + 2] = 0.97
      }
    }

    starsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(starPositions, 3)
    )
    starsGeometry.setAttribute("size", new THREE.BufferAttribute(starSizes, 1))
    starsGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(starColors, 3)
    )

    const starsMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uTime;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPosition.z) * (1.0 + sin(uTime * 2.0 + position.x) * 0.2);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
    })
    const stars = new THREE.Points(starsGeometry, starsMaterial)
    scene.add(stars)

    // ── Nebula Clouds ──
    const nebulaGeometry = new THREE.PlaneGeometry(30, 30, 64, 64)
    const nebulaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor1: { value: new THREE.Color(0.4, 0.1, 0.6) },
        uColor2: { value: new THREE.Color(0.1, 0.2, 0.5) },
        uColor3: { value: new THREE.Color(0.0, 0.4, 0.4) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        uniform vec3 uColor3;
        varying vec2 vUv;

        float noise(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        float smoothNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);

          float a = noise(i);
          float b = noise(i + vec2(1.0, 0.0));
          float c = noise(i + vec2(0.0, 1.0));
          float d = noise(i + vec2(1.0, 1.0));

          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 6; i++) {
            value += amplitude * smoothNoise(p);
            p *= 2.0;
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          vec2 uv = vUv;
          float n = fbm(uv * 2.0 + uTime * 0.02);
          float n2 = fbm(uv * 3.0 - uTime * 0.015);

          vec3 color = mix(uColor1, uColor2, n);
          color = mix(color, uColor3, n2 * 0.5);

          float alpha = n * n2 * 0.15;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    const nebulas: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const nebula = new THREE.Mesh(nebulaGeometry, nebulaMaterial.clone())
      nebula.position.z = -15 - i * 5
      nebula.rotation.z = i * 0.5
      nebula.material.uniforms.uColor1.value = new THREE.Color(
        0.3 + Math.random() * 0.3,
        0.1 + Math.random() * 0.2,
        0.4 + Math.random() * 0.3
      )
      nebula.material.uniforms.uColor2.value = new THREE.Color(
        0.1 + Math.random() * 0.2,
        0.2 + Math.random() * 0.3,
        0.4 + Math.random() * 0.3
      )
      scene.add(nebula)
      nebulas.push(nebula)
    }

    // ── Gravitational Particle Spiral ──
    const GRAV_COUNT = 350
    const gravParticles: GravParticle[] = []
    const gravGeo = new THREE.BufferGeometry()
    const gravPositions = new Float32Array(GRAV_COUNT * 3)
    const gravSizes = new Float32Array(GRAV_COUNT)
    const gravColors = new Float32Array(GRAV_COUNT * 3)
    const gravOpacities = new Float32Array(GRAV_COUNT)

    for (let i = 0; i < GRAV_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = 1.2 + Math.random() * 4.5
      const speed = (0.3 + Math.random() * 0.5) / Math.sqrt(radius)

      gravParticles.push({
        angle,
        radius,
        speed,
        size: 0.015 + Math.random() * 0.04,
        baseOpacity: 0.25 + Math.random() * 0.75,
        y: (Math.random() - 0.5) * 0.2,
      })

      gravPositions[i * 3] = Math.cos(angle) * radius
      gravPositions[i * 3 + 1] = gravParticles[i].y
      gravPositions[i * 3 + 2] = Math.sin(angle) * radius
      gravSizes[i] = gravParticles[i].size
      gravOpacities[i] = gravParticles[i].baseOpacity

      // Mix of teal and violet hues
      const hue =
        Math.random() > 0.55
          ? 0.44 + Math.random() * 0.06
          : 0.76 + Math.random() * 0.06
      const c = new THREE.Color().setHSL(
        hue,
        0.7 + Math.random() * 0.3,
        0.45 + Math.random() * 0.35
      )
      gravColors[i * 3] = c.r
      gravColors[i * 3 + 1] = c.g
      gravColors[i * 3 + 2] = c.b
    }

    gravGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(gravPositions, 3)
    )
    gravGeo.setAttribute("size", new THREE.BufferAttribute(gravSizes, 1))
    gravGeo.setAttribute("color", new THREE.BufferAttribute(gravColors, 3))
    gravGeo.setAttribute("opacity", new THREE.BufferAttribute(gravOpacities, 1))

    const gravMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        attribute float opacity;
        varying vec3 vColor;
        varying float vOpacity;
        uniform float uPixelRatio;

        void main() {
          vColor = color;
          vOpacity = opacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio * (400.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = 1.0 - smoothstep(0.15, 0.5, dist);
          float glow = exp(-dist * 5.0);
          vec3 finalColor = vColor + vec3(glow * 0.25);
          gl_FragColor = vec4(finalColor, alpha * vOpacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const gravPoints = new THREE.Points(gravGeo, gravMaterial)
    const gravGroup = new THREE.Group()
    gravGroup.rotation.x = -Math.PI / 2.3
    gravGroup.add(gravPoints)
    scene.add(gravGroup)

    // ── Ambient Light (subtle) ──
    const ambientLight = new THREE.AmbientLight(0x222233, 0.3)
    scene.add(ambientLight)

    // ── Post-Processing: Bloom ──
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.7,   // strength
      0.35,  // radius
      0.8    // threshold
    )
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())

    // ── Event Listeners ──
    const handleResize = () => {
      const newWidth = container.clientWidth
      const newHeight = container.clientHeight
      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
      composer.setSize(newWidth, newHeight)
      diskUniforms.uResolution.value.set(newWidth, newHeight)
    }
    window.addEventListener("resize", handleResize)

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      mouseRef.current.targetX = (e.clientX - rect.left) / rect.width
      mouseRef.current.targetY = 1 - (e.clientY - rect.top) / rect.height
    }
    container.addEventListener("mousemove", handleMouseMove)

    const handleScroll = () => {
      const scrollHeight =
        document.documentElement.scrollHeight - window.innerHeight
      if (scrollHeight > 0) {
        scrollRef.current.targetProgress = Math.min(
          window.scrollY / scrollHeight,
          1
        )
      }
    }
    window.addEventListener("scroll", handleScroll, { passive: true })

    // ── Animation Loop ──
    let time = 0
    let firstFrame = true

    const animate = () => {
      time += 0.016

      // Smooth scroll interpolation
      scrollRef.current.progress +=
        (scrollRef.current.targetProgress - scrollRef.current.progress) * 0.03
      const sp = scrollRef.current.progress

      // Smooth mouse
      mouseRef.current.x +=
        (mouseRef.current.targetX - mouseRef.current.x) * 0.05
      mouseRef.current.y +=
        (mouseRef.current.targetY - mouseRef.current.y) * 0.05

      // ── Scroll-Driven Camera Descent ──
      const cameraZ = 6 - sp * 3.5
      const mouseInfluence = Math.max(0.08, 0.5 - sp * 0.4)
      camera.position.x = (mouseRef.current.x - 0.5) * mouseInfluence
      camera.position.y = (mouseRef.current.y - 0.5) * mouseInfluence
      camera.position.z = cameraZ
      camera.lookAt(0, 0, 0)

      // Update uniforms
      diskUniforms.uTime.value = time
      diskMaterial.uniforms.uTime.value = time
      backDiskMaterial.uniforms.uTime.value = time
      photonRingMaterial.uniforms.uTime.value = time
      photonRing2Material.uniforms.uTime.value = time
      starsMaterial.uniforms.uTime.value = time

      // Scroll-enhanced rotation speed
      const rotMult = 1 + sp * 0.8
      stars.rotation.y = time * 0.02 * rotMult
      stars.rotation.x = Math.sin(time * 0.1) * 0.05
      accretionDisk.rotation.z = time * 0.1 * rotMult
      backAccretionDisk.rotation.z = time * 0.1 * rotMult + Math.PI

      // Nebulas counter-rotate against the stars
      for (let i = 0; i < nebulas.length; i++) {
        const baseOffset = i * (Math.PI * 2) / 3
        nebulas[i].rotation.z = baseOffset - time * 0.08 * (1 + i * 0.3) * rotMult
      }

      // ── Gravitational Particles Update ──
      for (let i = 0; i < GRAV_COUNT; i++) {
        const p = gravParticles[i]
        p.angle += p.speed * 0.016 * rotMult
        p.radius -= 0.0005 * rotMult

        // Respawn when consumed
        if (p.radius < 0.85) {
          p.radius = 2.5 + Math.random() * 3.5
          p.angle = Math.random() * Math.PI * 2
          p.y = (Math.random() - 0.5) * 0.2
        }

        gravPositions[i * 3] = Math.cos(p.angle) * p.radius
        gravPositions[i * 3 + 1] = p.y
        gravPositions[i * 3 + 2] = Math.sin(p.angle) * p.radius

        const fadeFactor = Math.min(1, (p.radius - 0.85) / 1.5)
        gravOpacities[i] = p.baseOpacity * fadeFactor
        gravSizes[i] = p.size * (0.3 + fadeFactor * 0.7)
      }
      gravGeo.attributes.position.needsUpdate = true
      gravGeo.attributes.opacity.needsUpdate = true
      gravGeo.attributes.size.needsUpdate = true

      // Bloom intensity increases slightly as we descend
      bloomPass.strength = 0.7 + sp * 0.5
      composer.render()

      if (firstFrame) {
        firstFrame = false
        onReady?.()
      }

      frameIdRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameIdRef.current)
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("scroll", handleScroll)
      container.removeEventListener("mousemove", handleMouseMove)
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [accretionFragmentShader, accretionVertexShader])

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "auto",
      }}
    />
  )
}
