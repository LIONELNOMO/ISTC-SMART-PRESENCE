/**
 * Ce que chaque rôle reçoit, champ par champ.
 *
 *  §13.8 « Données de trop dans les réponses » — le serveur ne renvoie que les
 *         champs utiles au rôle. Rien n'est « masqué à l'écran ».
 *  §13.3 « Fuite des taux et des montants »    — les montants ne sont joints que
 *         pour l'administration, derrière `canSeeMoney`.
 *  §13.10 « Numéros des parents exposés »      — jamais dans une projection
 *         enseignant, secrétaire ou étudiant.
 *  §13.10 « Liste de classe exposée »          — un étudiant ne reçoit que ses
 *         propres données.
 *  §13.5 « Données sensibles sur l'appareil »  — cette fonction décide de ce qui
 *         est écrit dans IndexedDB, donc de ce qu'un téléphone perdu révèle.
 */

import { serverDb } from './db.js'
import { canSeeMoney, filieresDuChef, departementDuChef, hasRole } from './guard.js'
import { getSettings, semestresOf, missingSettings } from './settings.js'
import {
  loadRefs,
  decorateSession,
  studentAbsences,
  absenceTotals,
  teacherHours,
  fichePaie,
  adminReport,
  alertList,
  filiereAttendance,
  justificationQueue,
  classeLabel,
  sectionLabel,
  matiereLabel,
  periodBounds,
  teacherDepartement,
  classeDepartement,
} from './reporting.js'
import { readAudit, readAnomalies } from './audit.js'
import { allRates, resolveRate } from './rates.js'
import { nowIso, dayKey, semesterOf } from '../lib/dates.js'
import { sortBy } from '../lib/utils.js'
import { SESSION_STATES, computeStatus, paidHours } from './rules.js'

/** Identité, sans condensé de mot de passe ni champ interne. */
function projectMe(ctx) {
  return {
    id: ctx.userId,
    nom: ctx.user.nom ?? '',
    prenom: ctx.user.prenom ?? '',
    telephone: ctx.user.telephone ?? '',
    label: ctx.label,
    login: ctx.user.login,
    roles: ctx.roles,
    mustChangePassword: ctx.mustChangePassword,
  }
}

/** Réglages visibles par tous les rôles connectés : rien de sensible. */
function projectPublicSettings(settings) {
  return {
    etablissement: settings.etablissement,
    delaiReleveJours: settings.delaiReleveJours,
    delaiCorrectionHeures: settings.delaiCorrectionHeures,
    semestres: semestresOf(settings).map((s) => ({ id: s.id, nom: s.nom, debut: s.debut, fin: s.fin })),
  }
}

/* ------------------------------------------------------------------ *
 *  Étudiant
 * ------------------------------------------------------------------ */

async function projectStudent(ctx, refs) {
  if (!ctx.studentId) return null
  const student = refs.index.student.get(ctx.studentId)
  if (!student) return null
  const classe = refs.index.classe.get(student.classeId)

  const totals = await absenceTotals({ studentId: ctx.studentId, refs })
  const { seances } = await studentAbsences(ctx.studentId, refs)

  const notifications = await serverDb.notifications
    .where('classeId')
    .equals(student.classeId)
    .reverse()
    .limit(30)
    .toArray()

  // La séance ouverte de sa classe, pour savoir s'il peut scanner.
  const sessionsDeLaClasse = await serverDb.sessions.where('classeId').equals(student.classeId).toArray()
  const ouverte = sortBy(
    sessionsDeLaClasse.filter((s) => s.rollOpenedAt && !s.rollClosedAt),
    (s) => s.rollOpenedAt,
    'desc',
  )[0]

  return {
    // Ses propres données, et rien de sa classe (§13.10).
    profil: {
      matricule: student.matricule,
      nom: `${student.prenom} ${student.nom}`,
      classe: classeLabel(classe, refs.index),
      section: student.section ?? 'francophone',
      sectionLabel: sectionLabel(student.section ?? 'francophone'),
      // Pas de parentPhone : l'étudiant ne le voit pas et ne peut pas le changer.
    },
    totaux: {
      semestre: totals.semestre,
      periodeLabel: totals.periodeLabel,
      nonJustifiees: totals.nonJustifiees,
      justifiees: totals.justifiees,
      enAttente: totals.enAttente,
      parMatiere: totals.parMatiere,
    },
    absences: totals.absences.map((a) => ({
      sessionId: a.sessionId,
      arrivalAt: a.arrivalAt,
      matiere: a.matiere,
      heures: a.heures,
      etat: a.etat,
      justification: a.justification
        ? {
            state: a.justification.state,
            motif: a.justification.motif,
            commentaire: a.justification.commentaire,
            decidedAt: a.justification.decidedAt,
            decidedByLabel: a.justification.decidedByLabel,
          }
        : null,
    })),
    seances: seances.map((s) => ({
      sessionId: s.sessionId,
      arrivalAt: s.arrivalAt,
      matiere: s.matiere,
      statutSeance: s.statutSeance,
      presence: s.presence,
      heures: s.heures,
    })),
    notifications: notifications.map((n) => ({
      id: n.id,
      at: n.at,
      titre: n.titre,
      corps: n.corps,
      sessionId: n.sessionId,
    })),
    seanceOuverte: ouverte ? { id: ouverte.id, matiereId: ouverte.matiereId } : null,
  }
}

