#!/usr/bin/env python3
"""Conversion d'un G-code cartésien 3 axes en G-code polaire Apex.

Format de sortie (cf. src/components/gcodeLayer.ts) :
    G00 Y<C> X<R> Z<Z> B<B> [E<e>] [F<f>]
  - X = R : rayon du PIVOT de l'axe B depuis l'axe du plateau (mm) ;
  - Y = C : angle du plateau (degrés, absolu, jamais replié modulo 360) ;
  - Z : hauteur du pivot (mm) ; B : inclinaison de la tête vers +R (degrés) ;
  - E : position ABSOLUE de l'extrudeur (M82).
La pointe de buse est à `pivot` mm sous le pivot, le long de l'axe de la tête :
    r_buse = R - pivot*sin(B)      z_buse = Z + pivot*(1 - cos(B))

Deux modes :
  - polar   : B = 0 partout (tête droite) ;
  - dynamic : B incliné selon la normale locale de la couche (G-codes non plans), dans le plan
              radial (seule direction possible pour la tête), borné à [b-min, b-limit] (B ≥ 0 : la tête ne penche que vers +R).

Le firmware interpole linéairement en (R, C, Z, B) : une droite cartésienne deviendrait une
spirale. Chaque segment est donc subdivisé jusqu'à ce que la buse reste à moins de `tol` mm de la
trajectoire cartésienne d'origine.

Commentaires et commandes sans mouvement (;TYPE:, ;WIPE_*, M-codes…) sont recopiés tels quels.
Progression sur stderr : lignes « PROGRESS <0-100> ». Résumé JSON sur stdout.
Bibliothèque standard uniquement (exécuté par la distribution Python embarquée de l'application).
"""

import argparse
import json
import math
import re
import sys

VERSION = "1.0"

CMD_RE = re.compile(r"^([GM])(\d+)(?:\.\d+)?")
WORD_RE = re.compile(r"([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))")
LAYER_RE = re.compile(r"^\s*(?:LAYER_CHANGE\b|<layer>|LAYER:)", re.I)
PAREN_RE = re.compile(r"\([^)]*\)")

ARC_MAX_CHORD_MM = 0.5
ARC_MAX_STEP_RAD = math.radians(10)
ARC_MAX_SEGMENTS = 720
MAX_SUBDIVISIONS = 2048
E_EPS = 1e-9
# Grille de la carte de hauteur des couches (angle dynamique) : taille de cellule (mm), rayon du
# voisinage de l'ajustement de plan (cellules) et pas d'échantillonnage des extrusions (mm).
HEIGHTMAP_CELL_MM = 1.0
HEIGHTMAP_RADIUS_CELLS = 2
HEIGHTMAP_SAMPLE_MM = 1.0
# Variation maximale de B le long du trajet (degrés par mm parcouru), pour une tête qui ne donne
# pas d'à-coups.
B_RATE_DEG_PER_MM = 2.0
# En deçà de ce rayon, la direction radiale n'est pas définie : tête droite.
MIN_RADIUS_FOR_TILT_MM = 1.0


class Progress:
    def __init__(self):
        self.last = -1

    def report(self, pct):
        pct = int(max(0, min(100, pct)))
        if pct != self.last:
            self.last = pct
            sys.stderr.write(f"PROGRESS {pct}\n")
            sys.stderr.flush()


def fmt(value, digits):
    """Nombre compact : « 12.5 », « -0.25 », jamais « -0 »."""
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


# --------------------------------------------------------------------------------------------
# Passe 1 : lecture du G-code cartésien
# --------------------------------------------------------------------------------------------

class Moves:
    """Mouvements cartésiens (pointe de buse), en tableaux parallèles."""

    def __init__(self):
        self.x = []
        self.y = []
        self.z = []
        self.de = []
        self.feed = []
        self.extruding = []
        self.layer = []

    def __len__(self):
        return len(self.x)


