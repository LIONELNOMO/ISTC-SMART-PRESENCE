import { LogoMark, Marque } from './Logo.jsx'

/**
 * Mise en page des écrans affichés hors session : choix d'espace, et toute
 * page qui s'adresse à quelqu'un qui n'est pas encore dans son espace.
 *
 * `marqueComplete` affiche le logo entier avec le nom et le slogan. Ailleurs,
 * la pastille suffit et laisse la place au contenu.
 */
export function Ecran({ titre, sousTitre, children, large = false, marqueComplete = false }) {
  return (
    <div className="brand-wash min-h-dvh bg-canvas">
      <div
        className={`mx-auto flex min-h-dvh w-full flex-col justify-center gouttiere py-10 ${
          large ? 'max-w-3xl' : 'max-w-xl'
        }`}
      >
        <header className="mb-6 text-center">
          {marqueComplete ? (
            <Marque className="mb-6" />
          ) : (
            <span className="mx-auto mb-4 flex justify-center">
              <LogoMark taille={56} arrondi="rounded-2xl" />
            </span>
          )}
          <h1 className="titre-fluide font-bold tracking-tight text-ink">{titre}</h1>
          {sousTitre && (
            <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-faint">
              {sousTitre}
            </p>
          )}
        </header>
        {children}
      </div>
    </div>
  )
}
