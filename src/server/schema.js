/**
 * Validation par schéma — la première porte du serveur.
 *
 *  §13.1 « Injection NoSQL »        — un objet là où un texte est attendu est refusé.
 *  §13.1 « Pollution de prototype » — __proto__, constructor et prototype sont refusés.
 *  §13.1 « Expression coûteuse »    — chaque champ a une longueur maximale.
 *  §13.3 « Affectation de masse »   — seules les clefs déclarées sont lues ;
 *                                     toute clef inconnue fait échouer la requête.
 *  §13.6 « Entrées non validées »   — type, longueur, format et valeurs autorisées.
 */

import { errors } from './errors.js'

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE_RE = /^[ACDEFGHJKLMNPQRTUVWXY34679]{6}$/
const PHONE_RE = /^\d{8,15}$/
const MATRICULE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,23}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/
const SLUG_RE = /^[A-Za-z0-9_-]{1,40}$/

/** Un texte libre : on borne la longueur et on retire les caractères de contrôle. */
function cleanText(value, max) {
  return (
    String(value)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .trim()
      .slice(0, max)
  )
}

const CHECKS = {
  uuid: (v) => (typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : undefined),
  code: (v) => {
    if (typeof v !== 'string') return undefined
    const up = v.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return CODE_RE.test(up) ? up : undefined
  },
  token: (v) => (typeof v === 'string' && TOKEN_RE.test(v) ? v : undefined),
  slug: (v) => (typeof v === 'string' && SLUG_RE.test(v) ? v : undefined),
  qr: (v) => (typeof v === 'string' && v.length <= 256 ? v : undefined),
  matricule: (v) => (typeof v === 'string' && MATRICULE_RE.test(v.trim()) ? v.trim() : undefined),
  phone: (v) => {
    if (typeof v !== 'string' && typeof v !== 'number') return undefined
    const digits = String(v).replace(/\D/g, '')
    return PHONE_RE.test(digits) ? digits : undefined
  },
  iso: (v) => (typeof v === 'string' && ISO_RE.test(v) ? v : undefined),
  date: (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : undefined),
  time: (v) => (typeof v === 'string' && TIME_RE.test(v) ? v : undefined),
  bool: (v) => (typeof v === 'boolean' ? v : undefined),
  text: (v, spec) => {
    if (typeof v === 'number') return cleanText(v, spec.max ?? 200)
    if (typeof v !== 'string') return undefined // refuse objet, tableau, null
    const cleaned = cleanText(v, spec.max ?? 200)
    if (spec.min && cleaned.length < spec.min) return undefined
    return cleaned
  },
  int: (v, spec) => {
    if (typeof v === 'boolean') return undefined
    const n = Number(v)
    if (!Number.isInteger(n)) return undefined
    if (spec.min !== undefined && n < spec.min) return undefined
    if (spec.max !== undefined && n > spec.max) return undefined
    return n
  },
  number: (v, spec) => {
    if (typeof v === 'boolean') return undefined
    const n = Number(v)
    if (!Number.isFinite(n)) return undefined
    if (spec.min !== undefined && n < spec.min) return undefined
    if (spec.max !== undefined && n > spec.max) return undefined
    return n
  },
  enum: (v, spec) => (spec.values.includes(v) ? v : undefined),
  uuids: (v, spec) => {
    if (!Array.isArray(v)) return undefined
    const max = spec.max ?? 500
    if (v.length > max) return undefined
    const out = []
    for (const item of v) {
      const id = CHECKS.uuid(item)
      if (id === undefined) return undefined
      out.push(id)
    }
    return [...new Set(out)]
  },
  /**
   * Objet dont la forme dépend d'un autre champ (entité du référentiel, ligne
   * d'import). Il n'est PAS validé ici : ops.js le repasse par validate() avec
   * la forme correspondante. On borne seulement la taille et on refuse les
   * clefs dangereuses (§13.1 pollution de prototype).
   */
  raw: (v) => {
    if (!isPlainObject(v)) return undefined
    const keys = Object.keys(v)
    if (keys.length > 40) return undefined
    if (keys.some((k) => DANGEROUS_KEYS.has(k))) return undefined
    return v
  },
  rawList: (v, spec) => {
    if (!Array.isArray(v)) return undefined
    if (v.length > (spec.max ?? 5000)) return undefined
    for (const item of v) {
      if (CHECKS.raw(item) === undefined) return undefined
    }
    return v
  },
  object: (v, spec) => {
    if (!isPlainObject(v)) return undefined
    return validate(v, spec.shape, spec.label ?? 'objet')
  },
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Valide un objet contre une forme. Lève une AppError au premier écart.
 * Le résultat est un objet NEUF : rien de ce qui n'est pas déclaré ne passe.
 */
export function validate(input, shape, label = 'requête') {
  if (!isPlainObject(input)) throw errors.invalide(`${label} : format attendu.`)

  for (const key of Object.keys(input)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw errors.invalide(`${label} : clef refusée.`)
    }
    if (!Object.hasOwn(shape, key)) {
      // Affectation de masse : on refuse au lieu d'ignorer, pour que l'appel
      // fautif soit corrigé et non toléré (§13.3).
      throw errors.invalide(`${label} : champ « ${cleanText(key, 40)} » non autorisé.`)
    }
  }

  const out = Object.create(null)
  for (const [key, spec] of Object.entries(shape)) {
    const raw = Object.hasOwn(input, key) ? input[key] : undefined

    if (raw === undefined || raw === null || raw === '') {
      if (spec.required) throw errors.invalide(`${label} : « ${key} » est obligatoire.`)
      if (spec.default !== undefined) out[key] = spec.default
      else out[key] = null
      continue
    }

    const check = CHECKS[spec.type]
    if (!check) throw errors.interne()
    const value = check(raw, spec)
    if (value === undefined) {
      throw errors.invalide(`${label} : « ${key} » est invalide.`)
    }
    out[key] = value
  }

  return { ...out }
}

