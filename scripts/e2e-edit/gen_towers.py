"""Génère les G-code polaires de test du banc e2e : towers.gcode (deux tours à 180°, couches de 0,2 mm :
symétrie cyclique) et thin.gcode (une tour, couches de 0,1 mm : rognage). Format Apex : G00 Y<C> X<R> Z B E F."""
import math
import os

OUT = os.path.dirname(os.path.abspath(__file__))


def tower_file(name, centers, layer_mm, layers, comment):
    lines = [f"; {comment}", "G21", "G90", "M82", "G92 E0", "G00 B0.0000 F1200"]
    e = 0.0
    rad = 4.0
    for cx in centers:
        for layer in range(1, layers + 1):
            z = layer_mm * layer
            pts = []
            n = 48
            for k in range(n + 1):
                th = 2 * math.pi * k / n
                x = cx + rad * math.cos(th)
                y = rad * math.sin(th)
                c = math.degrees(math.atan2(y, x))
                if cx < 0 and c < 0:
                    c += 360.0
                pts.append((math.hypot(x, y), c))
            r0, c0 = pts[0]
            lines.append(f"G00 Y{c0:.4f} X{r0:.4f} Z{z + 1.0:.4f} B0.0000 F3600")
            lines.append(f"G00 Y{c0:.4f} X{r0:.4f} Z{z:.4f} B0.0000 F3600")
            prev = pts[0]
            for r, c in pts[1:]:
                px, py = prev[0] * math.cos(math.radians(prev[1])), prev[0] * math.sin(math.radians(prev[1]))
                qx, qy = r * math.cos(math.radians(c)), r * math.sin(math.radians(c))
                e += math.hypot(qx - px, qy - py) * 0.06 * layer_mm
                lines.append(f"G00 Y{c:.4f} X{r:.4f} Z{z:.4f} B0.0000 E{e:.5f} F1800")
                prev = (r, c)
    with open(os.path.join(OUT, name), "w") as f:
        f.write("\n".join(lines) + "\n")


tower_file("towers.gcode", (60.0, -60.0), 0.2, 30, "deux tours symetriques (banc de test)")
tower_file("thin.gcode", (60.0,), 0.1, 60, "une tour fine (banc de test du rognage)")
