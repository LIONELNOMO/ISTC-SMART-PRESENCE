/**
 * Tests des règles de calcul et des protections, calqués sur les critères de
 * validation du §12 et sur la section Sécurité (§13).
 *
 *   node --test tests/
 *
 * Ne sont testés ici que les modules purs : ils ne touchent ni IndexedDB ni le
 * DOM. Les écrans et la file d'attente se vérifient dans le navigateur, avec le
 * mode avion de l'application.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeStatus,
  paidHours,
  unpaidGapHours,
  checkTimesPlausible,
  hasOpenSession,
  scanWindowProblem,
  compareCounts,
  effectivePresent,
  absencesOf,
  missingParts,
  SESSION_STATES,
} from '../src/server/rules.js'
import { resolveRate, sessionCost } from '../src/server/rates.js'
import { hoursBetween, dayKey, semesterOf, timeOnDayToIso } from '../src/lib/dates.js'
import {
  buildWhatsAppLink,
  normalizePhone,
  renderTemplate,
  DEFAULT_TEMPLATE,
} from '../src/lib/whatsapp.js'
import { neutralizeCell, sanitizeImportedCell, parseCsv, toCsv } from '../src/lib/tabular.js'
import {
  buildPointageQr,
  verifyPointageQr,
  parsePointageQr,
  parsePresenceQr,
  buildPresenceQr,
  normalizeSessionCode,
  isSessionCodeShape,
  currentSlot,
  looksLikeUrl,
} from '../src/lib/qr-codes.js'
import {
  randomCode,
  randomId,
  constantTimeEqual,
  hashPassword,
  verifyPassword,
  passwordProblem,
  newHmacSecret,
} from '../src/lib/crypto.js'
import { safeRedirect, isAllowedExternalUrl } from '../src/lib/safe-redirect.js'
import { roleCombinationProblem, validate } from '../src/server/schema.js'

/* ------------------------------------------------------------------ *
 *  Fabriques
 * ------------------------------------------------------------------ */

const JOUR = '2026-10-08'

function seance(options = {}) {
  const arrivee = options.arrivalAt ?? `${JOUR}T10:00:00.000Z`
  return {
    id: 'seance-1',
    teacherId: 'ens-1',
    matiereId: 'mat-1',
    classeId: 'cls-1',
    niveau: 1,
    day: dayKey(arrivee),
    arrivalAt: arrivee,
    departureAt: options.departureAt ?? null,
    roll: options.roll ?? null,
    rollOpenedAt: options.rollOpenedAt ?? null,
    rollClosedAt: options.rollClosedAt ?? null,
    ...options,
  }
}

function releveValide(validatedAt, presents = []) {
  return { validatedAt, codeOk: true, presents }
}

/* ================================================================== *
 *  §4 — États d'une séance et heures payées
 * ================================================================== */

test('§12 — arrivée 10 h, départ 16 h, relevé 17 h : 6 heures payées', () => {
  const s = seance({
    arrivalAt: `${JOUR}T10:00:00.000Z`,
    departureAt: `${JOUR}T16:00:00.000Z`,
    roll: releveValide(`${JOUR}T17:00:00.000Z`),
  })
  assert.equal(computeStatus(s), SESSION_STATES.TERMINEE)
  assert.equal(paidHours(s), 6)
  // L'heure du relevé n'allonge jamais la durée payée, mais l'écart est visible.
  assert.equal(unpaidGapHours(s), 1)
})

test('§12 — une séance sans départ pointé n’ajoute aucune heure', () => {
  const s = seance({ roll: releveValide(`${JOUR}T12:00:00.000Z`) })
  assert.equal(computeStatus(s), SESSION_STATES.INCOMPLETE)
  assert.equal(paidHours(s), 0)
  assert.deepEqual(missingParts(s), ['départ'])
})

test('§12 — un relevé validé avec un code faux laisse la séance incomplète', () => {
  const s = seance({
    departureAt: `${JOUR}T12:00:00.000Z`,
    roll: { validatedAt: `${JOUR}T12:05:00.000Z`, codeOk: false, presents: ['e1'] },
  })
  assert.equal(computeStatus(s), SESSION_STATES.INCOMPLETE)
  assert.equal(paidHours(s), 0)
  assert.ok(missingParts(s).includes('code de séance correct'))
})