/* ------------------------------------------------------------------ *
 *  Rôles
 * ------------------------------------------------------------------ */

export const ROLES = ['etudiant', 'enseignant', 'secretaire', 'chef', 'administration']

export const ROLE_LABELS = {
  etudiant: 'Étudiant',
  enseignant: 'Enseignant',
  secretaire: 'Secrétaire',
  chef: 'Chef de département',
  administration: 'Administration',
}

/**
 * §13.3 « Pointage de soi-même » : le cumul secrétaire + enseignant est refusé,
 * sinon un même compte pourrait pointer ses propres heures.
 */
export const FORBIDDEN_ROLE_PAIRS = [['secretaire', 'enseignant']]

export function roleCombinationProblem(roles) {
  const set = new Set(roles)
  if (!roles.length) return 'Au moins un rôle est requis.'
  for (const role of roles) {
    if (!ROLES.includes(role)) return 'Rôle inconnu.'
  }
  for (const [a, b] of FORBIDDEN_ROLE_PAIRS) {
    if (set.has(a) && set.has(b)) {
      return `Le cumul « ${ROLE_LABELS[a]} » et « ${ROLE_LABELS[b]} » est interdit : un compte ne peut pas pointer ses propres heures.`
    }
  }
  if (set.has('etudiant') && set.size > 1) {
    return "Le rôle « Étudiant » ne se cumule avec aucun autre."
  }
  return null
}

/* ------------------------------------------------------------------ *
 *  Schémas des opérations — liste blanche des champs, par type d'action
 * ------------------------------------------------------------------ */

