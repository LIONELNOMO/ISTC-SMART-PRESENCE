import { useMemo, useState } from 'react'
import {
  BookOpen,
  Database,
  KeyRound,
  Link2,
  Plus,
  Search,
  Upload,
  UserCog,
  Users,
} from 'lucide-react'

import { useProjection } from '../../lib/session.jsx'
import { enqueue, synchroniser } from '../../lib/sync.js'
import { formatPhone } from '../../lib/whatsapp.js'
import { readStudentFile } from '../../lib/tabular.js'
import { formatStamp } from '../../lib/dates.js'
import { ESPACES } from '../../app/navigation.js'
import { PageHeader } from '../../components/app/AppShell.jsx'
import { Badge, Button } from '../../components/ui/primitives.jsx'
import { Banner, Card, CardBody, CardHeader, EmptyState } from '../../components/ui/surfaces.jsx'
import { Field, FileInput, Input, Segmented, Select, Switch } from '../../components/ui/forms.jsx'
import { DataTable } from '../../components/ui/data.jsx'
import { ConfirmDialog, Modal, useToast } from '../../components/ui/overlays.jsx'

const ONGLETS = [
  { value: 'filieres', label: 'Filières' },
  { value: 'classes', label: 'Classes' },
  { value: 'matieres', label: 'Matières' },
  { value: 'enseignants', label: 'Enseignants' },
  { value: 'affectations', label: 'Affectations' },
  { value: 'etudiants', label: 'Étudiants' },
  { value: 'comptes', label: 'Comptes' },
]

/**
 * Référentiel (§3, §10) : comptes, import des étudiants, filières, classes,
 * matières, affectations.
 *
 * §13.3 « Affectation de masse » : chaque formulaire envoie exactement les champs
 * déclarés dans `REFERENTIEL_SHAPES`. Un champ en trop fait échouer la requête,
 * côté serveur.
 */
