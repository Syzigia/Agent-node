"use client"

import { useRef, useEffect } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { SignOutButton } from "@clerk/nextjs"
import Link from "next/link"

export default function WaitlistPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Particle field background
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animationId: number
    let width = window.innerWidth
    let height = window.innerHeight

    canvas.width = width
    canvas.height = height

    // Orbital particles
    const particles: {
      angle: number
      radius: number
      speed: number
      size: number
      opacity: number
      drift: number
    }[] = []

    const cx = width / 2
    const cy = height / 2

    for (let i = 0; i < 120; i++) {
      const baseRadius = 80 + Math.random() * Math.min(width, height) * 0.45
      particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: baseRadius,
        speed:
          (0.0003 + Math.random() * 0.0008) * (Math.random() > 0.5 ? 1 : -1),
        size: 0.5 + Math.random() * 1.5,
        opacity: 0.1 + Math.random() * 0.4,
        drift: Math.sin(i * 0.7) * 15,
      })
    }

    function animate() {
      ctx!.clearRect(0, 0, width, height)

      for (const p of particles) {
        p.angle += p.speed

        const r = p.radius + Math.sin(p.angle * 3) * p.drift
        const x = cx + Math.cos(p.angle) * r
        const y = cy + Math.sin(p.angle) * r * 0.6 // elliptical orbit

        ctx!.beginPath()
        ctx!.arc(x, y, p.size, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(0, 229, 160, ${p.opacity})`
        ctx!.fill()
      }

      animationId = requestAnimationFrame(animate)
    }

    animate()

    const handleResize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width
      canvas.height = height
    }

    window.addEventListener("resize", handleResize)
    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener("resize", handleResize)
    }
  }, [])

  // Entrance animations
  useGSAP(
    () => {
      const tl = gsap.timeline({ delay: 0.4 })

      // Ring pulse in
      tl.fromTo(
        ".wl-ring",
        { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: 1.2, ease: "elastic.out(1, 0.5)" }
      )
        // Status badge
        .fromTo(
          ".wl-status",
          { scale: 0, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(2)" },
          "-=0.6"
        )
        // Title chars
        .fromTo(
          ".wl-char",
          { y: 80, opacity: 0, rotateX: -60 },
          {
            y: 0,
            opacity: 1,
            rotateX: 0,
            duration: 1,
            stagger: 0.08,
            ease: "power4.out",
          },
          "-=0.4"
        )
        // Subtitle
        .fromTo(
          ".wl-subtitle",
          { y: 20, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" },
          "-=0.5"
        )
        // Divider
        .fromTo(
          ".wl-divider",
          { scaleX: 0 },
          { scaleX: 1, duration: 0.8, ease: "power2.out" },
          "-=0.4"
        )
        // Message
        .fromTo(
          ".wl-message",
          { y: 15, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, ease: "power2.out" },
          "-=0.3"
        )
        // Waitlist progress
        .fromTo(
          ".wl-step",
          { y: 12, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.45,
            stagger: 0.08,
            ease: "power2.out",
          },
          "-=0.2"
        )
        // Features
        .fromTo(
          ".wl-feature",
          { x: -20, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.5,
            stagger: 0.1,
            ease: "power2.out",
          },
          "-=0.3"
        )
        // Footer
        .fromTo(
          ".wl-footer",
          { opacity: 0 },
          { opacity: 1, duration: 0.6 },
          "-=0.2"
        )

      // Continuous ring rotation
      gsap.to(".wl-ring-arc", {
        rotation: 360,
        duration: 6,
        repeat: -1,
        ease: "none",
        transformOrigin: "50% 50%",
      })

      // Status dot pulse
      gsap.to(".wl-status-dot", {
        scale: 1.5,
        opacity: 0.3,
        duration: 1.2,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      })
    },
    { scope: containerRef }
  )

  const title = "MISSION QUEUE"
  const stepBaseClass =
    "wl-step flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-left"
  const stepTitleClass =
    "block text-xs font-semibold uppercase tracking-[0.14em] text-slate-100"
  const stepCopyClass = "mt-1 block text-xs leading-relaxed text-slate-300/70"

  return (
    <div
      ref={containerRef}
      className="wl relative min-h-svh overflow-hidden bg-[#02040a] text-slate-100"
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-80"
        style={{
          background:
            "radial-gradient(1300px 900px at 10% 18%, rgba(12, 78, 130, 0.22), transparent 62%), radial-gradient(900px 620px at 88% 84%, rgba(0, 208, 159, 0.16), transparent 68%), linear-gradient(180deg, #02040a 0%, #050a15 60%, #060b18 100%)",
        }}
      />

      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <canvas
        ref={canvasRef}
        className="wl-canvas fixed inset-0 z-10 h-full w-full"
      />

      <div
        className="wl-vignette pointer-events-none fixed inset-0 z-20"
        style={{
          background:
            "radial-gradient(circle at 50% 44%, rgba(0,0,0,0) 14%, rgba(0,0,0,0.52) 72%, rgba(0,0,0,0.9) 100%), linear-gradient(150deg, rgba(0,208,159,0.06), rgba(0,0,0,0.22))",
        }}
      />

      <div className="wl-content relative z-30 mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 pt-4 pb-6 sm:px-6 sm:pb-8">
        <header className="wl-header mb-5 flex items-center justify-between sm:mb-6">
          <div className="wl-logo font-serif text-[1.32rem] tracking-wide text-white italic">
            TON
            <span className="ml-2 align-middle font-sans text-[0.62rem] font-semibold tracking-[0.16em] text-slate-300/70 uppercase not-italic">
              by Syzygy
            </span>
          </div>
          <SignOutButton>
            <button className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[0.72rem] font-semibold tracking-wide text-slate-100 transition hover:border-sky-300/50 hover:bg-sky-300/15 hover:text-white">
              Sign out
            </button>
          </SignOutButton>
        </header>

        <main
          className="wl-main mx-auto my-auto grid w-full max-w-4xl justify-items-center rounded-[26px] border border-white/15 px-4 py-6 text-center shadow-[0_30px_90px_rgba(0,0,0,0.48),inset_0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur-xl sm:px-8 sm:py-8"
          style={{
            background:
              "linear-gradient(155deg, rgba(7, 12, 24, 0.9) 0%, rgba(7, 12, 24, 0.72) 48%, rgba(6, 15, 28, 0.78) 100%)",
          }}
        >
          <div className="wl-ring mb-4 h-36 w-36 drop-shadow-[0_0_24px_rgba(0,208,159,0.28)] sm:h-44 sm:w-44">
            <svg viewBox="0 0 200 200" fill="none" className="h-full w-full">
              <circle
                cx="100"
                cy="100"
                r="90"
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="1"
              />
              <circle
                cx="100"
                cy="100"
                r="70"
                stroke="rgba(255,255,255,0.02)"
                strokeWidth="1"
              />
              <circle
                cx="100"
                cy="100"
                r="80"
                stroke="url(#wlGrad)"
                strokeWidth="1.5"
                strokeDasharray="502"
                strokeDashoffset="380"
                strokeLinecap="round"
                className="wl-ring-arc"
              />
              <circle
                cx="100"
                cy="20"
                r="3"
                fill="#00d09f"
                className="wl-ring-arc"
              />
              <defs>
                <linearGradient id="wlGrad" x1="0" y1="0" x2="200" y2="200">
                  <stop offset="0%" stopColor="#00d09f" stopOpacity="0.82" />
                  <stop offset="52%" stopColor="#65b6ff" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#00d09f" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <div className="wl-status mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1.5 text-[0.68rem] font-bold tracking-[0.1em] text-emerald-100 uppercase">
            <span className="wl-status-dot h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(0,208,159,0.75)]" />
            <span>Waitlist active</span>
          </div>

          <h1 className="wl-title m-0 font-serif text-[clamp(2.2rem,7vw,4.2rem)] leading-[1.05] tracking-[0.07em] text-slate-100 italic [text-shadow:0_0_44px_rgba(101,182,255,0.24)]">
            {title.split("").map((char, i) => (
              <span
                key={i}
                className="wl-char"
                style={{ display: char === " " ? "inline" : "inline-block" }}
              >
                {char === " " ? "\u00A0" : char}
              </span>
            ))}
          </h1>

          <p className="wl-subtitle mt-4 text-sm tracking-wide text-slate-300/80 sm:text-[0.94rem]">
            You&apos;re in line for private beta access.
          </p>

          <div className="wl-divider my-5 h-px w-[min(320px,80%)] origin-center bg-gradient-to-r from-transparent via-sky-300/40 to-transparent" />

          <p className="wl-message max-w-2xl text-sm leading-relaxed text-slate-300/75 sm:text-[0.92rem]">
            TON is onboarding creators in curated waves. We&apos;ll activate
            your workspace as soon as your cohort opens and notify you by email.
          </p>

          <div
            className="wl-progress mt-6 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2"
            aria-label="Waitlist progress"
          >
            <div
              className={`${stepBaseClass} border-emerald-400/40 bg-emerald-400/10`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(0,208,159,0.55)]" />
              <div>
                <strong className={stepTitleClass}>Account created</strong>
                <span className={stepCopyClass}>Your profile is ready</span>
              </div>
            </div>

            <div
              className={`${stepBaseClass} border-emerald-400/40 bg-emerald-400/10`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(0,208,159,0.55)]" />
              <div>
                <strong className={stepTitleClass}>Waitlist confirmed</strong>
                <span className={stepCopyClass}>
                  You&apos;re in the activation queue
                </span>
              </div>
            </div>

            <div className={`${stepBaseClass} border-sky-300/45 bg-sky-300/10`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-300 shadow-[0_0_12px_rgba(101,182,255,0.55)]" />
              <div>
                <strong className={stepTitleClass}>Access review</strong>
                <span className={stepCopyClass}>
                  New cohorts are enabled weekly
                </span>
              </div>
            </div>

            <div className={stepBaseClass}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/30 ring-1 ring-white/15" />
              <div>
                <strong className={stepTitleClass}>Dashboard unlocked</strong>
                <span className={stepCopyClass}>
                  Full workspace access enabled
                </span>
              </div>
            </div>
          </div>

          <div className="wl-features mt-5 grid w-full max-w-3xl gap-3">
            <div className="wl-feature flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.015] px-3 py-3 text-left">
              <span className="wl-feature-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-4 w-4"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
                </svg>
              </span>
              <div>
                <strong className="block text-xs font-semibold tracking-[0.14em] text-slate-100 uppercase">
                  Production Agent
                </strong>
                <span className="mt-1 block text-xs leading-relaxed text-slate-300/70">
                  Vectorization, enhancement & batch processing
                </span>
              </div>
            </div>

            <div className="wl-feature flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.015] px-3 py-3 text-left">
              <span className="wl-feature-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-4 w-4"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </span>
              <div>
                <strong className="block text-xs font-semibold tracking-[0.14em] text-slate-100 uppercase">
                  Photo Agent
                </strong>
                <span className="mt-1 block text-xs leading-relaxed text-slate-300/70">
                  Smart curation, filtering & corrections
                </span>
              </div>
            </div>

            <div className="wl-feature flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.015] px-3 py-3 text-left">
              <span className="wl-feature-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-4 w-4"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </span>
              <div>
                <strong className="block text-xs font-semibold tracking-[0.14em] text-slate-100 uppercase">
                  Creative Workspace
                </strong>
                <span className="mt-1 block text-xs leading-relaxed text-slate-300/70">
                  AI-powered project management & file handling
                </span>
              </div>
            </div>
          </div>
        </main>

        <footer className="wl-footer mt-4 flex flex-col items-center justify-between gap-2 text-center text-[0.63rem] tracking-[0.14em] text-slate-300/60 uppercase sm:mt-5 sm:flex-row sm:text-left">
          <span>TON by Syzygy — Private Beta 2026</span>
          <Link
            className="wl-link border-b border-sky-300/35 pb-1 text-slate-200/90 transition hover:border-emerald-400/60 hover:text-white"
            href="/"
          >
            View landing
          </Link>
        </footer>
      </div>
    </div>
  )
}
