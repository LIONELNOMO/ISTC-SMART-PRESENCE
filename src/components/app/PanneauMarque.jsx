import { useEffect, useState } from 'react'
import { CalendarCheck, QrCode, ShieldCheck, WifiOff } from 'lucide-react'

import { vitrine } from '../../lib/serveur.js'
import { LogoMark, LogoNom } from './Logo.jsx'
import { formatCount } from '../../lib/utils.js'

/**
 * Panneau de présentation affiché à gauche de l'écran de connexion, à partir de
 * `lg`. En dessous, il n'est pas rendu du tout : le téléphone garde la mise en
 * page compacte, qui va droit au formulaire.
 *
 * §13.10 : les chiffres viennent de `vitrine()`, qui ne renvoie que des
 * comptages. Aucun nom, aucun identifiant, aucun numéro n'apparaît ici.
 * L'appel passe par `lib/serveur.js` : en production il va à l'API PHP, et
 * cet écran n'entraîne donc pas la couche simulée dans le bundle.
 */

const ARGUMENTS = [
  {
    Icone: QrCode,
    titre: 'Présence par code QR',
    texte: "L'enseignant affiche le code, les étudiants le scannent. La liste à cocher reste disponible.",
  },
  {
    Icone: CalendarCheck,
    titre: 'Heures pointées au secrétariat',
    texte: "Arrivée et départ font foi. L'heure du relevé n'allonge jamais la durée payée.",
  },
  {
    Icone: WifiOff,
    titre: 'Fonctionne sans réseau',
    texte: 'Les actions sont gardées sur l’appareil et repartent à la reconnexion, sans doublon.',
  },
  {
    Icone: ShieldCheck,
    titre: 'Chaque geste laisse une trace',
    texte: "Historique en ajout seul, consultable par l'administration.",
  },
]

export function PanneauMarque() {
  const [chiffres, setChiffres] = useState(null)

  useEffect(() => {
    let annule = false
    vitrine().then((data) => {
      if (!annule) setChiffres(data)
    })
    return () => {
      annule = true
    }
  }, [])

  return (
    <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between">
      {/*
        Photographie de fond : une salle de cours de l'établissement.

        Elle n'est chargée que sur grand écran — ce panneau n'existe pas en
        dessous de `lg` — et en différé, derrière le reste de la page : elle ne
        retarde donc jamais l'affichage du formulaire de connexion, y compris
        sur une connexion lente (§11). `aria-hidden` : c'est un décor, il n'a
        rien à annoncer à un lecteur d'écran.
      */}
      <img
        src="/marque/fond-connexion.jpeg"
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        className="absolute inset-0 size-full object-cover"
        draggable={false}
      />

      {/* Voile de marque : il assombrit et réchauffe la photographie pour que
          le texte blanc reste lisible quelle que soit la zone de l'image. */}
      <div className="panneau-marque-fond absolute inset-0" aria-hidden />

      <div className="relative z-10 flex items-center gap-3 px-10 pt-10 xl:px-14">
        <LogoMark taille={56} arrondi="rounded-2xl" />
        <div className="min-w-0">
          <LogoNom taille="text-lg" className="block leading-tight" />
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Suivi des présences
          </p>
        </div>
      </div>

      <div className="relative z-10 px-10 xl:px-14">
        <h2
          className="max-w-[14ch] text-[clamp(2.25rem,2.4vw+1.4rem,3.25rem)] font-bold leading-[1.05] tracking-tight text-white"
          style={{ fontFamily: 'var(--font-titre)' }}
        >
          Chaque présence
          <br />
          <span className="text-[#7FB8EC]">compte.</span>
        </h2>

        <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-white/70">
          Les présences des enseignants et des étudiants, les heures effectuées et les absences —
          sur téléphone, avec ou sans connexion.
        </p>

        <ul className="mt-8 space-y-4">
          {ARGUMENTS.map(({ Icone, titre, texte }) => (
            <li key={titre} className="flex gap-3.5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#B5D4F4] ring-1 ring-inset ring-white/15">
                <Icone className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-white/90">{titre}</p>
                <p className="mt-0.5 max-w-[44ch] text-[12.5px] leading-relaxed text-white/55">
                  {texte}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative z-10 px-10 pb-10 xl:px-14">
        {chiffres?.etablissement && (
          <p className="mb-4 text-[12px] font-medium text-white/50">{chiffres.etablissement}</p>
        )}
        <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t border-white/10 pt-6">
          <Chiffre valeur={chiffres?.enseignants} libelle="Enseignants" />
          <Chiffre valeur={chiffres?.etudiants} libelle="Étudiants" />
          <Chiffre valeur={chiffres?.seances} libelle="Séances" />
        </dl>
      </div>
    </aside>
  )
}

function Chiffre({ valeur, libelle }) {
  return (
    <div>
      <dd className="text-[26px] font-bold leading-none tabular-nums text-[#7FB8EC]">
        {valeur === undefined || valeur === null ? '—' : formatCount(valeur)}
      </dd>
      <dt className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/45">
        {libelle}
      </dt>
    </div>
  )
}
