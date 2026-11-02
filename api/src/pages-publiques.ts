// Pages publiques de l'hôte web (écran de consentement OAuth de Google) : politique de
// confidentialité et conditions d'utilisation. HTML statique, sans aucune donnée d'utilisateur ;
// seule l'adresse de contact vient du Worker (variable CONTACT_EMAIL, jamais dans le dépôt).
// Servies sans JWT Access (exemption exacte dans src/acces.ts), jamais sur l'hôte de l'API.

export const CHEMINS_PUBLICS = ['/confidentialite', '/conditions'] as const;
export type CheminPublic = (typeof CHEMINS_PUBLICS)[number];

export const MISE_A_JOUR = '2 novembre 2026';

function echapper(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Adresse de contact si elle a la forme d'une adresse ; sinon rien (pas de ligne de contact). */
function contact(brut: string | undefined): string | null {
  const e = (brut ?? '').trim();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e) ? e : null;
}

const STYLE = `
:root { color-scheme: light dark; --fond: #f9fafb; --texte: #18181b; --discret: #6b7280; --bord: #e5e7eb; --carte: #ffffff; --lien: #2563eb; }
@media (prefers-color-scheme: dark) { :root { --fond: #0a0a0a; --texte: #fafafa; --discret: #a1a1aa; --bord: #27272a; --carte: #171717; --lien: #60a5fa; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--fond); color: var(--texte); font: 16px/1.6 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
article { background: var(--carte); border: 1px solid var(--bord); border-radius: 0.75rem; padding: 1.5rem; }
h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
h2 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
p, li { margin: 0.4rem 0; }
ul { padding-left: 1.25rem; }
.discret { color: var(--discret); font-size: 0.875rem; }
a { color: var(--lien); }
nav { margin-top: 1.5rem; font-size: 0.875rem; }
`;

function page(titre: string, corps: string, email: string | null): string {
  const ligneContact = email
    ? `<h2>Contact</h2><p><a href="mailto:${echapper(email)}">${echapper(email)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${titre} — Focus</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<article>
<h1>${titre}</h1>
<p class="discret">Focus · mise à jour le ${MISE_A_JOUR}</p>
${corps}
${ligneContact}
</article>
<nav><a href="/confidentialite">Confidentialité</a> · <a href="/conditions">Conditions d’utilisation</a></nav>
</main>
</body>
</html>
`;
}

const CONFIDENTIALITE = `
<h2>Qu’est-ce que Focus ?</h2>
<p>Focus est un outil <strong>personnel et privé</strong> : il organise les journées de son auteur
(heures de coucher et de lever, blocage d’applications pendant le travail). Il n’est pas destiné au
public : aucune inscription n’est possible et il n’a qu’un seul utilisateur, son auteur.</p>

<h2>Données traitées et pourquoi</h2>
<ul>
<li><strong>Tâches Todoist</strong> (titre, échéance, priorité, étiquettes, reports) : décider des
modes de la journée et du prix d’un report.</li>
<li><strong>Sommeil</strong> lu dans le compte Xiaomi (Mi Fitness) de l’utilisateur (heures,
phases, mesures de la montre) : calculer la dette de sommeil et les heures de lever.</li>
<li><strong>Séances de sport</strong> lues dans Hevy (début, fin, titre) : vérifier les engagements.</li>
<li><strong>Planning</strong> : configuration, exceptions demandées, sessions de travail, appareils
de l’utilisateur.</li>
<li><strong>Journaux techniques</strong> (erreurs, heures de synchronisation), sans jeton ni secret.</li>
</ul>

<h2>Où sont-elles stockées ?</h2>
<p>Dans une base Cloudflare D1 et les journaux du Worker Cloudflare qui fait tourner Focus. Les
jetons d’accès aux services externes sont des secrets du Worker ; ceux qui sont gardés en base
sont chiffrés (AES-GCM).</p>

<h2>Partage</h2>
<p>Aucune donnée n’est vendue, partagée ni transmise à des tiers, et Focus n’affiche aucune
publicité. Les données ne servent qu’aux fonctions décrites ici, pour leur seul utilisateur.</p>

<h2>Google Agenda</h2>
<p>Focus ne demande qu’une seule autorisation Google : la portée
<code>https://www.googleapis.com/auth/calendar.events</code>. Elle sert uniquement à créer, mettre
à jour et supprimer l’événement « Dormir » de chaque nuit dans l’agenda principal de l’utilisateur.
Focus ne lit pas les autres événements de l’agenda. Les données reçues de Google ne servent qu’à
cette fonction ; elles ne sont ni transférées, ni utilisées pour de la publicité, ni lues par une
personne autre que l’utilisateur.</p>
<p>L’utilisation et le transfert à toute autre application, par Focus, des informations reçues des
API Google respectent la
<a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
y compris les exigences « Limited Use ».</p>
<p lang="en" class="discret">Focus’s use and transfer to any other app of information received from
Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use
requirements.</p>
<p>L’autorisation peut être retirée à tout moment sur
<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> ; Focus
cesse alors toute écriture dans l’agenda.</p>

<h2>Conservation et suppression</h2>
<p>Les données restent dans la base tant que l’outil sert ; l’utilisateur, seul détenteur de
l’outil, peut les effacer à tout moment.</p>
`;

const CONDITIONS = `
<h2>Usage personnel</h2>
<p>Focus est un outil personnel, écrit et utilisé par son auteur pour lui-même. Il n’est ni vendu,
ni proposé au public, et aucune inscription n’est possible.</p>

<h2>Accès réservé</h2>
<p>L’application est protégée : seul son utilisateur autorisé peut s’y connecter. Toute autre
tentative d’accès est refusée.</p>

<h2>Aucune garantie</h2>
<p>Focus est fourni tel quel, sans garantie d’aucune sorte, notamment de disponibilité ou
d’exactitude des heures calculées. Son auteur ne peut être tenu responsable de l’usage qui en est
fait.</p>

<h2>Services tiers</h2>
<p>Focus lit ou écrit des données dans des services tiers (Todoist, Xiaomi, Hevy, Google Agenda)
avec l’autorisation de l’utilisateur ; leur usage reste soumis à leurs propres conditions. Le
traitement des données est décrit dans la <a href="/confidentialite">politique de confidentialité</a>.</p>
`;

export function pagePublique(chemin: CheminPublic, contactEmail: string | undefined): string {
  const email = contact(contactEmail);
  return chemin === '/confidentialite'
    ? page('Politique de confidentialité', CONFIDENTIALITE, email)
    : page('Conditions d’utilisation', CONDITIONS, email);
}
