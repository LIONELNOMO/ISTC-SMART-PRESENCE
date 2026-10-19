import { useMemo, useState } from 'react'
import { BookUser, Check, GraduationCap, Info, Plus, Search, Share2, UserPlus, X } from 'lucide-react'

import { cn } from '../../lib/utils.js'
import { useProjection, useSession } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState, Stat } from '../../components/ui/surfaces.jsx'
import { Field, Input, Select } from '../../components/ui/forms.jsx'
import { Modal, useToast } from '../../components/ui/overlays.jsx'

/**
 * Affectation matière → enseignant par le chef de département (§6).
 *
 * Le chef choisit, pour chaque matière de SA filière, l'enseignant qui la
 * donne (une matière = un enseignant). C'est cette affectation qui autorise
 * ensuite le pointage et qui relie les heures faites à l'enseignant payé (§7).
 *
 * §3 : seules les matières du semestre courant sont affichées ; celles de
 * l'autre semestre sont masquées par la projection, pas « cachées à l'écran ».
 * §14 : le chef ne voit aucun taux ni montant.
 */
export function DepartementAffectations() {
  const departement = useProjection('departement')
  const { enLigne } = useSession()
  const toast = useToast()

  const filieres = departement?.filieres ?? []
  const enseignants = departement?.enseignants ?? []
  const enseignantsAutres = departement?.enseignantsAutres ?? []
  const demandesRecues = departement?.demandesRecues ?? []
  const pretsAccordes = departement?.pretsAccordes ?? []
  const semestreCourant = departement?.semestreCourant ?? null

  const [filiereId, setFiliereId] = useState(null)
  const [recherche, setRecherche] = useState('')
  const [nouvelle, setNouvelle] = useState(false)
  // Matière en cours d'envoi, pour griser son menu.
  const [envoi, setEnvoi] = useState(null)
  // Autorisation en cours d'action (demande/décision/révocation).
  const [actionAcces, setActionAcces] = useState(null)

  const filiere = filieres.find((f) => f.id === filiereId) ?? filieres[0] ?? null

  const compte = useMemo(() => {
    let total = 0
    let affectees = 0
    for (const classe of filiere?.classes ?? []) {
      for (const matiere of classe.matieres) {
        total += 1
        if (matiere.teacherId) affectees += 1
      }
    }
    return { total, affectees, restantes: total - affectees }
  }, [filiere])

  // Recherche de matière (nom FR ou EN) : on ne garde que les classes qui ont
  // au moins une matière correspondante.
  const classesVisibles = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    const classes = filiere?.classes ?? []
    if (!terme) return classes
    return classes
      .map((classe) => ({
        ...classe,
        matieres: classe.matieres.filter(
          (m) =>
            m.nom.toLowerCase().includes(terme) ||
            (m.nomEn && m.nomEn.toLowerCase().includes(terme)),
        ),
      }))
      .filter((classe) => classe.matieres.length > 0)
  }, [filiere, recherche])

  if (!departement) {
    return (
      <EmptyState icon={<BookUser className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer les matières de votre filière.
      </EmptyState>
    )
  }

  if (!filieres.length) {
    return (
      <>
        <PageHeader title="Affectation des matières" />
        <Banner tone="warn" title="Aucune filière rattachée">
          Votre compte n'est chef de département d'aucune filière. L'administration doit vous
          rattacher à une filière.
        </Banner>
      </>
    )
  }

  const affecter = async (matiere, teacherId) => {
    setEnvoi(matiere.id)
    const reponse = await enqueue(
      'departement.affecter',
      { matiereId: matiere.id, teacherId: teacherId || null },
      { labelPourUtilisateur: `Affectation — ${matiere.nom}` },
    )
    setEnvoi(null)

    if (!reponse.ok) {
      toast.erreur(reponse.error?.message ?? "Affectation impossible.")
      return
    }
    const nom = enseignants.find((e) => e.id === teacherId)?.nom
    toast.succes(teacherId ? `${matiere.nom} → ${nom}` : `${matiere.nom} : enseignant retiré`)
    await synchroniser({ silencieux: true })
  }

  const agir = async (type, charge, cleAction, succes) => {
    setActionAcces(cleAction)
    const reponse = await enqueue(type, charge, { labelPourUtilisateur: succes })
    setActionAcces(null)
    if (!reponse.ok && !reponse.enAttente) {
      toast.erreur('Action refusée', reponse.error?.message)
      return
    }
    toast.succes(succes)
    await synchroniser({ silencieux: true })
  }

  const demanderAcces = (ens) =>
    agir('departement.demander_acces', { teacherId: ens.id }, ens.id, `Accès demandé — ${ens.nom}`)
  const deciderAcces = (dem, decision) =>
    agir(
      'departement.decider_acces',
      { autorisationId: dem.id, decision },
      dem.id,
      decision === 'accordee' ? `Accès accordé — ${dem.enseignant}` : `Demande refusée — ${dem.enseignant}`,
    )
  const revoquerAcces = (pret) =>
    agir('departement.revoquer_acces', { autorisationId: pret.id }, pret.id, `Accès révoqué — ${pret.enseignant}`)

  return (
    <>
      <PageHeader
        title="Affectation des matières"
        subtitle="Choisissez l'enseignant de chaque matière de votre filière."
        actions={
          <Button size="sm" onClick={() => setNouvelle(true)} disabled={!filiere || !enLigne}>
            <Plus className="size-4" aria-hidden />
            Nouvelle matière
          </Button>
        }
      >
        {filieres.length > 1 && (
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: 'thin' }}>
            {filieres.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiliereId(f.id)}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-lg border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  f.id === filiere?.id
                    ? 'border-line bg-surface text-ink shadow-sm'
                    : 'border-transparent text-faint hover:text-soft',
                )}
              >
                {f.nom}
              </button>
            ))}
          </div>
        )}
      </PageHeader>

      <Banner
        tone={semestreCourant ? 'info' : 'warn'}
        icon={<Info className="size-4" />}
        title={
          semestreCourant
            ? `Semestre ${semestreCourant} en cours`
            : 'Dates des semestres non réglées'
        }
      >
        {semestreCourant
          ? "Les matières de l'autre semestre sont masquées : seules celles du semestre en cours sont affectables ici."
          : "Toutes les matières sont affichées. Tant que l'administration n'a pas saisi les dates des semestres, aucun semestre ne peut être masqué."}
      </Banner>

      {!enLigne && (
        <Banner tone="warn" title="Hors ligne" className="mt-3">
          L'affectation d'une matière nécessite une connexion. Reconnectez-vous pour modifier.
        </Banner>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Matières" value={compte.total} hint={filiere?.nom} />
        <Stat label="Affectées" value={compte.affectees} tone="ok" />
        <Stat
          label="Sans enseignant"
          value={compte.restantes}
          tone={compte.restantes > 0 ? 'warn' : 'ok'}
        />
      </div>

      {(filiere?.classes ?? []).length > 0 && (
        <div className="relative mt-6">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une matière…"
            className="pl-10"
            maxLength={60}
          />
        </div>
      )}

      {(filiere?.classes ?? []).length === 0 ? (
        <EmptyState icon={<GraduationCap className="size-5" />} title="Aucune matière" className="mt-6">
          Aucune matière du semestre courant n'est rattachée à cette filière.
        </EmptyState>
      ) : classesVisibles.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="Aucune matière trouvée" className="mt-6">
          Aucune matière ne correspond à « {recherche} ».
        </EmptyState>
      ) : (
        <div className="mt-6 space-y-6">
          {classesVisibles.map((classe) => (
            <Card key={classe.id}>
              <CardHeader
                title={classe.nom || `Niveau ${classe.niveau}`}
                subtitle={`${classe.matieres.length} matière${classe.matieres.length > 1 ? 's' : ''}`}
                icon={<GraduationCap className="size-4" />}
              />
              <ul className="divide-y divide-line">
                {classe.matieres.map((matiere) => (
                  <li
                    key={matiere.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-strong">{matiere.nom}</p>
                      {matiere.nomEn && matiere.nomEn !== matiere.nom && (
                        <p className="truncate text-[12px] italic text-faint">{matiere.nomEn}</p>
                      )}
                      <p className="mt-0.5 text-[12px] text-faint">
                        {matiere.enseignant ? (
                          <>Affectée à {matiere.enseignant}</>
                        ) : (
                          <Badge tone="warn">Non affectée</Badge>
                        )}
                      </p>
                    </div>
                    <Select
                      className="sm:w-64"
                      aria-label={`Enseignant de ${matiere.nom}`}
                      value={matiere.teacherId ?? ''}
                      disabled={!enLigne || envoi === matiere.id}
                      onChange={(event) => affecter(matiere, event.target.value)}
                    >
                      <option value="">— Non affectée —</option>
                      {enseignants.map((enseignant) => (
                        <option key={enseignant.id} value={enseignant.id}>
                          {enseignant.nom}
                          {enseignant.externe ? ` — ${enseignant.departement} (externe)` : ''}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {enseignants.length === 0 && (
        <Banner tone="warn" title="Aucun enseignant dans votre département" className="mt-6">
          L'administration doit d'abord créer des enseignants et les rattacher à votre département
          pour que vous puissiez les affecter.
        </Banner>
      )}

      {/* Demandes d'accès reçues (je suis le chef propriétaire). */}
      {demandesRecues.length > 0 && (
        <Card className="mt-8">
          <CardHeader
            title="Demandes d'accès reçues"
            subtitle="D'autres départements souhaitent utiliser vos enseignants."
            icon={<UserPlus className="size-4" />}
          />
          <ul className="divide-y divide-line">
            {demandesRecues.map((dem) => (
              <li
                key={dem.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-strong">{dem.enseignant}</p>
                  <p className="text-[12px] text-faint">
                    Demandé par le département {dem.departementDemandeur}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => deciderAcces(dem, 'accordee')}
                    loading={actionAcces === dem.id}
                    disabled={!enLigne}
                  >
                    <Check className="size-4" /> Accorder
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deciderAcces(dem, 'refusee')}
                    disabled={!enLigne || actionAcces === dem.id}
                  >
                    <X className="size-4" /> Refuser
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Prêts accordés (mes enseignants utilisés ailleurs). */}
      {pretsAccordes.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Prêts accordés"
            subtitle="Vos enseignants utilisés par d'autres départements."
            icon={<Share2 className="size-4" />}
          />
          <ul className="divide-y divide-line">
            {pretsAccordes.map((pret) => (
              <li
                key={pret.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-strong">{pret.enseignant}</p>
                  <p className="text-[12px] text-faint">
                    Autorisé pour le département {pret.departementDemandeur}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoquerAcces(pret)}
                  loading={actionAcces === pret.id}
                  disabled={!enLigne}
                >
                  Révoquer
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Enseignants d'autres départements : demander l'accès. */}
      {enseignantsAutres.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Enseignants d'autres départements"
            subtitle="Demandez l'accès au chef concerné pour pouvoir les affecter."
            icon={<Share2 className="size-4" />}
          />
          <ul className="divide-y divide-line">
            {enseignantsAutres.map((ens) => (
              <li
                key={ens.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-strong">{ens.nom}</p>
                  <p className="text-[12px] text-faint">Département {ens.departement}</p>
                </div>
                {ens.statut === 'accordee' ? (
                  <Badge tone="ok">Autorisé</Badge>
                ) : ens.statut === 'en_attente' ? (
                  <Badge tone="warn">Demande envoyée</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => demanderAcces(ens)}
                    loading={actionAcces === ens.id}
                    disabled={!enLigne}
                  >
                    <UserPlus className="size-4" />
                    {ens.statut === 'refusee' || ens.statut === 'revoquee'
                      ? "Redemander l'accès"
                      : "Demander l'accès"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <NouvelleMatiere
        filiere={filiere}
        semestreCourant={semestreCourant}
        ouvert={nouvelle}
        onClose={() => setNouvelle(false)}
        onCree={async () => {
          setNouvelle(false)
          toast.succes('Matière créée', 'Elle apparaît dans la filière.')
          await synchroniser({ silencieux: true })
        }}
      />
    </>
  )
}

/** Création d'une matière par le chef, dans la filière sélectionnée. */
function NouvelleMatiere({ filiere, semestreCourant, ouvert, onClose, onCree }) {
  const [niveau, setNiveau] = useState('')
  const [nom, setNom] = useState('')
  const [nomEn, setNomEn] = useState('')
  const [semestre, setSemestre] = useState(String(semestreCourant || 1))
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  // Réinitialisation à l'ouverture.
  const [cle, setCle] = useState(null)
  if (ouvert && cle !== filiere?.id) {
    setCle(filiere?.id)
    setNiveau('')
    setNom('')
    setNomEn('')
    setSemestre(String(semestreCourant || 1))
    setErreur(null)
  }

  const creer = async () => {
    setErreur(null)
    if (!niveau) return setErreur('Choisissez le niveau.')
    if (nom.trim().length < 2) return setErreur('Saisissez le nom de la matière.')
    setEnvoi(true)
    const reponse = await enqueue(
      'departement.creer_matiere',
      {
        filiereId: filiere.id,
        niveau: Number(niveau),
        nom: nom.trim(),
        nomEn: nomEn.trim() || null,
        semestre: Number(semestre),
      },
      { labelPourUtilisateur: `Nouvelle matière — ${nom.trim()}` },
    )
    setEnvoi(false)
    if (!reponse.ok && !reponse.enAttente) {
      setErreur(reponse.error?.message ?? 'Création impossible.')
      return
    }
    onCree()
  }

  return (
    <Modal
      open={ouvert}
      onClose={onClose}
      title="Nouvelle matière"
      subtitle={filiere?.nom}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={creer} loading={envoi}>
            <Plus className="size-4" aria-hidden />
            Créer la matière
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Niveau" required htmlFor="nm-niveau" hint="L'année dans la filière.">
          <Select id="nm-niveau" value={niveau} onChange={(e) => setNiveau(e.target.value)}>
            <option value="">Choisir…</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                Niveau {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nom de la matière (français)" required htmlFor="nm-nom">
          <Input id="nm-nom" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={120} placeholder="ex. React JS" />
        </Field>
        <Field label="Nom en anglais" htmlFor="nm-nom-en" hint="Facultatif.">
          <Input id="nm-nom-en" value={nomEn} onChange={(e) => setNomEn(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Semestre" required htmlFor="nm-sem">
          <Select id="nm-sem" value={semestre} onChange={(e) => setSemestre(e.target.value)}>
            <option value="1">Semestre 1</option>
            <option value="2">Semestre 2</option>
          </Select>
        </Field>
        {erreur && <Banner tone="bad">{erreur}</Banner>}
      </div>
    </Modal>
  )
}
