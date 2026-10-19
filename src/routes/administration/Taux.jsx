import { useState } from 'react'
import { BarChart3, Check } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatMoney } from '../../lib/utils.js'
import { dayKey } from '../../lib/dates.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Input } from '../../components/ui/forms.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

/**
 * Taux horaires (§7, §10) — système simple.
 *
 * Un taux par niveau, le même pour tous les enseignants. On choisit un niveau,
 * on saisit le montant par heure, et c'est appliqué. Les fiches de paie
 * utilisent le taux courant ; une fiche déjà payée garde son montant figé.
 */
export function AdminTaux() {
  const administration = useProjection('administration')
  const toast = useToast()
  const [valeurs, setValeurs] = useState({}) // niveau -> saisie en cours
  const [envoi, setEnvoi] = useState(null) // niveau en cours d'enregistrement

  if (!administration) {
    return (
      <EmptyState icon={<BarChart3 className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les taux.
      </EmptyState>
    )
  }

  const monnaie = administration.parametres.monnaie
  const taux = administration.taux ?? []

  const enregistrer = async (niveau) => {
    const brut = String(valeurs[niveau] ?? '').trim()
    const montant = Number(brut)
    if (brut === '' || !Number.isInteger(montant) || montant < 0) {
      toast.erreur('Taux invalide', `Saisissez un montant entier en ${monnaie}.`)
      return
    }
    setEnvoi(niveau)
    const reponse = await enqueue(
      'admin.taux',
      { niveau, montant, dateEffet: dayKey() },
      { labelPourUtilisateur: `Taux niveau ${niveau}` },
    )
    setEnvoi(null)
    if (!reponse.ok && !reponse.enAttente) {
      toast.erreur('Enregistrement refusé', reponse.error?.message)
      return
    }
    toast.succes('Taux enregistré', `Niveau ${niveau} → ${formatMoney(montant, monnaie)} / h`)
    setValeurs((v) => ({ ...v, [niveau]: '' }))
    await synchroniser({ silencieux: true })
  }

  return (
    <>
      <PageHeader
        title="Taux horaires"
        subtitle="Un taux par niveau, le même pour tous les enseignants."
      />

      <Card>
        <CardHeader
          title="Taux par niveau"
          subtitle="Le montant payé par heure, pour chaque niveau."
          icon={<BarChart3 className="size-4" aria-hidden />}
        />
        {taux.length === 0 ? (
          <CardBody>
            <EmptyState icon={<BarChart3 className="size-5" />} title="Aucun niveau">
              Créez des classes dans le Référentiel : les niveaux apparaîtront ici.
            </EmptyState>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line">
            {taux.map((t) => (
              <li
                key={t.niveau}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-end sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-strong">Niveau {t.niveau}</p>
                  <p className="mt-0.5 text-[12px] text-faint">
                    Taux actuel :{' '}
                    {t.montant == null ? (
                      <span className="font-semibold text-warn">non défini</span>
                    ) : (
                      <span className="font-semibold text-ink">
                        {formatMoney(t.montant, monnaie)} / h
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-end gap-2">
                  <Field label={`Nouveau taux (${monnaie}/h)`} htmlFor={`t-${t.niveau}`} className="w-40">
                    <Input
                      id={`t-${t.niveau}`}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={valeurs[t.niveau] ?? ''}
                      placeholder={t.montant == null ? '5000' : String(t.montant)}
                      onChange={(e) => setValeurs((v) => ({ ...v, [t.niveau]: e.target.value }))}
                    />
                  </Field>
                  <Button onClick={() => enregistrer(t.niveau)} loading={envoi === t.niveau}>
                    <Check className="size-4" aria-hidden />
                    Enregistrer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Banner tone="info" className="mt-4" title="Ce que voient les autres rôles">
        Rien. Les taux et les montants ne sont pas envoyés aux comptes étudiant, enseignant,
        secrétaire et chef de département : ils sont absents de leurs données, pas seulement masqués
        à l'écran.
      </Banner>
    </>
  )
}
