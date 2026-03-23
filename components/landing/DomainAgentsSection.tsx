"use client"

import { useRef } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(ScrollTrigger)

// Production Agent Component
function ProductionAgentVisual() {
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      // Assembly animation
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top 70%",
          toggleActions: "play none none none",
        },
      })

      // Parts fly in
      tl.fromTo(
        ".production-part",
        {
          x: () => (Math.random() - 0.5) * 200,
          y: () => (Math.random() - 0.5) * 200,
          rotation: () => (Math.random() - 0.5) * 180,
          opacity: 0,
          scale: 0,
        },
        {
          x: 0,
          y: 0,
          rotation: 0,
          opacity: 1,
          scale: 1,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
        }
      )

      // Assembly glow
      tl.to(
        ".production-assembly",
        {
          boxShadow: "0 0 40px rgba(0, 229, 160, 0.4)",
          duration: 0.5,
        },
        "-=0.3"
      )

      // Gear rotation
      gsap.to(".production-gear", {
        rotation: 360,
        duration: 8,
        repeat: -1,
        ease: "none",
      })

      // Conveyor belt
      gsap.to(".production-conveyor-item", {
        x: 200,
        duration: 2,
        stagger: {
          each: 0.5,
          repeat: -1,
        },
        ease: "none",
      })
    },
    { scope: containerRef }
  )

  return (
    <div ref={containerRef} className="agent-visual production-agent-visual">
      {/* Assembly Grid */}
      <div className="production-assembly-container">
        <div className="production-assembly">
          {/* Central Asset */}
          <div className="production-central-asset">
            <div className="asset-preview">
              <div className="asset-layers">
                <div className="asset-layer layer-1" />
                <div className="asset-layer layer-2" />
                <div className="asset-layer layer-3" />
              </div>
            </div>
          </div>

          {/* Orbital Parts */}
          <div className="production-part part-vector">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#00e5a0"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2v20M2 12h20" />
            </svg>
          </div>
          <div className="production-part part-enhance">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#00e5a0"
              strokeWidth="1.5"
            >
              <path d="M12 3l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
            </svg>
          </div>
          <div className="production-part part-mockup">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#00e5a0"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
            </svg>
          </div>
          <div className="production-part part-convert">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#00e5a0"
              strokeWidth="1.5"
            >
              <path d="M4 4v16M20 4v16M4 12h16" />
            </svg>
          </div>

          {/* Gears */}
          <div className="production-gear gear-1">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
            </svg>
          </div>
          <div className="production-gear gear-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
            </svg>
          </div>
        </div>

        {/* Conveyor Belt */}
        <div className="production-conveyor">
          <div className="conveyor-track">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="production-conveyor-item">
                <div className="conveyor-icon">
                  {i === 0 && "AI"}
                  {i === 1 && "PSD"}
                  {i === 2 && "SVG"}
                  {i === 3 && "PDF"}
                </div>
              </div>
            ))}
          </div>
          <div className="conveyor-arrow">→</div>
        </div>
      </div>
    </div>
  )
}

