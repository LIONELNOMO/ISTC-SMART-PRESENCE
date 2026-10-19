import { useEffect, useMemo, useRef, useState } from 'react'
import { Backpack, BookOpen, CalendarDays, Check, Clock, NotebookText, Pencil, Ruler } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { vitrine } from '../../lib/serveur.js'

/**
 * Écran de lancement ISTC SmartPresence.
 *
 * Fond bleu de l'établissement : le globe/logo s'assemble, une ronde
 * d'étudiants et d'enseignants validés tourne autour, puis « ISTC
 * SmartPresence », le slogan, les chiffres et une barre de progression.
 *
 * Contraintes tenues :
 *  - l'animation ne retarde jamais l'application : elle se superpose et
 *    disparaît dès qu'elle est finie ; un appui la passe immédiatement.
 *  - `prefers-reduced-motion` : tout s'affiche d'un coup, sans mouvement.
 *  - une seule fois par ouverture de l'application (géré par le parent).
 *  - elle est VOLONTAIREMENT rapide (~3 s).
 */

const DUREE_ANIMATION = 2900
const DUREE_REDUITE = 800
const DUREE_SORTIE = 400
const DEBUT_COMPTEUR = 2000
const DUREE_COMPTEUR = 900

const AVATARS = [
  { l: 133, t: -2, init: 'AB', fg: '#412402', bg: '#FAC775', badge: 'check' },
  { l: 228, t: 38, init: 'LM', fg: '#042C53', bg: '#B5D4F4', badge: 'check' },
  { l: 268, t: 133, init: 'SE', fg: '#042C53', bg: '#B5D4F4', badge: 'check' },
  { l: 228, t: 228, init: 'MK', fg: '#412402', bg: '#FAC775', badge: 'check' },
  { l: 133, t: 268, init: 'JN', fg: '#042C53', bg: '#B5D4F4', badge: 'clock' },
  { l: 38, t: 228, init: 'FT', fg: '#042C53', bg: '#B5D4F4', badge: 'check' },
  { l: -2, t: 133, init: 'NT', fg: '#412402', bg: '#FAC775', badge: 'check' },
  { l: 38, t: 38, init: 'RO', fg: '#042C53', bg: '#B5D4F4', badge: 'check' },
]

const FLOTTANTS = [
  { Icon: BookOpen, s: 30, st: { left: '6%', top: '9%' }, d: '0s' },
  { Icon: Pencil, s: 26, st: { right: '9%', top: '12%' }, d: '-2s' },
  { Icon: NotebookText, s: 28, st: { left: '11%', bottom: '14%' }, d: '-4s' },
  { Icon: CalendarDays, s: 28, st: { right: '8%', bottom: '18%' }, d: '-1s' },
  { Icon: Backpack, s: 22, st: { left: '18%', top: '40%' }, d: '-3s' },
  { Icon: Ruler, s: 22, st: { right: '18%', top: '44%' }, d: '-5s' },
]

const SLOGAN = 'Chaque présence compte, chaque réussite se construit.'

