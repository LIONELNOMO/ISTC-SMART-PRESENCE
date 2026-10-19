import { useProjection } from '../../lib/session.jsx'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { AlertesPanel } from '../../components/app/AlertesPanel.jsx'

/**
 * Etudiants en alerte, vue administration (section 8).
 * Meme composant que pour le chef de departement : seul le perimetre change,
 * et c'est le serveur qui le decide.
 */
export function AdminAlertes() {
  const administration = useProjection('administration')

  return (
    <>
      <PageHeader
        title="Étudiants en alerte"
        subtitle="Au-delà du seuil d'heures d'absence non justifiées, toutes filières."
      />
      <AlertesPanel alertes={administration?.alertes} />
    </>
  )
}