test('une séance dont l’arrivée est pointée mais rien d’autre est « en cours »', () => {
  assert.equal(computeStatus(seance()), SESSION_STATES.EN_COURS)
})

test('les heures sont comptées à la minute près', () => {
  const s = seance({
    arrivalAt: `${JOUR}T08:07:00.000Z`,
    departureAt: `${JOUR}T10:22:00.000Z`,
    roll: releveValide(`${JOUR}T10:25:00.000Z`),
  })
  assert.equal(paidHours(s), 135 / 60)
  assert.equal(hoursBetween(s.arrivalAt, s.departureAt), 2.25)
})

/* ================================================================== *
 *  §13.4 — Durées impossibles
 * ================================================================== */

test('§13.4 — un départ antérieur à l’arrivée est refusé', () => {
  const probleme = checkTimesPlausible({
    arrivalAt: `${JOUR}T16:00:00.000Z`,
    departureAt: `${JOUR}T10:00:00.000Z`,
  })
  assert.match(probleme, /précéder/)
})

test('§13.4 — une séance de plus de 12 heures est refusée', () => {
  const probleme = checkTimesPlausible({
    arrivalAt: `${JOUR}T06:00:00.000Z`,
    departureAt: `${JOUR}T23:00:00.000Z`,
  })
  assert.ok(probleme)
})

test('§4 — un enseignant n’a qu’une séance ouverte à la fois', () => {
  const sessions = [seance({ id: 'a' }), seance({ id: 'b', departureAt: `${JOUR}T12:00:00.000Z` })]
  assert.equal(hasOpenSession(sessions, 'ens-1'), true)
  assert.equal(hasOpenSession([sessions[1]], 'ens-1'), false)
})

/* ================================================================== *
 *  §5 — Relevé, scans et écarts
 * ================================================================== */

test('§5 — un scan hors de la fenêtre du relevé est refusé, avec 5 min de tolérance', () => {
  const s = seance({
    rollOpenedAt: `${JOUR}T10:00:00.000Z`,
    rollClosedAt: `${JOUR}T11:00:00.000Z`,
  })
  const tolerance = 5 * 60_000

  assert.equal(scanWindowProblem(s, { receivedAt: `${JOUR}T10:30:00.000Z`, toleranceMs: tolerance }), null)
  // 3 minutes avant l'ouverture : accepté grâce à la tolérance d'horloge
  assert.equal(scanWindowProblem(s, { receivedAt: `${JOUR}T09:57:00.000Z`, toleranceMs: tolerance }), null)
  // 10 minutes avant : refusé
  assert.ok(scanWindowProblem(s, { receivedAt: `${JOUR}T09:50:00.000Z`, toleranceMs: tolerance }))
  // 10 minutes après la fermeture : refusé
  assert.ok(scanWindowProblem(s, { receivedAt: `${JOUR}T11:10:00.000Z`, toleranceMs: tolerance }))
})

test('§9 règle 3 — la liste cochée par l’enseignant l’emporte sur le scan', () => {
  const s = seance({ roll: releveValide(`${JOUR}T12:00:00.000Z`, ['e1', 'e2']) })
  // e3 a scanné mais n'est pas coché : il n'est pas présent.
  const presents = effectivePresent(s, ['e1', 'e3'])
  assert.deepEqual([...presents].sort(), ['e1', 'e2'])
  assert.equal(presents.has('e3'), false)
})

test('avant validation du relevé, ce sont les scans qui comptent', () => {
  const presents = effectivePresent(seance(), ['e1', 'e3'])
  assert.deepEqual([...presents].sort(), ['e1', 'e3'])
})

test('§12 — 30 personnes comptées pour 33 scans : l’écart est signalé', () => {
  const ecarts = compareCounts({ scans: 33, comptePhysique: 30, coches: 30, effectif: 42 })
  assert.ok(ecarts.some((e) => e.kind === 'scans_vs_comptage'))
  assert.match(ecarts[0].message, /33/)
})

test('§13.4 — toute la classe cochée sans aucun scan est signalé', () => {
  const ecarts = compareCounts({ scans: 0, comptePhysique: null, coches: 42, effectif: 42 })
  assert.ok(ecarts.some((e) => e.kind === 'classe_entiere'))
})

test('aucun écart quand les trois sources concordent', () => {
  assert.deepEqual(compareCounts({ scans: 30, comptePhysique: 30, coches: 30, effectif: 42 }), [])
})

/* ================================================================== *
 *  §6 — Absences
 * ================================================================== */