/* ------------------------------------------------------------------ *
 *  Enseignant — jamais de taux, jamais de montant, jamais de numéro de parent
 * ------------------------------------------------------------------ */

async function projectTeacher(ctx, refs) {
  if (!ctx.teacherId) return null

  const affectations = refs.affectations.filter((a) => a.teacherId === ctx.teacherId)
  const matieres = affectations
    .map((a) => refs.index.matiere.get(a.matiereId))
    .filter(Boolean)
    .map((m) => {
      const classe = refs.index.classe.get(m.classeId)
      return {
        id: m.id,
        nom: m.nom,
        nomEn: m.nomEn ?? null,
        classeId: m.classeId,
        classe: classeLabel(classe, refs.index),
        niveau: classe?.niveau ?? null,
      }
    })

  // Listes d'étudiants de SES classes, pour cocher le relevé hors ligne (§9).
  // Matricule et nom seulement : pas de numéro de parent (§13.10).
  const classeIds = [...new Set(matieres.map((m) => m.classeId))]
  const listes = classeIds.map((classeId) => ({
    classeId,
    classe: classeLabel(refs.index.classe.get(classeId), refs.index),
    etudiants: sortBy(
      refs.students
        .filter((s) => s.classeId === classeId && s.actif !== false)
        // §4 : chaque étudiant porte sa section ; l'enseignant ne coche que le
        // groupe de la séance ouverte.
        .map((s) => ({
          id: s.id,
          matricule: s.matricule,
          nom: `${s.prenom} ${s.nom}`,
          section: s.section ?? 'francophone',
        })),
      (s) => s.nom,
    ),
  }))

  const hours = await teacherHours(ctx.teacherId, refs)
  const settings = refs.settings

  // Séance ouverte : l'enseignant reçoit le code de séance et le jeton de scan,
  // car ce sont SES secrets de séance.
  const brutes = await serverDb.sessions.where('teacherId').equals(ctx.teacherId).toArray()
  const ouverte = brutes.find((s) => s.arrivalAt && !s.departureAt)
  const aRelever = sortBy(
    brutes.filter(
      (s) =>
        !(s.roll?.codeOk === true) &&
        new Date(s.arrivalAt).getTime() > Date.now() - settings.delaiReleveJours * 86_400_000,
    ),
    (s) => s.arrivalAt,
    'desc',
  )

  const scansParSeance = {}
  for (const session of brutes.slice(0, 60)) {
    const rows = await serverDb.attendance.where('sessionId').equals(session.id).toArray()
    scansParSeance[session.id] = rows.filter((r) => r.status === 'present').map((r) => r.studentId)
  }

  // Fiches de paie déjà PAYÉES — l'historique de paiement de l'enseignant.
  const fichesPayees = (await serverDb.fiches.where('teacherId').equals(ctx.teacherId).toArray())
    .filter((f) => f.statut === 'payee')
    .sort((a, b) => ((a.paidAt ?? a.sentAt) < (b.paidAt ?? b.sentAt) ? 1 : -1))
    .slice(0, 100)
  const idsPayees = new Set(fichesPayees.map((f) => f.id))
  // Heures terminées pas encore payées (hors fiches déjà payées).
  const mesSeances = await serverDb.sessions.where('teacherId').equals(ctx.teacherId).toArray()
  let heuresNonPayees = 0
  for (const s of mesSeances) {
    if (computeStatus(s) !== SESSION_STATES.TERMINEE) continue
    if (s.ficheId && idsPayees.has(s.ficheId)) continue
    heuresNonPayees += paidHours(s)
  }
  heuresNonPayees = Math.round(heuresNonPayees * 100) / 100

  return {
    matieres,
    listes,
    seanceEnCours: ouverte
      ? {
          ...(await decorateSession(ouverte, refs)),
          code: ouverte.code, // son propre code de séance
          scanToken: ouverte.scanToken, // pour afficher le QR de présence hors ligne
          presentsCoches: ouverte.roll?.presents ?? [],
        }
      : null,
    seancesARelever: await Promise.all(
      aRelever.map(async (s) => ({
        ...(await decorateSession(s, refs)),
        presentsCoches: s.roll?.presents ?? [],
        codeOk: Boolean(s.roll?.codeOk),
      })),
    ),
    scansParSeance,
    heures: {
      // Aucun montant ici. Volontairement.
      seances: hours.seances,
      totalHeures: hours.totalHeures,
      totalEcartNonPaye: hours.totalEcartNonPaye,
      parMatiere: hours.parMatiere,
      parJour: hours.parJour,
      parMois: hours.parMois,
      parSemestre: hours.parSemestre,
      incompletes: hours.incompletes,
    },
    // Historique de paiement : les fiches de paie déjà réglées (§7).
    // L'enseignant voit ici son montant — c'est le sien (§13.10).
    fiches: fichesPayees.map((f) => ({
      id: f.id,
      periode: f.periode,
      debut: f.debut ?? null,
      fin: f.fin ?? null,
      totalHeures: f.totalHeures,
      heuresPayees: Math.floor(f.totalHeures ?? 0),
      montant: f.montant ?? null,
      tauxImpot: f.tauxImpot ?? 0,
      impot: f.impot ?? null,
      net: f.net ?? null,
      parNiveau: f.parNiveau ?? [],
      parMatiere: f.parMatiere ?? [],
      etablissement: f.etablissement,
      payeePar: f.paidByLabel ?? '',
      payeeLe: f.paidAt ?? null,
    })),
    heuresNonPayees,
    // Avis affichés en pop-up à l'ouverture de l'espace enseignant.
    avis: (await serverDb.avis.where('teacherId').equals(ctx.teacherId).toArray())
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 20)
      .map((a) => ({ id: a.id, type: a.type, titre: a.titre, corps: a.corps, at: a.at })),
    // Appels déclarés par l'enseignant, pour voir lesquels restent à pointer.
    relevesDeclares: (
      await serverDb.declares.where('teacherId').equals(ctx.teacherId).toArray()
    )
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, 30)
      .map((d) => {
        const section = d.section ?? 'francophone'
        return {
          id: d.id,
          matiere: matiereLabel(refs.index.matiere.get(d.matiereId), section),
          matiereEn: refs.index.matiere.get(d.matiereId)?.nomEn ?? null,
          section,
          sectionLabel: sectionLabel(section),
          niveau: d.niveau,
          day: d.day,
          presents: (d.presents ?? []).length,
          pointe: Boolean(d.sessionId),
        }
      }),
  }
}

