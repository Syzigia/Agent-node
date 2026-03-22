"use client"

import { useRef } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"
import dynamic from "next/dynamic"
import { SignInButton, SignUpButton } from "@clerk/nextjs"

import { Button } from "@/components/ui/button"
import DomainAgentsSection from "./DomainAgentsSection"

const BlackHoleThree = dynamic(() => import("./BlackHoleThree"), { ssr: false })

gsap.registerPlugin(ScrollTrigger)

/* ═══════════════════════════════════════════
   HEADER
   ═══════════════════════════════════════════ */

function HeaderV5() {
  return (
    <header className="v5-header">
      <div className="v5-header-logo">
        TON <span>by Syzygy</span>
      </div>
      <div className="v5-header-actions">
        <SignInButton mode="modal">
          <Button
            variant="ghost"
            size="sm"
            className="v5-header-btn v5-header-btn-secondary !rounded-md"
          >
            Iniciar sesión
          </Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button size="sm" className="v5-header-btn !rounded-md">
            Acceso Anticipado
          </Button>
        </SignUpButton>
      </div>
    </header>
  )
}

/* ═══════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════ */

function HeroSection() {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const tl = gsap.timeline({ delay: 0.5 })

      // Title animation with character split
      const chars = document.querySelectorAll(".v5-hero-char")
      tl.fromTo(
        chars,
        {
          y: 100,
          opacity: 0,
          rotateX: -90,
        },
        {
          y: 0,
          opacity: 1,
          rotateX: 0,
          duration: 1.2,
          stagger: 0.08,
          ease: "power4.out",
        }
      )
        .fromTo(
          ".v5-hero-byline",
          { opacity: 0, letterSpacing: "0.5em" },
          {
            opacity: 1,
            letterSpacing: "0.2em",
            duration: 1,
            ease: "power2.out",
          },
          "-=0.6"
        )
        .fromTo(
          ".v5-hero-sub",
          { y: 30, opacity: 0 },
          { y: 0, opacity: 1, duration: 1, ease: "power3.out" },
          "-=0.5"
        )
        .fromTo(
          ".v5-scroll-hint",
          { opacity: 0 },
          { opacity: 1, duration: 0.8 },
          "-=0.3"
        )
    },
    { scope: ref }
  )

  const title = "TON"

  return (
    <section className="v5-hero" ref={ref}>
      <div className="v5-hero-inner">
        <h1 className="v5-hero-title">
          {title.split("").map((char, i) => (
            <span
              key={i}
              className="v5-hero-char"
              style={{ display: "inline-block" }}
            >
              {char}
            </span>
          ))}
        </h1>
        <p className="v5-hero-byline">by Syzygy</p>
        <p className="v5-hero-sub">
          El sistema operativo para mentes creativas.
          <br />
          Donde la productividad alcanza su punto de singularidad.
        </p>
      </div>
      <div className="v5-scroll-hint">
        <span>Descender al horizonte de eventos</span>
        <div className="v5-scroll-line" />
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   COSMIC DIVIDER
   ═══════════════════════════════════════════ */

function CosmicDivider() {
  return (
    <div className="v5-divider">
      <div className="v5-divider-dot" />
      <svg
        className="v5-divider-wave"
        viewBox="0 0 100 20"
        preserveAspectRatio="none"
      >
        <path
          d="M0,10 Q25,0 50,10 T100,10"
          fill="none"
          stroke="rgba(0,229,160,0.2)"
          strokeWidth="0.5"
        />
      </svg>
    </div>
  )
}

/* ═══════════════════════════════════════════
   PROBLEM
   ═══════════════════════════════════════════ */

function ProblemSection() {
  const ref = useRef<HTMLDivElement>(null)
  const counterRefs = useRef<(HTMLSpanElement | null)[]>([])

  const stats = [
    { value: 20, unit: "h/semana", desc: "Tareas repetitivas" },
    { value: 12, unit: "h/semana", desc: "Administrativo" },
    { value: 8, unit: "h/semana", desc: "Organización" },
  ]

  useGSAP(
    () => {
      // Heading with word animation
      gsap.fromTo(
        ".v5-problem-word",
        { y: 40, opacity: 0, rotateX: -45 },
        {
          y: 0,
          opacity: 1,
          rotateX: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ref.current,
            start: "top 70%",
            toggleActions: "play none none none",
          },
        }
      )

      // Counters with glow effect
      const counters = counterRefs.current.filter(Boolean)
      counters.forEach((el, i) => {
        const obj = { val: 0 }
        gsap.to(obj, {
          val: stats[i].value,
          duration: 2,
          ease: "power2.out",
          scrollTrigger: {
            trigger: el,
            start: "top 80%",
            toggleActions: "play none none none",
          },
          onUpdate: () => {
            if (el) el.textContent = Math.round(obj.val).toString()
          },
        })

        // Glow animation
        gsap.to(`.v5-stat-glow-${i}`, {
          opacity: 1,
          duration: 0.6,
          delay: 1.5,
          scrollTrigger: {
            trigger: el,
            start: "top 80%",
            toggleActions: "play none none none",
          },
        })
      })

      // Stats cards
      gsap.fromTo(
        ".v5-stat",
        { y: 50, opacity: 0, scale: 0.9 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.8,
          stagger: 0.15,
          ease: "back.out(1.5)",
          scrollTrigger: {
            trigger: ".v5-stats",
            start: "top 80%",
            toggleActions: "play none none none",
          },
        }
      )

      // Closing text
      gsap.fromTo(
        ".v5-problem-closing",
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: "power2.out",
          scrollTrigger: {
            trigger: ".v5-problem-closing",
            start: "top 85%",
            toggleActions: "play none none none",
          },
        }
      )
    },
    { scope: ref }
  )

  const problemWords = "Cada semana pierdes tiempo en lo que no importa.".split(
    " "
  )

  return (
    <section className="v5-problem" ref={ref}>
      <h2>
        {problemWords.map((word, i) => (
          <span
            key={i}
            className="v5-problem-word"
            style={{ display: "inline-block", marginRight: "0.3em" }}
          >
            {word}
          </span>
        ))}
      </h2>

      <div className="v5-stats">
        {stats.map((s, i) => (
          <div key={i} className="v5-stat">
            <div className="v5-stat-number">
              <span
                ref={(el) => {
                  counterRefs.current[i] = el
                }}
              >
                0
              </span>
              <span className="v5-stat-unit">{s.unit}</span>
            </div>
            <div className="v5-stat-desc">{s.desc}</div>
            <span className={`v5-stat-glow v5-stat-glow-${i}`} />
          </div>
        ))}
      </div>

      <p className="v5-problem-closing">
        40 horas que podrías dedicar a crear. <strong>TON las recupera.</strong>
      </p>
    </section>
  )
}