test('§6 — seules les séances terminées produisent des absences', () => {
  const enCours = seance()
  assert.deepEqual(absencesOf(enCours, ['e1', 'e2'], []), [])

  const terminee = seance({
    departureAt: `${JOUR}T13:00:00.000Z`,
    roll: releveValide(`${JOUR}T12:55:00.000Z`, ['e1']),
  })
  const absences = absencesOf(terminee, ['e1', 'e2', 'e3'], ['e1'])
  assert.equal(absences.length, 2)
  // Les heures d'absence valent la durée de la séance.
  assert.equal(absences[0].heures, 3)
})

/* ================================================================== *
 *  §7 — Taux et coûts
 * ================================================================== */

const TAUX = [
  { id: 'r1', scope: 'niveau', niveau: 1, montant: 4000, dateEffet: '2026-01-01' },
  { id: 'r2', scope: 'niveau', niveau: 2, montant: 5000, dateEffet: '2026-01-01' },
]

test('§7 — le taux du niveau s’applique à tous les enseignants', () => {
  // Même niveau, enseignants différents : même taux (modèle simple, un taux par niveau).
  assert.equal(
    resolveRate({ rates: TAUX, teacherId: 'ens-1', matiereId: 'mat-9', niveau: 1, day: JOUR }).montant,
    4000,
  )
  assert.equal(
    resolveRate({ rates: TAUX, teacherId: 'ens-9', matiereId: 'mat-1', niveau: 1, day: JOUR }).montant,
    4000,
  )
  // Niveau 2.
  assert.equal(
    resolveRate({ rates: TAUX, teacherId: 'ens-9', matiereId: 'mat-1', niveau: 2, day: JOUR }).montant,
    5000,
  )
})

test('§7 — une séance sans taux applicable garde un coût vide', () => {
  const s = seance({
    niveau: 7,
    departureAt: `${JOUR}T12:00:00.000Z`,
    roll: releveValide(`${JOUR}T12:00:00.000Z`),
  })
  const cout = sessionCost(s, TAUX)
  assert.equal(cout.montant, null)
  assert.equal(cout.raison, 'aucun_taux')
})

test('§12 — 2 h au niveau 1 et 2 h au niveau 2 : le coût du jour est 2X + 2Y', () => {
  const niveau1 = seance({
    id: 's1',
    teacherId: 'ens-9',
    niveau: 1,
    arrivalAt: `${JOUR}T08:00:00.000Z`,
    departureAt: `${JOUR}T10:00:00.000Z`,
    roll: releveValide(`${JOUR}T10:00:00.000Z`),
  })
  const niveau2 = seance({
    id: 's2',
    teacherId: 'ens-9',
    niveau: 2,
    arrivalAt: `${JOUR}T14:00:00.000Z`,
    departureAt: `${JOUR}T16:00:00.000Z`,
    roll: releveValide(`${JOUR}T16:00:00.000Z`),
  })

  const c1 = sessionCost(niveau1, TAUX)
  const c2 = sessionCost(niveau2, TAUX)
  assert.equal(c1.montant, 2 * 4000)
  assert.equal(c2.montant, 2 * 5000)
  assert.equal(c1.montant + c2.montant, 2 * 4000 + 2 * 5000)
})

test('§12 — un taux modifié aujourd’hui ne change pas le coût des séances d’hier', () => {
  const taux = [
    { id: 'a', scope: 'niveau', niveau: 1, montant: 4000, dateEffet: '2026-01-01' },
    { id: 'b', scope: 'niveau', niveau: 1, montant: 9000, dateEffet: '2026-10-09' },
  ]
  const hier = seance({
    teacherId: 'ens-9',
    niveau: 1,
    arrivalAt: '2026-10-08T08:00:00.000Z',
    departureAt: '2026-10-08T10:00:00.000Z',
    roll: releveValide('2026-10-08T10:00:00.000Z'),
  })
  hier.day = '2026-10-08'
  assert.equal(sessionCost(hier, taux).montant, 8000)

  const aujourdhui = { ...hier, day: '2026-10-09' }
  assert.equal(sessionCost(aujourdhui, taux).montant, 18000)
})

/* ================================================================== *
 *  §3 — Semestres
 * ================================================================== */