def read_gcode(lines, center_x, center_y, progress):
    """Renvoie (items, moves) : `items` est la suite des lignes de sortie, chaque élément étant
    soit une chaîne recopiée telle quelle, soit un couple (début, fin) d'indices de mouvements."""
    moves = Moves()
    items = []
    x = y = z = 0.0
    feed = 1500.0
    unit = 1.0
    rel_xyz = False
    rel_e = False
    e_abs = None
    layer = 0
    layer_markers = 0
    total = max(1, len(lines))

    def push(nx, ny, nz, de):
        moves.x.append(nx - center_x)
        moves.y.append(ny - center_y)
        moves.z.append(nz)
        moves.de.append(de)
        moves.feed.append(feed)
        moved = nx != x or ny != y or nz != z
        moves.extruding.append(moved and de > E_EPS)
        moves.layer.append(layer)

    for index, raw in enumerate(lines):
        if index % 5000 == 0:
            progress.report(30 * index / total)
        line = raw.rstrip("\r")
        semi = line.find(";")
        comment = line[semi + 1:] if semi >= 0 else ""
        code = line[:semi] if semi >= 0 else line
        if "(" in code:
            code = PAREN_RE.sub(" ", code)
        code = code.strip().upper()
        if comment and LAYER_RE.match(comment):
            layer += 1
            layer_markers += 1
        if not code:
            items.append(line)
            continue
        cmd = CMD_RE.match(code)
        if not cmd:
            items.append(line)
            continue
        letter, num = cmd.group(1), int(cmd.group(2))
        words = {m.group(1): float(m.group(2)) for m in WORD_RE.finditer(code[cmd.end():])}

        def axis(current, key):
            if key not in words:
                return current
            return current + words[key] * unit if rel_xyz else words[key] * unit

        def extrusion_delta():
            nonlocal e_abs
            if "E" not in words:
                return 0.0
            e = words["E"] * unit
            if rel_xyz or rel_e:
                return e
            de = 0.0 if e_abs is None else e - e_abs
            e_abs = e
            return de

        if letter == "M":
            if num == 82:
                rel_e = False
            elif num == 83:
                rel_e = True
            else:
                items.append(line)
            continue

        if num in (0, 1):
            if words.get("F", 0) > 0:
                feed = words["F"] * unit
            if not any(k in words for k in "XYZE"):
                continue
            start = len(moves)
            nx, ny, nz = axis(x, "X"), axis(y, "Y"), axis(z, "Z")
            push(nx, ny, nz, extrusion_delta())
            x, y, z = nx, ny, nz
            items.append((start, len(moves)))
        elif num in (2, 3):
            if words.get("F", 0) > 0:
                feed = words["F"] * unit
            ex, ey, ez = axis(x, "X"), axis(y, "Y"), axis(z, "Z")
            de = extrusion_delta()
            start = len(moves)
            for px, py, pz, pde in linearize_arc(x, y, z, ex, ey, ez, de, words, unit, num == 3):
                push(px, py, pz, pde)
                x, y, z = px, py, pz
            items.append((start, len(moves)))
        elif num == 20:
            unit = 25.4
        elif num == 21:
            unit = 1.0
        elif num == 90:
            rel_xyz = False
        elif num == 91:
            rel_xyz = True
        elif num == 92:
            # Repère de la source seulement : la sortie garde son propre E absolu et ses axes polaires.
            if "X" in words:
                x = words["X"] * unit
            if "Y" in words:
                y = words["Y"] * unit
            if "Z" in words:
                z = words["Z"] * unit
            if "E" in words:
                e_abs = words["E"] * unit
        elif num == 28:
            homed = [k for k in "XYZ" if k in words] or ["X", "Y", "Z"]
            if "X" in homed:
                x = 0.0
            if "Y" in homed:
                y = 0.0
            if "Z" in homed:
                z = 0.0
            items.append("G28")
        else:
            items.append(line)

    if layer_markers == 0:
        assign_layers_by_z(moves)
    return items, moves


