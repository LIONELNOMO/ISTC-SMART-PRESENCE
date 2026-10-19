import { useProjection } from '../../lib/session.jsx'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { AlertesPanel } from '../../components/app/AlertesPanel.jsx'

/**
 * Etudiants en alerte, pour la filiere du chef de departement (section 8).
 * Le serveur filtre la liste par filiere : rien d'autre n'arrive sur l'appareil.
 */
export function DepartementAlertes() {
  const departement = useProjection('departement')

  return (
    <>
      <PageHeader
        title="Étudiants en alerte"
        subtitle="Au-delà du seuil fixé par l'administration, pour votre filière."
      />
      <AlertesPanel alertes={departement?.alertes} />
    </>
  )
}