test('§3 — le semestre d’une séance est déduit de sa date', () => {
  const semestres = [
    { id: 's1', nom: 'Semestre 1', debut: '2026-09-01', fin: '2027-01-31T23:59:59.999Z' },
    { id: 's2', nom: 'Semestre 2', debut: '2027-02-01', fin: '2027-06-30T23:59:59.999Z' },
  ]
  assert.equal(semesterOf('2026-10-08T10:00:00.000Z', semestres).id, 's1')
  assert.equal(semesterOf('2027-03-15T10:00:00.000Z', semestres).id, 's2')
  assert.equal(semesterOf('2027-08-15T10:00:00.000Z', semestres), null)
})

/* ================================================================== *
 *  §13.1 — Injections
 * ================================================================== */

test('§13.1 — injection de formule neutralisée à l’export', () => {
  assert.equal(neutralizeCell('=1+1'), "'=1+1")
  assert.equal(neutralizeCell('+SOMME(A1)'), "'+SOMME(A1)")
  assert.equal(neutralizeCell('@import'), "'@import")
  assert.equal(neutralizeCell('-2'), "'-2")
  assert.equal(neutralizeCell('Awa Abena'), 'Awa Abena')
})

test('§13.13 — une cellule =1+1 importée ressort neutralisée dans l’export', () => {
  const importe = sanitizeImportedCell('=1+1')
  assert.equal(importe, "'=1+1")
  const csv = toCsv([{ key: 'nom', label: 'Nom' }], [{ nom: importe }])
  assert.ok(csv.includes("''=1+1") || csv.includes("'=1+1"))
  assert.ok(!csv.includes('\n=1+1'))
})

test('§13.1 — l’analyseur CSV gère les guillemets et les séparateurs', () => {
  const { rows } = parseCsv('matricule;nom\nINF001;"Abena; Awa"\nINF002;Fouda')
  assert.deepEqual(rows[1], ['INF001', 'Abena; Awa'])
  assert.equal(rows.length, 3)
})

test('§13.1 — un texte XSS reste du texte', () => {
  const sale = '<script>alert(1)</script>'
  // Aucune transformation magique : la valeur est conservée telle quelle, et
  // c'est React qui l'échappe à l'affichage. Elle ne doit pas être exécutable.
  assert.equal(sanitizeImportedCell(sale), sale)
  assert.equal(renderTemplate('{{etudiant}}', { etudiant: sale }), sale)
})

test('§13.1 — le modèle de message ne fait que substituer du texte', () => {
  // Une clef inconnue reste affichée telle quelle, elle n'est pas évaluée.
  assert.equal(renderTemplate('{{inconnu}}', { inconnu: 'x' }), '{{inconnu}}')
  // Les caractères de contrôle sont retirés des valeurs substituées.
  assert.equal(renderTemplate('{{etudiant}}', { etudiant: 'A\nB' }), 'A B')

  const rendu = renderTemplate(DEFAULT_TEMPLATE, {
    etudiant: 'Awa Abena',
    classe: 'Informatique niveau 1',
    heures: '12,5 h',
    periode: 'Semestre 1',
    etablissement: 'Institut',
  })
  assert.ok(rendu.includes('Awa Abena'))
  assert.ok(!rendu.includes('{{'))
})

/* ================================================================== *
 *  §13.9 — Lien WhatsApp
 * ================================================================== */

test('§13.1 — le numéro WhatsApp ne garde que des chiffres', () => {
  assert.equal(normalizePhone('+237 6 99 00 11 22'), '237699001122')
  assert.equal(normalizePhone('237699001122?text=pirate'), '237699001122')
  assert.equal(normalizePhone('12'), null)
  assert.equal(normalizePhone(''), null)
})

test('§13.9 — le lien est une URL https wa.me, message encodé', () => {
  const lien = buildWhatsAppLink({
    phoneFromDatabase: '+237 699 00 11 22',
    message: 'Bonjour & bienvenue ?text=injection',
  })
  const url = new URL(lien)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'wa.me')
  assert.equal(url.pathname, '/237699001122')
  assert.equal(url.searchParams.get('text'), 'Bonjour & bienvenue ?text=injection')
  assert.equal(url.searchParams.size ?? [...url.searchParams].length, 1)
})

test('§13.9 — un numéro invalide ne produit aucun lien', () => {
  assert.equal(buildWhatsAppLink({ phoneFromDatabase: 'abc', message: 'x' }), null)
})

/* ================================================================== *
 *  §13.6 / §13.8 — Redirections et liens
 * ================================================================== */

