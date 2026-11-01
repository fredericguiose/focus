import { Moon } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** Suit le système par défaut ; la bascule force clair ou sombre. */
export function BasculeTheme() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="theme-sombre" className="flex items-center gap-2 font-normal">
          <Moon className="size-4" /> Thème sombre
        </Label>
        <Switch id="theme-sombre" checked={resolvedTheme === 'dark'} onCheckedChange={(sombre) => setTheme(sombre ? 'dark' : 'light')} />
      </div>
      {theme !== 'system' ? (
        <Button variant="link" size="sm" className="text-muted-foreground h-auto justify-start p-0 text-xs" onClick={() => setTheme('system')}>
          Suivre le système
        </Button>
      ) : (
        <span className="text-muted-foreground text-xs">Suit le système</span>
      )}
    </div>
  );
}
