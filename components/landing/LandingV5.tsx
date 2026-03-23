"use client"

import { useRef, useState, useCallback, useEffect } from "react"
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
            className="v5-header-btn v5-header-btn-secondary !rounded-full"
          >
            Sign in
          </Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button size="sm" className="v5-header-btn !rounded-full">
            Early access
          </Button>
        </SignUpButton>
      </div>
    </header>
  )
}

/* ═══════════════════════════════════════════
   HERO
   ═══════════════════════════════════════════ */

function HeroSection({ ready }: { ready: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (!ready) return

      const tl = gsap.timeline({ delay: 0.3 })

      const chars = document.querySelectorAll(".v5-hero-char")
      tl.fromTo(
        chars,
        {
          y: 120,
          opacity: 0,
          rotateX: -90,
          scale: 0.8,
        },
        {
          y: 0,
          opacity: 1,
          rotateX: 0,
          scale: 1,
          duration: 1.4,
          stagger: 0.1,
          ease: "power4.out",
        }
      )
        .fromTo(
          ".v5-hero-byline",
          { opacity: 0, letterSpacing: "0.6em", y: 10 },
          {
            opacity: 1,
            letterSpacing: "0.25em",
            y: 0,
            duration: 1.2,
            ease: "power2.out",
          },
          "-=0.8"
        )
        .fromTo(
          ".v5-hero-sub",
          { y: 25, opacity: 0 },
          { y: 0, opacity: 1, duration: 1, ease: "power3.out" },
          "-=0.6"
        )
        .fromTo(
          ".v5-scroll-hint",
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.8 },
          "-=0.3"
        )
    },
    { scope: ref, dependencies: [ready] }
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
          The operating system for{" "}
          <span className="v5-highlight">creative minds</span>.
          <br />
          Where productivity reaches{" "}
          <span className="v5-highlight">singularity</span>.
        </p>
      </div>
      <div className="v5-scroll-hint">
        <span>Descend into the singularity</span>
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
    </div>
  )
}

/* ═══════════════════════════════════════════
   PROBLEM / METRICS
   ═══════════════════════════════════════════ */

