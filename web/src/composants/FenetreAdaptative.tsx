import type { ReactNode } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';

/** Dialog sur grand écran, Drawer (tiroir du bas) au téléphone. */
export function FenetreAdaptative({
  ouverte,
  surChangement,
  titre,
  description,
  pied,
  children,
}: {
  ouverte: boolean;
  surChangement: (ouverte: boolean) => void;
  titre: ReactNode;
  description?: ReactNode;
  pied?: ReactNode;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Drawer open={ouverte} onOpenChange={surChangement} repositionInputs={false}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-lg">{titre}</DrawerTitle>
            {description ? <DrawerDescription>{description}</DrawerDescription> : null}
          </DrawerHeader>
          <div className="grid gap-5 overflow-y-auto px-4 pb-2">{children}</div>
          {pied ? <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">{pied}</DrawerFooter> : null}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={ouverte} onOpenChange={surChangement}>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">{titre}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="-mx-6 grid gap-5 overflow-y-auto px-6 pb-2">{children}</div>
        {pied ? <DialogFooter>{pied}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
