import { Progress } from '@/components/ui/progress';
import type { PlafondApp } from '@/api/contrat';
import { formaterDuree } from '@/lib/temps';

/** Plafonds propres à certaines apps (Claude Code…), comptés à part du plafond commun. */
export function PlafondsApps({ plafonds }: { plafonds: PlafondApp[] | undefined }) {
  if (!plafonds || plafonds.length === 0) return null;
  return (
    <ul className="mt-1 grid gap-2 border-t pt-2">
      {plafonds.map((p) => (
        <li key={p.app} className="grid gap-1">
          <span className="flex justify-between gap-2">
            <span className="text-foreground font-medium">{p.nom}</span>
            <span className="tabular-nums">
              {formaterDuree(p.cumul_min)} sur {formaterDuree(p.plafond_min)}
            </span>
          </span>
          <Progress value={Math.min(100, (p.cumul_min / p.plafond_min) * 100)} aria-label={`Sessions ${p.nom} du jour`} className="h-1.5" />
        </li>
      ))}
    </ul>
  );
}
