/**
 * Tous les calculs de lecture : heures, absences, coûts, alertes.
 *
 * §13.8 « Sécurité calculée côté client » : rien de ceci n'est recalculé dans un
 * écran. Les composants affichent ce que ce module a produit.
 *
 * Ce module ne vérifie AUCUN droit : il est appelé exclusivement par
 * projection.js, qui a déjà filtré le périmètre, et les montants ne sont joints
 * que derrière `assertCanSeeMoney`.
 */

import { serverDb } from './db.js'
import { getSettings, semestresOf } from './settings.js'
import {
  computeStatus,
  paidHours,
  unpaidGapHours,
  overrunUnpaidHours,
  missingParts,
  SESSION_STATES,
} from './rules.js'
import { sessionCost, resolveRate, allRates } from './rates.js'
import { dayKey, monthKey, semesterOf, startOfWeek, startOfMonth, startOfDay } from '../lib/dates.js'
import { groupBy, sum, sortBy } from '../lib/utils.js'

/* ------------------------------------------------------------------ *
 *  Socle commun
 * ------------------------------------------------------------------ */

/** Charge le référentiel une fois, pour éviter les lectures en boucle. */
export async function loadRefs() {
  const [filieres, classes, matieres, teachers, students, affectations, departements, settings] =
    await Promise.all([
      serverDb.filieres.toArray(),
      serverDb.classes.toArray(),
      serverDb.matieres.toArray(),
      serverDb.teachers.toArray(),
      serverDb.students.toArray(),
      serverDb.affectations.toArray(),
      serverDb.departements.toArray(),
      getSettings(),
    ])
  const index = {
    filiere: new Map(filieres.map((f) => [f.id, f])),
    classe: new Map(classes.map((c) => [c.id, c])),
    matiere: new Map(matieres.map((m) => [m.id, m])),
    teacher: new Map(teachers.map((t) => [t.id, t])),
    student: new Map(students.map((s) => [s.id, s])),
    departement: new Map(departements.map((d) => [d.id, d])),
  }
  return {
    filieres,
    classes,
    matieres,
    teachers,
    students,
    affectations,
    departements,
    settings,
    index,
  }
}

/** Département d'un enseignant (rattachement direct). */
export function teacherDepartement(teacher, index) {
  const id = teacher?.departementId ?? null
  if (!id) return null
  const d = index.departement.get(id)
  return d ? { id: d.id, nom: d.nom } : null
}

/** Département d'une classe via sa filière (pour les étudiants). */
export function classeDepartement(classeId, index) {
  const classe = classeId ? index.classe.get(classeId) : null
  const filiere = classe ? index.filiere.get(classe.filiereId) : null
  const id = filiere?.departementId ?? null
  if (!id) return null
  const d = index.departement.get(id)
  return d ? { id: d.id, nom: d.nom } : null
}

/** Libellé lisible d'une classe. */
export function classeLabel(classe, index) {
  if (!classe) return '—'
  const filiere = index.filiere.get(classe.filiereId)
  return `${filiere?.nom ?? 'Filière'} · niveau ${classe.niveau}`
}

/**
 * Nom d'affichage d'une matière selon la section (§4).
 * La section anglophone affiche le nom anglais (repli sur le français si
 * l'intitulé anglais n'a pas été saisi).
 */
export function matiereLabel(matiere, section) {
  if (!matiere) return '—'
  if ((section ?? 'francophone') === 'anglophone' && matiere.nomEn) {
    return matiere.nomEn
  }
  return matiere.nom
}

/** Libellé lisible d'une section. */
export function sectionLabel(section) {
  return (section ?? 'francophone') === 'anglophone' ? 'Anglophone' : 'Francophone'
}

/**
 * Présents retenus pour une séance (§9 règle 3 : la liste de l'enseignant
 * l'emporte sur les scans).
 */
export async function presentIdsOf(session) {
  if (session.roll?.codeOk && session.roll?.validatedAt) {
    return new Set(session.roll.presents ?? [])
  }
  const scans = await serverDb.attendance.where('sessionId').equals(session.id).toArray()
  return new Set(scans.filter((s) => s.status === 'present').map((s) => s.studentId))
}