function ProblemSection() {
  const ref = useRef<HTMLDivElement>(null)
  const counterRefs = useRef<(HTMLSpanElement | null)[]>([])

  const stats = [
    { value: 20, unit: "h/week", desc: "Repetitive tasks" },
    { value: 12, unit: "h/week", desc: "Administrative work" },
    { value: 8, unit: "h/week", desc: "Organization" },
  ]

  useGSAP(
    () => {
      // Heading reveal — scrub-linked for smooth entrance
      gsap.fromTo(
        ".v5-problem-word",
        { y: 40, opacity: 0, rotateX: -30 },
        {
          y: 0,
          opacity: 1,
          rotateX: 0,
          duration: 0.8,
          stagger: 0.08,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ref.current,
            start: "top 70%",
            toggleActions: "play none none none",
          },
        }
      )

      // Animated counters
      const counters = counterRefs.current.filter(Boolean)
      counters.forEach((el, i) => {
        const obj = { val: 0 }
        gsap.to(obj, {
          val: stats[i].value,
          duration: 2.2,
          ease: "power2.out",
          scrollTrigger: {
            trigger: el,
            start: "top 85%",
            toggleActions: "play none none none",
          },
          onUpdate: () => {
            if (el) el.textContent = Math.round(obj.val).toString()
          },
        })

        gsap.to(`.v5-stat-glow-${i}`, {
          opacity: 1,
          duration: 0.8,
          delay: 1.8,
          scrollTrigger: {
            trigger: el,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        })
      })

      // Stat cards stagger
      gsap.fromTo(
        ".v5-stat",
        { y: 60, opacity: 0, scale: 0.92 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.9,
          stagger: 0.12,
          ease: "back.out(1.4)",
          scrollTrigger: {
            trigger: ".v5-stats",
            start: "top 85%",
            toggleActions: "play none none none",
          },
        }
      )

      // Closing text
      gsap.fromTo(
        ".v5-problem-closing",
        { y: 25, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          ease: "power2.out",
          scrollTrigger: {
            trigger: ".v5-problem-closing",
            start: "top 88%",
            toggleActions: "play none none none",
          },
        }
      )
    },
    { scope: ref }
  )

  const problemWords =
    "Every week, you lose time on what doesn't matter.".split(" ")

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
          <div key={i} className="v5-stat v5-glass-panel">
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
        40 hours you could spend creating. <strong>TON gives them back.</strong>
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
          stagger: { each: 0.04, from: "center" },
          ease: "back.out(1.5)",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 75%",
            toggleActions: "play none none none",
          },
        }
      )

      thumbs.forEach((thumb, i) => {
        gsap.to(thumb, {
          y: `+=${Math.sin(i) * 6}`,
          duration: 2.5 + Math.random(),
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: i * 0.08,
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
        { width: 0, opacity: 0 },
        {
          width: (i: number) => `${bars[i].width}%`,
          opacity: 1,
          duration: 1.8,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 75%",
            toggleActions: "play none none none",
          },
        }
      )

      const maxBar = barEls[4]
      if (maxBar) {
        gsap.to(maxBar, {
          boxShadow: "0 0 20px rgba(255, 107, 53, 0.4)",
          duration: 1.2,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: 2,
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
                  background: `linear-gradient(90deg, ${bar.color}30, ${bar.color})`,
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
   MARQUEE TICKER
   ═══════════════════════════════════════════ */

const marqueeItems = [
  "AI Agents",
  "Batch Editing",
  "Finance Automation",
  "Photo Curation",
  "Growth Engine",
  "Vectorization",
  "Smart Workflows",
  "Invoice Tracking",
  "Brand Analytics",
  "Creative Tools",
]

function MarqueeTicker() {
  const items = [...marqueeItems, ...marqueeItems]

  return (
    <div className="v5-marquee v5-glass-panel">
      <div className="v5-marquee-track">
        {items.map((item, i) => (
          <span key={i} className="v5-marquee-item">
            {item}
            <span className="v5-marquee-separator" />
          </span>
        ))}
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
            x: isReversed ? 60 : -60,
            opacity: 0,
          },
          {
            x: 0,
            opacity: 1,
            duration: 1.2,
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
      <div className="v5-agent v5-glass-panel">
        <div className="v5-agent-info">
          <div className="v5-agent-index">01 — Production Agent</div>
          <h3 className="v5-agent-title">Precision batch editing.</h3>
          <p className="v5-agent-desc">
            Correct exposure and color on hundreds of photos in seconds with
            exact parameters, directly in your workspace files.
          </p>
        </div>
        <PhotoVisual />
      </div>

      <div className="v5-agent reverse v5-glass-panel">
        <div className="v5-agent-info">
          <div className="v5-agent-index">02 — Finance Agent</div>
          <h3 className="v5-agent-title">Your cash flow, protected.</h3>
          <p className="v5-agent-desc">
            Automate overdue invoice follow-ups, estimate quarterly taxes, and
            keep expenses under control in one place.
          </p>
        </div>
        <FinanceVisual />
      </div>

      <div className="v5-agent v5-glass-panel">
        <div className="v5-agent-info">
          <div className="v5-agent-index">03 — Growth Agent</div>
          <h3 className="v5-agent-title">From portfolio to revenue.</h3>
          <p className="v5-agent-desc">
            Generate case studies automatically, estimate your brand-deal rates,
            and reactivate dormant clients.
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
        { y: 40, opacity: 0, scale: 0.96 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 1,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ref.current,
            start: "top 78%",
            toggleActions: "play none none none",
          },
        }
      )
    },
    { scope: ref }
  )

  return (
    <section className="v5-cta" ref={ref}>
      <h2>Your creativity deserves a system.</h2>
      <p className="v5-cta-sub">
        Join creators who are scaling without sacrificing every weekend.
      </p>
      <div className="v5-cta-actions">
        <SignUpButton mode="modal">
          <Button size="lg" className="v5-cta-btn !rounded-full">
            Request access
          </Button>
        </SignUpButton>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   LOADING SCREEN
   ═══════════════════════════════════════════ */

function LoadingScreen({
  ready,
  onComplete,
}: {
  ready: boolean
  onComplete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const hasTriggered = useRef(false)

  useEffect(() => {
    if (!ready || hasTriggered.current) return
    hasTriggered.current = true

    // Small delay to ensure the scene has stabilized
    const timeout = setTimeout(() => {
      const el = ref.current
      if (!el) return

      const tl = gsap.timeline({
        onComplete: () => onComplete(),
      })

      // Collapse the progress bar
      tl.to(".v5-loader-progress-fill", {
        width: "100%",
        duration: 0.4,
        ease: "power2.out",
      })
        // Flash the ring
        .to(
          ".v5-loader-ring",
          {
            scale: 1.3,
            opacity: 0,
            duration: 0.5,
            ease: "power2.in",
          },
          "-=0.1"
        )
        // Fade out text
        .to(
          ".v5-loader-text",
          {
            opacity: 0,
            y: -20,
            duration: 0.3,
            ease: "power2.in",
          },
          "-=0.4"
        )
        // Wipe the whole loader away
        .to(el, {
          opacity: 0,
          duration: 0.6,
          ease: "power2.inOut",
        })
    }, 300)

    return () => clearTimeout(timeout)
  }, [ready, onComplete])

  // Animate progress bar to ~90% while loading
  useEffect(() => {
    if (ready) return
    gsap.to(".v5-loader-progress-fill", {
      width: "90%",
      duration: 4,
      ease: "power1.out",
    })
  }, [ready])

  return (
    <div ref={ref} className="v5-loader">
      <div className="v5-loader-inner">
        {/* Animated ring */}
        <div className="v5-loader-ring">
          <svg viewBox="0 0 100 100" fill="none">
            <circle
              cx="50"
              cy="50"
              r="42"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              stroke="url(#loaderGradient)"
              strokeWidth="1.5"
              strokeDasharray="264"
              strokeDashoffset="200"
              strokeLinecap="round"
              className="v5-loader-arc"
            />
            <defs>
              <linearGradient
                id="loaderGradient"
                x1="0"
                y1="0"
                x2="100"
                y2="100"
              >
                <stop offset="0%" stopColor="#00e5a0" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div className="v5-loader-text">
          <span className="v5-loader-title">TON</span>
          <span className="v5-loader-subtitle">Initializing singularity</span>
        </div>

        {/* Progress bar */}
        <div className="v5-loader-progress">
          <div className="v5-loader-progress-fill" />
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════ */

export default function LandingV5() {
  const [sceneReady, setSceneReady] = useState(false)
  const [loaderDone, setLoaderDone] = useState(false)
  const [fontsReady, setFontsReady] = useState(false)

  // Wait for fonts
  useEffect(() => {
    if (typeof document === "undefined") return
    document.fonts.ready.then(() => setFontsReady(true))
  }, [])

  const handleSceneReady = useCallback(() => {
    setSceneReady(true)
  }, [])

  // Both scene + fonts loaded → start exit animation
  const allReady = sceneReady && fontsReady

  const handleLoaderExit = useCallback(() => {
    setLoaderDone(true)
  }, [])

  return (
    <div className="v5">
      {/* Loading screen */}
      {!loaderDone && (
        <LoadingScreen ready={allReady} onComplete={handleLoaderExit} />
      )}

      <BlackHoleThree onReady={handleSceneReady} />

      {/* Ambient floating orbs */}
      <div className="v5-orb v5-orb-1" />
      <div className="v5-orb v5-orb-2" />
      <div className="v5-orb v5-orb-3" />

      <div className="v5-content">
        <HeaderV5 />
        <HeroSection ready={loaderDone} />

        {/* Empty space to let the black hole zoom effect breathe */}
        <div className="v5-descent-spacer" />

        <ProblemSection />
        <MarqueeTicker />
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