test('§13.6 — seules les redirections internes connues sont acceptées', () => {
  assert.equal(safeRedirect('/enseignant/heures'), '/enseignant/heures')
  assert.equal(safeRedirect('//evil.example'), '/')
  assert.equal(safeRedirect('https://evil.example'), '/')
  assert.equal(safeRedirect('/\\evil.example'), '/')
  assert.equal(safeRedirect('javascript:alert(1)'), '/')
  assert.equal(safeRedirect('/inconnu'), '/')
  assert.equal(safeRedirect('/etudiant/../administration'), '/')
})

test('§13.8 — seul wa.me passe comme lien externe', () => {
  assert.equal(isAllowedExternalUrl('https://wa.me/237699001122'), true)
  assert.equal(isAllowedExternalUrl('http://wa.me/237699001122'), false)
  assert.equal(isAllowedExternalUrl('https://evil.example'), false)
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
})

/* ================================================================== *
 *  §13.4 — Codes QR
 * ================================================================== */

test('§12 — une photo du code QR de pointage scannée 5 minutes plus tard est refusée', async () => {
  const secret = newHmacSecret()
  const maintenant = Date.now()
  const qr = await buildPointageQr({ stationId: 'poste-1', stationSecret: secret, at: maintenant })

  // Tout de suite : accepté.
  assert.equal((await verifyPointageQr({ raw: qr, stationSecret: secret, receivedAt: maintenant })).ok, true)

  // 5 minutes plus tard : refusé pour expiration.
  const plusTard = maintenant + 5 * 60_000
  const refus = await verifyPointageQr({ raw: qr, stationSecret: secret, receivedAt: plusTard })
  assert.equal(refus.ok, false)
  assert.equal(refus.reason, 'expire')
})

test('§13.4 — un code QR de pointage fabriqué est refusé (signature)', async () => {
  const secret = newHmacSecret()
  const autre = newHmacSecret()
  const qr = await buildPointageQr({ stationId: 'poste-1', stationSecret: autre })
  const refus = await verifyPointageQr({ raw: qr, stationSecret: secret, receivedAt: Date.now() })
  assert.equal(refus.ok, false)
  assert.equal(refus.reason, 'signature')
})

test('§13.4 — un code QR modifié est refusé', async () => {
  const secret = newHmacSecret()
  const qr = await buildPointageQr({ stationId: 'poste-1', stationSecret: secret })
  const falsifie = qr.slice(0, -4) + 'AAAA'
  const refus = await verifyPointageQr({ raw: falsifie, stationSecret: secret, receivedAt: Date.now() })
  assert.equal(refus.ok, false)
})

test('§13.1 — un QR contenant une adresse n’est pas un code de l’application', () => {
  assert.equal(parsePointageQr('https://evil.example/pointage'), null)
  assert.equal(parsePointageQr('javascript:alert(1)'), null)
  assert.equal(parsePresenceQr('https://evil.example'), null)
  assert.equal(looksLikeUrl('https://evil.example'), true)
  assert.equal(looksLikeUrl('PRESENCES.A1.x'), false)
})

test('le code QR de présence se relit exactement', () => {
  const sessionId = randomId()
  const token = 'abcdefghijklmnopqrstuvwx'
  const qr = buildPresenceQr({ sessionId, scanToken: token })
  const relu = parsePresenceQr(qr)
  assert.equal(relu.sessionId, sessionId)
  assert.equal(relu.scanToken, token)
})

test('un contenu trop long est refusé sans être analysé', () => {
  assert.equal(parsePresenceQr('PRESENCES.A1.' + 'a'.repeat(400)), null)
})

/* ================================================================== *
 *  §13.11 / §13.2 — Aléa, comparaisons, mots de passe
 * ================================================================== */

test('§13.4 — le code de séance fait 6 caractères non ambigus et varie', () => {
  const codes = new Set()
  for (let i = 0; i < 400; i += 1) {
    const code = randomCode(6)
    assert.match(code, /^[ACDEFGHJKLMNPQRTUVWXY34679]{6}$/)
    codes.add(code)
  }
  // Un tirage cryptographique ne produit pas 400 fois la même valeur.
  assert.ok(codes.size > 350, `trop de collisions : ${codes.size}/400`)
})

