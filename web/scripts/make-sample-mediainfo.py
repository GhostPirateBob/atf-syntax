"""Write web/src/lib/sample-mediainfo.json: mediainfo's JSON for the playground's sample tracks.

Runs the mediainfo CLI on the real files and keeps its General and Audio tracks verbatim, minus
the keys that describe this machine (full path, folder, file dates). Each entry carries the
generic path the playground shows (under D:\\Music). Needs the mediainfo CLI and the files
themselves, so it's only re-run when the samples change. Point it at your own music folder:
    set ATF_SAMPLE_MUSIC=D:\\path\\to\\music     (Windows cmd; or $env:ATF_SAMPLE_MUSIC in pwsh)
    python -I web/scripts/make-sample-mediainfo.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path, PureWindowsPath

OUT = Path(__file__).resolve().parent.parent / "src" / "lib" / "sample-mediainfo.json"

# Where the real files live on this machine (not committed), and the folder the playground shows.
MUSIC_ROOT = os.environ.get("ATF_SAMPLE_MUSIC")
SHOWN_ROOT = PureWindowsPath(r"D:\Music")

# Each sample's path relative to the music folder. The shown path is SHOWN_ROOT plus this.
SAMPLES = [
    r"Alfie Templeman\Happiness in Liquid Form\02 Alfie Templeman - Things I Thought Were Mine.mp3",
    r"JAY-Z\Magna Carta... Holy Grail\05 JAY-Z feat. Frank Ocean - Oceans.mp3",
    r"The Notorious B.I.G_\Ready to Die\10 Juicy.mp3",
    r"Daft Punk\Discovery\1-01 One More Time.mp3",
]

# Hand edits applied over mediainfo's output, keyed by file name:
# {file name: {mediainfo General-track field: value}}.
OVERRIDES = {
    "05 JAY-Z feat. Frank Ocean - Oceans.mp3": {
        "Performer": "JAY-Z",
        "Performer_Sort": "Jay-Z",
        "Album": "Magna Carta Holy Grail",
    },
    # The tidy one: a downloader's running number (0318) and a 2021 reissue date replaced with the
    # album's track number and its 2001 release date.
    "1-01 One More Time.mp3": {
        "Track_Position": "1",
        "Recorded_Date": "2001-02-26",
    },
}

DROP = {
    "CompleteName", "FolderName", "FileName", "FileNameExtension",
    "File_Created_Date", "File_Created_Date_Local", "File_Modified_Date", "File_Modified_Date_Local",
    "@ref", "extra",
}

if not MUSIC_ROOT:
    sys.exit("Set ATF_SAMPLE_MUSIC to the folder that holds the sample files (see the docstring).")

entries = []
for rel in SAMPLES:
    real = Path(MUSIC_ROOT, *PureWindowsPath(rel).parts)
    shown = str(SHOWN_ROOT / rel)
    raw = subprocess.run(["mediainfo", "--Output=JSON", str(real)], capture_output=True, check=True).stdout
    tracks = json.loads(raw.decode("utf-8"))["media"]["track"]
    kept = [{k: v for k, v in t.items() if k not in DROP} for t in tracks if t.get("@type") in ("General", "Audio")]
    for t in kept:
        if t.get("@type") == "General":
            t.update(OVERRIDES.get(PureWindowsPath(rel).name, {}))
    entries.append({"filename": shown, "media": {"track": kept}})

OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
print(f"wrote {OUT} ({len(entries)} tracks)")