export function AdminReferentiel() {
  const administration = useProjection('administration')
  const toast = useToast()
  const [onglet, setOnglet] = useState('filieres')
  const [formulaire, setFormulaire] = useState(null)
  const [motDePasseCree, setMotDePasseCree] = useState(null)
  const [rechMatiere, setRechMatiere] = useState('')

  // Les Hooks doivent être appelés à chaque rendu, AVANT tout `return`
  // anticipé (règles des Hooks) : on garde `useMemo` ici et on sécurise
  // l'accès au référentiel qui peut ne pas être encore chargé.
  const ref = administration?.referentiel
  const matieresFiltrees = useMemo(() => {
    const liste = ref?.matieres ?? []
    const terme = rechMatiere.trim().toLowerCase()
    if (!terme) return liste
    return liste.filter(
      (m) =>
        m.nom.toLowerCase().includes(terme) ||
        (m.nomEn && m.nomEn.toLowerCase().includes(terme)) ||
        (m.classe && m.classe.toLowerCase().includes(terme)),
    )
  }, [ref?.matieres, rechMatiere])

  if (!administration) {
    return (
      <EmptyState icon={<Database className="size-5" />} title="Aucune donnée reçue">
        Synchronisez l'application pour récupérer le référentiel.
      </EmptyState>
    )
  }

  const envoyer = async (entite, valeurs, id = null) => {
    const reponse = await enqueue(
      'admin.referentiel',
      { entite, id, valeurs },
      { labelPourUtilisateur: `Référentiel — ${entite}` },
    )
    if (!reponse.ok) {
      return { ok: false, message: reponse.error?.message ?? 'Enregistrement impossible.' }
    }
    await synchroniser({ silencieux: true })
    if (reponse.data?.motDePasseProvisoire) {
      setMotDePasseCree({
        motDePasse: reponse.data.motDePasseProvisoire,
        entite,
        nom: valeurs.nom ? `${valeurs.prenom ?? ''} ${valeurs.nom}`.trim() : valeurs.matricule,
        login: valeurs.telephone ?? valeurs.matricule,
      })
    }
    toast.succes('Enregistré')
    return { ok: true }
  }

  return (
    <>
      <PageHeader
        title="Référentiel"
        subtitle="Filières, classes, matières, affectations, comptes et import des étudiants."
      >
        <Segmented value={onglet} onChange={setOnglet} options={ONGLETS} />
      </PageHeader>

      {onglet === 'filieres' && (
        <Bloc
          titre="Filières"
          sousTitre="Nom et chef de département."
          icone={<Database className="size-4" aria-hidden />}
          action={
            <Button size="sm" onClick={() => setFormulaire({ entite: 'filiere' })}>
              <Plus className="size-4" aria-hidden />
              Nouvelle filière
            </Button>
          }
        >
          <DataTable
            columns={[
              { key: 'nom', label: 'Filière', strong: true },
              {
                key: 'chef',
                label: 'Chef de département',
                render: (row) =>
                  row.chef ? row.chef : <Badge tone="warn">non désigné</Badge>,
              },
              {
                key: 'sectionAnglophone',
                label: 'Section anglo.',
                hideOnTablet: true,
                render: (row) =>
                  row.sectionAnglophone ? (
                    <Badge tone="brand">Oui</Badge>
                  ) : (
                    <span className="text-faint">—</span>
                  ),
              },
              {
                key: 'classes',
                label: 'Classes',
                align: 'right',
                render: (row) => <span className="text-faint">{row.classes}</span>,
              },
              {
                key: 'action',
                label: '',
                align: 'right',
                render: (row) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setFormulaire({ entite: 'filiere', valeur: row })}
                  >
                    Modifier
                  </Button>
                ),
              },
            ]}
            rows={ref.filieres}
            empty="Aucune filière"
            dense
          />
        </Bloc>
      )}

      {onglet === 'classes' && (
        <Bloc
          titre="Classes"
          sousTitre="Une filière et un niveau. Les étudiants attendus à une séance sont ceux de la classe de la matière."
          icone={<Users className="size-4" aria-hidden />}
          action={
            <Button size="sm" onClick={() => setFormulaire({ entite: 'classe' })}>
              <Plus className="size-4" aria-hidden />
              Nouvelle classe
            </Button>
          }
        >
          <DataTable
            columns={[
              { key: 'nom', label: 'Classe', strong: true },
              {
                key: 'niveau',
                label: 'Niveau',
                render: (row) => <Badge tone="brand">Niveau {row.niveau}</Badge>,
              },
              {
                key: 'effectif',
                label: 'Effectif',
                align: 'right',
                render: (row) => <span className="font-semibold">{row.effectif}</span>,
              },
              {
                key: 'matieres',
                label: 'Matières',
                align: 'right',
                render: (row) => <span className="text-faint">{row.matieres}</span>,
              },
            ]}
            rows={ref.classes}
            empty="Aucune classe"
            dense
          />
        </Bloc>
      )}

      {onglet === 'matieres' && (
        <Bloc
          titre="Matières"
          sousTitre="Une matière appartient à une seule classe."
          icone={<BookOpen className="size-4" aria-hidden />}
          action={
            <Button
              size="sm"
              onClick={() => setFormulaire({ entite: 'matiere' })}
              disabled={ref.classes.length === 0}
            >
              <Plus className="size-4" aria-hidden />
              Nouvelle matière
            </Button>
          }
        >
          <div className="relative mb-3">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
              aria-hidden
            />
            <Input
              value={rechMatiere}
              onChange={(e) => setRechMatiere(e.target.value)}
              placeholder="Rechercher une matière (nom ou classe)…"
              className="pl-10"
              maxLength={60}
            />
          </div>
          <DataTable
            columns={[
              {
                key: 'nom',
                label: 'Matière',
                strong: true,
                render: (row) => (
                  <span>
                    {row.nom}
                    {row.nomEn && row.nomEn !== row.nom && (
                      <span className="block text-[11px] font-normal italic text-faint">
                        {row.nomEn}
                      </span>
                    )}
                  </span>
                ),
              },
              { key: 'classe', label: 'Classe' },
              {
                key: 'enseignants',
                label: 'Enseignants affectés',
                render: (row) =>
                  row.enseignants.length ? (
                    row.enseignants.map((e) => e.nom).join(', ')
                  ) : (
                    <Badge tone="warn">aucun</Badge>
                  ),
              },
            ]}
            rows={matieresFiltrees}
            empty={rechMatiere.trim() ? 'Aucune matière trouvée' : 'Aucune matière'}
            dense
          />
        </Bloc>
      )}

      {onglet === 'enseignants' && (
        <Bloc
          titre="Enseignants"
          sousTitre="Nom, prénom, téléphone. Le téléphone sert d'identifiant de connexion."
          icone={<UserCog className="size-4" aria-hidden />}
          action={
            <Button size="sm" onClick={() => setFormulaire({ entite: 'enseignant' })}>
              <Plus className="size-4" aria-hidden />
              Nouvel enseignant
            </Button>
          }
        >
          <DataTable
            columns={[
              { key: 'nom', label: 'Enseignant', strong: true },
              {
                key: 'departement',
                label: 'Département',
                render: (row) =>
                  row.departement ? (
                    <Badge tone="brand">{row.departement}</Badge>
                  ) : (
                    <Badge tone="warn">non classé</Badge>
                  ),
              },
              {
                key: 'telephone',
                label: 'Téléphone',
                mono: true,
                render: (row) => formatPhone(row.telephone),
              },
              {
                key: 'matieres',
                label: 'Matières',
                render: (row) =>
                  row.matieres.length ? row.matieres.join(', ') : <Badge tone="warn">aucune</Badge>,
              },
              {
                key: 'actif',
                label: 'Compte',
                render: (row) =>
                  row.actif ? <Badge tone="ok">actif</Badge> : <Badge tone="bad">désactivé</Badge>,
              },
            ]}
            rows={ref.enseignants}
            empty="Aucun enseignant"
            dense
          />
        </Bloc>
      )}

      {onglet === 'affectations' && (
        <Bloc
          titre="Affectations"
          sousTitre="Un enseignant et une matière. Un enseignant peut avoir plusieurs matières, dans plusieurs classes et plusieurs niveaux."
          icone={<Link2 className="size-4" aria-hidden />}
          action={
            <Button
              size="sm"
              onClick={() => setFormulaire({ entite: 'affectation' })}
              disabled={ref.enseignants.length === 0 || ref.matieres.length === 0}
            >
              <Plus className="size-4" aria-hidden />
              Nouvelle affectation
            </Button>
          }
        >
          <DataTable
            columns={[
              { key: 'nom', label: 'Matière', strong: true },
              { key: 'classe', label: 'Classe' },
              {
                key: 'enseignants',
                label: 'Enseignants',
                render: (row) =>
                  row.enseignants.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {row.enseignants.map((e) => (
                        <Badge key={e.id} tone="brand">
                          {e.nom}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <Badge tone="warn">aucun</Badge>
                  ),
              },
            ]}
            rows={ref.matieres}
            empty="Aucune matière à affecter"
            dense
          />
        </Bloc>
      )}

      {onglet === 'etudiants' && (
        <EtudiantsOnglet
          referentiel={ref}
          onCreer={() => setFormulaire({ entite: 'etudiant' })}
          onEditer={(row) => setFormulaire({ entite: 'etudiant', valeur: row })}
          onImporte={(rapport) => {
            toast.succes(
              'Import terminé',
              `${rapport.crees} créé(s), ${rapport.doublons.length} doublon(s) ignoré(s).`,
            )
          }}
        />
      )}

      {onglet === 'comptes' && <ComptesOnglet comptes={ref.comptes} />}

      <FormulaireReferentiel
        demande={formulaire}
        referentiel={ref}
        onClose={() => setFormulaire(null)}
        onEnvoyer={envoyer}
      />

      <Modal
        open={Boolean(motDePasseCree)}
        onClose={() => setMotDePasseCree(null)}
        title="Mot de passe provisoire"
        subtitle={motDePasseCree ? `${motDePasseCree.nom} · ${motDePasseCree.login}` : undefined}
        size="sm"
        footer={
          <Button onClick={() => setMotDePasseCree(null)}>J'ai noté le mot de passe</Button>
        }
      >
        {motDePasseCree && (
          <div className="space-y-4 text-center">
            <p className="font-mono text-2xl font-bold tracking-wider text-ink">
              {motDePasseCree.motDePasse}
            </p>
            <Banner tone="warn">
              Ce mot de passe est affiché une seule fois : il n'est stocké que sous forme hachée.
              Remettez-le à la personne, qui devra le changer à sa première connexion.
            </Banner>
          </div>
        )}
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Enveloppe commune
 * ------------------------------------------------------------------ */

function Bloc({ titre, sousTitre, icone, action, children }) {
  return (
    <Card>
      <CardHeader title={titre} subtitle={sousTitre} icon={icone} actions={action} />
      <div className="px-2 py-1 sm:px-3">{children}</div>
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 *  Étudiants et import
 * ------------------------------------------------------------------ */

function EtudiantsOnglet({ referentiel: ref, onCreer, onEditer, onImporte }) {
  const [recherche, setRecherche] = useState('')
  const [apercu, setApercu] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const filtres = useMemo(() => {
    const terme = recherche.trim().toLowerCase()
    if (!terme) return ref.etudiants
    return ref.etudiants.filter(
      (etudiant) =>
        etudiant.nom.toLowerCase().includes(terme) ||
        etudiant.matricule.toLowerCase().includes(terme) ||
        etudiant.classe.toLowerCase().includes(terme),
    )
  }, [ref.etudiants, recherche])

  const choisirFichier = async (file) => {
    setErreur(null)
    setApercu(null)
    const lecture = await readStudentFile(file)
    if (lecture.error) {
      setErreur(lecture.error)
      return
    }
    setApercu(lecture)
  }

  const importer = async () => {
    if (!apercu?.records?.length) return
    setEnvoi(true)
    const reponse = await enqueue(
      'admin.import_etudiants',
      { lignes: apercu.records.map(({ ligne, ...reste }) => reste) },
      { labelPourUtilisateur: 'Import des étudiants' },
    )
    setEnvoi(false)
    if (!reponse.ok) {
      setErreur(reponse.error?.message ?? 'Import impossible.')
      return
    }
    await synchroniser({ silencieux: true })
    setApercu({ ...apercu, rapport: reponse.data })
    onImporte(reponse.data)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Import par fichier"
          subtitle="Colonnes attendues : matricule, nom, prénom, filière, niveau, numéro du parent. Colonne facultative : section (« anglophone » / « francophone »)."
          icon={<Upload className="size-4" aria-hidden />}
        />
        <CardBody className="space-y-4">
          <FileInput
            accept=".csv,text/csv"
            onFile={choisirFichier}
            label="Choisir un fichier CSV"
            hint="Les formules de tableur sont neutralisées, et chaque cellule est validée."
          />

          {erreur && <Banner tone="bad">{erreur}</Banner>}

          {apercu && !apercu.rapport && (
            <div className="space-y-3">
              <Banner tone="info" title="Aperçu avant validation">
                {apercu.records.length} ligne{apercu.records.length > 1 ? 's' : ''} lisible
                {apercu.records.length > 1 ? 's' : ''}
                {apercu.problems.length > 0 && `, ${apercu.problems.length} ignorée(s)`}
                {apercu.truncated && ' — fichier tronqué : trop de lignes'}. Rien n'est encore écrit.
                L'import crée uniquement des étudiants : un matricule déjà présent sera signalé, jamais
                écrasé.
              </Banner>

              <DataTable
                columns={[
                  { key: 'matricule', label: 'Matricule', mono: true, strong: true },
                  { key: 'nom', label: 'Nom' },
                  { key: 'prenom', label: 'Prénom' },
                  { key: 'filiere', label: 'Filière' },
                  { key: 'niveau', label: 'Niveau' },
                  { key: 'parent', label: 'Parent', mono: true },
                ]}
                rows={apercu.records.slice(0, 20)}
                getKey={(row) => `${row.matricule}-${row.ligne}`}
                empty="Aucune ligne exploitable"
                dense
              />
              {apercu.records.length > 20 && (
                <p className="text-[12px] text-faint">
                  20 premières lignes affichées sur {apercu.records.length}.
                </p>
              )}

              {apercu.problems.length > 0 && (
                <div className="rounded-xl border border-warn/30 bg-warn-soft/40 px-4 py-3">
                  <p className="text-[12px] font-semibold text-warn">Lignes ignorées</p>
                  <ul className="mt-1 space-y-0.5 text-[12px] text-warn/90">
                    {apercu.problems.slice(0, 8).map((probleme) => (
                      <li key={probleme.ligne}>
                        Ligne {probleme.ligne} : {probleme.raison}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={importer} loading={envoi}>
                  Importer {apercu.records.length} étudiant{apercu.records.length > 1 ? 's' : ''}
                </Button>
                <Button variant="ghost" onClick={() => setApercu(null)}>
                  Annuler
                </Button>
              </div>
            </div>
          )}

          {apercu?.rapport && (
            <div className="space-y-3">
              <Banner tone="ok" title="Import terminé">
                {apercu.rapport.crees} étudiant{apercu.rapport.crees > 1 ? 's' : ''} créé
                {apercu.rapport.crees > 1 ? 's' : ''}.
                {apercu.rapport.classesCreees.length > 0 &&
                  ` Classes créées : ${apercu.rapport.classesCreees.join(', ')}.`}
              </Banner>
              {apercu.rapport.doublons.length > 0 && (
                <Banner tone="warn" title={`${apercu.rapport.doublons.length} doublon(s) ignoré(s)`}>
                  {apercu.rapport.doublons.map((d) => d.matricule).join(', ')}
                </Banner>
              )}
              {apercu.rapport.sansParent?.length > 0 && (
                <Banner
                  tone="warn"
                  title={`${apercu.rapport.sansParent.length} étudiant(s) sans numéro de parent`}
                >
                  Ces étudiants sont créés et peuvent se connecter, mais{' '}
                  <strong>aucune alerte ne pourra être envoyée à leur parent</strong> tant que le
                  numéro manque. Complétez-le dans la liste ci-dessous.
                  <ul className="mt-1.5 space-y-0.5">
                    {apercu.rapport.sansParent.map((e) => (
                      <li key={e.matricule}>
                        <span className="font-mono">{e.matricule}</span> — {e.nom}
                      </li>
                    ))}
                  </ul>
                </Banner>
              )}
              {apercu.rapport.refusees.length > 0 && (
                <Banner tone="bad" title={`${apercu.rapport.refusees.length} ligne(s) refusée(s)`}>
                  <ul className="mt-1 space-y-0.5">
                    {apercu.rapport.refusees.slice(0, 8).map((r, index) => (
                      <li key={`${r.matricule}-${index}`}>
                        {r.matricule} : {r.raison}
                      </li>
                    ))}
                  </ul>
                </Banner>
              )}
              <Button variant="secondary" onClick={() => setApercu(null)}>
                Nouvel import
              </Button>
            </div>
          )}

          <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-faint">
            Les fichiers Excel (.xlsx) sont importés par le serveur : une archive XML doit être
            contrôlée contre les entités externes et les bombes de décompression. Depuis le
            navigateur, exportez la feuille en .csv.
          </p>
        </CardBody>
      </Card>

      <Bloc
        titre="Étudiants"
        sousTitre={`${ref.etudiants.length} étudiant${ref.etudiants.length > 1 ? 's' : ''}. Le numéro du parent n'est visible que par l'administration et le chef de département.`}
        icone={<Users className="size-4" aria-hidden />}
        action={
          <Button size="sm" onClick={onCreer} disabled={ref.classes.length === 0}>
            <Plus className="size-4" aria-hidden />
            Nouvel étudiant
          </Button>
        }
      >
        <div className="relative mb-2 px-1">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={recherche}
            onChange={(event) => setRecherche(event.target.value)}
            placeholder="Rechercher un nom, un matricule ou une classe"
            className="pl-10"
            maxLength={40}
          />
        </div>
        <DataTable
          columns={[
            { key: 'matricule', label: 'Matricule', mono: true, strong: true },
            { key: 'nom', label: 'Nom' },
            { key: 'classe', label: 'Classe' },
            {
              key: 'section',
              label: 'Section',
              hideOnTablet: true,
              render: (row) =>
                row.section === 'anglophone' ? (
                  <Badge tone="brand">Anglophone</Badge>
                ) : (
                  <span className="text-faint">Francophone</span>
                ),
            },
            {
              key: 'departement',
              label: 'Département',
              hideOnTablet: true,
              render: (row) =>
                row.departement ? (
                  <Badge tone="brand">{row.departement}</Badge>
                ) : (
                  <span className="text-faint">—</span>
                ),
            },
            {
              key: 'parentPhone',
              label: 'Parent',
              mono: true,
              render: (row) => formatPhone(row.parentPhone),
            },
            {
              key: 'actif',
              label: 'Compte',
              render: (row) =>
                row.actif ? <Badge tone="ok">actif</Badge> : <Badge tone="bad">désactivé</Badge>,
            },
          ]}
          rows={filtres.slice(0, 100)}
          empty="Aucun étudiant"
          dense
          onRowClick={onEditer}
        />
        {filtres.length > 100 && (
          <p className="px-2 pb-2 text-[12px] text-faint">
            100 premiers résultats affichés sur {filtres.length}. Affinez la recherche.
          </p>
        )}
      </Bloc>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  Comptes
 * ------------------------------------------------------------------ */

function ComptesOnglet({ comptes }) {
  const toast = useToast()
  const [aReinitialiser, setAReinitialiser] = useState(null)
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState(null)
  const [occupe, setOccupe] = useState(false)

  const basculer = async (compte, actif) => {
    const reponse = await enqueue(
      'admin.compte',
      { userId: compte.id, actif },
      { labelPourUtilisateur: `Compte — ${compte.nom}` },
    )
    if (!reponse.ok) {
      toast.erreur('Modification refusée', reponse.error?.message)
      return
    }
    await synchroniser({ silencieux: true })
    toast.succes(actif ? 'Compte activé' : 'Compte désactivé', 'Les sessions ouvertes sont fermées.')
  }

  const reinitialiser = async () => {
    setOccupe(true)
    const reponse = await enqueue(
      'admin.compte',
      { userId: aReinitialiser.id, reinitialiser: true },
      { labelPourUtilisateur: `Réinitialisation — ${aReinitialiser.nom}` },
    )
    setOccupe(false)
    setAReinitialiser(null)
    if (!reponse.ok) {
      toast.erreur('Réinitialisation refusée', reponse.error?.message)
      return
    }
    await synchroniser({ silencieux: true })
    setNouveauMotDePasse({
      nom: aReinitialiser.nom,
      login: aReinitialiser.login,
      motDePasse: reponse.data.motDePasseProvisoire,
    })
  }

  return (
    <>
      <Bloc
        titre="Comptes"
        sousTitre="Les comptes sont créés par l'administration : il n'y a pas d'inscription libre."
        icone={<KeyRound className="size-4" aria-hidden />}
      >
        <DataTable
          columns={[
            { key: 'nom', label: 'Personne', strong: true },
            { key: 'login', label: 'Identifiant', mono: true },
            {
              key: 'roles',
              label: 'Rôles',
              render: (row) => (
                <span className="flex flex-wrap gap-1.5">
                  {row.roles.map((role) => (
                    <Badge key={role} tone="brand">
                      {ESPACES[role]?.label ?? role}
                    </Badge>
                  ))}
                </span>
              ),
            },
            {
              key: 'mustChangePassword',
              label: 'Mot de passe',
              render: (row) =>
                row.mustChangePassword ? (
                  <Badge tone="warn">provisoire</Badge>
                ) : (
                  <Badge tone="ok">défini</Badge>
                ),
            },
            {
              key: 'createdAt',
              label: 'Créé le',
              hideOnTablet: true,
              render: (row) => (
                <span className="text-[12px] text-faint">{formatStamp(row.createdAt)}</span>
              ),
            },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (row) => (
                <span className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setAReinitialiser(row)}>
                    Réinitialiser
                  </Button>
                  <Switch
                    checked={row.actif}
                    onChange={(actif) => basculer(row, actif)}
                    id={`actif-${row.id}`}
                  />
                </span>
              ),
            },
          ]}
          rows={comptes}
          empty="Aucun compte"
          dense
        />
      </Bloc>

      <ConfirmDialog
        open={Boolean(aReinitialiser)}
        onClose={() => setAReinitialiser(null)}
        onConfirm={reinitialiser}
        title="Réinitialiser le mot de passe ?"
        confirmLabel="Réinitialiser"
        loading={occupe}
      >
        Un mot de passe provisoire sera produit pour {aReinitialiser?.nom}. Toutes ses sessions
        ouvertes seront fermées, et il devra en choisir un nouveau à sa prochaine connexion.
      </ConfirmDialog>

      <Modal
        open={Boolean(nouveauMotDePasse)}
        onClose={() => setNouveauMotDePasse(null)}
        title="Mot de passe provisoire"
        subtitle={nouveauMotDePasse ? `${nouveauMotDePasse.nom} · ${nouveauMotDePasse.login}` : undefined}
        size="sm"
        footer={<Button onClick={() => setNouveauMotDePasse(null)}>J'ai noté</Button>}
      >
        {nouveauMotDePasse && (
          <div className="space-y-4 text-center">
            <p className="font-mono text-2xl font-bold tracking-wider text-ink">
              {nouveauMotDePasse.motDePasse}
            </p>
            <Banner tone="warn">Affiché une seule fois. Remettez-le à la personne concernée.</Banner>
          </div>
        )}
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ *
 *  Formulaires
 * ------------------------------------------------------------------ */

function FormulaireReferentiel({ demande, referentiel: ref, onClose, onEnvoyer }) {
  const [valeurs, setValeurs] = useState({})
  const [erreur, setErreur] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  const entite = demande?.entite
  const existant = demande?.valeur ?? null

  // Réinitialisation à l'ouverture.
  const [dernierId, setDernierId] = useState(null)
  const cle = `${entite}-${existant?.id ?? 'nouveau'}`
  if (demande && dernierId !== cle) {
    setDernierId(cle)
    if (!existant) {
      setValeurs({})
    } else if (entite === 'etudiant') {
      setValeurs({
        matricule: existant.matricule ?? '',
        prenom: existant.prenom ?? '',
        nom: existant.nomFamille ?? '',
        classeId: existant.classeId ?? '',
        section: existant.section ?? 'francophone',
        parentPhone: existant.parentPhone ?? '',
      })
    } else {
      setValeurs({
        nom: existant.nom ?? '',
        chefUserId: existant.chefUserId ?? '',
        departementId: existant.departementId ?? '',
        sectionAnglophone: Boolean(existant.sectionAnglophone),
      })
    }
    setErreur(null)
  }

  const maj = (champ) => (event) =>
    setValeurs((v) => ({ ...v, [champ]: event?.target ? event.target.value : event }))

  const titres = {
    filiere: existant ? 'Modifier la filière' : 'Nouvelle filière',
    classe: 'Nouvelle classe',
    matiere: 'Nouvelle matière',
    enseignant: 'Nouvel enseignant',
    affectation: 'Nouvelle affectation',
    etudiant: existant ? "Modifier l'étudiant" : 'Nouvel étudiant',
  }

  const soumettre = async () => {
    setErreur(null)
    setEnvoi(true)

    // On n'envoie QUE les champs attendus par l'entité (§13.3).
    const charges = {
      filiere: {
        nom: valeurs.nom,
        chefUserId: valeurs.chefUserId || null,
        departementId: valeurs.departementId || null,
        sectionAnglophone: Boolean(valeurs.sectionAnglophone),
      },
      classe: { filiereId: valeurs.filiereId, niveau: Number(valeurs.niveau) },
      matiere: { nom: valeurs.nom, nomEn: valeurs.nomEn || null, classeId: valeurs.classeId },
      enseignant: {
        nom: valeurs.nom,
        prenom: valeurs.prenom,
        telephone: valeurs.telephone,
        departementId: valeurs.departementId || null,
      },
      affectation: { teacherId: valeurs.teacherId, matiereId: valeurs.matiereId },
      etudiant: {
        matricule: valeurs.matricule,
        nom: valeurs.nom,
        prenom: valeurs.prenom,
        classeId: valeurs.classeId,
        section: valeurs.section || 'francophone',
        parentPhone: valeurs.parentPhone,
      },
    }[entite]

    const reponse = await onEnvoyer(entite, charges, existant?.id ?? null)
    setEnvoi(false)
    if (!reponse.ok) {
      setErreur(reponse.message)
      return
    }
    onClose()
  }

  const chefsPossibles = (ref?.comptes ?? []).filter(
    (compte) => !compte.roles.includes('etudiant') && !compte.roles.includes('secretaire'),
  )

  // §4 : la classe choisie pour un étudiant relève-t-elle d'une filière à
  // section anglophone ? Sinon on n'affiche pas le choix de section.
  const classeChoisie = (ref?.classes ?? []).find((c) => c.id === valeurs.classeId)
  const filiereDeClasse = classeChoisie
    ? (ref?.filieres ?? []).find((f) => f.id === classeChoisie.filiereId)
    : null
  const classeAnglo = Boolean(filiereDeClasse?.sectionAnglophone)

  return (
    <Modal
      open={Boolean(demande)}
      onClose={onClose}
      title={titres[entite] ?? 'Référentiel'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={soumettre} loading={envoi}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {entite === 'filiere' && (
          <>
            <Field label="Nom de la filière" required htmlFor="f-nom">
              <Input id="f-nom" value={valeurs.nom ?? ''} onChange={maj('nom')} maxLength={80} />
            </Field>
            <Field
              label="Chef de département"
              htmlFor="f-chef"
              hint="Le rôle « chef de département » lui sera ajouté. Un compte secrétaire ne peut pas l'être."
            >
              <Select id="f-chef" value={valeurs.chefUserId ?? ''} onChange={maj('chefUserId')}>
                <option value="">Aucun pour l'instant</option>
                {chefsPossibles.map((compte) => (
                  <option key={compte.id} value={compte.id}>
                    {compte.nom} ({compte.login})
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Département"
              htmlFor="f-dep"
              hint="Les étudiants de cette filière seront classés dans ce département."
            >
              <Select id="f-dep" value={valeurs.departementId ?? ''} onChange={maj('departementId')}>
                <option value="">Aucun pour l'instant</option>
                {(ref?.departements ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Section anglophone"
              htmlFor="f-section-anglo"
              hint="Cochez si cette filière a une section anglophone : les mêmes cours, un groupe d'étudiants distinct, et les matières affichées sous leur nom anglais."
            >
              <Switch
                id="f-section-anglo"
                checked={Boolean(valeurs.sectionAnglophone)}
                onChange={(v) => maj('sectionAnglophone')(v)}
                label={valeurs.sectionAnglophone ? 'Oui' : 'Non'}
              />
            </Field>
          </>
        )}

        {entite === 'classe' && (
          <>
            <Field label="Filière" required htmlFor="c-filiere">
              <Select id="c-filiere" value={valeurs.filiereId ?? ''} onChange={maj('filiereId')}>
                <option value="">Choisir…</option>
                {ref.filieres.map((filiere) => (
                  <option key={filiere.id} value={filiere.id}>
                    {filiere.nom}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Niveau" required htmlFor="c-niveau">
              <Select id="c-niveau" value={valeurs.niveau ?? ''} onChange={maj('niveau')}>
                <option value="">Choisir…</option>
                {[1, 2, 3, 4, 5, 6].map((niveau) => (
                  <option key={niveau} value={niveau}>
                    Niveau {niveau}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {entite === 'matiere' && (
          <>
            <Field label="Nom de la matière (français)" required htmlFor="m-nom">
              <Input id="m-nom" value={valeurs.nom ?? ''} onChange={maj('nom')} maxLength={120} />
            </Field>
            <Field
              label="Nom en anglais"
              htmlFor="m-nom-en"
              hint="Intitulé officiel du cursus. Facultatif."
            >
              <Input id="m-nom-en" value={valeurs.nomEn ?? ''} onChange={maj('nomEn')} maxLength={120} />
            </Field>
            <Field
              label="Classe concernée"
              required
              htmlFor="m-classe"
              hint="Une matière appartient à une seule classe."
            >
              <Select id="m-classe" value={valeurs.classeId ?? ''} onChange={maj('classeId')}>
                <option value="">Choisir…</option>
                {ref.classes.map((classe) => (
                  <option key={classe.id} value={classe.id}>
                    {classe.nom}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {entite === 'enseignant' && (
          <>
            <Field label="Prénom" required htmlFor="e-prenom">
              <Input id="e-prenom" value={valeurs.prenom ?? ''} onChange={maj('prenom')} maxLength={60} />
            </Field>
            <Field label="Nom" required htmlFor="e-nom">
              <Input id="e-nom" value={valeurs.nom ?? ''} onChange={maj('nom')} maxLength={60} />
            </Field>
            <Field
              label="Téléphone"
              required
              htmlFor="e-tel"
              hint="Identifiant de connexion. Un mot de passe provisoire sera produit."
            >
              <Input
                id="e-tel"
                value={valeurs.telephone ?? ''}
                onChange={maj('telephone')}
                inputMode="numeric"
                maxLength={20}
                placeholder="237699000000"
              />
            </Field>
            <Field label="Département" htmlFor="e-dep" hint="Le département d'appartenance de l'enseignant.">
              <Select id="e-dep" value={valeurs.departementId ?? ''} onChange={maj('departementId')}>
                <option value="">Aucun pour l'instant</option>
                {(ref?.departements ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {entite === 'affectation' && (
          <>
            <Field label="Enseignant" required htmlFor="a-ens">
              <Select id="a-ens" value={valeurs.teacherId ?? ''} onChange={maj('teacherId')}>
                <option value="">Choisir…</option>
                {ref.enseignants.map((enseignant) => (
                  <option key={enseignant.id} value={enseignant.id}>
                    {enseignant.nom}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Matière" required htmlFor="a-mat">
              <Select id="a-mat" value={valeurs.matiereId ?? ''} onChange={maj('matiereId')}>
                <option value="">Choisir…</option>
                {ref.matieres.map((matiere) => (
                  <option key={matiere.id} value={matiere.id}>
                    {matiere.nom} — {matiere.classe}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {entite === 'etudiant' && (
          <>
            <Field label="Matricule" required htmlFor="s-mat">
              <Input
                id="s-mat"
                value={valeurs.matricule ?? ''}
                onChange={maj('matricule')}
                maxLength={24}
                autoCapitalize="characters"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Prénom" required htmlFor="s-prenom">
                <Input id="s-prenom" value={valeurs.prenom ?? ''} onChange={maj('prenom')} maxLength={60} />
              </Field>
              <Field label="Nom" required htmlFor="s-nom">
                <Input id="s-nom" value={valeurs.nom ?? ''} onChange={maj('nom')} maxLength={60} />
              </Field>
            </div>
            <Field label="Classe" required htmlFor="s-classe">
              <Select id="s-classe" value={valeurs.classeId ?? ''} onChange={maj('classeId')}>
                <option value="">Choisir…</option>
                {ref.classes.map((classe) => (
                  <option key={classe.id} value={classe.id}>
                    {classe.nom}
                  </option>
                ))}
              </Select>
            </Field>
            {classeAnglo && (
              <Field
                label="Section"
                required
                htmlFor="s-section"
                hint="Cette filière a une section anglophone : l'étudiant suit les mêmes cours, affichés sous leur nom anglais."
              >
                <Select id="s-section" value={valeurs.section ?? 'francophone'} onChange={maj('section')}>
                  <option value="francophone">Francophone</option>
                  <option value="anglophone">Anglophone</option>
                </Select>
              </Field>
            )}
            <Field
              label="Numéro WhatsApp du parent"
              required
              htmlFor="s-parent"
              hint="Format international. Modifiable par l'administration seulement, et chaque changement est historisé."
            >
              <Input
                id="s-parent"
                value={valeurs.parentPhone ?? ''}
                onChange={maj('parentPhone')}
                inputMode="numeric"
                maxLength={20}
                placeholder="237699000000"
              />
            </Field>
          </>
        )}

        {erreur && <Banner tone="bad">{erreur}</Banner>}
      </div>
    </Modal>
  )
}