/** Séance enrichie des informations dérivées, sans aucun montant. */
export async function decorateSession(session, refs) {
  const matiere = refs.index.matiere.get(session.matiereId)
  const classe = refs.index.classe.get(session.classeId)
  const teacher = refs.index.teacher.get(session.teacherId)
  const section = session.section ?? 'francophone'
  const scans = await serverDb.attendance.where('sessionId').equals(session.id).toArray()
  const scansPresents = scans.filter((s) => s.status === 'present')
  const presents = await presentIdsOf(session)
  // Effectif de la séance : seuls les étudiants de SA section (§4).
  const effectif = refs.students.filter(
    (s) => s.classeId === session.classeId && (s.section ?? 'francophone') === section && s.actif !== false,
  ).length

  return {
    id: session.id,
    day: session.day,
    status: computeStatus(session),
    manque: missingParts(session),
    matiereId: session.matiereId,
    matiere: matiereLabel(matiere, section),
    matiereEn: matiere?.nomEn ?? null,
    section,
    sectionLabel: sectionLabel(section),
    classeId: session.classeId,
    classe: classeLabel(classe, refs.index),
    niveau: session.niveau,
    filiereId: classe?.filiereId ?? null,
    teacherId: session.teacherId,
    enseignant: teacher ? `${teacher.prenom} ${teacher.nom}` : '—',
    arrivalAt: session.arrivalAt,
    departureAt: session.departureAt,
    plannedEndAt: session.plannedEndAt ?? null,
    releveAt: session.roll?.validatedAt ?? null,
    codeOk: Boolean(session.roll?.codeOk),
    heuresPayees: paidHours(session),
    ecartNonPaye: unpaidGapHours(session),
    depassementNonPaye: overrunUnpaidHours(session),
    departManuel: session.departureManual
      ? { motif: session.departureManual.motif, par: session.departureManual.byLabel, at: session.departureManual.at }
      : null,
    arrivalVia: session.arrivalVia,
    departureVia: session.departureVia ?? null,
    declareEnseignant: Boolean(session.declareEnseignant),
    saisieAnterieure: Boolean(session.saisieAnterieure),
    rollOpenedAt: session.rollOpenedAt,
    rollClosedAt: session.rollClosedAt,
    notifiee: Boolean(session.notifiee),
    presentsCount: presents.size,
    scansCount: scansPresents.length,
    comptePhysique: session.roll?.comptePhysique ?? null,
    effectif,
  }
}

/* ------------------------------------------------------------------ *
 *  Absences (§6)
 * ------------------------------------------------------------------ */

/**
 * Absences d'un étudiant, séance par séance, avec l'état de justification.
 * Seules les séances « terminées » produisent des absences (§6).
 */
export async function studentAbsences(studentId, refs = null) {
  const data = refs ?? (await loadRefs())
  const student = data.index.student.get(studentId) ?? (await serverDb.students.get(studentId))
  if (!student) return { absences: [], seances: [] }

  // §4 : l'étudiant ne voit que les séances de SA section.
  const section = student.section ?? 'francophone'
  const toutesSessions = await serverDb.sessions.where('classeId').equals(student.classeId).toArray()
  const sessions = toutesSessions.filter((s) => (s.section ?? 'francophone') === section)
  const justifications = await serverDb.justifications.where('studentId').equals(studentId).toArray()
  const justifBySession = new Map(justifications.map((j) => [j.sessionId, j]))

  const absences = []
  const seances = []

  for (const session of sortBy(sessions, (s) => s.arrivalAt, 'desc')) {
    // Séance saisie a posteriori : heures de l'enseignant seulement, aucune
    // présence/absence d'étudiant (aucun relevé n'a été fait).
    if (session.saisieAnterieure) continue

    const status = computeStatus(session)
    const presents = await presentIdsOf(session)
    const present = presents.has(studentId)
    const matiere = data.index.matiere.get(session.matiereId)
    const scan = await serverDb.attendance.get([session.id, studentId])

    const ligne = {
      sessionId: session.id,
      day: session.day,
      arrivalAt: session.arrivalAt,
      matiere: matiereLabel(matiere, section),
      matiereEn: matiere?.nomEn ?? null,
      matiereId: session.matiereId,
      statutSeance: status,
      heures: paidHours(session),
      presence: present ? 'present' : status === SESSION_STATES.TERMINEE ? 'absent' : 'en_attente',
      scanStatus: scan?.status ?? null,
    }
    seances.push(ligne)

    if (status === SESSION_STATES.TERMINEE && !present) {
      const justif = justifBySession.get(session.id)
      absences.push({
        ...ligne,
        justification: justif
          ? {
              id: justif.id,
              state: justif.state,
              motif: justif.motif,
              commentaire: justif.commentaire,
              decidedAt: justif.decidedAt,
              decidedByLabel: justif.decidedByLabel ?? null,
            }
          : null,
        etat: justif ? justif.state : 'non_justifiee',
      })
    }
  }

  return { absences, seances, student }
}

