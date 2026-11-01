import { BedDouble, CalendarClock, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReponseStatut } from '@/api/contrat';
import { formaterHeure } from '@/lib/temps';
import { phrase } from '@/lib/texte';
import { DecalerCoucher } from './DecalerCoucher';
import { JeVaisDormir } from './JeVaisDormir';

const TITRES = { journee: 'Ce soir', soiree: 'Ce soir', nuit: 'Cette nuit' } as const;

/**
 * Les deux actions du soir. Ce qui est proposé suit l'API (`phase`, `actions`) : rien n'est déduit
 * ici de l'heure. Sans ces champs (API plus ancienne), les actions restent désactivées.
 */
export function CarteActions({ statut }: { statut: ReponseStatut }) {
  const [dormir, setDormir] = useState(false);
  const [decaler, setDecaler] = useState(false);
  const j = statut.journee;
  const actions = statut.actions;
  const phase = statut.phase;
  const demain = statut.engagements_demain;
  const nuit = phase === 'nuit';
  const mode = actions?.decaler_coucher.mode;

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>{phase ? TITRES[phase] : 'Coucher'}</CardTitle>
        <CardDescription>
          Coucher à <span className="text-foreground font-medium tabular-nums">{formaterHeure(j.coucherApplique, j.fuseau)}</span> · lever à{' '}
          <span className="text-foreground font-medium tabular-nums">{formaterHeure(j.leverSuivant, j.fuseau)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!actions ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            Actions indisponibles : l'API doit être mise à jour.
          </p>
        ) : null}

        {actions?.je_vais_dormir.disponible ? (
          <Button size="lg" className="bg-mode-nuit hover:bg-mode-nuit/90 h-14 justify-start gap-3 text-base text-white" onClick={() => setDormir(true)}>
            <BedDouble className="size-5" />
            Je vais dormir
          </Button>
        ) : null}

        {actions ? (
          <div className="grid gap-1.5">
            <Button
              size="lg"
              variant="outline"
              className="h-auto min-h-14 flex-wrap justify-start gap-x-3 gap-y-1 py-3 text-base whitespace-normal"
              disabled={mode === 'indisponible'}
              onClick={() => setDecaler(true)}
            >
              <CalendarClock className="size-5" />
              <span className="flex-1 text-left whitespace-nowrap">Décaler le coucher</span>
              {mode === 'decision_de_nuit' ? (
                <Badge variant="outline" className="text-avertissement border-avertissement/40">
                  <ShieldAlert /> décision de nuit
                </Badge>
              ) : null}
            </Button>
            {mode === 'indisponible' && actions.decaler_coucher.motif ? (
              <p className="text-muted-foreground text-xs">{phrase(actions.decaler_coucher.motif)}.</p>
            ) : null}
            {nuit && mode === 'decision_de_nuit' ? (
              <p className="text-muted-foreground text-xs">La nuit a commencé : seule une décision de nuit peut encore la décaler.</p>
            ) : null}
            {!actions.je_vais_dormir.disponible && !nuit && actions.je_vais_dormir.motif ? (
              <p className="text-muted-foreground text-xs">{phrase(actions.je_vais_dormir.motif)}.</p>
            ) : null}
          </div>
        ) : null}

        {demain ? (
          <div className="grid gap-1.5 border-t pt-3">
            <span className="text-muted-foreground text-xs font-medium">Engagements de demain</span>
            {demain.length === 0 ? (
              <span className="text-sm">Aucun : réveil libre.</span>
            ) : (
              <ul className="grid gap-1">
                {demain.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{e.nom}</span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {e.reveil ? `réveil ${formaterHeure(e.reveil, j.fuseau)}` : 'sans heure'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </CardContent>
      <JeVaisDormir ouverte={dormir} surChangement={setDormir} />
      <DecalerCoucher ouverte={decaler} surChangement={setDecaler} />
    </Card>
  );
}
