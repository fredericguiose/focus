// Exceptions (conception §3.4) : l'aperçu et l'enregistrement passent par le même calcul du
// moteur ; seul l'enregistrement écrit. Aucune règle de friction n'est recodée ici.
import type { Contexte, DemandeException, FrictionFournie, Moteur, PrixException } from '../../core/src/types';
import { chargerContexte, nouvelIdentifiant } from './contexte';
import type { Dependances, JetonAuthentifie } from './env';
import { ErreurApi, requeteInvalide } from './erreurs';
import { type Corps, dateLocale, entierFacultatif, heureLocale, texte, texteFacultatif } from './validation';

const TYPES = ['ajoute', 'retire', 'decale', 'coucher', 'avancer_coucher'] as const;

function lireDemande(corps: Corps, contexte: Contexte, moteur: Moteur): DemandeException {
  const type = corps.type;
  switch (type) {
    case 'ajoute': {
      const heure = corps.heure === undefined ? undefined : heureLocale(corps, 'heure');
      const reveil = corps.reveil === undefined ? undefined : heureLocale(corps, 'reveil');
      if (!heure && !reveil) throw requeteInvalide('Un engagement ajouté demande « heure » ou « reveil ».');
      const preparationMin = entierFacultatif(corps, 'preparation_min', 0, 600);
      return {
        type,
        date: dateLocale(corps, 'date'),
        libelle: texte(corps, 'libelle', 100),
        ...(heure ? { heure } : {}),
        ...(preparationMin !== undefined ? { preparationMin } : {}),
        ...(reveil ? { reveil } : {}),
      };
    }
    case 'retire':
      return { type, date: dateLocale(corps, 'date'), engagement: texte(corps, 'engagement', 100) };
    case 'decale':
      return { type, date: dateLocale(corps, 'date'), engagement: texte(corps, 'engagement', 100), heure: heureLocale(corps, 'heure') };
    case 'coucher':
      return { type, nuit: dateLocale(corps, 'nuit'), heure: heureLocale(corps, 'heure') };
    case 'avancer_coucher':
      // « Je vais dormir » : l'heure est celle du serveur, jamais celle que le client annonce.
      return {
        type,
        nuit: corps.nuit === undefined ? moteur.journeeCourante(contexte).date : dateLocale(corps, 'nuit'),
        a: contexte.maintenant,
      };
    default:
      throw requeteInvalide(`Champ « type » : un parmi ${TYPES.join(', ')}.`, { champ: 'type' });
  }
}

function vueDemande(d: DemandeException): Record<string, unknown> {
  if (d.type === 'ajoute') {
    const { preparationMin, ...reste } = d;
    return { ...reste, ...(preparationMin !== undefined ? { preparation_min: preparationMin } : {}) };
  }
  return { ...d };
}

function vuePrix(p: PrixException) {
  return {
    admissible: p.admissible,
    motif_refus: p.motifRefus ?? null,
    friction: p.friction,
    friction_manquante: p.frictionManquante === true,
    resserre: p.resserre,
    coucher_avant: p.coucherAvant,
    coucher_apres: p.coucherApres,
    lever_avant: p.leverAvant,
    lever_apres: p.leverApres,
    dette_avant_min: p.detteAvantMin,
    dette_apres_min: p.detteApresMin,
  };
}

async function calculer(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  const { contexte, version } = await chargerContexte(db, jeton.utilisateur, deps.maintenant());
  const demande = lireDemande(corps, contexte, deps.moteur);
  const raison = texteFacultatif(corps, 'raison', 2000);
  const phrase = texteFacultatif(corps, 'phrase', 200);
  const friction: FrictionFournie = { ...(raison !== undefined ? { raison } : {}), ...(phrase !== undefined ? { phrase } : {}) };
  const prix = deps.moteur.prixException(contexte, demande, friction);
  return { contexte, version, demande, friction, prix };
}

export async function apercuException(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  const { demande, prix } = await calculer(deps, db, jeton, corps);
  return { demande: vueDemande(demande), prix: vuePrix(prix) };
}

export async function enregistrerException(deps: Dependances, db: D1Database, jeton: JetonAuthentifie, corps: Corps) {
  const { contexte, version, demande, friction, prix } = await calculer(deps, db, jeton, corps);
  if (!prix.admissible) {
    throw new ErreurApi(422, 'exception_refusee', prix.motifRefus ?? 'Exception refusée.', { prix: vuePrix(prix) });
  }
  // Garde-fou : le moteur vérifie le contenu de la friction ; on refuse au moins son absence.
  if (prix.friction === 'raison_phrase' && (!friction.raison || !friction.phrase)) {
    throw new ErreurApi(422, 'friction_manquante', 'Cette exception demande une raison et la phrase exacte.', { prix: vuePrix(prix) });
  }
  if (prix.friction === 'raison' && !friction.raison) {
    throw new ErreurApi(422, 'friction_manquante', 'Cette exception demande une raison.', { prix: vuePrix(prix) });
  }
  const id = nouvelIdentifiant('e');
  const jour = demande.type === 'coucher' || demande.type === 'avancer_coucher' ? demande.nuit : demande.date;
  const appareil = typeof corps.appareil === 'string' && corps.appareil !== '' ? corps.appareil.slice(0, 100) : jeton.nom;
  await db
    .prepare(
      `INSERT INTO exceptions (id, utilisateur, jour, type, raison, pendant_nuit, appareil, details, version_config, cree_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      jeton.utilisateur,
      jour,
      demande.type,
      friction.raison ?? null,
      // La décision de nuit est exactement l'exception qui a exigé la friction de nuit.
      prix.friction === 'raison_phrase' ? 1 : 0,
      appareil,
      JSON.stringify(demande),
      version,
      contexte.maintenant,
    )
    .run();
  return { id, demande: vueDemande(demande), prix: vuePrix(prix) };
}
