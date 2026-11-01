import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { API_SIMULEE } from '@/api';
import { useFocus, useHeureServeur } from '@/hooks/useFocus';
import { formaterDate, heureLocale } from '@/lib/temps';
import { cn } from '@/lib/utils';
import { ECRANS, type Ecran } from './navigation';

export function EnTete({ ecran }: { ecran: Ecran }) {
  const { statut, rafraichir } = useFocus();
  const maintenant = useHeureServeur();
  const [actualisation, setActualisation] = useState(false);
  const fuseau = statut?.journee.fuseau;

  return (
    <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b backdrop-blur md:rounded-t-xl">
      <div className="flex w-full items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden sm:inline-flex">Focus</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-medium">{ECRANS[ecran].libelle}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          {API_SIMULEE ? (
            <Badge variant="outline" className="hidden sm:inline-flex">
              Démonstration
            </Badge>
          ) : null}
          {fuseau && statut ? (
            <div className="grid text-right leading-tight">
              <span className="text-sm font-semibold tabular-nums">{heureLocale(maintenant, fuseau)}</span>
              <span className="text-muted-foreground hidden text-xs first-letter:uppercase sm:block">{formaterDate(statut.journee.date)}</span>
            </div>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Actualiser"
                onClick={() => {
                  setActualisation(true);
                  void rafraichir().finally(() => setActualisation(false));
                }}
              >
                <RefreshCw className={cn(actualisation && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Actualiser</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