export function SplashScreen({ onTermine }) {
  const [sort, setSort] = useState(false)
  const [reduit, setReduit] = useState(false)
  const [ens, setEns] = useState(0)
  const [etu, setEtu] = useState(0)
  const termine = useRef(false)
  const cibles = useRef({ ens: 48, etu: 1250 })

  // Formes du globe (arcs et feuilles) calculées une fois.
  const { arcs, leaves } = useMemo(construireFeuilles, [])

  useEffect(() => {
    const mouvementReduit =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    setReduit(mouvementReduit)
    const duree = mouvementReduit ? DUREE_REDUITE : DUREE_ANIMATION

    const fermer = () => {
      if (termine.current) return
      termine.current = true
      setSort(true)
      setTimeout(() => onTermine?.(), DUREE_SORTIE)
    }

    // Chiffres réels de l'établissement, animés jusqu'à leur valeur.
    let rafs = []
    vitrine()
      .then((v) => {
        const data = v?.data ?? v
        // Chiffres réels s'ils existent ; sinon on garde les valeurs d'accueil.
        if (data && data.enseignants > 0) {
          cibles.current = { ens: data.enseignants, etu: data.etudiants ?? 0 }
        }
      })
      .catch(() => {})

    const compter = () => {
      const t0 = performance.now()
      const pas = (now) => {
        const p = Math.min((now - t0) / DUREE_COMPTEUR, 1)
        const e = 1 - Math.pow(1 - p, 3)
        setEns(Math.round(cibles.current.ens * e))
        setEtu(Math.round(cibles.current.etu * e))
        if (p < 1) rafs.push(requestAnimationFrame(pas))
      }
      rafs.push(requestAnimationFrame(pas))
    }
    const tCompteur = setTimeout(compter, mouvementReduit ? 0 : DEBUT_COMPTEUR)
    const minuterie = setTimeout(fermer, duree)

    const passer = () => fermer()
    window.addEventListener('pointerdown', passer)
    window.addEventListener('keydown', passer)

    return () => {
      clearTimeout(minuterie)
      clearTimeout(tCompteur)
      rafs.forEach(cancelAnimationFrame)
      window.removeEventListener('pointerdown', passer)
      window.removeEventListener('keydown', passer)
    }
  }, [onTermine])

  return (
    <div
      className={cn('istc-splash', sort && 'sortie', reduit && 'statique')}
      role="status"
      aria-live="polite"
    >
      <style>{CSS_SPLASH}</style>
      <h1 className="sr-only">
        ISTC SmartPresence — {SLOGAN} Ouverture de l'application…
      </h1>

      {FLOTTANTS.map(({ Icon, s, st, d }, i) => (
        <span key={i} className="fl" style={{ ...st, animationDelay: d }} aria-hidden>
          <Icon size={s} strokeWidth={1.75} />
        </span>
      ))}

      <div className="globe-wrap" aria-hidden>
        <svg className="od" width="300" height="300" viewBox="0 0 300 300">
          <circle cx="150" cy="150" r="135" fill="none" stroke="#185FA5" strokeWidth="1" strokeDasharray="3 6" />
        </svg>

        <svg width="180" height="180" viewBox="0 0 160 160" className="globe-svg">
          <g className="leaves">
            {arcs.map((a) => (
              <path key={a.key} className="pp" style={{ animationDelay: '.3s' }} d={a.d} fill="none" stroke="#F0892E" strokeWidth="1.4" />
            ))}
            {leaves.map((lf) => (
              <g key={lf.key} transform={lf.transform}>
                <ellipse className="lf" style={{ animationDelay: `${lf.delay}s` }} cx={lf.cx} cy="0" rx="6.5" ry="2.8" fill={lf.fill} />
              </g>
            ))}
          </g>

          <g className="gl">
            <circle cx="80" cy="64" r="32" fill="#378ADD" />
            <path d="M80 39 C88 38 93 44 91 50 C97 54 99 62 95 69 C93 78 87 85 83 90 C79 84 77 77 73 72 C67 68 67 61 71 57 C69 51 73 43 80 39Z" fill="#0C447C" />
            <path d="M54 46 C60 44 61 52 57 58 C61 64 59 72 55 78 C51 72 50 58 54 46Z" fill="#0C447C" />
            <ellipse cx="80" cy="64" rx="14" ry="32" fill="none" stroke="#B5D4F4" strokeWidth=".6" />
            <line x1="48" y1="64" x2="112" y2="64" stroke="#B5D4F4" strokeWidth=".6" />
            <circle cx="80" cy="64" r="32" fill="none" stroke="#B5D4F4" strokeWidth="1" />
          </g>

          <path className="pg" style={{ transformOrigin: 'right center' }} d="M80 104 C68 97 52 96 36 100 L36 118 C52 114 68 115 80 122 Z" fill="#185FA5" />
          <path className="pg" style={{ transformOrigin: 'left center' }} d="M80 104 C92 97 108 96 124 100 L124 118 C108 114 92 115 80 122 Z" fill="#185FA5" />
          <path className="pg" style={{ transformOrigin: 'right center' }} d="M76 108 C66 103 54 102 42 104 M76 113 C66 108 54 107 42 109" fill="none" stroke="#B5D4F4" strokeWidth=".8" />
          <path className="pg" style={{ transformOrigin: 'left center' }} d="M84 108 C94 103 106 102 118 104 M84 113 C94 108 106 107 118 109" fill="none" stroke="#B5D4F4" strokeWidth=".8" />
        </svg>

        <div className="orb">
          {AVATARS.map((a, i) => (
            <div key={i} className="av" style={{ left: `${a.l}px`, top: `${a.t}px` }}>
              <div className="in">
                <div className="pp" style={{ animationDelay: `${0.7 + i * 0.04}s` }}>
                  <div className="face" style={{ background: a.bg, color: a.fg }}>{a.init}</div>
                  <div
                    className="bd pp"
                    style={{
                      animationDelay: `${1.0 + i * 0.03}s`,
                      background: a.badge === 'clock' ? '#F0997B' : '#97C459',
                      color: a.badge === 'clock' ? '#4A1B0C' : '#173404',
                    }}
                  >
                    {a.badge === 'clock' ? <Clock size={10} /> : <Check size={10} strokeWidth={3} />}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ISTC — tracé à l'encre cuivrée puis rempli, avec un reflet qui balaie. */}
      <svg width="300" height="78" viewBox="0 0 300 78" className="istc-word" aria-hidden>
        <defs>
          <clipPath id="istc-clip">
            <text x="150" y="64" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="66" letterSpacing="10">ISTC</text>
          </clipPath>
        </defs>
        <text className="ist" x="150" y="64" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight="700" fontSize="66" letterSpacing="10">ISTC</text>
        <polygon className="sh" points="-60,0 -30,0 -50,78 -80,78" fill="#FFE2B8" fillOpacity=".75" clipPath="url(#istc-clip)" />
      </svg>

      <div className="titre-ligne">
        <span className="fd trait" style={{ animationDelay: '1.5s' }} aria-hidden />
        <p className="titre" aria-hidden>
          {[...'SmartPresence'].map((ch, i) => (
            <span
              key={i}
              className="lt"
              style={{ color: i < 5 ? '#E6F1FB' : '#F0892E', animationDelay: `${1.4 + i * 0.03}s` }}
            >
              {ch}
            </span>
          ))}
        </p>
        <span className="fd trait" style={{ animationDelay: '1.5s' }} aria-hidden />
      </div>

      <p className="slogan" aria-hidden>
        {SLOGAN.split(' ').map((w, i) => (
          <span
            key={i}
            className="lt"
            style={{ color: /présence|réussite/.test(w) ? '#F0892E' : undefined, animationDelay: `${1.7 + i * 0.035}s` }}
          >
            {w}{' '}
          </span>
        ))}
      </p>

      <div className="pills fd" style={{ animationDelay: '2s' }} aria-hidden>
        <div className="pill">
          <span className="dot" style={{ background: '#FAC775' }} />
          <b>{ens.toLocaleString('fr-FR')}</b> enseignants
        </div>
        <div className="pill">
          <span className="dot" style={{ background: '#B5D4F4' }} />
          <b>{etu.toLocaleString('fr-FR')}</b> étudiants
        </div>
      </div>

      <div className="piste fd" style={{ animationDelay: '2s' }} aria-hidden>
        <div className="bar" />
      </div>

      <p className="bienvenue fd" style={{ animationDelay: '2.6s' }} aria-hidden>
        Bienvenue
      </p>
    </div>
  )
}

/** Arcs et feuilles de laurier autour du globe (cf. design ISTC). */
function construireFeuilles() {
  const rad = (d) => (d * Math.PI) / 180
  const arcs = [-1, 1].map((s, idx) => {
    const a1 = rad(125)
    const a2 = rad(245)
    const r = 60
    const cx = 80
    const cy = 68
    const x1 = cx + s * (r * Math.cos(a1))
    const y1 = cy + r * Math.sin(a1)
    const x2 = cx + s * (r * Math.cos(a2))
    const y2 = cy + r * Math.sin(a2)
    return { key: `arc${idx}`, d: `M${x1} ${y1} A${r} ${r} 0 0 ${s < 0 ? 1 : 0} ${x2} ${y2}` }
  })
  const leaves = []
  for (let i = 0; i < 9; i++) {
    const phi = rad(125 + i * 14)
    const x = 80 + 60 * Math.cos(phi)
    const y = 68 + 60 * Math.sin(phi)
    const base = 125 + i * 14 + 90
    ;[
      [-1, base - 28],
      [1, base + 28],
    ].forEach(([k, rot], j) => {
      ;[-1, 1].forEach((s) => {
        const X = s < 0 ? x : 160 - x
        const R = s < 0 ? rot : 180 - rot
        leaves.push({
          key: `lf${i}-${j}-${s}`,
          transform: `translate(${X} ${y}) rotate(${R})`,
          cx: k < 0 ? -6 : 6,
          fill: k < 0 ? '#F0892E' : '#EF9F27',
          delay: 0.5 + i * 0.04,
        })
      })
    })
  }
  return { arcs, leaves }
}

const CSS_SPLASH = `
.istc-splash{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:#042C53;overflow:hidden;padding:16px;font-family:var(--font-sans,system-ui,sans-serif);
  transition:opacity ${DUREE_SORTIE}ms ease-out}
.istc-splash.sortie{opacity:0;pointer-events:none}
.istc-splash .fl{position:absolute;color:#0C447C;animation:ispFloat 7s ease-in-out infinite;line-height:0}
.istc-splash .pp,.istc-splash .gl,.istc-splash .lf{opacity:0;transform:scale(.2);transform-box:fill-box;transform-origin:center}
.istc-splash .pp{animation:ispPop .4s cubic-bezier(.34,1.56,.64,1) forwards}
.istc-splash .lf{animation:ispPop .4s cubic-bezier(.34,1.56,.64,1) forwards}
.istc-splash .gl{animation:ispGlob .6s cubic-bezier(.34,1.4,.64,1) .1s forwards}
.istc-splash .pg{transform:scaleX(0);transform-box:fill-box;animation:ispOpen .5s cubic-bezier(.34,1.3,.64,1) .45s forwards}
.istc-splash .globe-wrap{position:relative;width:300px;height:300px}
.istc-splash .od{position:absolute;inset:0;opacity:0;animation:ispFadein .6s ease-out .1s forwards}
.istc-splash .globe-svg{position:absolute;left:60px;top:60px}
.istc-splash .orb{position:absolute;inset:0;animation:ispSpin 32s linear infinite}
.istc-splash .av{position:absolute;width:34px;height:34px}
.istc-splash .av>.in{animation:ispSpin 32s linear infinite reverse;width:100%;height:100%;position:relative}
.istc-splash .face{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500}
.istc-splash .bd{position:absolute;right:-4px;bottom:-4px;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #042C53}
.istc-splash .istc-word{margin-top:14px}
.istc-splash .ist{fill:transparent;stroke:#F0892E;stroke-width:1.2;stroke-dasharray:700;stroke-dashoffset:700;
  animation:ispInk .6s ease-in-out 1.1s forwards,ispFillin .4s ease-out 1.6s forwards}
.istc-splash .sh{transform:translateX(0);animation:ispSweep .7s ease-in-out 1.7s forwards}
.istc-splash .titre-ligne{display:flex;align-items:center;gap:12px;margin:2px 0 8px}
.istc-splash .trait{width:36px;height:1px;background:#F0892E}
.istc-splash .titre{margin:0;font-size:22px;font-weight:500;letter-spacing:1px}
.istc-splash .slogan{margin:0 0 16px;font-family:var(--font-voice,Georgia,serif);font-style:italic;font-size:17px;color:#B5D4F4;text-align:center;max-width:520px}
.istc-splash .lt{display:inline-block;opacity:0;transform:translateY(12px);animation:ispUp .4s cubic-bezier(.34,1.56,.64,1) forwards}
.istc-splash .fd{opacity:0;transform:translateY(10px);animation:ispUp .5s ease-out forwards}
.istc-splash .pills{display:flex;gap:12px;margin-bottom:18px;flex-wrap:wrap;justify-content:center}
.istc-splash .pill{display:flex;align-items:center;gap:8px;background:#0C447C;border-radius:999px;padding:6px 14px;font-size:13px;color:#E6F1FB}
.istc-splash .pill b{font-weight:600}
.istc-splash .dot{width:9px;height:9px;border-radius:50%}
.istc-splash .piste{width:220px;height:4px;border-radius:2px;background:#0C447C;overflow:hidden}
.istc-splash .bar{width:0;height:100%;background:#F0892E;border-radius:2px;animation:ispFill .7s cubic-bezier(.65,0,.35,1) 2s forwards}
.istc-splash .bienvenue{margin:14px 0 0;font-size:13px;color:#E6F1FB}
@keyframes ispPop{to{opacity:1;transform:scale(1)}}
@keyframes ispGlob{from{opacity:0;transform:scale(.2) rotate(-140deg)}to{opacity:1;transform:scale(1) rotate(0)}}
@keyframes ispOpen{to{transform:scaleX(1)}}
@keyframes ispInk{to{stroke-dashoffset:0}}
@keyframes ispFillin{to{fill:#F0892E}}
@keyframes ispSweep{to{transform:translateX(400px)}}
@keyframes ispUp{to{opacity:1;transform:translateY(0)}}
@keyframes ispFill{to{width:100%}}
@keyframes ispFadein{to{opacity:1}}
@keyframes ispSpin{to{transform:rotate(360deg)}}
@keyframes ispFloat{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-14px) rotate(8deg)}}
/* prefers-reduced-motion : tout visible, aucun mouvement. */
.istc-splash.statique .fl,.istc-splash.statique .orb,.istc-splash.statique .av>.in,.istc-splash.statique .sh{animation:none}
.istc-splash.statique .pp,.istc-splash.statique .gl,.istc-splash.statique .lf,.istc-splash.statique .fd,.istc-splash.statique .lt,.istc-splash.statique .od{opacity:1;transform:none;animation:none}
.istc-splash.statique .pg{transform:scaleX(1);animation:none}
.istc-splash.statique .ist{stroke-dashoffset:0;fill:#F0892E;animation:none}
.istc-splash.statique .bar{width:100%;animation:none}
.istc-splash.statique .sh{display:none}
@media (prefers-reduced-motion: reduce){
  .istc-splash .fl,.istc-splash .orb,.istc-splash .av>.in,.istc-splash .sh,
  .istc-splash .pp,.istc-splash .gl,.istc-splash .lf,.istc-splash .fd,.istc-splash .lt,
  .istc-splash .od,.istc-splash .pg,.istc-splash .ist,.istc-splash .bar{animation:none}
  .istc-splash .pp,.istc-splash .gl,.istc-splash .lf,.istc-splash .fd,.istc-splash .lt,.istc-splash .od{opacity:1;transform:none}
  .istc-splash .pg{transform:scaleX(1)}
  .istc-splash .ist{stroke-dashoffset:0;fill:#F0892E}
  .istc-splash .bar{width:100%}
  .istc-splash .sh{display:none}
}
`
