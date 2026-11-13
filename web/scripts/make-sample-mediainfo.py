"""Write web/src/lib/sample-mediainfo.json: mediainfo's JSON for the playground's sample tracks.

Runs the mediainfo CLI on the real files and keeps its General and Audio tracks verbatim, minus
the keys that describe this machine (full path, folder, file dates). Each entry carries the
generic path the playground shows. Needs the mediainfo CLI and the files themselves (the author's
music folder), so it's only re-run when the samples change:
    python -I web/scripts/make-sample-mediainfo.py
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "lib" / "sample-mediainfo.json"

# (real file on this machine, path shown in the playground)
SAMPLES = [
    (r"D:\__MUSIC\Alfie Templeman\Happiness in Liquid Form\02 Alfie Templeman - Things I Thought Were Mine.mp3",
     r"D:\Music\Alfie Templeman\Happiness in Liquid Form\02 Alfie Templeman - Things I Thought Were Mine.mp3"),
    (r"D:\__MUSIC\JAY-Z\Magna Carta... Holy Grail\05 JAY-Z feat. Frank Ocean - Oceans.mp3",
     r"D:\Music\JAY-Z\Magna Carta... Holy Grail\05 JAY-Z feat. Frank Ocean - Oceans.mp3"),
    (r"D:\__MUSIC\The Notorious B.I.G_\Ready to Die\10 Juicy.mp3",
     r"D:\Music\The Notorious B.I.G_\Ready to Die\10 Juicy.mp3"),
    (r"D:\__MUSIC\ZZ_LOOSE\Kaptein Frosk (music video in description)-291000340.mp3",
     r"D:\Music\ZZ_LOOSE\Kaptein Frosk (music video in description)-291000340.mp3"),
]

DROP = {
    "CompleteName", "FolderName", "FileName", "FileNameExtension",
    "File_Created_Date", "File_Created_Date_Local", "File_Modified_Date", "File_Modified_Date_Local",
    "@ref", "extra",
}

entries = []
for real, shown in SAMPLES:
    raw = subprocess.run(["mediainfo", "--Output=JSON", real], capture_output=True, check=True).stdout
    tracks = json.loads(raw.decode("utf-8"))["media"]["track"]
    kept = [{k: v for k, v in t.items() if k not in DROP} for t in tracks if t.get("@type") in ("General", "Audio")]
    entries.append({"filename": shown, "media": {"track": kept}})

OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
print(f"wrote {OUT} ({len(entries)} tracks)")