/**
 * Totaux d'absence d'un étudiant. Les heures justifiées sont comptées à part
 * (§6) et sortent du calcul du seuil d'alerte.
 */
export async function absenceTotals({ studentId, semestreId = null, refs = null }) {
  const data = refs ?? (await loadRefs())
  const semestres = semestresOf(data.settings)
  const { absences } = await studentAbsences(studentId, data)

  const cible = semestreId
    ? semestres.find((s) => s.id === semestreId)
    : semesterOf(new Date().toISOString(), semestres)

  const retenues = cible
    ? absences.filter((a) => semesterOf(a.arrivalAt, semestres)?.id === cible.id)
    : absences

  const justifiees = retenues.filter((a) => a.etat === 'acceptee')
  const nonJustifiees = retenues.filter((a) => a.etat !== 'acceptee')

  const parMatiere = [...groupBy(retenues, (a) => a.matiereId).entries()].map(([matiereId, lignes]) => ({
    matiereId,
    matiere: lignes[0].matiere,
    matiereEn: lignes[0].matiereEn ?? null,
    nonJustifiees: sum(lignes.filter((l) => l.etat !== 'acceptee'), (l) => l.heures),
    justifiees: sum(lignes.filter((l) => l.etat === 'acceptee'), (l) => l.heures),
    seances: lignes.length,
  }))

  return {
    semestre: cible ? { id: cible.id, nom: cible.nom } : null,
    periodeLabel: cible?.nom ?? 'année en cours',
    nonJustifiees: sum(nonJustifiees, (a) => a.heures),
    justifiees: sum(justifiees, (a) => a.heures),
    enAttente: sum(retenues.filter((a) => a.etat === 'en_attente'), (a) => a.heures),
    parMatiere: sortBy(parMatiere, (m) => -m.nonJustifiees),
    absences: retenues,
  }
}

/* ------------------------------------------------------------------ *
 *  Heures de l'enseignant (§7) — sans aucun montant
 * ------------------------------------------------------------------ */

