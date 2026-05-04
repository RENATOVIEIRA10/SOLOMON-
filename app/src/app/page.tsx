"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const INSURERS = [
  "Prudential",
  "MAG",
  "Icatu",
  "MetLife",
  "Bradesco",
  "Azos",
  "SulAmérica",
  "Porto Seguro",
  "Liberty",
  "AXA",
  "Allianz",
  "HDI",
  "Mapfre",
  "Zurich",
];

const STATS: { target: number; suffix?: string; label: string }[] = [
  { target: 14, suffix: "+", label: "Seguradoras\nindexadas" },
  { target: 16940, label: "Cláusulas\nanalisadas" },
  { target: 3, suffix: "s", label: "Tempo médio\nde resposta" },
  { target: 24, suffix: "/7", label: "Disponibilidade\ncontínua" },
];

const TYPEWRITER_TEXT =
  'solomon ask "Suicídio coberto após 24m Prudential Vida Total?"';

export default function LandingPage() {
  const navRef = useRef<HTMLElement | null>(null);
  const heroCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pillarsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const statsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctaCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const demoSectionRef = useRef<HTMLElement | null>(null);
  const statsSectionRef = useRef<HTMLElement | null>(null);
  const responseRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLSpanElement | null>(null);

  const [typedCmd, setTypedCmd] = useState("");
  const [counts, setCounts] = useState<number[]>(STATS.map(() => 0));

  // NAV scroll
  useEffect(() => {
    const onScroll = () => {
      if (!navRef.current) return;
      navRef.current.classList.toggle("sl-scrolled", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // HERO words animation
  useEffect(() => {
    const words = document.querySelectorAll<HTMLElement>(".sl-hero-title .sl-word");
    words.forEach((w, i) => {
      window.setTimeout(() => {
        w.style.animation = "sl-wordIn 0.7s cubic-bezier(0.16,1,0.3,1) forwards";
      }, 600 + i * 150);
    });
  }, []);

  // HERO canvas — orbital wireframe sphere + grid + particles
  useEffect(() => {
    const canvas = heroCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let t = 0;
    let rafId = 0;

    const particles = Array.from({ length: 120 }, () => {
      const r = 180 + Math.random() * 80;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      return {
        r,
        theta,
        phi,
        speed: 0.003 + Math.random() * 0.004,
        size: 0.5 + Math.random() * 1.5,
        opacity: 0.2 + Math.random() * 0.6,
      };
    });

    const rings = 12;

    const resize = () => {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    };

    const drawGrid = () => {
      const gy = H * 0.75;
      const horizon = H * 0.6;
      ctx.save();
      for (let xi = -20; xi <= 20; xi++) {
        const xp = W / 2 + xi * 60;
        ctx.beginPath();
        ctx.moveTo(xp, gy);
        const vp = W / 2;
        ctx.lineTo(vp + (xp - vp) * 0.02, horizon);
        const a = Math.max(0, 0.07 - Math.abs(xi) * 0.003);
        ctx.strokeStyle = `rgba(200,170,110,${a})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      for (let yi = 0; yi < 8; yi++) {
        const frac = Math.pow(yi / 8, 2);
        const y = horizon + (gy - horizon) * frac;
        const halfW = W * 0.8 * (1 - frac * 0.95);
        ctx.beginPath();
        ctx.moveTo(W / 2 - halfW, y);
        ctx.lineTo(W / 2 + halfW, y);
        ctx.strokeStyle = `rgba(200,170,110,${0.06 * (1 - frac)})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawOrb = (cx: number, cy: number, time: number) => {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 300);
      grad.addColorStop(0, "rgba(200,170,110,0.06)");
      grad.addColorStop(0.5, "rgba(200,170,110,0.02)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 300, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      for (let ri = 1; ri <= rings; ri++) {
        const phi = (ri / (rings + 1)) * Math.PI;
        const y = cy + Math.cos(phi) * 220;
        const rx = Math.sin(phi) * 220;
        const ry = rx * 0.35;
        if (ry < 2) continue;
        const alpha = Math.sin(phi) * 0.18;
        ctx.strokeStyle = `rgba(200,170,110,${alpha})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.ellipse(cx, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (let mi = 0; mi < 8; mi++) {
        const angle = (mi / 8) * Math.PI + time * 0.1;
        const cosA = Math.cos(angle);
        ctx.beginPath();
        ctx.strokeStyle = "rgba(200,170,110,0.08)";
        for (let si = 0; si <= 60; si++) {
          const phi2 = (si / 60) * Math.PI;
          const x2 = cx + Math.sin(phi2) * cosA * 220;
          const y2 = cy - Math.cos(phi2) * 220;
          if (si === 0) ctx.moveTo(x2, y2);
          else ctx.lineTo(x2, y2);
        }
        ctx.stroke();
      }
      ctx.restore();

      particles.forEach((p) => {
        const phi2 = p.phi + Math.sin(time * p.speed * 10) * 0.1;
        const theta2 = p.theta + time * p.speed;
        const px = cx + p.r * Math.sin(phi2) * Math.cos(theta2);
        const py =
          cy + p.r * Math.sin(phi2) * Math.sin(theta2) * 0.35 - p.r * Math.cos(phi2);
        const depth = (Math.sin(phi2) * Math.sin(theta2) + 1) / 2;
        ctx.beginPath();
        ctx.arc(px, py, p.size * depth, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,170,110,${p.opacity * depth})`;
        ctx.fill();
      });

      const grad2 = ctx.createLinearGradient(cx - 220, cy, cx + 220, cy);
      grad2.addColorStop(0, "transparent");
      grad2.addColorStop(0.3, "rgba(200,170,110,0.3)");
      grad2.addColorStop(0.7, "rgba(200,170,110,0.3)");
      grad2.addColorStop(1, "transparent");
      ctx.strokeStyle = grad2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 220, 220 * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    };

    const animate = () => {
      ctx.clearRect(0, 0, W, H);
      drawGrid();
      drawOrb(W / 2, H * 0.45, t);
      t += 0.008;
      rafId = requestAnimationFrame(animate);
    };

    resize();
    animate();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // PILLARS canvas — particle network
  useEffect(() => {
    const canvas = pillarsCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let rafId = 0;

    const pts = Array.from({ length: 80 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0002,
      vy: (Math.random() - 0.5) * 0.0002,
      s: 1 + Math.random() * 2,
    }));

    const resize = () => {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      pts.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.s, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200,170,110,0.15)";
        ctx.fill();
      });
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = (pts[i].x - pts[j].x) * W;
          const dy = (pts[i].y - pts[j].y) * H;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 120) {
            ctx.beginPath();
            ctx.moveTo(pts[i].x * W, pts[i].y * H);
            ctx.lineTo(pts[j].x * W, pts[j].y * H);
            ctx.strokeStyle = `rgba(200,170,110,${0.06 * (1 - d / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      rafId = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // STATS canvas — wave grid
  useEffect(() => {
    const canvas = statsCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let t = 0;
    let rafId = 0;

    const resize = () => {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const spacing = 60;
      for (let x = 0; x < W; x += spacing) {
        for (let y = 0; y < H; y += spacing) {
          const d = Math.sqrt((x - W / 2) ** 2 + (y - H / 2) ** 2);
          const wave = Math.sin(d * 0.02 - t) * 0.5 + 0.5;
          ctx.beginPath();
          ctx.arc(x, y, 1 + wave * 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200,170,110,${0.04 + wave * 0.08})`;
          ctx.fill();
        }
      }
      t += 0.03;
      rafId = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // CTA canvas — rotating rings
  useEffect(() => {
    const canvas = ctaCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let t = 0;
    let rafId = 0;

    const resize = () => {
      W = canvas.width = canvas.offsetWidth;
      H = canvas.height = canvas.offsetHeight;
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      for (let i = 0; i < 5; i++) {
        const r = 100 + i * 80;
        const tilt = 0.3 + i * 0.1;
        const rot = t * (i % 2 === 0 ? 0.2 : -0.15) + i * 0.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * tilt, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(200,170,110,${0.04 + i * 0.015})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        const bx = Math.cos(t * (i + 1) * 0.3) * r;
        const by = Math.sin(t * (i + 1) * 0.3) * r * tilt;
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(200,170,110,0.5)";
        ctx.fill();
        ctx.restore();
      }
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200);
      grad.addColorStop(0, "rgba(200,170,110,0.04)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      t += 0.012;
      rafId = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Typewriter (start when demo section visible)
  useEffect(() => {
    const section = demoSectionRef.current;
    if (!section) return;
    let started = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (started) return;
      started = true;
      let i = 0;
      interval = setInterval(() => {
        setTypedCmd(TYPEWRITER_TEXT.slice(0, i));
        i++;
        if (i > TYPEWRITER_TEXT.length) {
          if (interval) clearInterval(interval);
          if (cursorRef.current) cursorRef.current.style.display = "none";
          window.setTimeout(() => {
            responseRef.current?.classList.add("sl-visible");
          }, 400);
        }
      }, 38);
    };

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          start();
          obs.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    obs.observe(section);

    return () => {
      obs.disconnect();
      if (interval) clearInterval(interval);
    };
  }, []);

  // Scroll reveal
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".sl-reveal-up");
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("sl-visible");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Stats counters
  useEffect(() => {
    const section = statsSectionRef.current;
    if (!section) return;
    let fired = false;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !fired) {
          fired = true;
          STATS.forEach((stat, idx) => {
            const duration = stat.target > 1000 ? 2000 : 1200;
            const start = performance.now();
            const tick = (now: number) => {
              const elapsed = now - start;
              const progress = Math.min(elapsed / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              setCounts((prev) => {
                const next = [...prev];
                next[idx] = Math.round(eased * stat.target);
                return next;
              });
              if (progress < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        }
      },
      { threshold: 0.5 }
    );
    obs.observe(section);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="sl-root">
      {/* NAV */}
      <nav ref={navRef} className="sl-nav">
        <Link href="/" className="sl-nav-logo">
          SOLOMON
        </Link>
        <div className="sl-nav-links">
          <span className="sl-nav-badge">Prévia por convite</span>
          <a href="#demo">Demo</a>
          <a href="#pillars">Recursos</a>
          <Link href="/signup" className="sl-nav-cta">
            Solicitar acesso
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <section id="hero" className="sl-hero">
        <canvas ref={heroCanvasRef} className="sl-hero-canvas" />

        <div className="sl-hero-badge">
          Seu consultor privado de IA · Seguros de vida
        </div>

        <h1 className="sl-hero-title">
          <span className="sl-line">
            <span className="sl-word">Certeza</span>
            &nbsp;
            <span className="sl-word sl-gold-text">absoluta.</span>
          </span>
          <span className="sl-line" style={{ marginTop: 4 }}>
            <span className="sl-word">Em</span>
            &nbsp;
            <span className="sl-word">segundos.</span>
          </span>
        </h1>

        <p className="sl-hero-sub">
          Seu consultor privado de IA para seguros de vida.
          <br />
          Responde com citação exata da cláusula — de qualquer seguradora, em
          tempo real.
        </p>

        <div className="sl-hero-actions">
          <Link href="/signup" className="sl-btn-primary">
            Solicitar acesso
          </Link>
          <a href="#demo" className="sl-btn-ghost">
            Ver demonstração
          </a>
        </div>

        <div className="sl-scroll-hint">
          <span>Scroll</span>
          <div className="sl-scroll-line" />
        </div>
      </section>

      {/* DEMO */}
      <section id="demo" ref={demoSectionRef} className="sl-demo">
        <div className="sl-section-label sl-reveal-up">
          SOLOMON · Resposta ao vivo
        </div>
        <h2 className="sl-section-title sl-reveal-up sl-delay-1">
          Do oráculo ao <em>veredicto.</em>
        </h2>
        <p className="sl-section-sub sl-reveal-up sl-delay-2">
          Não interpreta. Não chuta. Prova — com a cláusula exata, a página e o
          parágrafo.
        </p>

        <div className="sl-demo-terminal sl-reveal-up sl-delay-3">
          <div className="sl-terminal-bar">
            <div className="sl-t-dot" />
            <div className="sl-t-dot" />
            <div className="sl-t-dot" />
            <span className="sl-t-title">solomon · terminal</span>
          </div>
          <div className="sl-terminal-body">
            <div className="sl-t-prompt">
              <span className="sl-t-ps">$</span>
              <span className="sl-t-cmd">{typedCmd}</span>
              <span ref={cursorRef} className="sl-t-cursor" />
            </div>
            <hr className="sl-t-divider" />
            <div ref={responseRef} className="sl-t-response">
              <div className="sl-t-verdict">✓ Coberto após carência</div>
              <p className="sl-t-answer">
                Sim. Após 24 meses de vigência, a cobertura por morte natural ou
                acidental inclui suicídio.
              </p>
              <div className="sl-t-quote">
                &ldquo;A Seguradora garantirá o pagamento do Capital Seguro em
                caso de Morte Natural ou Acidental do Segurado, ocorrida após
                24 meses de vigência da apólice.&rdquo;
              </div>
              <div className="sl-t-source">
                Fonte:{" "}
                <strong>
                  Condicoes_Gerais_Prudential_VidaTotal_2025.pdf
                </strong>
                <span>· p. 12</span>
                <span>· § 4.2</span>
              </div>
            </div>
          </div>
          <div className="sl-t-glow" />
        </div>
      </section>

      {/* TICKER */}
      <div className="sl-ticker">
        <div className="sl-ticker-label">Seguradoras indexadas</div>
        <div className="sl-ticker-track">
          {[...INSURERS, ...INSURERS].map((name, i, arr) => (
            <span key={`${name}-${i}`} style={{ display: "contents" }}>
              <span className="sl-ticker-item">{name}</span>
              {i < arr.length - 1 ? (
                <span className="sl-ticker-sep">·</span>
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {/* PILLARS */}
      <section id="pillars" className="sl-pillars">
        <canvas ref={pillarsCanvasRef} className="sl-pillars-canvas" />
        <div className="sl-pillars-header">
          <div className="sl-section-label sl-reveal-up">
            Três trilhos. Uma só fonte.
          </div>
          <h2 className="sl-section-title sl-reveal-up sl-delay-1">
            A plataforma que
            <br />
            transforma <em>dado em decisão.</em>
          </h2>
        </div>

        <div className="sl-pillars-grid">
          <div className="sl-pillar-card sl-reveal-up">
            <div className="sl-pillar-num">
              01
              <span className="sl-pillar-status sl-live">● ao vivo</span>
            </div>
            <h3 className="sl-pillar-name">
              SOLOMON
              <br />
              ao vivo
            </h3>
            <p className="sl-pillar-desc">
              Pergunta livre sobre qualquer seguradora. Resposta em segundos com
              citação da cláusula exata. Não interpreta — prova.
            </p>
            <div className="sl-pillar-terminal">
              <div className="sl-pt-line">
                <span className="sl-pt-arrow">$</span>
                <span className="sl-pt-text">
                  solomon ask &quot;Cobertura MAG doenças pré?&quot;
                </span>
              </div>
              <div className="sl-pt-line" style={{ marginTop: 8 }}>
                <span className="sl-pt-arrow">→</span>
                <span className="sl-pt-result">
                  COBERTO após 180 dias de vigência
                </span>
              </div>
              <div className="sl-pt-quote-sm">
                &ldquo;As doenças pré-existentes serão cobertas após 180
                dias...&rdquo; — MAG, CGA 2025, p. 8.
              </div>
            </div>
          </div>

          <div className="sl-pillar-card sl-reveal-up sl-delay-1">
            <div className="sl-pillar-num">02</div>
            <h3 className="sl-pillar-name">Pré-Sinistro</h3>
            <p className="sl-pillar-desc">
              Cruza o evento com as condições gerais antes de abrir. Veredicto,
              checklist e risk flags. Evite surpresas no momento mais delicado
              com o cliente.
            </p>
            <div className="sl-pillar-badges">
              <div className="sl-badge-row">
                <div className="sl-badge-dot sl-green" /> Apólice vigente
                confirmada
              </div>
              <div className="sl-badge-row">
                <div className="sl-badge-dot sl-yellow" /> Evento dentro do
                período de carência
              </div>
              <div className="sl-badge-row">
                <div className="sl-badge-dot sl-green" /> Cobertura específica
                ativa
              </div>
              <div className="sl-badge-row">
                <div className="sl-badge-dot sl-green" /> Documentação completa
              </div>
              <div className="sl-badge-row">
                <div className="sl-badge-dot sl-red" /> Risk flag: cláusula de
                exclusão § 7.1
              </div>
            </div>
          </div>

          <div className="sl-pillar-card sl-reveal-up sl-delay-2">
            <div className="sl-pillar-num">03</div>
            <h3 className="sl-pillar-name">Comparador</h3>
            <p className="sl-pillar-desc">
              Lado a lado entre seguradoras. Mostra onde você é superior.
              Converte prospect em cliente com dados, não com opinião.
            </p>
            <div
              className="sl-pillar-terminal"
              style={{ padding: 0, overflow: "hidden" }}
            >
              <table className="sl-pillar-table">
                <thead>
                  <tr>
                    <th>Critério</th>
                    <th>Prudential</th>
                    <th>MAG</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Carência suicídio</td>
                    <td className="sl-better">24 meses</td>
                    <td>36 meses</td>
                  </tr>
                  <tr>
                    <td>Doenças pré</td>
                    <td>180 dias</td>
                    <td className="sl-better">90 dias</td>
                  </tr>
                  <tr>
                    <td>Capital máximo</td>
                    <td className="sl-better">R$ 5M</td>
                    <td>R$ 3M</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section ref={statsSectionRef} className="sl-stats">
        <canvas ref={statsCanvasRef} className="sl-stats-canvas" />
        <div className="sl-stats-grid">
          {STATS.map((stat, i) => (
            <div key={stat.label} className="sl-stat-card">
              <div className="sl-stat-num">
                <span>{counts[i].toLocaleString("pt-BR")}</span>
                {stat.suffix ? (
                  <span className="sl-stat-suffix">{stat.suffix}</span>
                ) : null}
              </div>
              <div className="sl-stat-label">
                {stat.label.split("\n").map((line, idx, arr) => (
                  <span key={idx}>
                    {line}
                    {idx < arr.length - 1 ? <br /> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section id="cta" className="sl-cta">
        <canvas ref={ctaCanvasRef} className="sl-cta-canvas" />
        <div className="sl-cta-inner">
          <div className="sl-cta-eyebrow sl-reveal-up">
            Acesso exclusivo para corretores
          </div>
          <h2 className="sl-cta-title sl-reveal-up sl-delay-1">
            Pronto para
            <br />
            <em>provar?</em>
          </h2>
          <p className="sl-cta-sub sl-reveal-up sl-delay-2">
            Acesso exclusivo para corretores de seguros de vida. Solicite seu
            convite e experimente a diferença entre chutar e saber.
          </p>
          <div className="sl-reveal-up sl-delay-3">
            <Link href="/signup" className="sl-btn-primary">
              Solicitar acesso
            </Link>
          </div>
          <div
            className="sl-cta-disclaimer sl-reveal-up"
            style={{ transitionDelay: "0.5s" }}
          >
            Resposta em até 24h · Sem compromisso · Acesso por convite
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="sl-footer">
        <div className="sl-footer-logo">SOLOMON</div>
        <div className="sl-footer-meta">
          Oráculo de Seguros de Vida · © 2026 AUR.IOs
        </div>
        <div className="sl-footer-right">v1.0 · Acesso restrito</div>
      </footer>
    </div>
  );
}
