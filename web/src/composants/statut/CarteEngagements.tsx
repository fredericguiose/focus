import {
  Check,
  CircleDashed,
  Clock,
  Dumbbell,
  Minus,
  TriangleAlert,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EngagementVerifie, ReponseStatut } from "@/api/contrat";
import { ajouterJours, formaterDateCourte, jourDeSemaine } from "@/lib/temps";
import { cn } from "@/lib/utils";

type Etat =
  | "fait"
  | "a_faire"
  | "a_venir"
  | "saute_declare"
  | "saute_non_declare"
  | "facultatif_non_fait";

const ETATS: Record<
  Etat,
  { libelle: string; icone: typeof Check; classe: string }
> = {
  fait: {
    libelle: "Fait",
    icone: Check,
    classe: "bg-succes/15 text-succes border-succes/30",
  },
  a_faire: {
    libelle: "À faire",
    icone: X,
    classe: "bg-avertissement/15 text-avertissement border-avertissement/40",
  },
  a_venir: {
    libelle: "À venir",
    icone: Clock,
    classe: "bg-muted text-muted-foreground border-transparent",
  },
  saute_declare: {
    libelle: "Annulé à l’avance",
    icone: Minus,
    classe: "bg-muted text-muted-foreground border-border",
  },
  saute_non_declare: {
    libelle: "Sauté sans l’annuler",
    icone: X,
    classe: "bg-destructive/10 text-destructive border-destructive/30",
  },
  facultatif_non_fait: {
    libelle: "Non faite (facultative)",
    icone: CircleDashed,
    classe: "bg-muted/60 text-muted-foreground border-border border-dashed",
  },
};

const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

/** « à faire » d'un jour futur se lit « à venir ». */
export function etatDe(e: EngagementVerifie, aujourdhui: string): Etat {
  return e.statut === "a_faire" && e.date > aujourdhui ? "a_venir" : e.statut;
}

export function sautesEnMots(n: number): string {
  if (n === 0) return "Aucune séance sautée cette semaine";
  return `${n} séance${n > 1 ? "s" : ""} sautée${n > 1 ? "s" : ""} cette semaine`;
}

function Pastille({
  etat,
  titre,
  grande = false,
}: {
  etat: Etat;
  titre: string;
  grande?: boolean;
}) {
  const { icone: Icone, classe } = ETATS[etat];
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-md border",
        grande ? "size-8" : "size-7",
        classe,
      )}
      title={titre}
      aria-label={titre}
      role="img"
    >
      <Icone className="size-4" />
    </span>
  );
}

export function CarteEngagements({ statut }: { statut: ReponseStatut }) {
  const liste = statut.engagements_verifies;
  if (!liste) return null;
  const aujourdhui = statut.aujourdhui ?? statut.journee.date;
  const lundi = ajouterJours(
    aujourdhui,
    -((jourDeSemaine(aujourdhui) + 6) % 7),
  );
  const semaine = JOURS.map((_, i) => ajouterJours(lundi, i));
  const duJour = liste.filter((e) => e.date === aujourdhui);
  const engagements = [
    ...new Map(
      liste.filter((e) => e.date >= lundi).map((e) => [e.engagement, e.nom]),
    ).entries(),
  ];
  const sautes = statut.sautes_semaine ?? 0;
  const facultatives = liste.some(
    (e) => e.date >= lundi && e.statut === "facultatif_non_fait",
  );
  const cleRefusee = statut.seances_mesurees?.erreur === "cle_hevy_refusee";

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Dumbbell className="text-muted-foreground size-4" /> Engagements
        </CardTitle>
        <CardAction>
          <Badge
            variant="outline"
            className={cn(
              sautes > 0
                ? "text-avertissement border-avertissement/40"
                : "text-muted-foreground",
            )}
          >
            {sautes === 0
              ? "semaine tenue"
              : `${sautes} sauté${sautes > 1 ? "s" : ""}`}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        <section className="grid gap-2" aria-label="Aujourd'hui">
          <span className="text-muted-foreground text-sm">Aujourd’hui</span>
          {duJour.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aucun engagement vérifié prévu aujourd’hui.
            </p>
          ) : (
            <ul className="grid gap-2">
              {duJour.map((e) => {
                const etat = etatDe(e, aujourdhui);
                return (
                  <li key={e.engagement} className="flex items-center gap-3">
                    <Pastille etat={etat} titre={ETATS[etat].libelle} grande />
                    <div className="grid">
                      <span className="font-medium">{e.nom}</span>
                      <span
                        className={cn(
                          "text-xs",
                          etat === "a_faire"
                            ? "text-avertissement font-medium"
                            : "text-muted-foreground",
                        )}
                      >
                        {etat === "fait"
                          ? "séance enregistrée"
                          : etat === "a_faire"
                            ? "pas encore de séance enregistrée"
                            : ETATS[etat].libelle.toLowerCase()}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {engagements.length > 0 ? (
          <section className="grid gap-2" aria-label="Cette semaine">
            <span className="text-muted-foreground text-sm">
              Cette semaine
              {engagements.length === 1 ? ` · ${engagements[0]![1]}` : ""}
            </span>
            <div className="grid gap-2">
              {engagements.map(([id, nom]) => (
                <div key={id} className="grid gap-1.5">
                  {engagements.length > 1 ? (
                    <span className="truncate text-sm font-medium">{nom}</span>
                  ) : null}
                  <div className="grid grid-cols-7 gap-1" aria-label={nom}>
                    {semaine.map((date, i) => {
                      const e = liste.find(
                        (x) => x.engagement === id && x.date === date,
                      );
                      return (
                        <div
                          key={date}
                          className="flex flex-col items-center gap-1"
                        >
                          <span
                            className={cn(
                              "text-[11px]",
                              date === aujourdhui
                                ? "text-foreground font-semibold"
                                : "text-muted-foreground",
                            )}
                          >
                            {JOURS[i]}
                          </span>
                          {e ? (
                            <Pastille
                              etat={etatDe(e, aujourdhui)}
                              titre={`${formaterDateCourte(date)} : ${ETATS[etatDe(e, aujourdhui)].libelle.toLowerCase()}`}
                            />
                          ) : (
                            <span
                              className="flex size-7 items-center justify-center"
                              title={`${formaterDateCourte(date)} : rien de prévu`}
                            >
                              <span className="bg-border size-1 rounded-full" />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <ul
              className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs"
              aria-label="Légende"
            >
              {(
                [
                  "fait",
                  "saute_declare",
                  "saute_non_declare",
                  ...(facultatives ? (["facultatif_non_fait"] as const) : []),
                  "a_venir",
                ] as const
              ).map((etat) => {
                const { icone: Icone, classe } = ETATS[etat];
                return (
                  <li key={etat} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "flex size-3.5 items-center justify-center rounded-[3px] border",
                        classe,
                      )}
                    >
                      <Icone className="size-2.5" />
                    </span>
                    {ETATS[etat].libelle.toLowerCase()}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {sautes > 0 ? (
          <p
            className={cn(
              "text-sm",
              sautes > 0
                ? "text-avertissement font-medium"
                : "text-muted-foreground",
            )}
          >
            {sautesEnMots(sautes)}
          </p>
        ) : null}
        {cleRefusee ? (
          <p className="text-avertissement flex items-center gap-1.5 text-xs">
            <TriangleAlert className="size-3.5 shrink-0" /> La clé Hevy est
            refusée : les séances ne sont plus mises à jour.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
