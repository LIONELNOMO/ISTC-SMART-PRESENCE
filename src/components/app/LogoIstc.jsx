import { cn } from '../../lib/utils.js'

/**
 * Logo officiel de l'ISTC.
 *
 * C'est le fichier fourni par l'établissement, utilisé TEL QUEL : il n'est ni
 * redessiné, ni recoloré, ni recadré. Toute retouche ferait de l'emblème une
 * approximation, ce qui n'est pas acceptable pour un logo institutionnel.
 *
 * À ne pas confondre avec le logo de l'application (`Logo.jsx` : le livre avec
 * les trois personnes et la coche).
 *
 * Pour le filigrane, c'est l'opacité du conteneur qui est réduite — l'image
 * elle-même reste intacte et nette.
 */

const SOURCE = '/marque/logo-istc.jpeg'

export function LogoIstc({ className, taille = 160, ...props }) {
  return (
    <img
      src={SOURCE}
      alt="ISTC"
      width={taille}
      height={taille}
      // L'image garde ses proportions d'origine ; aucun recadrage.
      className={cn('block h-auto select-none', className)}
      style={{ width: taille }}
      draggable={false}
      {...props}
    />
  )
}