export const OP_SCHEMAS = {
  // --- secrétariat (§4) ---
  'secretariat.arrivee': {
    roles: ['secretaire'],
    shape: {
      teacherId: { type: 'uuid', required: true },
      matiereId: { type: 'uuid', required: true },
      // Heure de fin prévue (HH:MM), plafond des heures payées (§4).
      finPrevue: { type: 'time', required: true },
      // Niveau (1 à 8), pré-rempli depuis la classe, modifiable (§7).
      niveau: { type: 'int', required: true, min: 1, max: 6 },
      // §4 : groupe visé (francophone par défaut, anglophone si proposé).
      section: { type: 'enum', required: false, values: ['francophone', 'anglophone'] },
    },
  },
  'secretariat.depart': {
    roles: ['secretaire'],
    shape: { sessionId: { type: 'uuid', required: true } },
  },
  'secretariat.depart_manuel': {
    roles: ['secretaire'],
    shape: {
      sessionId: { type: 'uuid', required: true },
      heure: { type: 'time', required: true },
      motif: { type: 'text', required: true, min: 4, max: 300 },
    },
  },
  // Correction de la matière d'une séance en cours (secrétaire).
  'secretariat.changer_matiere': {
    roles: ['secretaire'],
    shape: {
      sessionId: { type: 'uuid', required: true },
      matiereId: { type: 'uuid', required: true },
    },
  },
  // Crée une fiche de paie sur une période ; réserve les séances (§7).
  'secretariat.creer_fiche': {
    roles: ['secretaire'],
    shape: {
      teacherId: { type: 'uuid', required: true },
      debut: { type: 'date', required: true },
      fin: { type: 'date', required: true },
    },
  },
  // Annule une fiche en attente : ses séances redeviennent disponibles.
  'secretariat.annuler_fiche': {
    roles: ['secretaire'],
    shape: {
      ficheId: { type: 'uuid', required: true },
    },
  },
  // L'administration paie une fiche : fige le montant, solde les séances (§7).
  'admin.payer_fiche': {
    roles: ['administration'],
    shape: {
      ficheId: { type: 'uuid', required: true },
      // Taux d'impôt (%), saisi par l'administration. Absent => 0.
      tauxImpot: { type: 'number', required: false, min: 0, max: 100 },
    },
  },
  // Séance saisie a posteriori (coupure, absence…). Heures seulement (§13.5).
  'secretariat.seance_anterieure': {
    roles: ['secretaire'],
    shape: {
      teacherId: { type: 'uuid', required: true },
      matiereId: { type: 'uuid', required: true },
      niveau: { type: 'int', required: true, min: 1, max: 6 },
      jour: { type: 'date', required: true },
      heureArrivee: { type: 'time', required: true },
      heureDepart: { type: 'time', required: true },
      motif: { type: 'text', required: false, max: 300 },
      section: { type: 'enum', required: false, values: ['francophone', 'anglophone'] },
    },
  },

  // --- pointage par scan, côté enseignant (§4) ---
  'pointage.scan': {
    roles: ['enseignant'],
    shape: {
      qr: { type: 'qr', required: true },
      matiereId: { type: 'uuid', required: false },
      finPrevue: { type: 'time', required: false },
      section: { type: 'enum', required: false, values: ['francophone', 'anglophone'] },
    },
  },
  // L'enseignant corrige la matière de SA séance en cours.
  'releve.changer_matiere': {
    roles: ['enseignant'],
    shape: {
      sessionId: { type: 'uuid', required: true },
      matiereId: { type: 'uuid', required: true },
    },
  },
  // Appel déclaré par l'enseignant, sans secrétaire ni code (§4).
  'releve.declarer': {
    roles: ['enseignant'],
    shape: {
      matiereId: { type: 'uuid', required: true },
      niveau: { type: 'int', required: true, min: 1, max: 6 },
      section: { type: 'enum', required: false, values: ['francophone', 'anglophone'] },
      presents: { type: 'uuids', required: false, max: 500 },
      comptePhysique: { type: 'int', required: false, min: 0, max: 500 },
    },
  },
  // Le secrétariat pointe les heures d'un appel déclaré.
  'secretariat.pointer_declare': {
    roles: ['secretaire'],
    shape: {
      declareId: { type: 'uuid', required: true },
      heureArrivee: { type: 'time', required: true },
      heureDepart: { type: 'time', required: true },
    },
  },
  // Chacun modifie son propre profil.
  'compte.profil': {
    roles: ['etudiant', 'enseignant', 'secretaire', 'chef', 'administration'],
    shape: {
      prenom: { type: 'text', required: true, min: 1, max: 50 },
      nom: { type: 'text', required: true, min: 1, max: 50 },
      telephone: { type: 'phone', required: false },
    },
  },

  // --- relevé de présences (§5) ---
  'releve.ouvrir': {
    roles: ['enseignant'],
    shape: { sessionId: { type: 'uuid', required: true } },
  },
  'releve.fermer': {
    roles: ['enseignant'],
    shape: { sessionId: { type: 'uuid', required: true } },
  },
  'releve.valider': {
    roles: ['enseignant'],
    shape: {
      sessionId: { type: 'uuid', required: false },
      matiereId: { type: 'uuid', required: true },
      code: { type: 'code', required: true },
      presents: { type: 'uuids', required: false, max: 500 },
      comptePhysique: { type: 'int', required: false, min: 0, max: 500 },
    },
  },
  'releve.corriger': {
    roles: ['enseignant', 'chef'],
    shape: {
      sessionId: { type: 'uuid', required: true },
      presents: { type: 'uuids', required: false, max: 500 },
      motif: { type: 'text', required: false, max: 300 },
    },
  },

  // --- étudiant (§5, §6) ---
  'presence.scan': {
    roles: ['etudiant'],
    shape: {
      qr: { type: 'qr', required: true },
      deviceId: { type: 'text', required: true, max: 40 },
    },
  },
  'justification.demander': {
    roles: ['etudiant'],
    shape: {
      sessionId: { type: 'uuid', required: true },
      motif: { type: 'text', required: true, min: 4, max: 500 },
      piece: {
        type: 'object',
        required: false,
        label: 'justificatif',
        shape: {
          id: { type: 'uuid', required: true },
          name: { type: 'text', required: true, max: 80 },
          type: { type: 'enum', required: true, values: ['image/jpeg', 'image/png', 'application/pdf'] },
          size: { type: 'int', required: true, min: 1, max: 5 * 1024 * 1024 },
          dataUrl: { type: 'text', required: true, max: 7_000_000 },
          exifStripped: { type: 'bool', required: false, default: false },
        },
      },
    },
  },

  // --- chef de département (§6) ---
  'justification.decider': {
    roles: ['chef'],
    shape: {
      justificationId: { type: 'uuid', required: true },
      decision: { type: 'enum', required: true, values: ['acceptee', 'refusee'] },
      commentaire: { type: 'text', required: false, max: 300 },
    },
  },
  'justification.directe': {
    roles: ['chef'],
    shape: {
      sessionId: { type: 'uuid', required: true },
      studentId: { type: 'uuid', required: true },
      commentaire: { type: 'text', required: false, max: 300 },
    },
  },
  // Le chef affecte (ou retire) un enseignant à une matière de SA filière.
  // Une matière n'a qu'un enseignant : l'affectation remplace la précédente.
  // teacherId absent => on retire.
  'departement.affecter': {
    roles: ['chef', 'administration'],
    shape: {
      matiereId: { type: 'uuid', required: true },
      teacherId: { type: 'uuid', required: false },
    },
  },
  // Le chef crée une matière dans une de SES filières, à un niveau.
  'departement.creer_matiere': {
    roles: ['chef'],
    shape: {
      filiereId: { type: 'uuid', required: true },
      niveau: { type: 'int', required: true, min: 1, max: 6 },
      nom: { type: 'text', required: true, min: 2, max: 120 },
      nomEn: { type: 'text', required: false, max: 120 },
      semestre: { type: 'int', required: false, min: 1, max: 2 },
    },
  },
  // Un chef demande à utiliser un enseignant d'un AUTRE département.
  'departement.demander_acces': {
    roles: ['chef'],
    shape: { teacherId: { type: 'uuid', required: true } },
  },
  // Le chef propriétaire accorde ou refuse la demande.
  'departement.decider_acces': {
    roles: ['chef'],
    shape: {
      autorisationId: { type: 'uuid', required: true },
      decision: { type: 'enum', required: true, values: ['accordee', 'refusee'] },
    },
  },
  // Le chef propriétaire révoque un accès déjà accordé.
  'departement.revoquer_acces': {
    roles: ['chef'],
    shape: { autorisationId: { type: 'uuid', required: true } },
  },

  // --- alerte aux parents (§8) ---
  'parent.contacter': {
    roles: ['chef', 'administration'],
    shape: { studentId: { type: 'uuid', required: true } },
  },

  // --- administration (§3, §7) ---
  'admin.referentiel': {
    roles: ['administration'],
    shape: {
      entite: {
        type: 'enum',
        required: true,
        values: ['filiere', 'classe', 'matiere', 'enseignant', 'secretaire', 'affectation', 'etudiant'],
      },
      id: { type: 'uuid', required: false },
      valeurs: { type: 'raw', required: true }, // validé contre REFERENTIEL_SHAPES dans ops.js
    },
  },
  // Taux horaire simple : un taux par niveau, pour tous (§7).
  'admin.taux': {
    roles: ['administration'],
    shape: {
      niveau: { type: 'int', required: true, min: 1, max: 6 },
      montant: { type: 'int', required: true, min: 0, max: 10_000_000 },
      dateEffet: { type: 'date', required: true },
    },
  },
  'admin.parametres': {
    roles: ['administration'],
    shape: {
      etablissement: { type: 'text', required: false, max: 120 },
      monnaie: { type: 'text', required: false, max: 12 },
      seuilAlerteHeures: { type: 'number', required: false, min: 0, max: 1000 },
      seuilAlertePeriode: { type: 'enum', required: false, values: ['mois', 'semestre'] },
      delaiReleveJours: { type: 'int', required: false, min: 1, max: 60 },
      delaiCorrectionHeures: { type: 'int', required: false, min: 1, max: 720 },
      dureeSessionHorsLigneJours: { type: 'int', required: false, min: 1, max: 30 },
      modeleMessage: { type: 'text', required: false, max: 1000 },
    },
  },
  'admin.semestres': {
    roles: ['administration'],
    shape: {
      semestres: {
        type: 'object',
        required: true,
        label: 'semestres',
        shape: {
          s1Debut: { type: 'date', required: true },
          s1Fin: { type: 'date', required: true },
          s2Debut: { type: 'date', required: true },
          s2Fin: { type: 'date', required: true },
        },
      },
    },
  },
  'admin.compte': {
    roles: ['administration'],
    shape: {
      userId: { type: 'uuid', required: true },
      actif: { type: 'bool', required: false },
      reinitialiser: { type: 'bool', required: false },
    },
  },
  'admin.import_etudiants': {
    roles: ['administration'],
    shape: {
      lignes: { type: 'rawList', required: true, max: 5000 }, // validé contre IMPORT_ROW_SHAPE dans ops.js
    },
  },
}