export async function teacherHours(teacherId, refs = null) {
  const data = refs ?? (await loadRefs())
  const sessions = await serverDb.sessions.where('teacherId').equals(teacherId).toArray()
  const semestres = semestresOf(data.settings)

  const lignes = []
  for (const session of sortBy(sessions, (s) => s.arrivalAt, 'desc')) {
    lignes.push(await decorateSession(session, data))
  }

  const terminees = lignes.filter((l) => l.status === SESSION_STATES.TERMINEE)

  // §4 : on sépare les sections — une même matière enseignée en francophone
  // et en anglophone donne deux lignes (noms FR / EN).
  const parMatiere = [...groupBy(terminees, (l) => `${l.matiereId}|${l.section ?? 'francophone'}`).entries()].map(
    ([, rows]) => ({
      matiereId: rows[0].matiereId,
      matiere: rows[0].matiere,
      matiereEn: rows[0].matiereEn ?? null,
      section: rows[0].section ?? 'francophone',
      classe: rows[0].classe,
      heures: sum(rows, (r) => r.heuresPayees),
      seances: rows.length,
    }),
  )

  // Ventilation par niveau — base de la fiche récapitulative (§7).
  const parNiveau = [...groupBy(terminees, (l) => l.niveau).entries()]
    .map(([niveau, rows]) => ({
      niveau: Number(niveau),
      heures: sum(rows, (r) => r.heuresPayees),
      seances: rows.length,
    }))
    .sort((a, b) => a.niveau - b.niveau)

  const parJour = [...groupBy(terminees, (l) => l.day).entries()]
    .map(([day, rows]) => ({ day, heures: sum(rows, (r) => r.heuresPayees), seances: rows.length }))
    .sort((a, b) => (a.day < b.day ? 1 : -1))

  const parMois = [...groupBy(terminees, (l) => monthKey(l.arrivalAt)).entries()]
    .map(([mois, rows]) => ({ mois, heures: sum(rows, (r) => r.heuresPayees), seances: rows.length }))
    .sort((a, b) => (a.mois < b.mois ? 1 : -1))

  const parSemestre = semestres.map((s) => {
    const rows = terminees.filter((l) => semesterOf(l.arrivalAt, semestres)?.id === s.id)
    return { id: s.id, nom: s.nom, heures: sum(rows, (r) => r.heuresPayees), seances: rows.length }
  })

  return {
    seances: lignes,
    totalHeures: sum(terminees, (l) => l.heuresPayees),
    totalEcartNonPaye: sum(lignes, (l) => l.ecartNonPaye),
    totalDepassement: sum(lignes, (l) => l.depassementNonPaye ?? 0),
    incompletes: lignes.filter((l) => l.status === SESSION_STATES.INCOMPLETE),
    enCours: lignes.filter((l) => l.status === SESSION_STATES.EN_COURS),
    parMatiere: sortBy(parMatiere, (m) => -m.heures),
    parNiveau,
    parJour,
    parMois,
    parSemestre,
  }
}

/* ------------------------------------------------------------------ *
 *  Fiche de paie sur une période (§7)
 * ------------------------------------------------------------------ */

/** Libellé lisible d'une période de paie. */
export function libellePeriode(debut, fin) {
  const fmt = (x) => {
    if (!x) return '…'
    const [y, m, d] = String(x).slice(0, 10).split('-')
    return `${d}/${m}/${y}`
  }
  if (!debut && !fin) return 'Depuis le début'
  return `${fmt(debut)} → ${fmt(fin)}`
}

/**
 * Heures (et montant si demandé) d'un enseignant sur une PÉRIODE, ventilées par
 * niveau ET par matière. Ne compte que les séances terminées non encore portées
 * par une fiche (`ficheId` vide) : pas de double paiement. Si `ficheId` est
 * fourni, on compte au contraire les séances DE cette fiche (bornes ignorées).
 */
