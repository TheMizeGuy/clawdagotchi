"""The frame contract, checked from outside the engine.

`claude plugin test` runs each suite with no file system (a test's `$` has
no `fs`, a hook's `$.fs.read` needs a stub, and a `.json` file cannot be
imported), so the check that reads scripts/frames.json lives here: the table
in hooks/lib/sprite.ts (SOLO_FRAMES, SCENE_FRAMES) must equal the JSON kind
by kind (its solo frames, then its scenes), entry for entry and in order, and
every frame's PNG must exist at the size its kind gives (width and height
times `scale`). The JSON may interleave the kinds (0.5.0 appended a solo
frame after the scenes); the code keeps one table per kind.

Run from the repo root (stdlib only):
    python3 -m unittest discover -s plugins/mize-coworker/tests -p 'test_*.py'
"""

import json
import re
import struct
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
FRAMES_JSON = PLUGIN / "scripts" / "frames.json"
SPRITE_TS = PLUGIN / "hooks" / "lib" / "sprite.ts"
FRAMES_DIR = PLUGIN / "assets" / "frames"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def table_block(source: str, name: str) -> list[tuple[str, str]]:
    """The `key: 'value'` lines of `export const <name> = { ... }` in sprite.ts, in order."""
    match = re.search(r"export const " + name + r" = \{\n(.*?)\n\} as const", source, re.S)

    if match is None:
        raise AssertionError(f"{name} not found in {SPRITE_TS}")

    entries = []

    for line in match.group(1).splitlines():
        entry = re.fullmatch(r"\s*([A-Za-z0-9]+): '([A-Za-z0-9]+)',", line)

        if entry is None:
            raise AssertionError(f"{name}: a line that is not one entry: {line!r}")

        entries.append((entry.group(1), entry.group(2)))

    return entries


def png_size(path: Path) -> tuple[int, int]:
    """Width and height from a PNG's IHDR chunk."""
    with path.open("rb") as handle:
        head = handle.read(24)

    if head[:8] != PNG_SIGNATURE or head[12:16] != b"IHDR":
        raise AssertionError(f"{path.name} is not a PNG")

    return struct.unpack(">II", head[16:24])


class FrameContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads(FRAMES_JSON.read_text())
        source = SPRITE_TS.read_text()
        cls.solo = table_block(source, "SOLO_FRAMES")
        cls.scene = table_block(source, "SCENE_FRAMES")

    def test_the_table_mirrors_the_json(self) -> None:
        solo = []
        scene = []

        for frame in self.contract["frames"]:
            if frame["kind"] == "solo":
                solo.append((frame["name"], frame["braille"]))
            else:
                self.assertEqual(frame["kind"], "scene", frame["name"])
                scene.append((frame["name"], frame["solo"]))

        self.assertEqual(self.solo, solo)
        self.assertEqual(self.scene, scene)
        self.assertEqual((len(solo), len(scene)), (94, 38))

    def test_every_name_is_one_frame(self) -> None:
        names = [frame["name"] for frame in self.contract["frames"]]

        self.assertEqual(len(names), 132)
        self.assertEqual(len(set(names)), len(names))

    def test_every_scene_names_a_solo_frame(self) -> None:
        solos = {name for name, _ in self.solo}

        for name, solo in self.scene:
            self.assertIn(solo, solos, name)

    def test_every_frame_has_its_png(self) -> None:
        for frame in self.contract["frames"]:
            path = FRAMES_DIR / f"{frame['name']}.png"

            self.assertTrue(path.is_file(), f"missing {path}")

    def test_every_png_is_its_kind_s_size(self) -> None:
        scale = self.contract["scale"]

        for frame in self.contract["frames"]:
            box = self.contract[frame["kind"]]
            path = FRAMES_DIR / f"{frame['name']}.png"

            if path.is_file():
                self.assertEqual(png_size(path), (box["width"] * scale, box["height"] * scale), frame["name"])

    def test_the_boxes_match_the_code(self) -> None:
        # the solo box is the footer's 8x2 and the scene box the spinner's 12x2 (sprite.ts PICTURE.big, SCENE_BOX)
        self.assertEqual((self.contract["solo"]["columns"], self.contract["solo"]["rows"]), (8, 2))
        self.assertEqual((self.contract["scene"]["columns"], self.contract["scene"]["rows"]), (12, 2))


if __name__ == "__main__":
    unittest.main()