def linearize_arc(x, y, z, ex, ey, ez, de, words, unit, ccw):
    """Arc G2/G3 → points intermédiaires (x, y, z, ΔE), comme parseGCode côté interface."""
    if "I" in words or "J" in words:
        cx = x + words.get("I", 0.0) * unit
        cy = y + words.get("J", 0.0) * unit
    elif "R" in words:
        r = words["R"] * unit
        dx, dy = ex - x, ey - y
        d = math.hypot(dx, dy)
        if d < 1e-9 or abs(r) < d / 2:
            return [(ex, ey, ez, de)]
        h = math.sqrt(r * r - d * d / 4) * (1 if ccw else -1) * (1 if r > 0 else -1)
        cx = (x + ex) / 2 - dy / d * h
        cy = (y + ey) / 2 + dx / d * h
    else:
        return [(ex, ey, ez, de)]
    radius = math.hypot(x - cx, y - cy)
    a0 = math.atan2(y - cy, x - cx)
    sweep = math.atan2(ey - cy, ex - cx) - a0
    if ccw:
        while sweep <= 1e-9:
            sweep += 2 * math.pi
    else:
        while sweep >= -1e-9:
            sweep -= 2 * math.pi
    n = min(ARC_MAX_SEGMENTS, max(1, math.ceil(abs(sweep) * radius / ARC_MAX_CHORD_MM),
                                  math.ceil(abs(sweep) / ARC_MAX_STEP_RAD)))
    points = []
    for i in range(1, n + 1):
        if i == n:
            points.append((ex, ey, ez, de / n))
        else:
            a = a0 + sweep * i / n
            points.append((cx + radius * math.cos(a), cy + radius * math.sin(a), z + (ez - z) * i / n, de / n))
    return points


def assign_layers_by_z(moves):
    """Sans marqueur de couche : nouvelle couche à chaque remontée de Z hors dépôt."""
    layer = 0
    last_extrusion_z = None
    for k in range(len(moves)):
        if moves.extruding[k]:
            last_extrusion_z = moves.z[k]
        elif last_extrusion_z is not None and moves.z[k] > last_extrusion_z + 1e-3:
            layer += 1
            last_extrusion_z = None
        moves.layer[k] = layer


# --------------------------------------------------------------------------------------------
# Passe 2 : inclinaison optimale de la tête (angle dynamique)
# --------------------------------------------------------------------------------------------