test('la saisie du code de séance est normalisée', () => {
  assert.equal(normalizeSessionCode(' a7-c d9 k '), 'A7CD9K')
  assert.equal(isSessionCodeShape('A7CD9K'), true)
  // « O », « I », « S » et « B » ne font pas partie de l'alphabet.
  assert.equal(isSessionCodeShape('OISB12'), false)
  assert.equal(isSessionCodeShape('A7CD9'), false)
})

test('§13.2 — la comparaison de secrets est à temps constant et exacte', () => {
  assert.equal(constantTimeEqual('ABCDEF', 'ABCDEF'), true)
  assert.equal(constantTimeEqual('ABCDEF', 'ABCDEG'), false)
  assert.equal(constantTimeEqual('ABCDEF', 'ABCDE'), false)
  assert.equal(constantTimeEqual('', ''), true)
  assert.equal(constantTimeEqual(null, undefined), true)
})

test('§13.2 — les mots de passe sont salés : deux condensés diffèrent', async () => {
  const a = await hashPassword('motdepasse1')
  const b = await hashPassword('motdepasse1')
  assert.notEqual(a, b)
  assert.ok(a.startsWith('pbkdf2$'))
  assert.equal(await verifyPassword('motdepasse1', a), true)
  assert.equal(await verifyPassword('motdepasse2', a), false)
})

test('§13.2 — politique de mot de passe : 8 caractères minimum', () => {
  assert.ok(passwordProblem('court1'))
  assert.ok(passwordProblem('quehuitlettres')) // aucun chiffre
  assert.equal(passwordProblem('bonmotdepasse1'), null)
})

/* ================================================================== *
 *  §13.1 / §13.3 — Validation par schéma
 * ================================================================== */

const FORME = {
  nom: { type: 'text', required: true, max: 20 },
  nombre: { type: 'int', required: false, min: 0, max: 10 },
}

test('§13.3 — un champ non déclaré fait échouer la requête', () => {
  assert.throws(() => validate({ nom: 'Awa', role: 'administration' }, FORME), /non autorisé/)
})

test('§13.1 — __proto__ est refusé', () => {
  assert.throws(() => validate(JSON.parse('{"nom":"a","__proto__":{"x":1}}'), FORME), /refusée|non autorisé/)
})

test('§13.1 — un objet là où un texte est attendu est refusé', () => {
  assert.throws(() => validate({ nom: { $ne: null } }, FORME), /invalide/)
  assert.throws(() => validate({ nom: ['a'] }, FORME), /invalide/)
})

test('§13.6 — les longueurs et les bornes sont appliquées', () => {
  const ok = validate({ nom: 'Awa', nombre: 5 }, FORME)
  assert.equal(ok.nom, 'Awa')
  assert.equal(ok.nombre, 5)
  assert.throws(() => validate({ nom: 'x'.repeat(5), nombre: 99 }, FORME), /invalide/)
  // Un texte trop long est tronqué, pas rejeté, quand aucun minimum n'est posé.
  assert.equal(validate({ nom: 'y'.repeat(50) }, FORME).nom.length, 20)
})

test('§13.3 — le cumul secrétaire + enseignant est refusé', () => {
  assert.ok(roleCombinationProblem(['secretaire', 'enseignant']))
  assert.equal(roleCombinationProblem(['enseignant', 'chef']), null)
  assert.ok(roleCombinationProblem(['etudiant', 'enseignant']))
  assert.ok(roleCombinationProblem([]))
})

/* ================================================================== *
 *  Utilitaires de date
 * ================================================================== */

test('une heure saisie à la main est rattachée au jour de la séance', () => {
  const iso = timeOnDayToIso('16:30', `${JOUR}T10:00:00.000Z`)
  const d = new Date(iso)
  assert.equal(d.getHours(), 16)
  assert.equal(d.getMinutes(), 30)
  assert.equal(timeOnDayToIso('25:00', `${JOUR}T10:00:00.000Z`), null)
  assert.equal(timeOnDayToIso('abc', `${JOUR}T10:00:00.000Z`), null)
})

test('le créneau de pointage change toutes les 60 secondes', () => {
  // On se place au début d'un créneau, sinon le décalage initial fausse le test.
  const debutCreneau = Math.floor(1_760_000_000_000 / 60_000) * 60_000
  assert.equal(currentSlot(debutCreneau), currentSlot(debutCreneau + 59_999))
  assert.equal(currentSlot(debutCreneau + 60_000), currentSlot(debutCreneau) + 1)
})