// Photo Agent Component
function PhotoAgentVisual() {
  const containerRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      // Gallery entrance
      gsap.fromTo(
        ".photo-gallery-item",
        {
          y: 60,
          opacity: 0,
          rotationY: -30,
        },
        {
          y: 0,
          opacity: 1,
          rotationY: 0,
          duration: 0.8,
          stagger: {
            each: 0.1,
            from: "center",
          },
          ease: "power3.out",
          scrollTrigger: {
            trigger: containerRef.current,
            start: "top 70%",
            toggleActions: "play none none none",
          },
        }
      )

      // Bad photos fade out
      gsap.to(".photo-bad", {
        opacity: 0.15,
        filter: "grayscale(100%)",
        duration: 1,
        delay: 1,
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top 60%",
          toggleActions: "play none none none",
        },
      })

      // Good photos glow
      gsap.to(".photo-good", {
        boxShadow: "0 0 30px rgba(0, 229, 160, 0.5)",
        duration: 0.8,
        delay: 1.2,
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top 60%",
          toggleActions: "play none none none",
        },
      })

      // Adjustment wave
      gsap.to(".photo-adjustment-bar", {
        width: "100%",
        duration: 1.5,
        stagger: 0.2,
        ease: "power2.out",
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top 50%",
          toggleActions: "play none none none",
        },
      })

      // Floating animation for gallery
      gsap.to(".photo-gallery-item", {
        y: "+=8",
        duration: 2,
        stagger: {
          each: 0.2,
          from: "random",
          repeat: -1,
          yoyo: true,
        },
        ease: "sine.inOut",
      })
    },
    { scope: containerRef }
  )

  const photos = [
    { id: 1, status: "good", label: "Approved" },
    { id: 2, status: "bad", label: "Discard" },
    { id: 3, status: "good", label: "Approved" },
    { id: 4, status: "good", label: "Approved" },
    { id: 5, status: "bad", label: "Discard" },
    { id: 6, status: "good", label: "Approved" },
  ]

  return (
    <div ref={containerRef} className="agent-visual photo-agent-visual">
      {/* Photo Gallery Grid */}
      <div className="photo-gallery-container">
        <div className="photo-gallery-grid">
          {photos.map((photo, i) => (
            <div
              key={photo.id}
              className={`photo-gallery-item photo-${photo.status}`}
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div className="photo-thumbnail">
                <div className="photo-content">
                  <div className="photo-landscape">
                    <div className="photo-mountain" />
                    <div className="photo-sun" />
                  </div>
                </div>
                <div className="photo-label">{photo.label}</div>
                <div className="photo-badge">
                  {photo.status === "good" ? "✓" : "✕"}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Adjustment Panel */}
        <div className="photo-adjustments">
          <div className="photo-adjustment-item">
            <span className="adjustment-name">Exposure</span>
            <div className="adjustment-bar-container">
              <div className="photo-adjustment-bar" style={{ width: "0%" }} />
            </div>
            <span className="adjustment-value">+0.8</span>
          </div>
          <div className="photo-adjustment-item">
            <span className="adjustment-name">Color</span>
            <div className="adjustment-bar-container">
              <div className="photo-adjustment-bar" style={{ width: "0%" }} />
            </div>
            <span className="adjustment-value">+15</span>
          </div>
          <div className="photo-adjustment-item">
            <span className="adjustment-name">Sharpness</span>
            <div className="adjustment-bar-container">
              <div className="photo-adjustment-bar" style={{ width: "0%" }} />
            </div>
            <span className="adjustment-value">+25</span>
          </div>
        </div>

        {/* Stats */}
        <div className="photo-stats">
          <div className="photo-stat">
            <span className="stat-number">247</span>
            <span className="stat-label">Photos processed</span>
          </div>
          <div className="photo-stat">
            <span className="stat-number">23</span>
            <span className="stat-label">Discarded</span>
          </div>
          <div className="photo-stat">
            <span className="stat-number">4m</span>
            <span className="stat-label">Time saved</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Main Section Component
export default function DomainAgentsSection() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      // Header animation
      gsap.fromTo(
        ".domain-header-title",
        { y: 50, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: headerRef.current,
            start: "top 80%",
            toggleActions: "play none none none",
          },
        }
      )

      gsap.fromTo(
        ".domain-header-subtitle",
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          delay: 0.2,
          ease: "power3.out",
          scrollTrigger: {
            trigger: headerRef.current,
            start: "top 80%",
            toggleActions: "play none none none",
          },
        }
      )

      // Agent cards animation
      gsap.utils
        .toArray<HTMLElement>(".domain-agent-card")
        .forEach((card, i) => {
          gsap.fromTo(
            card,
            {
              x: i % 2 === 0 ? -80 : 80,
              opacity: 0,
            },
            {
              x: 0,
              opacity: 1,
              duration: 1,
              ease: "power3.out",
              scrollTrigger: {
                trigger: card,
                start: "top 75%",
                toggleActions: "play none none none",
              },
            }
          )
        })
    },
    { scope: sectionRef }
  )

  const agents = [
    {
      id: "01",
      title: "Production Agent",
      subtitle: "The Stellar Engineer",
      description:
        "Vectorization, image enhancement, background removal, and mockup generation. Transform creative assets with machine precision.",
      tools: [
        "Vectorization",
        "Image enhancement",
        "Background removal",
        "Automatic mockups",
      ],
      visual: ProductionAgentVisual,
    },
    {
      id: "02",
      title: "Photo Agent",
      subtitle: "The Galaxy Curator",
      description:
        "Smart filtering, batch correction with explicit parameters, and preset extraction. Your photo workflow, fully optimized.",
      tools: [
        "Quality filtering",
        "Batch correction",
        "Preset extraction",
        "Organization",
      ],
      visual: PhotoAgentVisual,
    },
  ]

  return (
    <section ref={sectionRef} className="domain-agents-section">
      {/* Header */}
      <div ref={headerRef} className="domain-header">
        <h2 className="domain-header-title">
          Builders of the Creative Universe
        </h2>
        <p className="domain-header-subtitle">
          Specialized Domain Agents for image-first workflows.
          <br />A complete ecosystem for creative professionals.
        </p>
      </div>

      {/* Agents */}
      <div className="domain-agents-container">
        {agents.map((agent, index) => {
          const VisualComponent = agent.visual
          return (
            <div
              key={agent.id}
              className={`domain-agent-card ${index % 2 === 1 ? "reverse" : ""}`}
            >
              <div className="domain-agent-content">
                <div className="domain-agent-meta">
                  <span className="domain-agent-number">{agent.id}</span>
                  <span className="domain-agent-divider" />
                </div>
                <h3 className="domain-agent-title">{agent.title}</h3>
                <p className="domain-agent-subtitle">{agent.subtitle}</p>
                <p className="domain-agent-description">{agent.description}</p>
                <div className="domain-agent-tools">
                  {agent.tools.map((tool, i) => (
                    <span key={i} className="domain-tool-tag">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
              <div className="domain-agent-visual-wrapper">
                <VisualComponent />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