/* ═══════════════════════════════════════════
   AGENT VISUALS
   ═══════════════════════════════════════════ */

function PhotoVisual() {
  const containerRef = useRef<HTMLDivElement>(null)
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([])

  const COLS = 4
  const ROWS = 3
  const SIZE = 48
  const GAP = 6

  const colors = [
    "#0a2a1e",
    "#0f3325",
    "#143d2d",
    "#0d2920",
    "#112e24",
    "#163f2f",
    "#0b2b1f",
    "#103426",
    "#153e2e",
    "#0e2a21",
    "#122f25",
    "#173f30",
  ]

  useGSAP(
    () => {
      const thumbs = thumbRefs.current.filter(Boolean) as HTMLDivElement[]
      if (!thumbs.length) return

      gsap.fromTo(
        thumbs,
        {
          x: () => (Math.random() - 0.5) * 300,
          y: () => (Math.random() - 0.5) * 200,
          rotation: () => (Math.random() - 0.5) * 60,
          opacity: 0,
          scale: 0,
        },
        {
          x: (i: number) =>
            (i % COLS) * (SIZE + GAP) - ((COLS - 1) * (SIZE + GAP)) / 2,
          y: (i: number) =>
            Math.floor(i / COLS) * (SIZE + GAP) -
            ((ROWS - 1) * (SIZE + GAP)) / 2,
          rotation: 0,
          opacity: 1,
          scale: 1,
          duration: 1.5,
          stagger: {
            each: 0.04,
            from: "center",
          },
          ease: "back.out(1.5)",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 75%",
            toggleActions: "play none none none",
          },
        }
      )

      // Continuous floating animation
      thumbs.forEach((thumb, i) => {
        gsap.to(thumb, {
          y: `+=${Math.sin(i) * 8}`,
          duration: 2 + Math.random(),
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: i * 0.1,
        })
      })
    },
    { scope: containerRef }
  )

  return (
    <div className="v5-agent-visual">
      <div ref={containerRef} className="v5-photo-visual">
        {colors.map((c, i) => (
          <div
            key={i}
            ref={(el) => {
              thumbRefs.current[i] = el
            }}
            className="v5-photo-thumb"
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  )
}

function FinanceVisual() {
  const containerRef = useRef<HTMLDivElement>(null)
  const barRefs = useRef<(HTMLDivElement | null)[]>([])

  const bars = [
    { label: "Ene", width: 65, color: "#00e5a0" },
    { label: "Feb", width: 42, color: "#00e5a0" },
    { label: "Mar", width: 80, color: "#00e5a0" },
    { label: "Abr", width: 53, color: "#00e5a0" },
    { label: "May", width: 92, color: "#ff6b35" },
    { label: "Jun", width: 71, color: "#00e5a0" },
  ]

  useGSAP(
    () => {
      const barEls = barRefs.current.filter(Boolean) as HTMLDivElement[]
      if (!barEls.length) return

      gsap.fromTo(
        barEls,
        {
          width: 0,
          opacity: 0,
        },
        {
          width: (i: number) => `${bars[i].width}%`,
          opacity: 1,
          duration: 1.5,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 75%",
            toggleActions: "play none none none",
          },
        }
      )

      // Pulse effect on the highest bar
      const maxBar = barEls[4]
      if (maxBar) {
        gsap.to(maxBar, {
          boxShadow: "0 0 20px rgba(255, 107, 53, 0.5)",
          duration: 1,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: 1.5,
        })
      }
    },
    { scope: containerRef }
  )

  return (
    <div className="v5-agent-visual">
      <div ref={containerRef} className="v5-finance-visual">
        {bars.map((bar, i) => (
          <div key={i} className="v5-finance-row">
            <span className="v5-finance-label">{bar.label}</span>
            <div className="v5-finance-track">
              <div
                ref={(el) => {
                  barRefs.current[i] = el
                }}
                className="v5-finance-bar"
                style={{
                  background: `linear-gradient(90deg, ${bar.color}40, ${bar.color})`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GrowthVisual() {
  const svgRef = useRef<SVGSVGElement>(null)
  const nodeRefs = useRef<(SVGCircleElement | null)[]>([])
  const lineRefs = useRef<(SVGLineElement | null)[]>([])

  const nodes = [
    { x: 50, y: 55 },
    { x: 120, y: 25 },
    { x: 195, y: 65 },
    { x: 265, y: 20 },
    { x: 155, y: 105 },
    { x: 85, y: 95 },
    { x: 235, y: 100 },
  ]

  const connections: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [0, 5],
    [2, 4],
    [5, 4],
    [4, 6],
    [3, 6],
  ]

  useGSAP(
    () => {
      const nodeEls = nodeRefs.current.filter(Boolean)
      const lineEls = lineRefs.current.filter(Boolean)
      if (!nodeEls.length) return

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: svgRef.current,
          start: "top 75%",
          toggleActions: "play none none none",
        },
      })

      tl.to(nodeEls, {
        opacity: 1,
        attr: { r: 5 },
        duration: 0.6,
        stagger: 0.06,
        ease: "back.out(2)",
      }).to(
        lineEls,
        {
          opacity: 1,
          strokeDashoffset: 0,
          duration: 0.8,
          stagger: 0.04,
          ease: "power2.out",
        },
        "-=0.3"
      )

      // Continuous node pulse
      nodeEls.forEach((node, i) => {
        gsap.to(node, {
          attr: { r: 7 },
          duration: 1.5,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: i * 0.2,
        })
      })
    },
    { scope: svgRef }
  )

  return (
    <div className="v5-agent-visual">
      <div className="v5-growth-visual">
        <svg ref={svgRef} viewBox="0 0 320 130" fill="none">
          {connections.map(([from, to], i) => (
            <line
              key={`l-${i}`}
              ref={(el) => {
                lineRefs.current[i] = el
              }}
              x1={nodes[from].x}
              y1={nodes[from].y}
              x2={nodes[to].x}
              y2={nodes[to].y}
              stroke="rgba(0,229,160,0.4)"
              strokeWidth="1.5"
              strokeDasharray="100"
              strokeDashoffset="100"
              style={{ opacity: 0 }}
            />
          ))}
          {nodes.map((n, i) => (
            <circle
              key={`n-${i}`}
              ref={(el) => {
                nodeRefs.current[i] = el
              }}
              cx={n.x}
              cy={n.y}
              r={0}
              fill="#00e5a0"
              style={{ opacity: 0 }}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   AGENTS SECTION
   ═══════════════════════════════════════════ */

function AgentsSection() {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      gsap.utils.toArray<HTMLElement>(".v5-agent").forEach((el) => {
        const isReversed = el.classList.contains("reverse")
        gsap.fromTo(
          el,
          {
            x: isReversed ? 80 : -80,
            opacity: 0,
          },
          {
            x: 0,
            opacity: 1,
            duration: 1,
            ease: "power3.out",
            scrollTrigger: {
              trigger: el,
              start: "top 80%",
              toggleActions: "play none none none",
            },
          }
        )
      })
    },
    { scope: ref }
  )

  return (
    <section className="v5-agents" ref={ref}>
      {/* Agent 1 — Production */}
      <div className="v5-agent">
        <div className="v5-agent-info">
          <div className="v5-agent-index">01 — Agente de Producción</div>
          <h3 className="v5-agent-title">Edición en lote milimétrica.</h3>
          <p className="v5-agent-desc">
            Corrige la exposición y color de cientos de fotos en segundos con
            parámetros exactos, directo en tus archivos locales.
          </p>
        </div>
        <PhotoVisual />
      </div>

      {/* Agent 2 — Finance */}
      <div className="v5-agent reverse">
        <div className="v5-agent-info">
          <div className="v5-agent-index">02 — Agente Financiero</div>
          <h3 className="v5-agent-title">Tu flujo de caja, blindado.</h3>
          <p className="v5-agent-desc">
            Cobros automáticos de facturas vencidas, cálculo de impuestos
            trimestrales y control de gastos en un solo lugar.
          </p>
        </div>
        <FinanceVisual />
      </div>

      {/* Agent 3 — Growth */}
      <div className="v5-agent">
        <div className="v5-agent-info">
          <div className="v5-agent-index">03 — Agente de Crecimiento</div>
          <h3 className="v5-agent-title">De portafolio a ingresos.</h3>
          <p className="v5-agent-desc">
            Genera casos de estudio automáticamente, calcula tus tarifas por
            brand deal y reactiva clientes dormidos.
          </p>
        </div>
        <GrowthVisual />
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   CTA
   ═══════════════════════════════════════════ */

function CtaSection() {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      gsap.fromTo(
        ref.current!.children,
        { y: 40, opacity: 0, scale: 0.95 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.8,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ref.current,
            start: "top 75%",
            toggleActions: "play none none none",
          },
        }
      )
    },
    { scope: ref }
  )

  return (
    <section className="v5-cta" ref={ref}>
      <h2>Tu creatividad merece un sistema.</h2>
      <p className="v5-cta-sub">
        Únete a los creadores que están escalando sin trabajar fines de semana.
      </p>
      <div className="v5-cta-actions">
        <SignUpButton mode="modal">
          <Button size="lg" className="v5-cta-btn !rounded-lg">
            Solicitar acceso
          </Button>
        </SignUpButton>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════ */

export default function LandingV5() {
  return (
    <div className="v5">
      <BlackHoleThree />
      <div className="v5-content">
        <HeaderV5 />
        <HeroSection />
        <CosmicDivider />
        <ProblemSection />
        <CosmicDivider />
        <AgentsSection />
        <CosmicDivider />
        <DomainAgentsSection />
        <CosmicDivider />
        <CtaSection />
        <footer className="v5-footer">TON by Syzygy — 2026</footer>
      </div>
    </div>
  )
}