export async function fichePaie(teacherId, debut, fin, avecMontant = false, ficheId = null, refs = null) {
  refs = refs ?? (await loadRefs())
  const d = debut ? String(debut).slice(0, 10) : null
  const f = fin ? String(fin).slice(0, 10) : null

  let sessions = await serverDb.sessions.where('teacherId').equals(teacherId).toArray()
  sessions = sessions.filter((s) => computeStatus(s) === SESSION_STATES.TERMINEE)
  if (ficheId !== null) {
    sessions = sessions.filter((s) => s.ficheId === ficheId)
  } else {
    sessions = sessions.filter((s) => !s.ficheId)
    if (d) sessions = sessions.filter((s) => String(s.day ?? '') >= d)
    if (f) sessions = sessions.filter((s) => String(s.day ?? '') <= f)
  }
  sessions.sort((a, b) => String(a.day ?? '').localeCompare(String(b.day ?? '')))

  const rates = avecMontant ? await allRates() : []
  // Une fiche de paie se calcule au TAUX COURANT : le taux est résolu à la date
  // du jour, pour toute la fiche, pas au taux historique séance par séance (§7).
  const jourRef = dayKey()
  const parNiveau = new Map()
  const parMatiere = new Map()
  const seanceIds = []
  let totalHeures = 0
  let totalMontant = 0
  let incomplet = false

  for (const s of sessions) {
    const dec = await decorateSession(s, refs)
    const h = Number(dec.heuresPayees) || 0
    seanceIds.push(s.id)
    totalHeures += h

    let montantSeance = null
    if (avecMontant) {
      const resolu = resolveRate({
        rates,
        teacherId: s.teacherId,
        matiereId: s.matiereId,
        niveau: s.niveau,
        day: jourRef,
      })
      montantSeance = resolu ? Math.round(h * resolu.montant) : null
      if (montantSeance === null) incomplet = true
      else totalMontant += montantSeance
    }

    const kn = String(Number(dec.niveau))
    if (!parNiveau.has(kn)) {
      parNiveau.set(kn, {
        niveau: Number(dec.niveau), heures: 0, seances: 0,
        montant: avecMontant ? 0 : null, montantIncomplet: false,
      })
    }
    const gn = parNiveau.get(kn)
    gn.heures += h
    gn.seances += 1

    const sec = dec.section ?? 'francophone'
    const km = `${dec.matiereId}@${Number(dec.niveau)}@${sec}`
    if (!parMatiere.has(km)) {
      parMatiere.set(km, {
        matiereId: dec.matiereId, matiere: dec.matiere, matiereEn: dec.matiereEn ?? null,
        section: sec,
        niveau: Number(dec.niveau), heures: 0, seances: 0,
        montant: avecMontant ? 0 : null, montantIncomplet: false,
      })
    }
    const gm = parMatiere.get(km)
    gm.heures += h
    gm.seances += 1

    if (avecMontant) {
      for (const g of [gn, gm]) {
        if (montantSeance === null) g.montantIncomplet = true
        else g.montant += montantSeance
      }
    }
  }

  const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
  const parNiveauArr = [...parNiveau.values()]
    .map((n) => ({ ...n, heures: round2(n.heures) }))
    .sort((a, b) => a.niveau - b.niveau)
  const parMatiereArr = [...parMatiere.values()]
    .map((m) => ({ ...m, heures: round2(m.heures) }))
    .sort((a, b) => a.niveau - b.niveau || String(a.matiere).localeCompare(String(b.matiere)))

  // Les minutes ne comptent pas : heures PAYÉES = total de la fiche arrondi à
  // l'heure inférieure (6 h 07 → 6 h). Le brut est ramené à ces heures entières.
  const heuresPayees = Math.floor(totalHeures)
  const brut = avecMontant ? (totalHeures > 0 ? Math.round(totalMontant * (heuresPayees / totalHeures)) : 0) : null

  return {
    debut: d,
    fin: f,
    periode: libellePeriode(d, f),
    totalHeures: round2(totalHeures),
    heuresPayees,
    totalSeances: seanceIds.length,
    seanceIds,
    parNiveau: parNiveauArr,
    parMatiere: parMatiereArr,
    montant: brut,
    montantIncomplet: avecMontant ? incomplet : false,
  }
}

/* ------------------------------------------------------------------ *
 *  Heures et coûts pour l'administration (§7)
 * ------------------------------------------------------------------ */

/**
 * Agrégat administratif. Les montants ne sont joints que si `withMoney` est
 * vrai, et seul projection.js le passe à vrai, après `assertCanSeeMoney`.
 */
