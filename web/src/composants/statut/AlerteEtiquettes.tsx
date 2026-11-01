import { TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ReponseStatut, UsageEtiquette } from '@/api/contrat';

/**
 * Ce que l'absence d'une étiquette casse, selon son rôle le plus important dans la config. Une
 * étiquette absente de Todoist ne marque aucune tâche : les conditions qui la cherchent n'en
 * trouvent jamais (le planning compte donc comme fait, à tort).
 */
export function consequence(usages: UsageEtiquette[], modes: string[]): string {
  if (usages.includes('planning')) return 'Le planning du jour comptera toujours comme fait.';
  if (usages.includes('recap')) return 'Le récap comptera toujours comme fait.';
  if (usages.includes('condition')) {
    const ou = modes.length === 0 ? '' : ` (${modes.length > 1 ? 'modes' : 'mode'} ${modes.join(', ')})`;
    return `Les conditions qui la filtrent${ou} ne trouveront jamais de tâche.`;
  }
  if (usages.includes('exclusion')) return "Elle n'exclut aucune tâche.";
  return 'Les règles qui la citent ne fonctionnent pas comme prévu.';
}

/** Décision du CDC (audit du 01/11, point 2) : une étiquette du YAML absente de Todoist est signalée. */
export function AlerteEtiquettes({ statut }: { statut: ReponseStatut }) {
  const todoist = statut.todoist;
  const manquantes = todoist?.etiquettes_manquantes ?? [];
  if (manquantes.length === 0) return null;
  // Noms lisibles des modes, pris dans le parcours des appareils.
  const noms = new Map(statut.appareils.flatMap((a) => (a.parcours ?? []).map((e) => [e.mode, e.nom] as const)));
  const lignes = manquantes.map((etiquette) => {
    const d = todoist?.etiquettes_manquantes_detail?.find((x) => x.etiquette === etiquette);
    return { etiquette, texte: consequence(d?.usages ?? [], (d?.modes ?? []).map((m) => noms.get(m) ?? m)) };
  });
  const seule = lignes.length === 1 ? lignes[0] : undefined;
  return (
    <Alert className="border-avertissement/40 text-avertissement">
      <TriangleAlert />
      <AlertTitle className="line-clamp-none">
        {seule ? `Étiquette Todoist introuvable : @${seule.etiquette}` : `Étiquettes Todoist introuvables : ${lignes.map((l) => `@${l.etiquette}`).join(', ')}`}
      </AlertTitle>
      <AlertDescription>
        {seule ? (
          <p>{seule.texte}</p>
        ) : (
          <ul className="grid gap-0.5">
            {lignes.map((l) => (
              <li key={l.etiquette}>
                <span className="text-foreground font-medium">@{l.etiquette}</span> : {l.texte}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs">{seule ? 'Créez-la' : 'Créez-les'} dans Todoist ou corrigez le nom dans la config.</p>
      </AlertDescription>
    </Alert>
  );
}