def compute_tilts(moves, b_limit, pivot, progress, b_min=0.0):
    """B (degrés) à la fin de chaque mouvement, d'après la normale de la couche au point déposé."""
    n = len(moves)
    targets = [None] * n

    # Carte de hauteur par couche : cellule → [somme z, nombre].
    cells = {}
    prev_x = prev_y = prev_z = None
    for k in range(n):
        if k % 20000 == 0:
            progress.report(30 + 10 * k / max(1, n))
        x, y, z = moves.x[k], moves.y[k], moves.z[k]
        if moves.extruding[k] and prev_x is not None:
            length = math.hypot(x - prev_x, y - prev_y)
            steps = max(1, int(length / HEIGHTMAP_SAMPLE_MM))
            layer_cells = cells.setdefault(moves.layer[k], {})
            for s in range(steps + 1):
                f = s / steps
                sx = prev_x + (x - prev_x) * f
                sy = prev_y + (y - prev_y) * f
                sz = prev_z + (z - prev_z) * f
                key = (math.floor(sx / HEIGHTMAP_CELL_MM), math.floor(sy / HEIGHTMAP_CELL_MM))
                acc = layer_cells.get(key)
                if acc is None:
                    layer_cells[key] = [sz, 1]
                else:
                    acc[0] += sz
                    acc[1] += 1
        prev_x, prev_y, prev_z = x, y, z

    normal_cache = {}

    def normal_at(layer, x, y):
        key = (layer, math.floor(x / HEIGHTMAP_CELL_MM), math.floor(y / HEIGHTMAP_CELL_MM))
        cached = normal_cache.get(key)
        if cached is not None:
            return cached
        layer_cells = cells.get(layer, {})
        pts = []
        for dx in range(-HEIGHTMAP_RADIUS_CELLS, HEIGHTMAP_RADIUS_CELLS + 1):
            for dy in range(-HEIGHTMAP_RADIUS_CELLS, HEIGHTMAP_RADIUS_CELLS + 1):
                acc = layer_cells.get((key[1] + dx, key[2] + dy))
                if acc is not None:
                    pts.append(((key[1] + dx + 0.5) * HEIGHTMAP_CELL_MM,
                                (key[2] + dy + 0.5) * HEIGHTMAP_CELL_MM,
                                acc[0] / acc[1]))
        result = (0.0, 0.0, 1.0)
        if len(pts) >= 2:
            mx = sum(p[0] for p in pts) / len(pts)
            my = sum(p[1] for p in pts) / len(pts)
            mz = sum(p[2] for p in pts) / len(pts)
            cxx = cxy = cyy = cxz = cyz = 0.0
            for px, py, pz in pts:
                ux, uy, uz = px - mx, py - my, pz - mz
                cxx += ux * ux
                cxy += ux * uy
                cyy += uy * uy
                cxz += ux * uz
                cyz += uy * uz
            det = cxx * cyy - cxy * cxy
            if det > 1e-6 * max(1e-9, (cxx + cyy) ** 2):
                gx = (cxz * cyy - cyz * cxy) / det
                gy = (cyz * cxx - cxz * cxy) / det
            elif cxx + cyy > 1e-9:
                # Cellules alignées (paroi fine) : pente le long de la ligne seulement.
                gx = cxz / (cxx + cyy)
                gy = cyz / (cxx + cyy)
            else:
                gx = gy = 0.0
            norm = math.sqrt(gx * gx + gy * gy + 1.0)
            result = (-gx / norm, -gy / norm, 1.0 / norm)
        normal_cache[key] = result
        return result

    for k in range(n):
        if k % 20000 == 0:
            progress.report(40 + 5 * k / max(1, n))
        if not moves.extruding[k]:
            continue
        x, y = moves.x[k], moves.y[k]
        r = math.hypot(x, y)
        if r < MIN_RADIUS_FOR_TILT_MM:
            targets[k] = 0.0
            continue
        nx, ny, nz = normal_at(moves.layer[k], x, y)
        n_r = (nx * x + ny * y) / r
        b = math.degrees(math.atan2(n_r, nz))
        targets[k] = max(b_min, min(b_limit, b))

    # Trajets à vide : cible du prochain dépôt (la tête s'y prépare pendant le trajet).
    upcoming = 0.0
    for k in range(n - 1, -1, -1):
        if targets[k] is None:
            targets[k] = upcoming
        else:
            upcoming = targets[k]

    # Vitesse d'inclinaison bornée, dans les deux sens (anticipe les changements à venir).
    dist = [0.0] * n
    for k in range(1, n):
        dist[k] = math.dist((moves.x[k - 1], moves.y[k - 1], moves.z[k - 1]),
                            (moves.x[k], moves.y[k], moves.z[k]))
    tilts = targets[:]
    for k in range(1, n):
        step = B_RATE_DEG_PER_MM * dist[k]
        tilts[k] = max(tilts[k - 1] - step, min(tilts[k - 1] + step, tilts[k]))
    for k in range(n - 2, -1, -1):
        step = B_RATE_DEG_PER_MM * dist[k + 1]
        tilts[k] = max(tilts[k + 1] - step, min(tilts[k + 1] + step, tilts[k]))

    # Pivot jamais au-delà de l'axe du plateau : R = r + pivot·sin(B) ≥ 0.
    for k in range(n):
        r = math.hypot(moves.x[k], moves.y[k])
        min_b = -math.degrees(math.asin(min(1.0, r / pivot)))
        if tilts[k] < min_b:
            tilts[k] = min_b
    return tilts


# --------------------------------------------------------------------------------------------
# Passe 3 : émission polaire, avec subdivision adaptative
# --------------------------------------------------------------------------------------------

