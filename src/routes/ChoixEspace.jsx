import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import { useSession } from '../lib/session.jsx'
import { espacesDisponibles } from '../app/navigation.js'
import { Card, CardBody } from '../components/ui/surfaces.jsx'
import { Ecran } from '../components/app/EcranSansSession.jsx'

/**
 * §2 : « Un même compte peut être enseignant et chef de département. Il choisit
 * alors son espace après la connexion. »
 */
export function ChoixEspace() {
  const { pret, moi, roles, setEspace } = useSession()
  const navigate = useNavigate()

  if (!pret) return null
  if (!moi) return <Navigate to="/connexion" replace />

  const espaces = espacesDisponibles(roles)
  if (espaces.length === 1) return <Navigate to={espaces[0].racine} replace />

  return (
    <Ecran titre={`Bonjour ${moi.prenom || moi.label}`} sousTitre="Choisissez votre espace.">
      <Card>
        <CardBody className="space-y-2.5">
          {espaces.map((espace) => {
            const Icone = espace.icone
            return (
              <button
                key={espace.cle}
                type="button"
                onClick={async () => {
                  await setEspace(espace.cle)
                  navigate(espace.racine)
                }}
                className="group flex w-full items-center gap-4 rounded-xl border border-line bg-surface-2 px-4 py-4 text-left transition-all duration-150 hover:border-brand-ring hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ring"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
                  <Icone className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{espace.titre}</span>
                  <span className="block text-[12px] text-faint">
                    {espace.ecrans.map((e) => e.label).join(' · ')}
                  </span>
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-text"
                  aria-hidden
                />
              </button>
            )
          })}
        </CardBody>
      </Card>

      <p className="mt-4 text-center text-[12px] leading-relaxed text-faint">
        Vous pourrez changer d'espace à tout moment depuis le menu de votre compte.
      </p>
    </Ecran>
  )
}