/** Champs acceptés par entité du référentiel — §13.3 « Affectation de masse ». */
export const REFERENTIEL_SHAPES = {
  filiere: {
    nom: { type: 'text', required: true, min: 2, max: 80 },
    chefUserId: { type: 'uuid', required: false },
    departementId: { type: 'uuid', required: false },
    // §4 : la filière propose-t-elle une section anglophone ?
    sectionAnglophone: { type: 'bool', required: false },
  },
  classe: {
    filiereId: { type: 'uuid', required: true },
    niveau: { type: 'int', required: true, min: 1, max: 6 },
  },
  matiere: {
    // Nom français (langue principale).
    nom: { type: 'text', required: true, min: 2, max: 120 },
    // Nom anglais (intitulé officiel du cursus). Absent => inchangé.
    nomEn: { type: 'text', required: false, max: 120 },
    classeId: { type: 'uuid', required: true },
    // Semestre (1 ou 2). Absent => 1 à la création, inchangé en édition.
    semestre: { type: 'int', required: false, min: 1, max: 2 },
  },
  enseignant: {
    nom: { type: 'text', required: true, min: 2, max: 60 },
    prenom: { type: 'text', required: true, min: 1, max: 60 },
    telephone: { type: 'phone', required: true },
    departementId: { type: 'uuid', required: false },
  },
  secretaire: {
    nom: { type: 'text', required: true, min: 2, max: 60 },
    prenom: { type: 'text', required: true, min: 1, max: 60 },
    telephone: { type: 'phone', required: true },
  },
  affectation: {
    teacherId: { type: 'uuid', required: true },
    matiereId: { type: 'uuid', required: true },
  },
  etudiant: {
    matricule: { type: 'matricule', required: true },
    nom: { type: 'text', required: true, min: 2, max: 60 },
    prenom: { type: 'text', required: true, min: 1, max: 60 },
    classeId: { type: 'uuid', required: true },
    // §4 : groupe linguistique de l'étudiant.
    section: { type: 'enum', required: false, values: ['francophone', 'anglophone'] },
    parentPhone: { type: 'phone', required: true },
  },
}

