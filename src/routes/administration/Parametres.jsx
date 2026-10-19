import { useEffect, useState } from 'react'
import { CalendarRange, MessageSquare, Settings, ShieldAlert, Timer } from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { renderTemplate, TEMPLATE_VARIABLES } from '../../lib/whatsapp.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, Input, Select, Textarea } from '../../components/ui/forms.jsx'
import { useToast } from '../../components/ui/overlays.jsx'

/**
 * Paramètres (§10) : semestres, seuil d'alerte, délais, modèle de message.
 *
 * §14 : le seuil d'alerte et les dates de semestre n'ont AUCUNE valeur par
 * défaut. Tant qu'ils sont vides, l'application le dit au lieu d'inventer.
 * §13.9 « Message d'alerte piégé » : le modèle est modifiable par
 * l'administration seulement, et chaque changement est historisé.
 */
export function AdminParametres() {
  const administration = useProjection('administration')
  const toast = useToast()

  const [form, setForm] = useState(null)
  const [semestres, setSemestres] = useState(null)
  const [envoi, setEnvoi] = useState(null)
  const [erreur, setErreur] = useState(null)

  const parametres = administration?.parametres

  useEffect(() => {
    if (!parametres || form) return
    setForm({
      etablissement: parametres.etablissement ?? '',
      monnaie: parametres.monnaie ?? '',
      seuilAlerteHeures:
        parametres.seuilAlerteHeures === null || parametres.seuilAlerteHeures === undefined
          ? ''
          : String(parametres.seuilAlerteHeures),
      seuilAlertePeriode: parametres.seuilAlertePeriode ?? 'semestre',
      delaiReleveJours: String(parametres.delaiReleveJours ?? 7),
      delaiCorrectionHeures: String(parametres.delaiCorrectionHeures ?? 48),
      dureeSessionHorsLigneJours: String(parametres.dureeSessionHorsLigneJours ?? 7),
      modeleMessage: parametres.modeleMessage ?? '',
    })
    setSemestres({
      s1Debut: parametres.semestres?.s1Debut ?? '',
      s1Fin: parametres.semestres?.s1Fin ?? '',
      s2Debut: parametres.semestres?.s2Debut ?? '',
      s2Fin: parametres.semestres?.s2Fin ?? '',
    })
  }, [parametres, form])

  if (!administration || !form) {
    return (
      <EmptyState icon={<Settings className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les paramètres.
      </EmptyState>
    )
  }

  const maj = (champ) => (event) =>
    setForm((f) => ({ ...f, [champ]: event?.target ? event.target.value : event }))

  const enregistrer = async (bloc) => {
    setErreur(null)
    setEnvoi(bloc)

    const charges =
      bloc === 'general'
        ? {
            etablissement: form.etablissement,
            monnaie: form.monnaie,
          }
        : bloc === 'alerte'
          ? {
              seuilAlerteHeures: form.seuilAlerteHeures === '' ? null : Number(form.seuilAlerteHeures),
              seuilAlertePeriode: form.seuilAlertePeriode,
            }
          : bloc === 'delais'
            ? {
                delaiReleveJours: Number(form.delaiReleveJours),
                delaiCorrectionHeures: Number(form.delaiCorrectionHeures),
                dureeSessionHorsLigneJours: Number(form.dureeSessionHorsLigneJours),
              }
            : { modeleMessage: form.modeleMessage }

    const reponse = await enqueue('admin.parametres', charges, {
      labelPourUtilisateur: 'Modification des paramètres',
    })
    setEnvoi(null)

    if (!reponse.ok) {
      setErreur(reponse.error?.message ?? 'Enregistrement impossible.')
      return
    }
    await synchroniser({ silencieux: true })
    toast.succes('Paramètres enregistrés', 'Le changement est inscrit dans l’historique.')
  }

  const enregistrerSemestres = async () => {
    setErreur(null)
    setEnvoi('semestres')
    const reponse = await enqueue(
      'admin.semestres',
      { semestres },
      { labelPourUtilisateur: 'Dates des semestres' },
    )
    setEnvoi(null)
    if (!reponse.ok) {
      setErreur(reponse.error?.message ?? 'Enregistrement impossible.')
      return
    }
    await synchroniser({ silencieux: true })
    toast.succes('Semestres enregistrés', 'Le semestre de chaque séance est déduit de sa date.')
  }

  const apercu = renderTemplate(form.modeleMessage, {
    etudiant: 'Awa Abena',
    classe: 'Informatique niveau 1',
    heures: '12,5 h',
    periode: 'Semestre 1',
    etablissement: form.etablissement || 'Établissement',
  })

  return (
    <>
      <PageHeader
        title="Paramètres"
        subtitle="Semestres, seuil d'alerte, délais et modèle de message aux parents."
      />

      {(parametres.manquants ?? []).length > 0 && (
        <Banner tone="warn" className="mb-4" title="Valeurs à fixer">
          {parametres.manquants.join(' · ')}. Le cahier des charges ne fixe aucune valeur par défaut
          pour ces points : c'est à l'établissement de les choisir.
        </Banner>
      )}

      {erreur && <Banner tone="bad" className="mb-4">{erreur}</Banner>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Établissement"
            icon={<Settings className="size-4" aria-hidden />}
          />
          <CardBody className="space-y-4">
            <Field label="Nom de l'établissement" htmlFor="etab">
              <Input id="etab" value={form.etablissement} onChange={maj('etablissement')} maxLength={120} />
            </Field>
            <Field
              label="Monnaie"
              htmlFor="monnaie"
              hint="Affichée avec les montants. Les coûts sont arrondis à l'unité."
            >
              <Input
                id="monnaie"
                value={form.monnaie}
                onChange={maj('monnaie')}
                maxLength={12}
                className="max-w-[160px]"
              />
            </Field>
            <Button onClick={() => enregistrer('general')} loading={envoi === 'general'}>
              Enregistrer
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Seuil d'alerte aux parents"
            subtitle="Aucune valeur par défaut : tant que le seuil est vide, la liste reste vide."
            icon={<ShieldAlert className="size-4" aria-hidden />}
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Heures non justifiées" htmlFor="seuil">
                <Input
                  id="seuil"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  value={form.seuilAlerteHeures}
                  onChange={maj('seuilAlerteHeures')}
                  placeholder="à définir"
                />
              </Field>
              <Field label="Période" htmlFor="periode">
                <Select
                  id="periode"
                  value={form.seuilAlertePeriode}
                  onChange={maj('seuilAlertePeriode')}
                >
                  <option value="semestre">Par semestre</option>
                  <option value="mois">Par mois</option>
                </Select>
              </Field>
            </div>
            <p className="text-[12px] leading-relaxed text-faint">
              Les absences justifiées acceptées sortent de ce calcul. Les justifications en attente y
              restent.
            </p>
            <Button onClick={() => enregistrer('alerte')} loading={envoi === 'alerte'}>
              Enregistrer
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Dates des semestres"
            subtitle="Le semestre d'une séance est déduit de sa date."
            icon={<CalendarRange className="size-4" aria-hidden />}
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Semestre 1 — début" htmlFor="s1d">
                <Input
                  id="s1d"
                  type="date"
                  value={semestres.s1Debut}
                  onChange={(event) => setSemestres((s) => ({ ...s, s1Debut: event.target.value }))}
                />
              </Field>
              <Field label="Semestre 1 — fin" htmlFor="s1f">
                <Input
                  id="s1f"
                  type="date"
                  value={semestres.s1Fin}
                  onChange={(event) => setSemestres((s) => ({ ...s, s1Fin: event.target.value }))}
                />
              </Field>
              <Field label="Semestre 2 — début" htmlFor="s2d">
                <Input
                  id="s2d"
                  type="date"
                  value={semestres.s2Debut}
                  onChange={(event) => setSemestres((s) => ({ ...s, s2Debut: event.target.value }))}
                />
              </Field>
              <Field label="Semestre 2 — fin" htmlFor="s2f">
                <Input
                  id="s2f"
                  type="date"
                  value={semestres.s2Fin}
                  onChange={(event) => setSemestres((s) => ({ ...s, s2Fin: event.target.value }))}
                />
              </Field>
            </div>
            <Button
              onClick={enregistrerSemestres}
              loading={envoi === 'semestres'}
              disabled={!semestres.s1Debut || !semestres.s1Fin || !semestres.s2Debut || !semestres.s2Fin}
            >
              Enregistrer les semestres
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Délais"
            subtitle="Vérifiés par le serveur, pas seulement par l'interface."
            icon={<Timer className="size-4" aria-hidden />}
          />
          <CardBody className="space-y-4">
            <Field
              label="Saisie d'un relevé après le cours (jours)"
              htmlFor="d-releve"
              hint="Passé ce délai, l'enseignant s'adresse à l'administration."
            >
              <Input
                id="d-releve"
                type="number"
                min={1}
                max={60}
                value={form.delaiReleveJours}
                onChange={maj('delaiReleveJours')}
                className="max-w-[140px]"
              />
            </Field>
            <Field
              label="Correction d'un relevé par l'enseignant (heures)"
              htmlFor="d-corr"
              hint="Ensuite, seul le chef de département peut modifier."
            >
              <Input
                id="d-corr"
                type="number"
                min={1}
                max={720}
                value={form.delaiCorrectionHeures}
                onChange={maj('delaiCorrectionHeures')}
                className="max-w-[140px]"
              />
            </Field>
            <Field
              label="Durée maximale d'une session hors ligne (jours)"
              htmlFor="d-sess"
              hint="Au-delà, l'appareil doit repasser par une connexion. Protège un téléphone perdu."
            >
              <Input
                id="d-sess"
                type="number"
                min={1}
                max={30}
                value={form.dureeSessionHorsLigneJours}
                onChange={maj('dureeSessionHorsLigneJours')}
                className="max-w-[140px]"
              />
            </Field>
            <Button onClick={() => enregistrer('delais')} loading={envoi === 'delais'}>
              Enregistrer
            </Button>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Modèle de message aux parents"
            subtitle="Simple substitution de texte : aucune variable n'est exécutée."
            icon={<MessageSquare className="size-4" aria-hidden />}
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((variable) => (
                <Badge key={variable.key} tone="brand" className="font-mono">
                  {`{{${variable.key}}}`}
                </Badge>
              ))}
            </div>

            <Field label="Modèle" htmlFor="modele">
              <Textarea
                id="modele"
                value={form.modeleMessage}
                onChange={maj('modeleMessage')}
                rows={4}
                maxLength={1000}
              />
            </Field>

            <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
                Aperçu
              </p>
              {/* Texte brut échappé par React : un modèle contenant du code reste du texte. */}
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{apercu}</p>
            </div>

            <Banner tone="info">
              Toute modification de ce modèle est enregistrée dans l'historique et signalée : un lien
              frauduleux glissé ici serait visible.
            </Banner>

            <Button onClick={() => enregistrer('modele')} loading={envoi === 'modele'}>
              Enregistrer le modèle
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