/* ------------------------------------------------------------------ *
 *  Secrétariat — pas de montant, pas de numéro de parent
 * ------------------------------------------------------------------ */

async function projectSecretary(ctx, refs) {
  const station = await serverDb.stations.filter((s) => s.secretaryUserId === ctx.userId).first()

  const enseignants = sortBy(
    refs.teachers
      .filter((t) => t.actif !== false)
      .map((t) => {
        const dep = teacherDepartement(t, refs.index)
        return {
          id: t.id,
          nom: `${t.prenom} ${t.nom}`,
          telephone: t.telephone,
          departementId: dep?.id ?? null,
          departement: dep?.nom ?? null,
          matieres: refs.affectations
            .filter((a) => a.teacherId === t.id)
            .map((a) => {
              const m = refs.index.matiere.get(a.matiereId)
              if (!m) return null
              const classe = refs.index.classe.get(m.classeId)
              const filiereM = classe ? refs.index.filiere.get(classe.filiereId) : null
              return {
                id: m.id,
                nom: m.nom,
                nomEn: m.nomEn ?? null,
                classe: classeLabel(classe, refs.index),
                // Niveau de la classe : sert à pré-remplir le choix de niveau
                // au pointage d'arrivée (modifiable ensuite par le secrétariat).
                niveau: classe?.niveau ?? null,
                // §4 : la filière propose-t-elle une section anglophone ?
                sectionAnglophone: !!filiereM?.sectionAnglophone,
              }
            })
            .filter(Boolean),
        }
      }),
    (t) => t.nom,
  )

  // Toutes les matières, avec leur département : au pointage, le secrétariat
  // cherche parmi les matières du département de l'enseignant (§4).
  const matieresPointage = sortBy(
    refs.matieres
      .map((m) => {
        const classe = refs.index.classe.get(m.classeId)
        if (!classe) return null
        const filiere = refs.index.filiere.get(classe.filiereId)
        return {
          id: m.id,
          nom: m.nom,
          nomEn: m.nomEn ?? null,
          niveau: classe.niveau ?? null,
          classe: classeLabel(classe, refs.index),
          departementId: filiere?.departementId ?? null,
          // §4 : la filière propose-t-elle une section anglophone ?
          sectionAnglophone: !!filiere?.sectionAnglophone,
        }
      })
      .filter(Boolean),
    (m) => `${String(m.niveau ?? 0).padStart(2, '0')}-${m.nom}`,
  )

  const jour = dayKey()
  const sessions = await serverDb.sessions.toArray()
  const duJour = sortBy(sessions.filter((s) => s.day === jour), (s) => s.arrivalAt, 'desc')
  const recentesIncompletes = sortBy(
    sessions.filter((s) => s.day !== jour && s.status === SESSION_STATES.INCOMPLETE),
    (s) => s.arrivalAt,
    'desc',
  ).slice(0, 40)

  const decore = async (list) =>
    Promise.all(
      list.map(async (s) => ({
        ...(await decorateSession(s, refs)),
        // La secrétaire remet le code de séance : elle doit le voir (§4).
        code: s.code,
      })),
    )

  return {
    station: station
      ? {
          id: station.id,
          label: station.label,
          // Clef de signature du QR de pointage : délivrée au poste du
          // secrétariat, et à lui seul (§13.4).
          secret: station.secret,
        }
      : null,
    enseignants,
    matieresPointage,
    seancesDuJour: await decore(duJour),
    incompletesAnterieures: await decore(recentesIncompletes),
    // Appels déclarés par les enseignants (sans secrétaire), pas encore
    // pointés : la secrétaire doit leur attribuer des heures.
    declaresEnAttente: (await serverDb.declares.toArray())
      .filter((d) => !d.sessionId)
      .sort((a, b) => (a.day < b.day ? 1 : -1))
      .slice(0, 100)
      .map((d) => {
        const t = refs.index.teacher.get(d.teacherId)
        return {
          id: d.id,
          teacherId: d.teacherId,
          enseignant: t ? `${t.prenom} ${t.nom}` : '—',
          matiere: refs.index.matiere.get(d.matiereId)?.nom ?? '—',
          matiereEn: refs.index.matiere.get(d.matiereId)?.nomEn ?? null,
          niveau: d.niveau,
          day: d.day,
          presents: (d.presents ?? []).length,
          declareLe: d.declaredAt,
        }
      }),
    // Fiches de paie créées (en attente / payées). Sans montant (§13.10).
    fiches: (await serverDb.fiches.toArray())
      .filter((f) => f.statut === 'en_attente' || f.statut === 'payee')
      .sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))
      .slice(0, 50)
      .map((f) => {
        const t = refs.index.teacher.get(f.teacherId)
        return {
          id: f.id,
          teacherId: f.teacherId,
          enseignant: t ? `${t.prenom} ${t.nom}` : '—',
          periode: f.periode,
          debut: f.debut ?? null,
          fin: f.fin ?? null,
          statut: f.statut,
          totalHeures: f.totalHeures,
          heuresPayees: Math.floor(f.totalHeures ?? 0),
          creeeLe: f.sentAt,
        }
      }),
    // Nom de l'établissement, pour l'en-tête de la fiche PDF (§7). Pas de
    // réglage sensible ici — ni taux, ni montant.
    parametres: { etablissement: refs.settings.etablissement },
  }
}