/** Une ligne d'import d'étudiants. */
export const IMPORT_ROW_SHAPE = {
  matricule: { type: 'matricule', required: true },
  nom: { type: 'text', required: true, min: 2, max: 60 },
  prenom: { type: 'text', required: true, min: 1, max: 60 },
  filiere: { type: 'text', required: true, min: 2, max: 80 },
  niveau: { type: 'text', required: true, max: 20 },
  // §4 : « anglophone » / « francophone » (vide = francophone).
  section: { type: 'text', required: false, max: 20 },
  /**
   * Le §3 demande le numéro du parent pour chaque étudiant, mais les listes
   * fournies par l'établissement sont incomplètes : un dossier peut arriver
   * sans numéro.
   *
   * Refuser ces lignes empêcherait les étudiants concernés de se connecter,
   * ce qui est pire que l'absence de numéro. Ils sont donc créés, et c'est
   * l'écran « Étudiants en alerte » qui porte la conséquence : sans numéro,
   * aucune alerte aux parents n'est possible, et l'administration le voit.
   * Le numéro reste modifiable par l'administration seulement (§13.9).
   */
  parent: { type: 'phone', required: false },
}

/**
 * Le champ `role` n'apparaît dans aucun schéma hors `admin.*` : un compte ne
 * peut donc pas s'attribuer un rôle (§13.3 « Élévation de rôle »).
 */
export const CONNEXION_SHAPE = {
  identifiant: { type: 'text', required: true, min: 3, max: 40 },
  motDePasse: { type: 'text', required: true, min: 1, max: 128 },
  deviceId: { type: 'text', required: true, max: 40 },
}

export const CHANGE_PASSWORD_SHAPE = {
  actuel: { type: 'text', required: true, min: 1, max: 128 },
  nouveau: { type: 'text', required: true, min: 8, max: 128 },
}
