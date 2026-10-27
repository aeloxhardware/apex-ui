#!/usr/bin/env python3
"""Parité du convertisseur polaire natif (native/src/polar_main.cpp) avec python/gcode_to_polar.py.

    python scripts/check_polar_parity.py <fichier.gcode> <apex_gcode_to_polar> [--center-x 125 --center-y 125]

Compare octet à octet la sortie des deux modes (polar, dynamic) ; en dynamique, B est borné comme le script
(`--b-min -45` des deux côtés) et l'évitement des collisions n'est pas demandé (le script Python n'en a pas).
Code de sortie 1 au premier écart.
"""
import argparse
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gcode")
    ap.add_argument("native_exe")
    ap.add_argument("--center-x", default="125")
    ap.add_argument("--center-y", default="125")
    args = ap.parse_args()
    ok = True
    with tempfile.TemporaryDirectory() as tmp:
        for mode in ("polar", "dynamic"):
            common = ["--mode", mode, "--center-x", args.center_x, "--center-y", args.center_y,
                      "--b-min", "-45", "--source", "parite"]
            py_out, cc_out = pathlib.Path(tmp, f"py_{mode}.gcode"), pathlib.Path(tmp, f"cc_{mode}.gcode")
            subprocess.run([sys.executable, str(ROOT / "python" / "gcode_to_polar.py"), args.gcode, str(py_out), *common],
                           check=True, capture_output=True)
            subprocess.run([args.native_exe, args.gcode, str(cc_out), *common], check=True, capture_output=True)
            same = py_out.read_bytes() == cc_out.read_bytes()
            print(f"{mode:8s} {'identique' if same else 'DIFFERENT'}")
            ok &= same
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
