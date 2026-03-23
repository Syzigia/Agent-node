"use client"

import { useRef, useEffect, useMemo } from "react"
import * as THREE from "three"

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

// Tool types for creative orbiters
interface CreativeTool {
  mesh: THREE.Object3D
  orbitRadius: number
  orbitSpeed: number
  orbitAngle: number
  orbitAxis: THREE.Vector3
  toolType: string
}

// Brush particle interface
interface BrushParticle {
  position: THREE.Vector3
  velocity: THREE.Vector3
  life: number
  maxLife: number
  size: number
  color: THREE.Color
}

export default function BlackHoleThree() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mouseRef = useRef({
    x: 0.5,
    y: 0.5,
    targetX: 0.5,
    targetY: 0.5,
    worldPos: new THREE.Vector3(),
  })
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const frameIdRef = useRef<number>(0)
  const creativeToolsRef = useRef<CreativeTool[]>([])
  const brushParticlesRef = useRef<BrushParticle[]>([])
  const brushMeshRef = useRef<THREE.Points | null>(null)

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
    
    // Simplex noise functions
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
      
      // Convert to polar coordinates
      float angle = atan(uv.y, uv.x);
      
      // Radial gradient for disk shape
      float innerEdge = smoothstep(uInnerRadius - 0.02, uInnerRadius, dist);
      float outerEdge = 1.0 - smoothstep(uOuterRadius - 0.05, uOuterRadius, dist);
      float diskMask = innerEdge * outerEdge;
      
      if (diskMask < 0.001) {
        discard;
      }
      
      // Animated spiral pattern
      float spiralSpeed = uTime * 0.3;
      float spiralTightness = 3.0;
      float spiral = sin(angle * spiralTightness + dist * 15.0 - spiralSpeed);
      spiral = spiral * 0.5 + 0.5;
      
      // Turbulence
      vec3 noisePos = vec3(uv * 3.0, uTime * 0.1);
      float turbulence = fbm(noisePos) * 0.5 + 0.5;
      
      // Density variations
      float density = spiral * turbulence;
      density = pow(density, 1.5);
      
      // Temperature gradient (hotter inside)
      float tempGradient = 1.0 - smoothstep(uInnerRadius, uOuterRadius, dist);
      
      // Color mixing based on temperature and density
      vec3 hotColor = uDiskColor1; // White/yellow
      vec3 midColor = uDiskColor2; // Orange
      vec3 coolColor = uDiskColor3; // Red/purple
      
      vec3 color = mix(coolColor, midColor, tempGradient * 0.7);
      color = mix(color, hotColor, tempGradient * tempGradient * density);
      
      // Doppler beaming effect (brighter on one side)
      float beaming = sin(angle - 1.0) * 0.5 + 0.5;
      color *= 0.7 + beaming * 0.6;
      
      // Add brightness variations
      color *= (0.8 + density * 0.4);
      
      // Alpha based on density with soft edges
      float alpha = density * diskMask * uIntensity;
      alpha *= smoothstep(uInnerRadius, uInnerRadius + 0.05, dist);
      alpha *= 1.0 - smoothstep(uOuterRadius - 0.08, uOuterRadius, dist);
      
      // Glow near inner edge
      float innerGlow = 1.0 - smoothstep(uInnerRadius, uInnerRadius + 0.08, dist);
      color += hotColor * innerGlow * 0.5;
      alpha += innerGlow * 0.3;
      
      gl_FragColor = vec4(color, alpha);
    }
  `,
    []
  )

  // Function to create creative tool geometries
  const createCreativeTools = (scene: THREE.Scene): CreativeTool[] => {
    const tools: CreativeTool[] = []
    const toolConfigs = [
      {
        type: "brush",
        color: 0x00e5a0,
        radius: 2.5,
        speed: 0.3,
        geometry: () => {
          const group = new THREE.Group()

          // Mango de madera realista - más delgado y alargado
          const handleGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.5, 12)
          const handleMat = new THREE.MeshStandardMaterial({
            color: 0x8b4513,
            roughness: 0.8,
          })
          const handle = new THREE.Mesh(handleGeo, handleMat)
          handle.position.y = 0.25
          group.add(handle)

          // Ferula metálica (conector)
          const ferruleGeo = new THREE.CylinderGeometry(0.028, 0.025, 0.08, 12)
          const ferruleMat = new THREE.MeshStandardMaterial({
            color: 0xc0c0c0,
            metalness: 0.8,
            roughness: 0.2,
          })
          const ferrule = new THREE.Mesh(ferruleGeo, ferruleMat)
          ferrule.position.y = -0.04
          group.add(ferrule)

          // Cerdas de la brocha - forma más realista
          const bristlesGeo = new THREE.CylinderGeometry(0.035, 0.01, 0.12, 16)
          const bristlesMat = new THREE.MeshStandardMaterial({
            color: 0xd2b48c,
            roughness: 1.0,
          })
          const bristles = new THREE.Mesh(bristlesGeo, bristlesMat)
          bristles.position.y = -0.14
          group.add(bristles)

          // Pintura en la punta
          const paintGeo = new THREE.SphereGeometry(
            0.025,
            16,
            8,
            0,
            Math.PI * 2,
            0,
            Math.PI / 2
          )
          const paintMat = new THREE.MeshBasicMaterial({
            color: 0x00e5a0,
            transparent: true,
            opacity: 0.9,
          })
          const paint = new THREE.Mesh(paintGeo, paintMat)
          paint.position.y = -0.18
          paint.rotation.x = Math.PI
          group.add(paint)

          return group
        },
      },
      {
        type: "camera",
        color: 0xff6b35,
        radius: 3.2,
        speed: 0.22,
        geometry: () => {
          const group = new THREE.Group()

          // Cuerpo de cámara DSLR - más proporcionado
          const bodyGeo = new THREE.BoxGeometry(0.35, 0.25, 0.2)
          const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.3,
            metalness: 0.2,
          })
          const body = new THREE.Mesh(bodyGeo, bodyMat)
          group.add(body)

          // Agarre
          const gripGeo = new THREE.BoxGeometry(0.08, 0.22, 0.1)
          const grip = new THREE.Mesh(gripGeo, bodyMat)
          grip.position.set(0.13, -0.015, 0.12)
          group.add(grip)

          // Montura del lente
          const mountGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 32)
          const mountMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            metalness: 0.6,
            roughness: 0.4,
          })
          const mount = new THREE.Mesh(mountGeo, mountMat)
          mount.rotation.x = Math.PI / 2
          mount.position.z = 0.11
          group.add(mount)

          // Lente exterior
          const lensOuterGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.15, 32)
          const lensOuterMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.2,
            metalness: 0.1,
          })
          const lensOuter = new THREE.Mesh(lensOuterGeo, lensOuterMat)
          lensOuter.rotation.x = Math.PI / 2
          lensOuter.position.z = 0.2
          group.add(lensOuter)

          // Cristal del lente
          const glassGeo = new THREE.CircleGeometry(0.07, 32)
          const glassMat = new THREE.MeshBasicMaterial({
            color: 0x2244aa,
            transparent: true,
            opacity: 0.6,
          })
          const glass = new THREE.Mesh(glassGeo, glassMat)
          glass.position.z = 0.28
          group.add(glass)

          // Flash pop-up
          const flashGeo = new THREE.BoxGeometry(0.1, 0.04, 0.08)
          const flash = new THREE.Mesh(flashGeo, bodyMat)
          flash.position.set(-0.08, 0.14, 0)
          group.add(flash)

          return group
        },
      },
      {
        type: "pencil",
        color: 0xffd93d,
        radius: 2.8,
        speed: 0.35,
        geometry: () => {
          const group = new THREE.Group()

          // Cuerpo del lápiz hexagonal - más delgado
          const bodyGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6)
          const bodyMat = new THREE.MeshStandardMaterial({
            color: 0xffd93d,
            roughness: 0.4,
          })
          const body = new THREE.Mesh(bodyGeo, bodyMat)
          body.position.y = 0.1
          group.add(body)

          // Madera expuesta (cono)
          const woodGeo = new THREE.CylinderGeometry(0.025, 0.008, 0.08, 6)
          const woodMat = new THREE.MeshStandardMaterial({
            color: 0xdeb887,
            roughness: 0.8,
          })
          const wood = new THREE.Mesh(woodGeo, woodMat)
          wood.position.y = -0.205
          group.add(wood)

          // Grafito
          const graphiteGeo = new THREE.ConeGeometry(0.008, 0.03, 6)
          const graphiteMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.2,
            metalness: 0.1,
          })
          const graphite = new THREE.Mesh(graphiteGeo, graphiteMat)
          graphite.position.y = -0.26
          group.add(graphite)

          // Goma de borrar
          const eraserGeo = new THREE.CylinderGeometry(0.028, 0.025, 0.06, 6)
          const eraserMat = new THREE.MeshStandardMaterial({
            color: 0xff69b4,
            roughness: 0.6,
          })
          const eraser = new THREE.Mesh(eraserGeo, eraserMat)
          eraser.position.y = 0.35
          group.add(eraser)

          // Metal de la goma
          const metalGeo = new THREE.CylinderGeometry(0.027, 0.027, 0.04, 6)
          const metalMat = new THREE.MeshStandardMaterial({
            color: 0xc0c0c0,
            metalness: 0.8,
            roughness: 0.2,
          })
          const metal = new THREE.Mesh(metalGeo, metalMat)
          metal.position.y = 0.295
          group.add(metal)

          return group
        },
      },
      {
        type: "mouse",
        color: 0x4ecdc4,
        radius: 3.5,
        speed: 0.18,
        geometry: () => {
          const group = new THREE.Group()

          // Cuerpo del mouse - forma más realista
          const bodyGeo = new THREE.CapsuleGeometry(0.07, 0.18, 4, 16)
          const bodyMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.2,
            metalness: 0.1,
          })
          const body = new THREE.Mesh(bodyGeo, bodyMat)
          body.rotation.z = Math.PI / 2
          group.add(body)

          // Línea divisoria izquierda
          const line1Geo = new THREE.BoxGeometry(0.005, 0.18, 0.01)
          const line1Mat = new THREE.MeshBasicMaterial({ color: 0xcccccc })
          const line1 = new THREE.Mesh(line1Geo, line1Mat)
          line1.position.set(-0.02, 0, 0.07)
          group.add(line1)

          // Línea divisoria derecha
          const line2 = line1.clone()
          line2.position.set(0.02, 0, 0.07)
          group.add(line2)

          // Rueda de scroll
          const wheelGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.04, 16)
          const wheelMat = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.4,
          })
          const wheel = new THREE.Mesh(wheelGeo, wheelMat)
          wheel.rotation.z = Math.PI / 2
          wheel.position.set(0, 0, 0.08)
          group.add(wheel)

          return group
        },
      },
      {
        type: "keyboard",
        color: 0xff6b9d,
        radius: 3.8,
        speed: 0.15,
        geometry: () => {
          const group = new THREE.Group()

          // Base del teclado
          const baseGeo = new THREE.BoxGeometry(0.45, 0.025, 0.18)
          const baseMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.4,
          })
          const base = new THREE.Mesh(baseGeo, baseMat)
          group.add(base)

          // Teclas más detalladas
          const keyMat = new THREE.MeshStandardMaterial({
            color: 0x444444,
            roughness: 0.5,
          })

          // Filas de teclas
          const rows = 4
          const cols = 12
          for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
              const keyGeo = new THREE.BoxGeometry(0.025, 0.015, 0.025)
              const key = new THREE.Mesh(keyGeo, keyMat)
              key.position.set(
                (j - (cols - 1) / 2) * 0.032,
                0.02,
                (i - (rows - 1) / 2) * 0.032
              )
              group.add(key)
            }
          }

          // Spacebar más larga
          const spaceGeo = new THREE.BoxGeometry(0.12, 0.015, 0.025)
          const space = new THREE.Mesh(spaceGeo, keyMat)
          space.position.set(0, 0.02, 0.065)
          group.add(space)

          return group
        },
      },
      {
        type: "playButton",
        color: 0xff0000,
        radius: 4.2,
        speed: 0.25,
        geometry: () => {
          const group = new THREE.Group()

          // Círculo exterior del botón play
          const circleGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.02, 32)
          const circleMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.2,
          })
          const circle = new THREE.Mesh(circleGeo, circleMat)
          circle.rotation.x = Math.PI / 2
          group.add(circle)

          // Triángulo play
          const shape = new THREE.Shape()
          shape.moveTo(-0.04, -0.06)
          shape.lineTo(-0.04, 0.06)
          shape.lineTo(0.08, 0)
          shape.lineTo(-0.04, -0.06)

          const triangleGeo = new THREE.ExtrudeGeometry(shape, {
            depth: 0.015,
            bevelEnabled: false,
          })
          const triangleMat = new THREE.MeshBasicMaterial({ color: 0xff0000 })
          const triangle = new THREE.Mesh(triangleGeo, triangleMat)
          triangle.position.z = 0.015
          group.add(triangle)

          return group
        },
      },
    ]

    toolConfigs.forEach((config, index) => {
      const geometry = config.geometry()

      // Create a container for the tool to handle orbit
      const pivot = new THREE.Group()
      scene.add(pivot)

      // Add glow effect
      const glowGeometry = new THREE.SphereGeometry(0.2, 16, 16)
      const glowMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(config.color) },
          uTime: { value: 0 },
        },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uTime;
          varying vec3 vNormal;
          
          void main() {
            float intensity = pow(0.6 - dot(vNormal, vec3(0, 0, 1.0)), 2.0);
            float pulse = sin(uTime * 2.0 + ${index.toFixed(1)}) * 0.3 + 0.7;
            gl_FragColor = vec4(uColor, intensity * 0.4 * pulse);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      })
      const glow = new THREE.Mesh(glowGeometry, glowMaterial)
      geometry.add(glow)

      // Position the tool at orbit radius
      geometry.position.x = config.radius
      pivot.add(geometry)

      // Random starting angle and axis
      const orbitAngle = (index / toolConfigs.length) * Math.PI * 2
      const orbitAxis = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize()

      tools.push({
        mesh: geometry,
        orbitRadius: config.radius,
        orbitSpeed: config.speed,
        orbitAngle: orbitAngle,
        orbitAxis: orbitAxis,
        toolType: config.type,
      })
    })

    return tools
  }

  // Create brush particle system
  const createBrushParticles = (scene: THREE.Scene): THREE.Points => {
    const particleCount = 500
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(particleCount * 3)
    const sizes = new Float32Array(particleCount)
    const colors = new Float32Array(particleCount * 3)
    const opacities = new Float32Array(particleCount)

    // Initialize all particles as inactive
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = -100 // Hide initially
      sizes[i] = 0
      opacities[i] = 0
      colors[i * 3] = 1
      colors[i * 3 + 1] = 1
      colors[i * 3 + 2] = 1
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute("opacity", new THREE.BufferAttribute(opacities, 1))

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
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
          gl_PointSize = size * uPixelRatio * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vOpacity;
        
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          
          // Soft edge
          float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
          
          // Glow center
          float glow = 1.0 - smoothstep(0.0, 0.3, dist);
          vec3 finalColor = mix(vColor, vec3(1.0), glow * 0.5);
          
          gl_FragColor = vec4(finalColor, alpha * vOpacity);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const points = new THREE.Points(geometry, material)
    scene.add(points)
    return points
  }

  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Scene setup
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.z = 5

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Black hole event horizon
    const blackHoleGeometry = new THREE.SphereGeometry(0.7, 64, 64)
    const blackHoleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
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
      transparent: true,
    })
    const blackHole = new THREE.Mesh(blackHoleGeometry, blackHoleMaterial)
    scene.add(blackHole)

    // Photon ring
    const photonRingGeometry = new THREE.TorusGeometry(0.95, 0.03, 32, 128)
    const photonRingMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
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
        varying vec2 vUv;
        
        void main() {
          float pulse = sin(uTime * 2.0) * 0.3 + 0.7;
          vec3 color = vec3(1.0, 0.65, 0.3) * pulse;
          float alpha = 0.5 * pulse;
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

    // Secondary photon ring
    const photonRing2Geometry = new THREE.TorusGeometry(1.08, 0.015, 32, 128)
    const photonRing2Material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
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
        varying vec2 vUv;
        
        void main() {
          float pulse = sin(uTime * 1.5 + 1.0) * 0.2 + 0.5;
          vec3 color = vec3(0.7, 0.5, 1.0) * pulse;
          float alpha = 0.3 * pulse;
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

    // Accretion disk
    const diskGeometry = new THREE.PlaneGeometry(6, 6, 128, 128)
    const diskUniforms: AccretionDiskUniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
      uBlackHoleRadius: { value: 0.7 },
      uInnerRadius: { value: 0.15 },
      uOuterRadius: { value: 0.45 },
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

    // Back half of accretion disk (dimmer)
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

    // Starfield
    const starsGeometry = new THREE.BufferGeometry()
    const starsCount = 3000
    const starPositions = new Float32Array(starsCount * 3)
    const starSizes = new Float32Array(starsCount)
    const starColors = new Float32Array(starsCount * 3)

    for (let i = 0; i < starsCount; i++) {
      const i3 = i * 3
      const r = 10 + Math.random() * 40
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)

      starPositions[i3] = r * Math.sin(phi) * Math.cos(theta)
      starPositions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      starPositions[i3 + 2] = r * Math.cos(phi)

      starSizes[i] = Math.random() * 0.08 + 0.02

      // Star colors (white, blue-white, yellow)
      const colorType = Math.random()
      if (colorType < 0.7) {
        starColors[i3] = 1.0
        starColors[i3 + 1] = 1.0
        starColors[i3 + 2] = 1.0
      } else if (colorType < 0.85) {
        starColors[i3] = 0.8
        starColors[i3 + 1] = 0.9
        starColors[i3 + 2] = 1.0
      } else {
        starColors[i3] = 1.0
        starColors[i3 + 1] = 0.95
        starColors[i3 + 2] = 0.8
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
      uniforms: {
        uTime: { value: 0 },
      },
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

    // Nebula clouds
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

    // Create multiple nebula layers
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
    }

    // Create creative tools orbiting
    creativeToolsRef.current = createCreativeTools(scene)

    // Create brush particle system
    brushMeshRef.current = createBrushParticles(scene)

    // Resize handler
    const handleResize = () => {
      const newWidth = container.clientWidth
      const newHeight = container.clientHeight
      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
      diskUniforms.uResolution.value.set(newWidth, newHeight)
    }
    window.addEventListener("resize", handleResize)

    // Mouse handlers
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      mouseRef.current.targetX = (e.clientX - rect.left) / rect.width
      mouseRef.current.targetY = 1 - (e.clientY - rect.top) / rect.height

      // Update world position for brush effect
      const vector = new THREE.Vector3(
        mouseRef.current.targetX * 2 - 1,
        mouseRef.current.targetY * 2 - 1,
        0.5
      )
      vector.unproject(camera)
      const dir = vector.sub(camera.position).normalize()
      const distance = -camera.position.z / dir.z
      mouseRef.current.worldPos
        .copy(camera.position)
        .add(dir.multiplyScalar(distance))
    }
    container.addEventListener("mousemove", handleMouseMove)

    // Animation loop
    let time = 0
    const particleSpawnTimer = { value: 0 }

    const animate = () => {
      time += 0.016
      particleSpawnTimer.value += 0.016

      // Smooth mouse interpolation
      mouseRef.current.x +=
        (mouseRef.current.targetX - mouseRef.current.x) * 0.05
      mouseRef.current.y +=
        (mouseRef.current.targetY - mouseRef.current.y) * 0.05

      // Update uniforms
      diskUniforms.uTime.value = time
      diskMaterial.uniforms.uTime.value = time
      backDiskMaterial.uniforms.uTime.value = time
      photonRingMaterial.uniforms.uTime.value = time
      photonRing2Material.uniforms.uTime.value = time
      starsMaterial.uniforms.uTime.value = time

      // Camera subtle movement based on mouse
      camera.position.x = (mouseRef.current.x - 0.5) * 0.5
      camera.position.y = (mouseRef.current.y - 0.5) * 0.5
      camera.lookAt(0, 0, 0)

      // Rotate stars slowly
      stars.rotation.y = time * 0.02
      stars.rotation.x = Math.sin(time * 0.1) * 0.05

      // Rotate accretion disk
      accretionDisk.rotation.z = time * 0.1
      backAccretionDisk.rotation.z = time * 0.1 + Math.PI

      // Animate creative tools orbiting
      creativeToolsRef.current.forEach((tool, index) => {
        // Orbit around black hole
        tool.orbitAngle += tool.orbitSpeed * 0.01

        // Calculate position on orbit
        const axis = tool.orbitAxis
        const angle = tool.orbitAngle

        // Base position (offset by radius)
        const basePos = new THREE.Vector3(tool.orbitRadius, 0, 0)

        // Apply rotation around axis
        basePos.applyAxisAngle(axis, angle)

        // Add subtle bobbing motion
        basePos.y += Math.sin(time * 0.5 + index) * 0.1

        // Update mesh position
        tool.mesh.position.copy(basePos)

        // Make tool face the center (black hole)
        tool.mesh.lookAt(0, 0, 0)

        // Add self-rotation
        tool.mesh.rotateZ(time * 0.2)

        // Update glow
        const glow = tool.mesh.children[
          tool.mesh.children.length - 1
        ] as THREE.Mesh
        if (glow && glow.material instanceof THREE.ShaderMaterial) {
          glow.material.uniforms.uTime.value = time
        }
      })

      // Spawn brush particles
      if (particleSpawnTimer.value > 0.02) {
        particleSpawnTimer.value = 0

        // Find inactive particle
        let particleIndex = -1

        const positions = brushMeshRef.current?.geometry.attributes.position
          .array as Float32Array

        for (let i = 0; i < 500; i++) {
          const idx = i * 3
          if (positions[idx + 2] < -50) {
            particleIndex = i
            break
          }
        }

        // If no inactive particle found, use random one
        if (particleIndex === -1) {
          particleIndex = Math.floor(Math.random() * 500)
        }

        // Spawn new particle at mouse position with offset
        const idx = particleIndex * 3
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * 0.2,
          (Math.random() - 0.5) * 0.2,
          0
        )

        positions[idx] = mouseRef.current.worldPos.x + offset.x
        positions[idx + 1] = mouseRef.current.worldPos.y + offset.y
        positions[idx + 2] = mouseRef.current.worldPos.z

        brushParticlesRef.current[particleIndex] = {
          position: new THREE.Vector3(
            positions[idx],
            positions[idx + 1],
            positions[idx + 2]
          ),
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.01,
            (Math.random() - 0.5) * 0.01,
            0
          ),
          life: 1.0,
          maxLife: 1.0 + Math.random() * 0.5,
          size: 0.05 + Math.random() * 0.1,
          color: new THREE.Color().setHSL(Math.random() * 0.2 + 0.4, 1, 0.6),
        }

        brushMeshRef.current!.geometry.attributes.position.needsUpdate = true
      }

      // Update brush particles
      const positions = brushMeshRef.current?.geometry.attributes.position
        .array as Float32Array
      const sizes = brushMeshRef.current?.geometry.attributes.size
        .array as Float32Array
      const colors = brushMeshRef.current?.geometry.attributes.color
        .array as Float32Array
      const opacities = brushMeshRef.current?.geometry.attributes.opacity
        .array as Float32Array

      for (let i = 0; i < 500; i++) {
        const particle = brushParticlesRef.current[i]
        if (!particle || particle.life <= 0) continue

        // Update life
        particle.life -= 0.016

        if (particle.life <= 0) {
          // Hide particle
          positions[i * 3 + 2] = -100
          sizes[i] = 0
          opacities[i] = 0
        } else {
          // Update position with drift
          particle.position.add(particle.velocity)
          positions[i * 3] = particle.position.x
          positions[i * 3 + 1] = particle.position.y
          positions[i * 3 + 2] = particle.position.z

          // Update size (grow then shrink)
          const lifeRatio = particle.life / particle.maxLife
          sizes[i] = particle.size * Math.sin(lifeRatio * Math.PI)

          // Update opacity
          opacities[i] = lifeRatio * 0.8

          // Update color
          colors[i * 3] = particle.color.r
          colors[i * 3 + 1] = particle.color.g
          colors[i * 3 + 2] = particle.color.b
        }
      }

      // Update brush mesh attributes
      if (brushMeshRef.current) {
        brushMeshRef.current.geometry.attributes.position.needsUpdate = true
        brushMeshRef.current.geometry.attributes.size.needsUpdate = true
        brushMeshRef.current.geometry.attributes.color.needsUpdate = true
        brushMeshRef.current.geometry.attributes.opacity.needsUpdate = true
        if (brushMeshRef.current.material instanceof THREE.ShaderMaterial) {
          brushMeshRef.current.material.uniforms.uTime.value = time
        }
      }

      renderer.render(scene, camera)
      frameIdRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(frameIdRef.current)
      window.removeEventListener("resize", handleResize)
      container.removeEventListener("mousemove", handleMouseMove)
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [
    accretionFragmentShader,
    accretionVertexShader,
    createCreativeTools,
    createBrushParticles,
  ])

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