export async function adminReport({ from = null, to = null, withMoney = false, refs = null } = {}) {
  const data = refs ?? (await loadRefs())
  const rates = withMoney ? await allRates() : []
  const sessions = await serverDb.sessions.toArray()

  const dansPeriode = sessions.filter((s) => {
    if (from && s.day < from) return false
    if (to && s.day > to) return false
    return true
  })

  const lignes = []
  for (const session of sortBy(dansPeriode, (s) => s.arrivalAt, 'desc')) {
    const base = await decorateSession(session, data)
    if (withMoney) {
      const cost = sessionCost(session, rates)
      lignes.push({ ...base, montant: cost.montant, taux: cost.taux, coutRaison: cost.raison })
    } else {
      lignes.push(base)
    }
  }

  const terminees = lignes.filter((l) => l.status === SESSION_STATES.TERMINEE)
  const sansTaux = withMoney ? terminees.filter((l) => l.coutRaison === 'aucun_taux') : []

  const agrege = (clef, libelle) =>
    [...groupBy(terminees, clef).entries()].map(([key, rows]) => ({
      key,
      libelle: libelle(rows[0]),
      heures: sum(rows, (r) => r.heuresPayees),
      seances: rows.length,
      montant: withMoney ? sum(rows, (r) => r.montant ?? 0) : null,
      montantIncomplet: withMoney ? rows.some((r) => r.montant === null) : false,
    }))

  return {
    seances: lignes,
    enCours: lignes.filter((l) => l.status === SESSION_STATES.EN_COURS),
    incompletes: lignes.filter((l) => l.status === SESSION_STATES.INCOMPLETE),
    saisiesManuelles: lignes.filter((l) => l.departManuel),
    totaux: {
      heures: sum(terminees, (l) => l.heuresPayees),
      seances: terminees.length,
      montant: withMoney ? sum(terminees, (l) => l.montant ?? 0) : null,
      montantIncomplet: withMoney && sansTaux.length > 0,
    },
    sansTaux,
    parEnseignant: sortBy(agrege((l) => l.teacherId, (r) => r.enseignant), (r) => -r.heures),
    parMatiere: sortBy(agrege((l) => l.matiereId, (r) => r.matiere), (r) => -r.heures),
    parFiliere: sortBy(agrege((l) => l.filiereId, (r) => r.classe.split(' · ')[0]), (r) => -r.heures),
    parNiveau: sortBy(agrege((l) => l.niveau, (r) => `Niveau ${r.niveau}`), (r) => -r.heures),
    parJour: [...groupBy(terminees, (l) => l.day).entries()]
      .map(([day, rows]) => ({
        day,
        heures: sum(rows, (r) => r.heuresPayees),
        seances: rows.length,
        montant: withMoney ? sum(rows, (r) => r.montant ?? 0) : null,
      }))
      .sort((a, b) => (a.day < b.day ? 1 : -1)),
  }
}

/** Raccourcis de période pour le tableau de bord. */
export function periodBounds(kind, now = new Date()) {
  if (kind === 'jour') return { from: dayKey(startOfDay(now)), to: dayKey(now) }
  if (kind === 'semaine') return { from: dayKey(startOfWeek(now)), to: dayKey(now) }
  if (kind === 'mois') return { from: dayKey(startOfMonth(now)), to: dayKey(now) }
  return { from: null, to: null }
}

/* ------------------------------------------------------------------ *
 *  Étudiants en alerte (§8)
 * ------------------------------------------------------------------ */

/**
 * Liste d'alerte. Tant que l'administration n'a pas fixé de seuil, la liste est
 * vide et `seuilDefini` vaut faux : l'écran le dit au lieu d'inventer un chiffre
 * (§14).
 */
