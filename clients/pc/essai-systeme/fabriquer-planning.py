#!/usr/bin/env python3
"""Fabrique un planning (format §4.3, version 1) dont les instants sont relatifs à maintenant.

Entrée (stdin), en secondes depuis maintenant :
  {"config": "essai-1", "valable": 7200, "travail": ["alice"],
   "segments": [{"mode": "WORK", "de": -60, "a": 3600, "bloquer": ["youtube.com"],
                 "verrou": false, "fermer": true, "sessions": "autorisees"}],
   "sessions": [{"id": "s_01", "tache": "DM de maths", "domaines": ["chatgpt.com"],
                 "question": {"id": "q_01", "posee": 5, "attente": 3, "expire": 120}}]}
Sortie (stdout) : le planning JSON.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

maintenant = datetime.now(timezone.utc)


def instant(secondes):
    t = maintenant + timedelta(seconds=secondes)
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


spec = json.load(sys.stdin)
planning = {
    "version": spec.get("version", 1),
    "appareil": spec.get("appareil", "pc_linux"),
    "heure_serveur": instant(0),
    "config_version": spec.get("config", "essai"),
    "valable_jusqua": instant(spec.get("valable", 7200)),
    "comptes_de_travail": spec.get("travail", ["alice"]),
    "segments": [
        {
            "debut": instant(s["de"]),
            "fin": instant(s["a"]),
            "mode": s["mode"],
            "sessions": s.get("sessions", "interdites"),
            "actions": {
                "bloquer_domaines": s.get("bloquer", []),
                "verrouiller_session": s.get("verrou", False),
                "fermer_comptes_hors_travail": s.get("fermer", False),
            },
        }
        for s in spec.get("segments", [])
    ],
    "sessions": [],
    "raison": spec.get("raison", "essai système"),
}
for s in spec.get("sessions", []):
    session = {
        "id": s["id"],
        "tache": {"id": s.get("tache_id", "t1"), "nom": s.get("tache", "DM de maths")},
        "apps": s.get("apps", ["chatgpt"]),
        "domaines": s.get("domaines", []),
        "ouverte_le": instant(s.get("ouverte", -60)),
    }
    q = s.get("question")
    if q:
        session["question"] = {
            "id": q["id"],
            "posee_a": instant(q["posee"]),
            "attente_s": q.get("attente", 3),
            "expire_a": instant(q["expire"]),
        }
    planning["sessions"].append(session)
json.dump(planning, sys.stdout, indent=2)