class Emitter:
    def __init__(self, pivot, tol):
        self.pivot = pivot
        self.tol = tol
        self.c = 0.0  # angle plateau courant (degrés, déroulé)
        self.e = 0.0  # E absolu de sortie
        self.feed = None
        self.out = []
        self.max_error = 0.0
        self.b_min = 0.0
        self.b_max = 0.0

    def polar(self, x, y, z, b_deg, c_ref):
        """(R, C, Z) du pivot pour la pointe de buse (x, y, z) et l'inclinaison B."""
        r = math.hypot(x, y)
        if r < 1e-6:
            c = c_ref
        else:
            theta = math.degrees(math.atan2(y, x))
            c = c_ref + ((theta - c_ref + 180.0) % 360.0 - 180.0)
        b = math.radians(b_deg)
        return r + self.pivot * math.sin(b), c, z - self.pivot * (1.0 - math.cos(b))

    def tip(self, big_r, c_deg, big_z, b_deg):
        b = math.radians(b_deg)
        r = big_r - self.pivot * math.sin(b)
        c = math.radians(c_deg)
        return r * math.cos(c), r * math.sin(c), big_z + self.pivot * (1.0 - math.cos(b))

    def plan(self, p0, p1, b0, b1, n):
        """États polaires aux n+1 points de subdivision, et écart max au milieu des sous-segments."""
        states = []
        c = self.c
        for i in range(n + 1):
            f = i / n
            x = p0[0] + (p1[0] - p0[0]) * f
            y = p0[1] + (p1[1] - p0[1]) * f
            z = p0[2] + (p1[2] - p0[2]) * f
            b = b0 + (b1 - b0) * f
            big_r, c, big_z = self.polar(x, y, z, b, c)
            states.append((big_r, c, big_z, b))
        error = 0.0
        for i in range(n):
            s0, s1 = states[i], states[i + 1]
            mid = self.tip((s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2, (s0[2] + s1[2]) / 2, (s0[3] + s1[3]) / 2)
            f = (i + 0.5) / n
            ex = p0[0] + (p1[0] - p0[0]) * f - mid[0]
            ey = p0[1] + (p1[1] - p0[1]) * f - mid[1]
            ez = p0[2] + (p1[2] - p0[2]) * f - mid[2]
            error = max(error, math.sqrt(ex * ex + ey * ey + ez * ez))
        return states, error

    def start(self, p, b, de, feed):
        r = math.hypot(p[0], p[1])
        self.c = math.degrees(math.atan2(p[1], p[0])) if r > 1e-6 else 0.0
        big_r, c, big_z = self.polar(p[0], p[1], p[2], b, self.c)
        words = f"G00 Y{fmt(c, 4)} X{fmt(big_r, 4)} Z{fmt(big_z, 4)} B{fmt(b, 3)}"
        if abs(de) > E_EPS:
            self.e += de
            words += f" E{fmt(self.e, 5)}"
        self.out.append(words + self.feed_word(feed))

    def move(self, p0, p1, b0, b1, de, feed):
        if p0 == p1 and b0 == b1:
            if abs(de) > E_EPS:
                self.e += de
                self.out.append(f"G00 E{fmt(self.e, 5)}{self.feed_word(feed)}")
            return
        n = 1
        states, error = self.plan(p0, p1, b0, b1, n)
        while error > self.tol and n < MAX_SUBDIVISIONS:
            n *= 2
            states, error = self.plan(p0, p1, b0, b1, n)
        self.max_error = max(self.max_error, error)
        for i in range(1, n + 1):
            big_r, c, big_z, b = states[i]
            self.c = c
            self.b_min = min(self.b_min, b)
            self.b_max = max(self.b_max, b)
            words = f"G00 Y{fmt(c, 4)} X{fmt(big_r, 4)} Z{fmt(big_z, 4)} B{fmt(b, 3)}"
            if abs(de) > E_EPS:
                self.e += de / n
                words += f" E{fmt(self.e, 5)}"
            self.out.append(words + self.feed_word(feed))

    def feed_word(self, feed):
        if feed == self.feed:
            return ""
        self.feed = feed
        return f" F{fmt(feed, 1)}"


def convert(text, mode, center_x, center_y, pivot, b_limit, tol, source, drop_radius=0.0, b_min=0.0):
    progress = Progress()
    lines = text.split("\n")
    items, moves = read_gcode(lines, center_x, center_y, progress)
    n = len(moves)
    if mode == "dynamic":
        tilts = compute_tilts(moves, b_limit, pivot, progress, b_min)
    else:
        tilts = [0.0] * n
    progress.report(45)

    emitter = Emitter(pivot, tol)
    header = [
        f"; generated by Apex Slicer {VERSION} (conversion polaire depuis {source})" if source
        else f"; generated by Apex Slicer {VERSION} (conversion polaire)",
        f"; apex_conversion_mode = {mode}",
        f"; apex_bed_center = {fmt(center_x, 3)},{fmt(center_y, 3)}",
        f"; apex_nozzle_pivot_mm = {fmt(pivot, 3)}",
        f"; apex_dropped_outside_radius_mm = {fmt(drop_radius, 3)}",
        "G21",
        "G90",
        "M82",
    ]
    emitter.out.extend(header)

    prev = None
    prev_b = 0.0
    done = 0
    dropped = 0
    after_drop = False
    for item in items:
        if isinstance(item, str):
            emitter.out.append(item)
            continue
        for k in range(item[0], item[1]):
            done += 1
            if done % 5000 == 0:
                progress.report(45 + 55 * done / max(1, n))
            p = (moves.x[k], moves.y[k], moves.z[k])
            de = moves.de[k]
            if drop_radius and math.hypot(p[0], p[1]) > drop_radius:
                # Hors du plateau : mouvement supprimé. Les rétractions/réinjections (sans dépôt)
                # sont gardées sur place pour ne pas fausser la quantité de filament rétractée.
                dropped += 1
                after_drop = True
                if prev is not None and abs(de) > E_EPS and not moves.extruding[k]:
                    emitter.move(prev, prev, prev_b, prev_b, de, moves.feed[k])
                continue
            if after_drop and moves.extruding[k]:
                # Son vrai point de départ était hors plateau : on s'y rend sans déposer.
                de = 0.0
            after_drop = False
            if prev is None:
                # Premier mouvement : position de départ inconnue, on s'y rend directement.
                emitter.start(p, tilts[k], de, moves.feed[k])
            else:
                emitter.move(prev, p, prev_b, tilts[k], de, moves.feed[k])
            prev, prev_b = p, tilts[k]
    progress.report(100)
    summary = {
        "movesIn": n,
        "droppedMoves": dropped,
        "linesOut": len(emitter.out),
        "maxErrorMm": emitter.max_error,
        "bMin": emitter.b_min,
        "bMax": emitter.b_max,
    }
    return "\n".join(emitter.out) + "\n", summary


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--mode", choices=("polar", "dynamic"), default="polar")
    parser.add_argument("--center-x", type=float, required=True)
    parser.add_argument("--center-y", type=float, required=True)
    parser.add_argument("--pivot", type=float, default=46.0)
    parser.add_argument("--b-limit", type=float, default=45.0)
    parser.add_argument("--tol", type=float, default=0.01)
    parser.add_argument("--source", default="")
    parser.add_argument("--drop-outside-radius", type=float, default=0.0,
                        help="supprime les mouvements dont la buse finit au-delà de ce rayon (mm) ; 0 : aucun")
    parser.add_argument("--b-min", type=float, default=0.0,
                        help="B minimal (degrés) : la tête ne penche que vers +R sur la machine, B ≥ 0")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8", errors="replace") as f:
        text = f.read()
    output, summary = convert(text, args.mode, args.center_x, args.center_y, args.pivot,
                              args.b_limit, args.tol, args.source, args.drop_outside_radius, args.b_min)
    with open(args.output, "w", encoding="utf-8", newline="\n") as f:
        f.write(output)
    sys.stdout.write(json.dumps(summary) + "\n")


if __name__ == "__main__":
    main()