/* ------------------------------------------------------------------ *
 *  Chef de département — sa filière, sans aucun montant (§14)
 * ------------------------------------------------------------------ */

async function projectChef(ctx, refs) {
  const filiereIds = await filieresDuChef(ctx)
  if (!filiereIds.length) {
    return {
      filieres: [],
      enseignants: [],
      enseignantsAutres: [],
      demandesRecues: [],
      pretsAccordes: [],
      departement: null,
      semestreCourant: null,
      justifications: [],
      presences: [],
      alertes: null,
    }
  }

  // §3 : le semestre courant se déduit des dates saisies par l'administration.
  // Null tant que les dates ne sont pas réglées : on n'en masque alors aucun.
  const sem = semesterOf(new Date().toISOString(), semestresOf(refs.settings))
  const semestreCourant = sem ? (sem.id === 's2' ? 2 : 1) : null

  // Enseignant affecté à chaque matière (une matière = un enseignant).
  const enseignantParMatiere = new Map(refs.affectations.map((a) => [a.matiereId, a.teacherId]))

  const deptIds = new Set()
  const filieres = []

  for (const fid of filiereIds) {
    const f = refs.index.filiere.get(fid)
    if (!f) continue
    if (f.departementId) deptIds.add(f.departementId)

    const classes = refs.classes
      .filter((c) => c.filiereId === fid)
      .sort((a, b) => (a.niveau ?? 0) - (b.niveau ?? 0))
      .map((c) => {
        const matieres = refs.matieres
          .filter((m) => m.classeId === c.id)
          .filter((m) => semestreCourant === null || (m.semestre ?? 1) === semestreCourant)
          .map((m) => {
            const tid = enseignantParMatiere.get(m.id) ?? null
            const t = tid ? refs.index.teacher.get(tid) : null
            return {
              id: m.id,
              nom: m.nom,
              nomEn: m.nomEn ?? null,
              semestre: m.semestre ?? 1,
              teacherId: tid,
              enseignant: t ? `${t.prenom} ${t.nom}`.trim() : null,
            }
          })
          .sort((a, b) => a.nom.localeCompare(b.nom))
        return { id: c.id, niveau: c.niveau, nom: c.nom, matieres }
      })

    filieres.push({
      id: fid,
      nom: f.nom,
      sectionAnglophone: !!f.sectionAnglophone,
      classes,
    })
  }

  // Département que ce chef dirige + autorisations de partage (§13.3).
  const monDep = await departementDuChef(ctx)
  const autorisations = await serverDb.autorisations.toArray()
  const autorPourMonDep = new Map() // teacherId -> ligne (demandes de MON département)
  for (const a of autorisations) {
    if (a.departementId === monDep) autorPourMonDep.set(a.teacherId, a)
  }
  const idsAutorises = new Set(
    [...autorPourMonDep.values()].filter((a) => a.statut === 'accordee').map((a) => a.teacherId),
  )
  const nomDep = (id) => (id ? refs.index.departement.get(id)?.nom ?? null : null)

  // Enseignants affectables : ceux de son département + ceux autorisés.
  const enseignants = refs.teachers
    .filter((t) => (t.actif ?? 1))
    .filter((t) => (t.departementId && deptIds.has(t.departementId)) || idsAutorises.has(t.id))
    .map((t) => ({
      id: t.id,
      nom: `${t.prenom} ${t.nom}`.trim(),
      departement: nomDep(t.departementId),
      externe: !(t.departementId && deptIds.has(t.departementId)),
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom))

  // Enseignants des AUTRES départements, pour demander l'accès.
  const enseignantsAutres = refs.teachers
    .filter((t) => (t.actif ?? 1))
    .filter((t) => t.departementId && !deptIds.has(t.departementId))
    .map((t) => {
      const a = autorPourMonDep.get(t.id)
      return {
        id: t.id,
        nom: `${t.prenom} ${t.nom}`.trim(),
        departement: nomDep(t.departementId),
        statut: a?.statut ?? 'aucune',
        autorisationId: a?.id ?? null,
      }
    })
    .sort((a, b) => a.departement?.localeCompare(b.departement) || a.nom.localeCompare(b.nom))

  // Demandes d'accès reçues : enseignants de MON département demandés par d'autres.
  const demandesRecues = autorisations
    .filter((a) => a.statut === 'en_attente')
    .map((a) => ({ a, t: refs.index.teacher.get(a.teacherId) }))
    .filter(({ t }) => t && t.departementId === monDep)
    .sort((x, y) => (x.a.demandeAt < y.a.demandeAt ? 1 : -1))
    .map(({ a, t }) => ({
      id: a.id,
      teacherId: a.teacherId,
      enseignant: `${t.prenom} ${t.nom}`.trim(),
      departementDemandeur: nomDep(a.departementId),
      demandeLe: a.demandeAt,
    }))

  // Prêts accordés : enseignants de MON département utilisés par d'autres.
  const pretsAccordes = autorisations
    .filter((a) => a.statut === 'accordee')
    .map((a) => ({ a, t: refs.index.teacher.get(a.teacherId) }))
    .filter(({ t }) => t && t.departementId === monDep)
    .map(({ a, t }) => ({
      id: a.id,
      teacherId: a.teacherId,
      enseignant: `${t.prenom} ${t.nom}`.trim(),
      departementDemandeur: nomDep(a.departementId),
    }))

  const alertes = await alertList({ filiereIds, refs })

  return {
    filieres,
    enseignants,
    enseignantsAutres,
    demandesRecues,
    pretsAccordes,
    departement: nomDep(monDep),
    semestreCourant,
    justifications: await justificationQueue(filiereIds, refs),
    presences: await filiereAttendance(filiereIds, refs),
    alertes: {
      ...alertes,
      // §13.10 : le chef de département a le droit de voir le numéro du parent.
      etudiants: alertes.etudiants,
    },
  }
}

/* ------------------------------------------------------------------ *
 *  Administration — seul rôle à recevoir les taux et les montants
 * ------------------------------------------------------------------ */

async function projectAdmin(ctx, refs) {
  if (!canSeeMoney(ctx)) return null // ceinture et bretelles
  const settings = refs.settings

  const [jour, semaine, mois] = await Promise.all([
    adminReport({ ...periodBounds('jour'), withMoney: true, refs }),
    adminReport({ ...periodBounds('semaine'), withMoney: true, refs }),
    adminReport({ ...periodBounds('mois'), withMoney: true, refs }),
  ])
  const tout = await adminReport({ withMoney: true, refs })

  const rates = await allRates()
  // Système simple : un taux horaire par niveau, pour tous. On expose le taux
  // COURANT de chaque niveau existant.
  const jourRefTaux = dayKey()
  const niveauxExistants = [...new Set(refs.classes.map((c) => c.niveau))].sort((a, b) => a - b)
  const taux = niveauxExistants.map((n) => {
    const r = resolveRate({ rates, teacherId: null, matiereId: null, niveau: n, day: jourRefTaux })
    return { niveau: n, montant: r?.montant ?? null }
  })

  const comptes = sortBy(
    (await serverDb.users.toArray()).map((u) => ({
      id: u.id,
      login: u.login,
      nom: `${u.prenom ?? ''} ${u.nom ?? ''}`.trim(),
      roles: u.roles ?? [],
      actif: u.actif !== false,
      mustChangePassword: Boolean(u.mustChangePassword),
      createdAt: u.createdAt ?? null,
      // Jamais de passwordHash dans une projection.
    })),
    (u) => u.nom,
  )

  const alertes = await alertList({ refs })

  // Fiches de paie : en attente (montant recalculé en direct sur les séances
  // réservées) et payées (montant figé). Détail par niveau ET par matière.
  const fichesBrutes = (await serverDb.fiches.toArray())
    .filter((f) => f.statut === 'en_attente' || f.statut === 'payee')
    .sort((a, b) => {
      if (a.statut !== b.statut) return a.statut === 'en_attente' ? -1 : 1
      return a.sentAt < b.sentAt ? 1 : -1
    })
    .slice(0, 200)

  const fichesAdmin = await Promise.all(
    fichesBrutes.map(async (f) => {
      const t = refs.index.teacher.get(f.teacherId)
      const dep = t ? teacherDepartement(t, refs.index) : null

      let parNiveau
      let parMatiere
      let montant
      let incomplet
      let heuresPayees
      let tauxImpot = null
      let impot = null
      let net = null
      if (f.statut === 'payee') {
        parNiveau = f.parNiveau ?? []
        parMatiere = f.parMatiere ?? []
        montant = f.montant ?? 0
        incomplet = false
        heuresPayees = Math.floor(f.totalHeures ?? 0)
        tauxImpot = f.tauxImpot ?? 0
        impot = f.impot ?? null
        net = f.net ?? null
      } else {
        const calc = await fichePaie(f.teacherId, null, null, true, f.id, refs)
        parNiveau = calc.parNiveau
        parMatiere = calc.parMatiere
        montant = calc.montant
        incomplet = calc.montantIncomplet
        heuresPayees = calc.heuresPayees
      }

      // Taux courant par niveau (pré-remplissage de la saisie des taux).
      const jourAuj = dayKey()
      parNiveau = parNiveau.map((n) => {
        const r = resolveRate({
          rates,
          teacherId: f.teacherId,
          matiereId: null,
          niveau: n.niveau,
          day: jourAuj,
        })
        return { ...n, taux: r?.montant ?? null }
      })

      return {
        id: f.id,
        statut: f.statut,
        teacherId: f.teacherId,
        enseignant: t ? `${t.prenom} ${t.nom}` : '—',
        departement: dep?.nom ?? null,
        periode: f.periode,
        debut: f.debut ?? null,
        fin: f.fin ?? null,
        totalHeures: f.totalHeures,
        heuresPayees,
        parNiveau,
        parMatiere,
        montant,
        montantIncomplet: incomplet,
        tauxImpot,
        impot,
        net,
        etablissement: f.etablissement,
        creeePar: f.sentByLabel,
        creeeLe: f.sentAt,
        payeePar: f.paidByLabel ?? '',
        payeeLe: f.paidAt ?? null,
      }
    }),
  )

  return {
    parametres: {
      ...settings,
      manquants: missingSettings(settings),
    },
    fiches: fichesAdmin,
    tableauDeBord: {
      jour: { totaux: jour.totaux, parJour: jour.parJour },
      semaine: { totaux: semaine.totaux },
      mois: { totaux: mois.totaux },
      enCours: tout.enCours,
      incompletes: tout.incompletes,
      saisiesManuelles: tout.saisiesManuelles,
      sansTaux: tout.sansTaux,
    },
    heuresEtCouts: {
      seances: tout.seances,
      totaux: tout.totaux,
      parEnseignant: tout.parEnseignant,
      parMatiere: tout.parMatiere,
      parFiliere: tout.parFiliere,
      parNiveau: tout.parNiveau,
      parJour: tout.parJour,
    },
    referentiel: {
      departements: sortBy(
        refs.departements.map((d) => ({ id: d.id, nom: d.nom })),
        (d) => d.nom,
      ),
      filieres: sortBy(
        refs.filieres.map((f) => ({
          id: f.id,
          nom: f.nom,
          chefUserId: f.chefUserId ?? null,
          chef: f.chefUserId ? comptes.find((c) => c.id === f.chefUserId)?.nom ?? '—' : null,
          departementId: f.departementId ?? null,
          departement: f.departementId ? refs.index.departement.get(f.departementId)?.nom ?? null : null,
          sectionAnglophone: !!f.sectionAnglophone,
          classes: refs.classes.filter((c) => c.filiereId === f.id).length,
        })),
        (f) => f.nom,
      ),
      classes: sortBy(
        refs.classes.map((c) => ({
          id: c.id,
          nom: classeLabel(c, refs.index),
          filiereId: c.filiereId,
          niveau: c.niveau,
          effectif: refs.students.filter((s) => s.classeId === c.id && s.actif !== false).length,
          matieres: refs.matieres.filter((m) => m.classeId === c.id).length,
        })),
        (c) => c.nom,
      ),
      matieres: sortBy(
        refs.matieres.map((m) => ({
          id: m.id,
          nom: m.nom,
          nomEn: m.nomEn ?? null,
          classeId: m.classeId,
          classe: classeLabel(refs.index.classe.get(m.classeId), refs.index),
          enseignants: refs.affectations
            .filter((a) => a.matiereId === m.id)
            .map((a) => {
              const t = refs.index.teacher.get(a.teacherId)
              return t ? { id: t.id, nom: `${t.prenom} ${t.nom}` } : null
            })
            .filter(Boolean),
        })),
        (m) => m.nom,
      ),
      enseignants: sortBy(
        refs.teachers.map((t) => {
          const dep = teacherDepartement(t, refs.index)
          return {
            id: t.id,
            userId: t.userId,
            nom: `${t.prenom} ${t.nom}`,
            prenom: t.prenom,
            nomFamille: t.nom,
            telephone: t.telephone,
            actif: t.actif !== false,
            matieres: refs.affectations
              .filter((a) => a.teacherId === t.id)
              .map((a) => refs.index.matiere.get(a.matiereId)?.nom)
              .filter(Boolean),
            departementId: dep?.id ?? null,
            departement: dep?.nom ?? null,
          }
        }),
        (t) => t.nom,
      ),
      etudiants: sortBy(
        refs.students.map((s) => {
          const dep = classeDepartement(s.classeId, refs.index)
          return {
            id: s.id,
            matricule: s.matricule,
            nom: `${s.prenom} ${s.nom}`,
            prenom: s.prenom,
            nomFamille: s.nom,
            classeId: s.classeId,
            classe: classeLabel(refs.index.classe.get(s.classeId), refs.index),
            section: s.section ?? 'francophone',
            sectionLabel: sectionLabel(s.section ?? 'francophone'),
            // §13.10 : visible par l'administration et le chef de département.
            parentPhone: s.parentPhone,
            actif: s.actif !== false,
            departementId: dep?.id ?? null,
            departement: dep?.nom ?? null,
          }
        }),
        (s) => s.nom,
      ),
      comptes,
    },
    taux,
    alertes,
    historique: await readAudit({ limit: 300 }),
    anomalies: await readAnomalies({ limit: 200 }),
  }
}

/* ------------------------------------------------------------------ *
 *  Assemblage
 * ------------------------------------------------------------------ */

/**
 * Construit la projection complète pour un contexte. Chaque bloc n'est calculé
 * que si le rôle correspondant est présent : un enseignant ne déclenche même pas
 * le calcul des montants.
 */
export async function project(ctx) {
  const refs = await loadRefs()
  const settings = await getSettings()

  const out = {
    moi: projectMe(ctx),
    parametres: projectPublicSettings(settings),
    recuA: nowIso(),
  }

  if (hasRole(ctx, 'etudiant')) out.etudiant = await projectStudent(ctx, refs)
  if (hasRole(ctx, 'enseignant')) out.enseignant = await projectTeacher(ctx, refs)
  if (hasRole(ctx, 'secretaire')) out.secretariat = await projectSecretary(ctx, refs)
  if (hasRole(ctx, 'chef')) out.departement = await projectChef(ctx, refs)
  if (hasRole(ctx, 'administration')) out.administration = await projectAdmin(ctx, refs)

  return out
}
