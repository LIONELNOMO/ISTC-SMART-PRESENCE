import { cn } from '../../lib/utils.js'

/**
 * Le logo ISTC SmartPresence : l'emblème de l'application — un globe surmonté
 * d'arcs en pointillés, le monogramme « SM » avec sa coche verte, posé sur un
 * livre ouvert.
 *
 * Deux variantes :
 *  - `Marque`  : la marque complète, emblème + nom + slogan (écrans d'accueil)
 *  - `LogoMark`: la seule pastille carrée (en-tête, barre latérale)
 *
 * L'emblème est l'image fournie par l'établissement (`embleme-istc.png`),
 * utilisée telle quelle : un logo institutionnel ne se redessine pas. Elle est
 * cadrée sur fond blanc, donc lisible aussi en mode sombre.
 */

const SOURCE_EMBLEME = '/marque/embleme-istc.png'

/** L'emblème seul (globe + « SM » + coche + livre), sur fond blanc. */
export function EmblemeIstc({ taille, className, ...props }) {
  return (
    <img
      src={SOURCE_EMBLEME}
      alt="ISTC SmartPresence"
      className={cn('object-contain', className)}
      style={taille ? { width: taille, height: taille } : undefined}
      draggable={false}
      {...props}
    />
  )
}

/** Pastille carrée : l'emblème ISTC. */
export function LogoMark({ className, taille = 36, arrondi = 'rounded-xl' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-white shadow-sm ring-1 ring-black/10',
        arrondi,
        className,
      )}
      style={{ width: taille, height: taille }}
    >
      <EmblemeIstc taille={taille} className="rounded-[inherit]" />
    </span>
  )
}

/** Nom de l'application, aux couleurs de la marque. */
/**
 * Nom de l'application.
 *
 * « ISTC » est mis en valeur — italique, gras, et souligné d'un trait cuivré :
 * c'est le nom de l'établissement, il porte le reste. « SmartPresence » suit en
 * gras simple, sans italique, pour que le contraste se voie.
 *
 * Le soulignement est dessiné avec `box-shadow` plutôt qu'avec
 * `text-decoration` : il se place ainsi sous la lettre sans la toucher, et
 * garde la même épaisseur quelle que soit la taille du texte.
 */
export function LogoNom({ className, taille = 'text-xl' }) {
  return (
    <span
      className={cn('font-bold tracking-tight', taille, className)}
      style={{ fontFamily: 'var(--font-titre)' }}
    >
      <span
        className="mr-[0.1em] inline-block italic text-[#0B1F4B] dark:text-[#cfe0ff]"
        style={{ boxShadow: 'inset 0 -0.12em 0 0 var(--c-accent)' }}
      >
        ISTC
      </span>
      <span className="text-[#0A6FE0]">Smart</span>
      <span className="text-[#17A34A]">Presence</span>
    </span>
  )
}

/**
 * Marque complète, pour les écrans sans session : installation, connexion,
 * choix d'espace.
 */
export function Marque({ className, avecSlogan = true }) {
  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div className="w-full max-w-[400px] rounded-2xl bg-white p-4 shadow-card ring-1 ring-black/5">
        <EmblemeIstc className="mx-auto block w-3/4" />
      </div>

      <LogoNom taille="text-[26px]" />

      {avecSlogan && (
        <div className="flex items-center gap-3">
          <span className="h-px w-10 bg-line-strong" aria-hidden />
          <span className="text-[13px] text-faint">Chaque présence compte.</span>
          <span className="h-px w-10 bg-line-strong" aria-hidden />
        </div>
      )}
    </div>
  )
}
