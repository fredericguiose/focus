#!/usr/bin/env python3
"""Fausse API Focus pour l'essai système : sert un planning écrit par verifier.sh et note
chaque requête. Pilotée par des fichiers dans DOSSIER (défaut /srv/fausse-api) :

  planning.json   corps de GET /v1/planning (heure_serveur remplacée par l'heure courante)
  comportement    normal | panne (503) | muet (ne répond pas) ; relu à chaque requête
  jeton           jeton attendu (Authorization: Bearer …) ; sinon 401
  requetes.jsonl  journal des requêtes reçues (méthode, chemin, corps)

Usage : fausse-api.py [port] [dossier]
"""
import json
import sys
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18799
DOSSIER = Path(sys.argv[2] if len(sys.argv) > 2 else "/srv/fausse-api")


def lire(nom, defaut=""):
    try:
        return (DOSSIER / nom).read_text().strip()
    except FileNotFoundError:
        return defaut


class Gestionnaire(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def repondre(self, statut, corps):
        b = json.dumps(corps).encode()
        self.send_response(statut)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def traiter(self, methode):
        longueur = int(self.headers.get("Content-Length") or 0)
        brut = self.rfile.read(longueur) if longueur else b""
        try:
            corps = json.loads(brut) if brut else None
        except ValueError:
            corps = brut.decode(errors="replace")
        autorise = self.headers.get("Authorization", "") == "Bearer " + lire("jeton")
        with open(DOSSIER / "requetes.jsonl", "a") as f:
            f.write(json.dumps({"t": time.time(), "methode": methode, "chemin": self.path,
                                "autorise": autorise, "corps": corps}) + "\n")

        comportement = lire("comportement", "normal")
        if comportement == "muet":
            time.sleep(120)
            return
        if comportement == "panne":
            return self.repondre(503, {"erreur": "indisponible", "message": "panne simulée"})
        if not autorise:
            return self.repondre(401, {"erreur": "non_authentifie", "message": "jeton invalide"})

        if methode == "GET" and self.path == "/v1/planning":
            try:
                p = json.loads(lire("planning.json", "null"))
            except ValueError:
                return self.repondre(500, {"erreur": "erreur_interne", "message": "planning illisible"})
            if p is None:
                return self.repondre(404, {"erreur": "introuvable", "message": "pas de planning"})
            p["heure_serveur"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            return self.repondre(200, p)
        if methode == "GET" and self.path == "/v1/taches":
            return self.repondre(200, {"taches": [{"id": "t1", "nom": "DM de maths"}, {"id": "t2", "nom": "Exposé NSI"}]})
        if methode == "POST" and self.path in ("/v1/accuses", "/v1/evenements"):
            return self.repondre(200, {"ok": True})
        if methode == "POST" and self.path == "/v1/sessions":
            return self.repondre(201, {"session": {"id": "s_essai"}})
        if methode == "POST" and self.path.startswith("/v1/sessions/") and self.path.endswith("/reponse"):
            return self.repondre(200, {"ok": True})
        return self.repondre(404, {"erreur": "introuvable", "message": self.path})

    def do_GET(self):
        self.traiter("GET")

    def do_POST(self):
        self.traiter("POST")


if __name__ == "__main__":
    DOSSIER.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Gestionnaire).serve_forever()
