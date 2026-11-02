import { ChevronsUpDown, KeyRound, Target } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { API_SIMULEE } from '@/api';
import { useFocus, useHeureServeur } from '@/hooks/useFocus';
import { etatPing, libelleAppareil, STYLES_PING } from '@/lib/appareils';
import { cn } from '@/lib/utils';
import { ECRANS, type Ecran, LISTE_ECRANS } from './navigation';
import { BasculeTheme } from './Theme';

export function BarreLaterale({ ecran, allerA, indicateurs }: { ecran: Ecran; allerA: (e: Ecran) => void; indicateurs: Partial<Record<Ecran, string>> }) {
  const { statut, changerJeton } = useFocus();
  const maintenant = useHeureServeur();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <span className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <Target className="size-4" />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">Focus</span>
                <span className="text-muted-foreground truncate text-xs">{API_SIMULEE ? 'Démonstration' : 'Tableau de bord'}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Écrans</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {LISTE_ECRANS.map((e) => {
                const { libelle, icone: Icone } = ECRANS[e];
                return (
                  <SidebarMenuItem key={e}>
                    <SidebarMenuButton
                      isActive={ecran === e}
                      tooltip={libelle}
                      onClick={() => {
                        allerA(e);
                        setOpenMobile(false);
                      }}
                    >
                      <Icone />
                      <span>{libelle}</span>
                    </SidebarMenuButton>
                    {indicateurs[e] ? (
                      <SidebarMenuBadge>
                        <span className="bg-avertissement size-2 rounded-full" aria-label={indicateurs[e]} />
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {statut ? (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Appareils</SidebarGroupLabel>
            <SidebarGroupContent>
              <ul className="grid gap-1 px-2">
                {statut.appareils.map((a) => {
                  const s = STYLES_PING[etatPing(a.vu_le, maintenant)];
                  return (
                    <li key={a.appareil} className="flex items-center gap-2 py-1 text-sm">
                      <span className={cn('size-2 rounded-full', s.point)} aria-hidden />
                      <span className="flex-1 truncate">{libelleAppareil(a)}</span>
                      <span className="text-muted-foreground text-xs">{s.libelle}</span>
                    </li>
                  );
                })}
              </ul>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <div className="group-data-[collapsible=icon]:hidden rounded-lg border bg-background/60 p-3">
          <BasculeTheme />
        </div>
        {changerJeton ? (
          <>
            <SidebarSeparator className="mx-0" />
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton size="lg" tooltip="Accès">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg">
                          <KeyRound className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      <span className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">Jeton</span>
                        <span className="text-muted-foreground truncate text-xs">{API_SIMULEE ? 'démonstration' : 'enregistré ici'}</span>
                      </span>
                      <ChevronsUpDown className="ml-auto size-4" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                    <DropdownMenuLabel>Jeton de l'interface</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={changerJeton}>
                      <KeyRound /> Changer de jeton
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </>
        ) : null}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