export async function alertList({ filiereIds = null, refs = null } = {}) {
  const data = refs ?? (await loadRefs())
  const seuil = data.settings.seuilAlerteHeures
  if (seuil === null || seuil === undefined) {
    return { seuilDefini: false, seuil: null, periode: data.settings.seuilAlertePeriode, etudiants: [] }
  }

  const contacts = await serverDb.parentContacts.toArray()
  const dernierContact = new Map()
  for (const contact of sortBy(contacts, (c) => c.at)) {
    dernierContact.set(contact.studentId, contact)
  }

  const etudiants = []
  for (const student of data.students) {
    if (student.actif === false) continue
    const classe = data.index.classe.get(student.classeId)
    if (filiereIds && !filiereIds.includes(classe?.filiereId)) continue

    const totals = await absenceTotals({ studentId: student.id, refs: data })
    if (totals.nonJustifiees < seuil) continue

    const contact = dernierContact.get(student.id)
    etudiants.push({
      studentId: student.id,
      matricule: student.matricule,
      nom: `${student.prenom} ${student.nom}`,
      classe: classeLabel(classe, data.index),
      filiereId: classe?.filiereId ?? null,
      heuresNonJustifiees: totals.nonJustifiees,
      periode: totals.periodeLabel,
      // §13.10 : le numéro n'est joint que pour les rôles autorisés, et c'est
      // projection.js qui en décide.
      parentPhone: student.parentPhone,
      dernierContactAt: contact?.at ?? null,
      dernierContactPar: contact?.byLabel ?? null,
    })
  }

  return {
    seuilDefini: true,
    seuil,
    periode: data.settings.seuilAlertePeriode,
    etudiants: sortBy(etudiants, (e) => -e.heuresNonJustifiees),
  }
}

/* ------------------------------------------------------------------ *
 *  Présences d'une filière (chef de département)
 * ------------------------------------------------------------------ */

export async function filiereAttendance(filiereIds, refs = null) {
  const data = refs ?? (await loadRefs())
  const classes = data.classes.filter((c) => filiereIds.includes(c.filiereId))

  const parClasse = []
  for (const classe of sortBy(classes, (c) => c.niveau)) {
    const eleves = data.students.filter((s) => s.classeId === classe.id && s.actif !== false)
    const lignes = []
    for (const eleve of sortBy(eleves, (s) => `${s.nom} ${s.prenom}`)) {
      const totals = await absenceTotals({ studentId: eleve.id, refs: data })
      lignes.push({
        studentId: eleve.id,
        matricule: eleve.matricule,
        nom: `${eleve.prenom} ${eleve.nom}`,
        section: eleve.section ?? 'francophone',
        sectionLabel: sectionLabel(eleve.section ?? 'francophone'),
        nonJustifiees: totals.nonJustifiees,
        justifiees: totals.justifiees,
        enAttente: totals.enAttente,
      })
    }
    parClasse.push({
      classeId: classe.id,
      classe: classeLabel(classe, data.index),
      niveau: classe.niveau,
      effectif: eleves.length,
      etudiants: lignes,
      totalNonJustifiees: sum(lignes, (l) => l.nonJustifiees),
    })
  }
  return parClasse
}

/** File des justifications à traiter, pour le chef de département. */
export async function justificationQueue(filiereIds, refs = null) {
  const data = refs ?? (await loadRefs())
  const rows = await serverDb.justifications.toArray()
  const retenues = rows.filter((j) => filiereIds.includes(j.filiereId))

  const out = []
  for (const justif of sortBy(retenues, (j) => j.createdAt, 'desc')) {
    const session = await serverDb.sessions.get(justif.sessionId)
    const student = data.index.student.get(justif.studentId)
    const matiere = session ? data.index.matiere.get(session.matiereId) : null
    const classe = student ? data.index.classe.get(student.classeId) : null
    out.push({
      id: justif.id,
      state: justif.state,
      motif: justif.motif,
      commentaire: justif.commentaire,
      createdAt: justif.createdAt,
      decidedAt: justif.decidedAt,
      decidedByLabel: justif.decidedByLabel ?? null,
      directe: Boolean(justif.directe),
      piece: justif.piece
        ? { id: justif.piece.id, name: justif.piece.name, type: justif.piece.type, dataUrl: justif.piece.dataUrl, exifStripped: justif.piece.exifStripped }
        : null,
      studentId: justif.studentId,
      etudiant: student ? `${student.prenom} ${student.nom}` : '—',
      matricule: student?.matricule ?? '—',
      classe: classeLabel(classe, data.index),
      sessionId: justif.sessionId,
      matiere: matiereLabel(matiere, session?.section ?? 'francophone'),
      matiereEn: matiere?.nomEn ?? null,
      seanceDu: session?.arrivalAt ?? null,
      heures: session ? paidHours(session) : 0,
    })
  }
  return out
}
