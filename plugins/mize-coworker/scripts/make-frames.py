#!/usr/bin/env python3
"""Draws every picture frame of Claude, the mize-coworker mascot, as pixel art: one PNG per
entry of scripts/frames.json, under assets/frames/<name>.png.

The art lives here as code. `Pose` and `claude()` are one parametric renderer for Claude
(eyes, arms, legs, squash and stretch, lift, tint); each prop has its own drawing function;
the FRAMES table near the end composes them, one line per frame. To change a frame, change
its arguments there (or the pose constant it names), run `python3 scripts/make-frames.py`
(needs Pillow) and look at the sheets (`--sheet <dir>`), then commit the PNGs.

The format is fixed by the mod:
- a logical grid of hard pixels, no anti-aliasing, exported at 4x (one logical pixel is a 4x4
  block), RGBA on a transparent background;
- solo frames are 70x40 (a 280x160 PNG the terminal draws in 8x2 cells, about 2 device pixels a
  logical pixel); scene frames are 105x40 (420x160, 12x2 cells), Claude in the left 70 columns
  exactly as in his solo pose and the prop at the right (columns 60 to 104);
- his feet stand on row 37 (hops and steps excepted); rows 38 and 39 hold the floor under him,
  an opaque ellipse a shade lighter than the terminal (FLOOR).

`--sheet <dir>` also writes, for review: sheet-device.png (every frame at the size the
terminal draws it), sheet-zoom.png (the 4x export) and loops.png (each animation loop as a
strip). The script fails if frames.json and FRAMES disagree on any name or kind, if a scene
does not keep every pixel of Claude's pose in the solo frame it names (only the eyes may turn,
as frames.json asks of read2), or if the frames come to 500 KB or more.
"""
from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import dataclass, replace

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, 'frames.json')
OUT = os.path.normpath(os.path.join(HERE, '..', 'assets', 'frames'))

SCALE = 4
SOLO_W, SCENE_W, H = 70, 105, 40
MAX_BYTES = 500 * 1024          # the whole folder of frames


# ------------------------------------------------------------------------------- colors

def rgb(code, a=255):
    code = code.lstrip('#')
    return (int(code[0:2], 16), int(code[2:4], 16), int(code[4:6], 16), a)


def mix(c1, c2, t):
    """c1 moved a fraction t of the way to c2 (alpha kept from c1)."""
    return tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (c1[3],)


def fade(c, a):
    return c[:3] + (a,)


# Catppuccin Mocha, for the props and effects
TEXT, SUBTEXT = rgb('#cdd6f4'), rgb('#a6adc8')
SURFACE1, SURFACE2, BASE = rgb('#45475a'), rgb('#585b70'), rgb('#1e1e2e')
BLUE, LAVENDER, MAUVE = rgb('#89b4fa'), rgb('#b4befe'), rgb('#cba6f7')
SKY, SAPPHIRE = rgb('#89dceb'), rgb('#74c7ec')
GREEN, YELLOW, PEACH = rgb('#a6e3a1'), rgb('#f9e2af'), rgb('#fab387')
RED, PINK = rgb('#f38ba8'), rgb('#f5c2e7')
WHITE = rgb('#ffffff')

# The floor under Claude and under the things that stand on it. The terminal is #11111b, so a
# shadow (black at 31%, 0.4.0) could not be seen; an opaque ellipse a shade lighter can.
FLOOR = BASE

# Claude: cel shading in three tones on the orange, a deeper line where the legs meet the body
SKIN = {
    'light': rgb('#e8926f'),
    'base': rgb('#d97757'),
    'dark': rgb('#bd6045'),
    'deep': rgb('#9e4c36'),
}
GLOSS = rgb('#f2a886')       # a few pixels of shine at the top left of the body
EYE, GLINT = BASE, rgb('#f8f4ff')
BLUSH = rgb('#ec8a7f')
TONGUE = rgb('#e0707e')
FROST, FROST_DEEP = rgb('#eef4ff'), rgb('#bcd0f2')


# ------------------------------------------------------------------------------- canvas

def over(src, dst):
    """src composited over dst (straight RGBA, integer math so every run is byte-identical)."""
    sa = src[3]
    if dst is None or sa == 255 or dst[3] == 0:
        return src
    if sa == 0:
        return dst
    da = dst[3]
    oa = sa * 255 + da * (255 - sa)
    rgb_ = tuple((src[i] * sa * 255 + dst[i] * da * (255 - sa) + oa // 2) // oa for i in range(3))
    return rgb_ + ((oa + 127) // 255,)


class Canvas:
    """Logical pixels, alpha-composited as they are drawn. `pose` is Claude's pose in a frame."""

    def __init__(self, w, h=H):
        self.w, self.h = w, h
        self.px = {}
        self.pose = None

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h and c[3] > 0:
            self.px[(x, y)] = over(c, self.px.get((x, y)))

    def fill(self, mask, c):
        for x, y in sorted(mask):
            self.put(x, y, c)

    def paint(self, colors):
        for (x, y) in sorted(colors):
            self.put(x, y, colors[(x, y)])

    def erase(self, mask):
        for q in mask:
            self.px.pop(q, None)

    def paste(self, other, dx=0, dy=0):
        for (x, y) in sorted(other.px):
            self.put(x + dx, y + dy, other.px[(x, y)])

    def image(self, scale=SCALE):
        small = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            small.putpixel((x, y), c)
        return small.resize((self.w * scale, self.h * scale), Image.NEAREST)


# ------------------------------------------------------------------------------- shapes
# A mask is a set of (x, y) pixels. Round shapes test each pixel's center (x + .5, y + .5).

def rect(x0, y0, x1, y1):
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def rounded(x0, y0, x1, y1, corner):
    """A rectangle whose rows are inset by `corner` at the top and the bottom (row by row)."""
    out, n = set(), y1 - y0 + 1
    for i in range(n):
        k = min(i, n - 1 - i)
        inset = corner[k] if k < len(corner) else 0
        out |= {(x, y0 + i) for x in range(x0 + inset, x1 - inset + 1)}
    return out


def ellipse(cx, cy, rx, ry):
    return {(x, y) for x in range(math.floor(cx - rx) - 1, math.ceil(cx + rx) + 1)
            for y in range(math.floor(cy - ry) - 1, math.ceil(cy + ry) + 1)
            if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1.0001}


def disc(cx, cy, r):
    return ellipse(cx, cy, r, r)


def capsule(ax, ay, bx, by, r, square=2.0):
    """Every pixel within r of the segment from (ax, ay) to (bx, by). `square` above 2 makes
    the ends squarer (the distance past an end is a superellipse norm of that power)."""
    out = set()
    vx, vy = bx - ax, by - ay
    length = math.hypot(vx, vy)
    ux, uy = (vx / length, vy / length) if length else (1.0, 0.0)
    for y in range(math.floor(min(ay, by) - r) - 1, math.ceil(max(ay, by) + r) + 1):
        for x in range(math.floor(min(ax, bx) - r) - 1, math.ceil(max(ax, bx) + r) + 1):
            px, py = x + .5 - ax, y + .5 - ay
            along = px * ux + py * uy
            perp = abs(-px * uy + py * ux)
            past = max(0.0, -along, along - length)
            if past ** square + perp ** square <= r ** square + 1e-6:
                out.add((x, y))
    return out


def polygon(points):
    """Pixels whose centers fall inside the polygon (even-odd rule)."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    out = set()
    for y in range(math.floor(min(ys)), math.ceil(max(ys)) + 1):
        for x in range(math.floor(min(xs)), math.ceil(max(xs)) + 1):
            px, py, inside = x + .5, y + .5, False
            for i in range(len(points)):
                (x1, y1), (x2, y2) = points[i], points[i - 1]
                if (y1 > py) != (y2 > py) and px < x1 + (py - y1) * (x2 - x1) / (y2 - y1):
                    inside = not inside
            if inside:
                out.add((x, y))
    return out


def near(x, y):
    return ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))


def edge(mask):
    """The pixels of a mask that touch the outside (4-neighbours)."""
    return {(x, y) for x, y in mask if not set(near(x, y)) <= mask}


def around(mask):
    """The pixels just outside a mask (4-neighbours)."""
    return {q for x, y in mask for q in near(x, y)} - mask


def tidy(mask):
    """A mask without one-pixel spurs and one-pixel pits: a pixel with one neighbour or none in
    it goes, a hole with three or four comes in, until nothing changes. Unions of discs come out
    of the raster with both, and an outline drawn on them shows each one as a stray pixel."""
    out = set(mask)
    while True:
        spurs = {q for q in out if sum(n in out for n in near(*q)) <= 1}
        pits = {q for q in around(out) if sum(n in out for n in near(*q)) >= 3}
        if not spurs and not pits:
            return out
        out = (out - spurs) | pits


def mirrored(mask, width=SOLO_W):
    return {(width - 1 - x, y) for x, y in mask}


def stamp(c, rows, x, y, colors):
    """Draws a small picture written as text: each character names a color in `colors`;
    any other character ('.', ' ') is left empty."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in colors:
                c.put(x + i, y + j, colors[ch])


def shade(mask, tones, light=2, dark=3):
    """Cel shading by distance to the shape's own top and bottom edges: the top `light` rows
    of every column take the light tone, the bottom `dark` rows the dark one."""
    out = {}
    for x, y in mask:
        up = 1
        while (x, y - up) in mask:
            up += 1
        down = 1
        while (x, y + down) in mask:
            down += 1
        if up <= light:
            out[(x, y)] = tones['light']
        elif down <= dark:
            out[(x, y)] = tones['dark']
        else:
            out[(x, y)] = tones['base']
    return out


def line_px(points):
    """The pixels of a polyline, one per step, with no doubled corners (each pixel touches the
    next one by a side or a corner, never both)."""
    out = []
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        n = max(abs(bx - ax), abs(by - ay), 1)
        for i in range(n + 1):
            q = (round(ax + (bx - ax) * i / n), round(ay + (by - ay) * i / n))
            if not out or out[-1] != q:
                out.append(q)
    keep = []
    for i, q in enumerate(out):
        if keep and i + 1 < len(out):
            a, b = keep[-1], out[i + 1]
            if abs(a[0] - b[0]) == 1 and abs(a[1] - b[1]) == 1 and (q[0] in (a[0], b[0])) and (q[1] in (a[1], b[1])):
                continue        # a corner pixel between two diagonal neighbours: drop it
        keep.append(q)
    return keep


# ------------------------------------------------------------------------------- Claude

GROUND = 37                 # the bottom row of his feet
BX0, BX1 = 15, 54           # body columns: 40 wide, about 9-pixel margins outside the arms
BY1, BH = 31, 24            # body bottom row and height (rows 8 to 31)
CORNER = (3, 2, 1)          # body corner insets, row by row from the top and the bottom
LEGS = (17, 24, 42, 49)     # left column of each leg, 4 wide, in two pairs
LEG_W = 4
ARM_R = 3.5                 # half the arm's thickness (7 pixels)
FORE_R = 3.0                # half a forearm's thickness, below a bent elbow
ARM_SQUARE = 4.0            # how square the arm's ends are (2 is round)
SHOULDER = 13.5             # the arm's pivot, below the top of the body
EYE_IN, EYE_TOP = 9, 6      # the eye box (4x7): in from the body's side, down from its top


@dataclass(frozen=True)
class Arm:
    """One arm: a bar with squared-off rounded ends from the shoulder (just inside the body's
    side) to the hand, drawn behind the body. (dx, dy) is the hand's offset from the shoulder,
    written for the left arm (negative dx is outward); the right arm mirrors it. elbow, an
    offset from the shoulder too, bends the arm there, the forearm a little slimmer. front:
    the forearm comes toward the viewer, drawn over the body with a deep line where it crosses
    it (the upper arm stays behind)."""
    dx: float = -3.0
    dy: float = 0.0
    elbow: tuple | None = None
    front: bool = False


REST = Arm()                       # the nub at his side
TUCK = Arm(-1, 8, elbow=(-6, 3.5), front=True)   # elbows out, the hands forward and down on a desk
LOW = Arm(-2.5, 2.5)               # hanging a little lower (crouching)
SWING_F = Arm(-3, 1.5)             # walking
SWING_B = Arm(-3.5, -1.5)
UP = Arm(-6, -9)                   # raised, out to the side
HIGH = Arm(-5, -10.5)              # raised high, a little outward
LAG = Arm(-7, -5)                  # still up and out after a landing
ELBOW = (-9, -1)                   # waving: the upper arm out to the side, the forearm up
WAVE_OUT = Arm(-14, -11.5, elbow=ELBOW)     # the forearm tilted away from his head
WAVE_IN = Arm(-5.5, -12, elbow=ELBOW)       # and toward it
STARTLE = Arm(-6, -6)              # flinching
STRETCH = Arm(-8, -6)              # yawning, stretching out
STRETCH_HIGH = Arm(-6.5, -11)      # yawning, fully stretched
HOLD = Arm(-4.5, -2)               # holding something up at his side


@dataclass(frozen=True)
class Pose:
    """Claude, front on. eyes: a key of EYES; look: shifts the eyes (x, y); arms: (left,
    right); lift: raises the body (negative lowers it, bending the legs); tall and wide:
    stretch the body (negative squashes it); splay: pushes the outer legs out; feet: each
    foot's height above the ground; mouth, brows, blush: extra expression; tint: 'sleep' or
    'cold'."""
    eyes: str = 'open'
    look: tuple = (0, 0)
    arms: tuple = (REST, REST)     # None: tucked out of sight
    lift: int = 0
    tall: int = 0
    wide: int = 0
    splay: int = 0
    feet: tuple = (0, 0, 0, 0)
    mouth: str | None = None
    brows: str | None = None
    blush: bool = False
    tint: str | None = None
    frost: bool = False


# Eyes: (dx, dy, rows, mirror) placed on the 4x7 eye box; '#' dark, 'o' the glint. With
# mirror the right eye is the left one flipped; without it both are the same (the glint stays
# at the upper left, where the light comes from).
EYES = {
    'open':    (0, 0, ('####', '#o##', '#o##', '####', '####', '####', '####'), False),
    'wide':    (0, -1, ('####', '#oo#', '#o##', '####', '####', '####', '####', '####'), False),
    'focus':   (0, 2, ('####', '#o##', '####', '####', '####'), False),
    'half':    (0, 3, ('####', '####', '####', '####'), False),   # the lid down over the glint
    'blink':   (0, 4, ('####', '####'), False),
    'happy':   (-1, 1, ('.####.', '##..##', '#....#'), False),
    'sleepy':  (-1, 4, ('#....#', '.####.'), False),
    'squeeze': (-1, 1, ('##....', '.###..', '...###', '.###..', '##....'), True),
    'worried': (0, -1, ('####', '#o##', '####', '####', '####', '####'), False),
}
BROWS = {'worried': (0, -4, ('..##', '##..'))}
MOUTHS = {
    'o': ('.##.', '####', '####', '.##.'),
    'O': ('.###.', '#####', '#####', '##t##', '#ttt#', '.###.'),
}


def body_box(p):
    x0, x1 = BX0 - p.wide, BX1 + p.wide
    y1 = BY1 - p.lift
    return x0, y1 - (BH + p.tall) + 1, x1, y1


def shoulder(x0, y0):
    """The left arm's pivot (the right one mirrors it)."""
    return x0 + 1.5, y0 + SHOULDER


def arm_masks(arm, x0, y0, right):
    """An arm's upper arm (empty when it is straight) and its forearm (the whole of a straight
    arm), as masks."""
    sx, sy = shoulder(x0, y0)
    hx, hy = sx + arm.dx, sy + arm.dy
    if arm.elbow:
        ex, ey = sx + arm.elbow[0], sy + arm.elbow[1]
        upper = capsule(sx, sy, ex, ey, ARM_R, ARM_SQUARE)
        fore = capsule(ex, ey, hx, hy, FORE_R, ARM_SQUARE)
    else:
        upper, fore = set(), capsule(sx, sy, hx, hy, ARM_R, ARM_SQUARE)
    return (mirrored(upper), mirrored(fore)) if right else (upper, fore)


def hand(pose, right=True):
    """Where a pose's right (or left) hand is, as a point on the canvas (pixel centers at .5)."""
    x0, y0, _, _ = body_box(pose)
    arm = pose.arms[1 if right else 0]
    sx, sy = shoulder(x0, y0)
    hx, hy = sx + arm.dx, sy + arm.dy
    return (SOLO_W - hx, hy) if right else (hx, hy)


def tinted(c, tint):
    if tint == 'sleep':
        return mix(c, rgb('#5a4a78'), .15)
    if tint == 'cold':
        return mix(c, rgb('#8aa4dc'), .3)
    return c


SIDE_SHADE = 1               # columns at the body's right edge that take the dark tone


def body_tones(body):
    """The body's cel shading: light along the top, dark along the bottom, and a dark rim
    down the right side, away from the light."""
    tones = shade(body, SKIN, light=2, dark=3)
    for x, y in body:
        if tones[(x, y)] == SKIN['base'] and any((x + k, y) not in body for k in range(1, SIDE_SHADE + 1)):
            tones[(x, y)] = SKIN['dark']
    return tones


def floor(c, cx, half, row=GROUND + 1):
    """The floor under something about 2 * half wide centered at cx: an opaque ellipse in two
    rows, the lower one shorter."""
    if not FLOOR or half < 3:
        return
    a, b = math.floor(cx - half), math.ceil(cx + half) - 1
    c.fill(rect(a + 1, row, b - 1, row), FLOOR)
    c.fill(rect(a + 4, row + 1, b - 4, row + 1), FLOOR)


def face(c, p):
    """His face: the blush, the eyes, the brows and the mouth of a pose."""
    x0, y0, x1, _ = body_box(p)
    ey = y0 + EYE_TOP
    if p.blush:
        for bx in (x0 + 7, x1 - 10):
            c.fill(rect(bx, ey + 9, bx + 3, ey + 9), BLUSH)
    dx, dy, rows, mirror = EYES[p.eyes]
    for side, ex in enumerate((x0 + EYE_IN, x1 - EYE_IN - 3)):
        r = rows
        ox = dx
        if side == 1 and mirror:
            r = tuple(row[::-1] for row in rows)
            ox = 4 - len(rows[0]) - dx
        stamp(c, r, ex + ox + p.look[0], ey + dy + p.look[1], {'#': EYE, 'o': GLINT})
    if p.brows:
        bdx, bdy, brow = BROWS[p.brows]
        for side, ex in enumerate((x0 + EYE_IN, x1 - EYE_IN - 3)):
            r = brow if side == 0 else tuple(row[::-1] for row in brow)
            stamp(c, r, ex + bdx + p.look[0], ey + bdy + p.look[1], {'#': EYE})
    if p.mouth:
        m = MOUTHS[p.mouth]
        stamp(c, m, (x0 + x1 + 1) // 2 - len(m[0]) // 2, ey + 9, {'#': EYE, 't': TONGUE})


def claude(p: Pose):
    """Claude in a pose, on his own 70x40 canvas."""
    c = Canvas(SOLO_W)
    c.pose = p
    x0, y0, x1, y1 = body_box(p)
    body = rounded(x0, y0, x1, y1, CORNER)
    arms = [(a,) + arm_masks(a, x0, y0, i == 1) for i, a in enumerate(p.arms) if a]

    # behind the body: the arms (a forearm that comes forward excepted), then the legs
    for a, upper, fore in arms:
        colors = shade(upper | fore, SKIN, light=2, dark=2)
        behind = upper if a.front else upper | fore
        c.paint({q: v for q, v in colors.items() if q in behind and q not in body})
    for i, lx in enumerate(LEGS):
        lx += (-p.splay if i == 0 else p.splay if i == 3 else 0)
        top, bottom = y1 + 1, GROUND - p.feet[i]
        n = bottom - top + 1
        for k in range(n):
            tone = 'deep' if k == 0 else 'dark' if (k >= n / 2 or n <= 3) else 'base'
            c.fill(rect(lx, top + k, lx + LEG_W - 1, top + k), SKIN[tone])

    # the body: three tones and a little shine
    c.paint(body_tones(body))
    c.fill({(x0 + 4, y0 + 2), (x0 + 5, y0 + 2), (x0 + 3, y0 + 3), (x0 + 6, y0 + 2)} & body, GLOSS)
    face(c, p)

    # in front of the body: forearms coming toward the viewer, a deep line where they cross it
    for a, upper, fore in arms:
        if a.front:
            c.fill(around(fore) & body, SKIN['deep'])
            c.paint(shade(fore, SKIN, light=2, dark=2))

    if p.tint:
        c.px = {q: tinted(v, p.tint) for q, v in c.px.items()}
    if p.frost:
        frost(c, body, x0, x1)

    # the floor under him, smaller the higher he is
    up = max(0, p.lift) + min(p.feet)
    floor(c, (x0 + x1 + 1) / 2, (x1 - x0 + 1) // 2 - 2 - up * 3 // 2)
    return c


def frost(c, body, x0, x1):
    """Rime along the top edge of the body, dripping a pixel or two here and there."""
    drips = (1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 1, 3, 1, 1, 2)
    for x in range(x0, x1 + 1):
        ys = sorted(y for bx, y in body if bx == x)
        if not ys:
            continue
        d = drips[(x * 7) % len(drips)]
        for k in range(d):
            c.put(x, ys[0] + k, FROST if k == 0 else FROST_DEEP)


# ------------------------------------------------------------------------------- poses

IDLE = Pose()
IDLE_UP = Pose(tall=1)
BLINK = Pose(eyes='blink')
BLINK_HALF = Pose(eyes='half')
LOOK_L = Pose(look=(-2, 0))
LOOK_R = Pose(look=(2, 0))
LOOK_UP = Pose(look=(1, -2))
LOOK_DOWN = Pose(eyes='focus', look=(1, 1))
ARMS_IN = Pose(arms=(TUCK, TUCK), eyes='focus', look=(1, 1))
STEP_A = Pose(feet=(2, 0, 2, 0), arms=(SWING_F, SWING_B))
STEP_B = Pose(lift=1, feet=(0, 3, 0, 3), arms=(SWING_B, SWING_F))
HOP_1 = Pose(lift=-2, tall=-2, wide=1, splay=1, arms=(LOW, LOW), eyes='focus')
HOP_2 = Pose(lift=4, tall=1, wide=-1, feet=(3, 3, 3, 3), arms=(UP, UP), eyes='happy')
HOP_3 = Pose(lift=-1, tall=-3, wide=2, splay=1, arms=(LAG, LAG), eyes='happy')
WAVE_1 = Pose(arms=(REST, WAVE_OUT), eyes='happy', blush=True)
WAVE_2 = Pose(arms=(REST, WAVE_IN), eyes='happy', blush=True)
FLINCH = Pose(lift=-1, tall=-2, wide=1, arms=(STARTLE, STARTLE), eyes='squeeze')
CHEER_1 = Pose(arms=(HIGH, HIGH), eyes='happy', blush=True)
CHEER_2 = Pose(lift=4, tall=1, wide=-1, feet=(3, 3, 3, 3), arms=(UP, UP), eyes='happy', blush=True)
CHEER_3 = Pose(lift=-1, tall=-2, wide=1, arms=(HIGH, HIGH), eyes='happy', blush=True)
YAWN_1 = Pose(tall=1, arms=(STRETCH, STRETCH), eyes='squeeze', mouth='o')
YAWN_2 = Pose(tall=2, wide=-1, arms=(STRETCH_HIGH, STRETCH_HIGH), eyes='squeeze', mouth='O')
SIP_1 = Pose(arms=(REST, HOLD), look=(2, -1))
SIP_2 = Pose(arms=(REST, None), eyes='happy', blush=True)   # the right hand is at the mug
SWEAT = Pose(eyes='worried', brows='worried', look=(-2, 0))
CLOCK_1 = Pose(arms=(REST, HOLD), look=(2, -1))
CLOCK_2 = Pose(arms=(REST, HOLD), eyes='wide', look=(2, -1))
PUMPKIN_1 = Pose(look=(2, 1))
PUMPKIN_2 = Pose(eyes='happy', look=(2, 0), blush=True)
SLEEP_1 = Pose(lift=-4, tall=-3, wide=1, arms=(None, None), eyes='sleepy', tint='sleep')
SLEEP_2 = replace(SLEEP_1, tall=-2)
SLEEP_COLD_1 = replace(SLEEP_1, tint='cold', frost=True)
SLEEP_COLD_2 = replace(SLEEP_2, tint='cold', frost=True)


# ------------------------------------------------------------------------------- small props

def sweat_drop(c, x, y):
    stamp(c, ('..s..', '..s..', '.sss.', 'swsss', 'sssss', 'sssss', '.SSS.'), x, y,
          {'s': SKY, 'S': SAPPHIRE, 'w': WHITE})


def sparkle(c, x, y, color):
    stamp(c, ('.c.', 'cwc', '.c.'), x - 1, y - 1, {'c': color, 'w': WHITE})


def confetti(c, pieces):
    """pieces: (x, y, color, kind), kind '.' one pixel, '+' a tiny plus, '-' a 2x1 strip,
    '|' a 1x2 strip."""
    for x, y, color, kind in pieces:
        if kind == '+':
            stamp(c, ('.c.', 'ccc', '.c.'), x - 1, y - 1, {'c': color})
        elif kind == '-':
            c.fill({(x, y), (x + 1, y)}, color)
        elif kind == '|':
            c.fill({(x, y), (x, y + 1)}, color)
        else:
            c.put(x, y, color)


Z_SMALL = ('####', '..#.', '.#..', '####')
Z_BIG = ('#####', '...#.', '..#..', '.#...', '#####')


def zs(c, items):
    """items: (x, y, glyph, alpha)."""
    for x, y, glyph, a in items:
        stamp(c, glyph, x, y, {'#': fade(LAVENDER, a)})


def snowflake(c, x, y, turned):
    if turned:
        rows = ('#.....#', '.#.#.#.', '..###..', '.##w##.', '..###..', '.#.#.#.', '#.....#')
    else:
        rows = ('...#...', '.#.#.#.', '..###..', '###w###', '..###..', '.#.#.#.', '...#...')
    stamp(c, rows, x - 3, y - 3, {'#': rgb('#dce8ff'), 'w': WHITE})


MUG = ('LLLLLL..',
       'MMMMMMhh',
       'MMMMMM.h',
       'MMMMMM.h',
       'MMMMMMhh',
       'DDDDDD..',
       '.DDDD...')


def mug(c, x, y):
    """A mauve mug 8x7, its handle at the right, top-left at (x, y)."""
    lite, dark = mix(MAUVE, WHITE, .35), mix(MAUVE, BASE, .3)
    stamp(c, MUG, x, y, {'L': lite, 'M': MAUVE, 'D': dark, 'h': mix(MAUVE, BASE, .12)})


def steam(c, x, y, phase):
    """Two wisps of steam rising side by side from (x, y), swaying together and fading."""
    sway = (0, 0, 1, 1, 0, 0, -1, -1)
    for k, sx in enumerate((x, x + 3)):
        for i in range(6 - k):
            c.put(sx + sway[(i + phase) % len(sway)], y - i - k, fade(TEXT, 220 - i * 34))


PAW = ('.ll.', 'lbbb', 'bbbd', '.dd.')


def mask_of(rows, x, y):
    """The pixels a stamp of `rows` at (x, y) draws."""
    return {(x + i, y + j) for j, row in enumerate(rows) for i, ch in enumerate(row) if ch not in '. '}


def paw(c, x, y, pose=None, keep=frozenset()):
    """Claude's hand in front of something he holds: a 4x4 nub, top-left at (x, y). With his
    pose, a deep line rims it where it lies on his body (not over `keep`, the thing held)."""
    if pose:
        x0, y0, x1, y1 = body_box(pose)
        c.fill(around(mask_of(PAW, x, y)) & rounded(x0, y0, x1, y1, CORNER) - keep, SKIN['deep'])
    stamp(c, PAW, x, y, {'l': SKIN['light'], 'b': SKIN['base'], 'd': SKIN['dark']})


def sip(c, pose):
    """The mug at his mouth between his eyes, his right paw on its handle, the steam rising
    clear of both eyes."""
    x, y = 32, 21
    mug(c, x, y)
    steam(c, x + 1, y - 2, 2)
    paw(c, x + 6, y + 1, pose, mask_of(MUG, x, y))


def hourglass(c, x, y, fallen):
    """A 9x13 hourglass with its top-left at (x, y); fallen 0..1 is how much sand has run."""
    cap, cap_lite, post = YELLOW, mix(YELLOW, WHITE, .45), mix(YELLOW, PEACH, .45)
    widths = (5, 5, 3, 3, 1, 3, 3, 5, 5)          # the glass, rows 2 to 10; the neck at row 6
    glass = {(x + 4 - w // 2 + i, y + 2 + j) for j, w in enumerate(widths) for i in range(w)}
    c.fill(glass, fade(TEXT, 95))
    sand_top = {(x + 4 - w // 2 + i, y + 2 + j) for j, w in enumerate(widths[:4]) for i in range(w)
                if j >= 4 - round(3 * (1 - fallen))}
    pile = 1 + round(2.4 * fallen)
    sand_bottom = {q for q in glass if q[1] > y + 10 - pile}
    c.fill(sand_top | sand_bottom, PEACH)
    c.fill(rect(x + 4, y + 6, x + 4, y + 10 - pile), mix(PEACH, WHITE, .3))
    c.fill(rect(x + 1, y + 2, x + 1, y + 10) | rect(x + 7, y + 2, x + 7, y + 10), post)
    c.fill(rect(x, y, x + 8, y + 1) | rect(x, y + 11, x + 8, y + 12), cap)
    c.fill(rect(x + 1, y, x + 7, y) | rect(x + 1, y + 11, x + 7, y + 11), cap_lite)


def pumpkin(c, x, y, glow):
    """A jack-o'-lantern 13x11 with its top-left at (x, y): lit (glow 1, a warm halo and a
    bright face) or flickered low (glow 0, the carved face gone dark)."""
    body = ellipse(x + 6.5, y + 6.5, 6.5, 4.6)
    rind = mix(PEACH, rgb('#e5763c'), .35)
    rib = mix(PEACH, rgb('#8a3c1c'), .4)
    floor(c, x + 6.5, 6, max(q[1] for q in body) + 1)
    if glow:
        c.fill(ellipse(x + 6.5, y + 6.5, 8.5, 6.8) - body, fade(YELLOW, 30))
        c.fill(ellipse(x + 6.5, y + 6.5, 7.6, 5.8) - body, fade(YELLOW, 36))
    c.paint(shade(body, {'light': PEACH, 'base': rind, 'dark': rib}, light=1, dark=1))
    for rx in (x + 3, x + 10):
        c.fill({q for q in body if q[0] == rx and y + 3 <= q[1] <= y + 10}, rib)
    stamp(c, ('.gg', 'gg.'), x + 6, y, {'g': GREEN})
    face = ('.l.....l.',
            'lll...lll',
            '.........',
            'l.lllll.l',
            '.lll.lll.')
    stamp(c, face, x + 2, y + 4, {'l': mix(YELLOW, WHITE, .3) if glow else mix(rib, BASE, .45)})


def nightcap(c, pose, frosty=False):
    """A slouchy blue nightcap on the left of his head, its pom-pom hanging past his side."""
    x0, y0, _, _ = body_box(pose)
    tones = {'light': mix(BLUE, WHITE, .3), 'base': BLUE, 'dark': mix(BLUE, BASE, .3)}
    cone = polygon([(x0 + 4, y0 + 1), (x0 + 22, y0 + 1), (x0 + 13, y0 - 7)])
    cone |= capsule(x0 + 12.5, y0 - 6, x0 + 5, y0 - 5, 1.6) | capsule(x0 + 5, y0 - 5, x0 + 1.5, y0 - 2, 1.3)
    c.paint(shade(cone, tones, light=1, dark=1))
    c.fill(rect(x0 + 8, y0 - 3, x0 + 18, y0 - 3) & cone, mix(BLUE, WHITE, .55))
    c.fill(rounded(x0 + 3, y0, x0 + 23, y0 + 2, (1,)), TEXT if not frosty else FROST)
    c.fill(rect(x0 + 4, y0 + 2, x0 + 22, y0 + 2), SUBTEXT if not frosty else FROST_DEEP)
    pom = disc(x0 + 1, y0 - 1, 2.3)
    c.fill(pom, TEXT)
    c.fill({(x0, y0 - 2), (x0 - 1, y0 - 1)} & pom, WHITE)


# ------------------------------------------------------------------------------- scene props
# Scene props are drawn behind Claude: he keeps every pixel of his solo pose.

def ring(c, rows, x, y):
    """A small round thought bubble written as text: 'o' its outline, 'f' its inside."""
    stamp(c, rows, x, y, {'o': TEXT, 'f': BASE})


BUBBLE_S = ('.oo.', 'offo', 'offo', '.oo.')
BUBBLE_M = ('.oooo.', 'offffo', 'offffo', 'offffo', 'offffo', '.oooo.')


def thought(c, dots):
    cloud = set()
    for cx, cy, r in ((76, 10.5, 5.5), (83, 7, 6.5), (91.5, 6.5, 6), (98, 10.5, 5),
                      (93.5, 14.5, 5), (85, 15, 5.5), (77.5, 14.5, 4.5)):
        cloud |= disc(cx, cy, r)
    cloud = tidy(cloud)
    c.fill(cloud - edge(cloud), BASE)
    c.fill(edge(cloud), TEXT)
    for i in range(dots):
        c.fill(rect(79 + 7 * i, 10, 81 + 7 * i, 12), TEXT)
    ring(c, BUBBLE_M, 63, 10)
    ring(c, BUBBLE_S, 58, 13)


def book(c, turning):
    spine = 78
    def top(x):
        return round(21 - 3 * math.sqrt(abs(x - spine) / 18))
    cover, cover_dark = BLUE, mix(BLUE, BASE, .35)
    page, gutter, ink = TEXT, SUBTEXT, mix(SUBTEXT, BASE, .35)
    for x in range(spine - 19, spine + 20):
        t = top(min(max(x, spine - 18), spine + 18))
        c.fill(rect(x, t + 1, x, t + 15), cover)
        c.put(x, t + 15, cover_dark)
    for x in range(spine - 18, spine + 19):
        if x == spine:
            continue
        t = top(x)
        c.fill(rect(x, t, x, t + 13), gutter if abs(x - spine) <= 2 else page)
        c.put(x, t + 13, gutter)
        for k, row in enumerate((3, 5, 7, 9, 11)):
            inner, outer = (9 if k == 4 else 3), (4 if k == 0 else 3)
            if spine - 18 + outer <= x <= spine - inner or spine + inner <= x <= spine + 18 - outer:
                if not (k == 2 and spine + 3 <= x <= spine + 6):
                    c.put(x, t + row, ink)
    if turning:
        sheet = polygon([(spine, 18), (spine + 9, 11), (spine + 13, 13), (spine + 2, 32)])
        c.fill(sheet, page)
        c.fill({q for q in sheet if q[0] <= spine + 2}, gutter)
        c.fill({q for q in edge(sheet) if q[0] >= spine + 4 and q[1] >= 14}, gutter)


def text_words():
    """Three faint lines of words, as (row, x0, x1)."""
    lines = ((11, (3, 6, 4, 7, 4)), (19, (5, 3, 8, 4, 5)), (27, (4, 7, 3, 5, 6)))
    words = []
    for row, lens in lines:
        x = 64
        for n in lens:
            if x + n - 1 <= 103:
                words.append((row, x, x + n - 1))
            x += n + 3
    return words


def lens(c, cx, cy, rim=False):
    """A magnifying glass's ring, handle and glint, centered at (cx, cy); what the glass shows
    is drawn first, by the caller. rim: a dark line around the ring, to part it from a busy
    picture under it."""
    ring_ = disc(cx, cy, 7.2) - disc(cx, cy, 5.2)
    hx, hy = cx + 5.5, cy + 5.5
    handle = capsule(hx, hy, hx + 4.5, hy + 4.5, 1.6)
    if rim:
        c.fill(around(disc(cx, cy, 7.2) | handle), BASE)
    c.paint(shade(handle, {'light': mix(PEACH, WHITE, .2), 'base': PEACH, 'dark': mix(PEACH, BASE, .3)}, 1, 1))
    c.paint({q: (SKY if q[1] + .5 < cy + 1.5 else mix(SKY, BASE, .25)) for q in ring_})
    gx, gy = math.floor(cx), math.floor(cy)
    c.fill({(gx - 3, gy - 2), (gx - 2, gy - 3), (gx - 3, gy - 1)}, fade(WHITE, 210))


def magnifier(c, cx, cy, lit=None):
    """A magnifying glass centered at (cx, cy) over lines of words: the words under it show
    magnified and bright (`lit` colors them: a found word)."""
    words = text_words()
    ink = {(x, row) for row, a, b in words for x in range(a, b + 1)}
    glass = disc(cx, cy, 5.2)
    ring_ = disc(cx, cy, 7.2) - glass
    c.fill(ink - glass - ring_, SURFACE2)
    c.fill(glass, fade(TEXT, 40))
    for x, y in glass:
        sx, sy = cx + (x + .5 - cx) / 2, cy + (y + .5 - cy) / 2
        if (math.floor(sx), math.floor(sy)) in ink:
            c.put(x, y, lit or TEXT)
    lens(c, cx, cy)


LAPTOP_DX = -3               # the laptop's place: its deck's corner under his right hand


def laptop(c, step):
    """A small laptop at the right: grey shell, dark screen; `step` grows the code on it."""
    own = Canvas(SCENE_W)
    laptop_at(own, step)
    c.paste(own, LAPTOP_DX)


def laptop_at(c, step):
    shell, shell_dark, shell_lite = SURFACE2, SURFACE1, SUBTEXT
    c.fill(rounded(64, 11, 96, 31, (1,)), shell)
    c.fill(rect(65, 11, 95, 11), shell_lite)
    c.fill(rect(66, 13, 94, 29), BASE)
    for i, y in enumerate(range(32, 38)):
        c.fill(rect(59 - i // 2, y, 101 + i // 2, y), shell_dark if i < 5 else mix(SURFACE1, BASE, .3))
    c.fill(rect(59, 32, 101, 32), shell_lite)
    for y in (34, 36):
        for x in range(62 + (y - 34) // 2, 99, 3):
            c.fill(rect(x, y, x + 1, y), shell)
    floor(c, 80.5, 22)
    first = ((68, 2, GREEN), (71, 6, SKY))
    longer = first + ((78, 4, TEXT), (83, 5, SKY), (89, 3, GREEN))
    second = ((70, 3, GREEN), (74, 5, SKY))
    shown = {1: ((16, first),), 2: ((16, longer),), 3: ((16, longer), (19, second))}[step]
    for row, segs in shown:
        for x, n, col in segs:
            c.fill(rect(x, row, x + n - 1, row), col)
    row, segs = shown[-1]
    end = segs[-1][0] + segs[-1][1] + 1
    c.fill(rect(end, row - 1, end + 1, row), TEXT)


def terminal(c, step):
    x0, y0, x1, y1 = 64, 7, 101, 33
    c.fill(rounded(x0, y0, x1, y1, (1,)), SURFACE2)
    c.fill(rect(x0 + 1, y0 + 4, x1 - 1, y1 - 1), BASE)
    c.fill(rect(x0 + 1, y0 + 1, x1 - 1, y0 + 3), SURFACE1)
    for i, col in enumerate((RED, YELLOW, GREEN)):
        c.fill(rect(x0 + 3 + 4 * i, y0 + 2, x0 + 4 + 4 * i, y0 + 2), col)

    def prompt(row, cmd, caret):
        stamp(c, ('#..', '.#.', '#..'), x0 + 3, row - 1, {'#': GREEN})
        x = x0 + 8
        for n in cmd:
            c.fill(rect(x, row, x + n - 1, row), SKY)
            x += n + 2
        if caret:
            c.fill(rect(x, row - 1, x + 1, row + 1), TEXT)

    def output(rows):
        for row, n in rows:
            c.fill(rect(x0 + 3, row, x0 + 3 + n - 1, row), SUBTEXT)

    if step == 1:
        prompt(14, (4,), True)
    elif step == 2:
        prompt(14, (4, 6), False)
        output(((18, 22), (21, 15)))
    else:
        prompt(14, (4, 6), False)
        output(((18, 22), (21, 15), (24, 26), (27, 11)))
        prompt(30, (), True)


GLOBE_MAP = (
    '..........................................',
    '...####.............###########...........',
    '..#######.........##############....##....',
    '.#########.......###########.....######...',
    '..########........#######.......#######...',
    '....#####..........####..........####.....',
    '.....####....###....###...........##......',   # 13-15: the island the web search finds
    '......###.....#......#.............#......',
    '......##.............................##...',
    '.......#............................####..',
    '....................................###...',
    '..........................................',
)
GLOBE = (82.5, 19.5, 11)          # center and radius
LAND = (mix(GREEN, WHITE, .25), GREEN, mix(GREEN, BASE, .35))
SEA = (mix(SAPPHIRE, WHITE, .25), SAPPHIRE, mix(SAPPHIRE, BASE, .38))


def globe_tone(turn, px, py):
    """The globe's color at the point (px, py), turned `turn` thirds: (is land, tone 0..2 from
    lit to shaded), or None off the sphere."""
    cx, cy, r = GLOBE
    u, v = (px - cx) / r, (py - cy) / r
    if u * u + v * v > 1.0001:
        return None
    w = math.sqrt(max(0.0, 1 - u * u - v * v))
    lat = math.asin(max(-1.0, min(1.0, v)))
    lon = math.atan2(u, w) + turn * 2 * math.pi / 3
    cols = len(GLOBE_MAP[0])
    mx = int(((lon / (2 * math.pi)) % 1) * cols)
    my = min(len(GLOBE_MAP) - 1, int((lat / math.pi + .5) * len(GLOBE_MAP)))
    lit = u * -.5 + v * -.62 + w * .6
    return GLOBE_MAP[my][mx] == '#', 0 if lit > .82 else 1 if lit > .12 else 2


def globe(c, turn, shine=True):
    """A desk globe; `turn` (0, 1, 2) rotates it by thirds."""
    cx, cy, r = GLOBE
    ring_ = disc(cx, cy, r + 2.6) - disc(cx, cy, r + 1.2)
    c.fill({q for q in ring_ if q[0] >= cx + 2 or q[1] >= cy + 6}, SURFACE2)
    c.fill(rect(82, 33, 83, 35), SURFACE2)
    c.fill(rounded(76, 35, 89, 37, (2,)), SURFACE2)
    c.fill(rect(77, 35, 88, 35), SUBTEXT)
    floor(c, 83, 9)
    for x, y in sorted(disc(cx, cy, r)):
        land, tone = globe_tone(turn, x + .5, y + .5)
        c.put(x, y, (LAND if land else SEA)[tone])
    if shine:
        gx, gy = math.floor(cx), math.floor(cy)
        c.fill({(gx - 5, gy - 6), (gx - 4, gy - 7), (gx - 6, gy - 5), (gx - 6, gy - 4)}, fade(WHITE, 220))


def globe_search(c, turn, cx, cy, found=False):
    """The globe under a magnifying glass at (cx, cy): the glass shows it twice as big and a
    little brighter, its land bright green when `found`."""
    under = Canvas(SCENE_W)
    globe(under, turn, shine=False)
    globe(c, turn)
    glass = disc(cx, cy, 5.2)
    c.erase(glass)
    for x, y in sorted(glass):
        sx, sy = cx + (x + .5 - cx) / 2, cy + (y + .5 - cy) / 2
        tone = globe_tone(turn, sx, sy)
        if tone is None:
            v = under.px.get((math.floor(sx), math.floor(sy)))
            c.put(x, y, mix(v, WHITE, .12) if v else fade(TEXT, 40))
        else:
            land, t = tone
            v = (LAND if land else SEA)[min(t, 1)]
            c.put(x, y, mix(v, WHITE, .45) if land and found else mix(v, WHITE, .12))
    lens(c, cx, cy, rim=True)


MINI = ('...lllllllllllll...',
        '..lllllllllllllll..',
        '..bbbbbbbbbbbbbbb..',
        '..bbbbbbbbbbbbbbb..',
        'llbbbbbbbbbbbbbbbll',
        'bbbbbbbbbbbbbbbbbbb',
        'ddbbbbbbbbbbbbbbbdd',
        '..ddddddddddddddd..',
        '...ddddddddddddd...')
MINI_LEGS = (3, 6, 11, 14)


def mini_claude(c, x, foot, hop=0, look=-1, shadow=True):
    """A helper: Claude at about 40% (19x11), its left edge at x, standing on row `foot`, or
    `hop` pixels above it with its legs dangling a pixel; its eyes turned toward the big one."""
    top = foot - 10 - hop
    for lx in MINI_LEGS:
        c.fill(rect(x + lx, top + 9, x + lx + 1, foot - hop + (1 if hop else 0)), SKIN['dark'])
        c.fill(rect(x + lx, top + 9, x + lx + 1, top + 9), SKIN['deep'])
    stamp(c, MINI, x, top, {'l': SKIN['light'], 'b': SKIN['base'], 'd': SKIN['dark']})
    for ex in (x + 5, x + 12):
        c.fill(rect(ex + look, top + 2, ex + look + 1, top + 4), EYE)
        c.put(ex + look, top + 2, GLINT)
    if shadow:
        floor(c, x + 9.5, 6 if hop else 8, foot + 1)


def helpers(c, n, phase):
    """n helpers bobbing in turn; phase 'a' or 'b' says which are up."""
    a = phase == 'a'
    if n == 1:
        mini_claude(c, 74, GROUND, 2 if a else 0)
    elif n == 2:
        mini_claude(c, 63, GROUND, 2 if a else 0)
        mini_claude(c, 84, GROUND, 0 if a else 2)
    else:
        # a little pyramid: the outer two on the ground, the middle one on their heads; when
        # the outer two bob up it rides along, then it hops on its own
        base = 2 if a else 0
        mini_claude(c, 63, GROUND, base)
        mini_claude(c, 84, GROUND, base)
        mini_claude(c, 73, GROUND - 11 - base, 0 if a else 3, shadow=False)


def speech(c, rise):
    y = 3 - rise
    tail = set()
    for k, (a, b) in enumerate(((74, 79), (72, 77), (70, 74), (69, 72), (68, 70), (67, 68))):
        tail |= rect(a, y + 16 + k, b, y + 16 + k)
    shape = rounded(72, y, 95, y + 15, (3, 1, 1)) | tail
    c.paint(shade(shape, {'light': mix(YELLOW, WHITE, .4), 'base': YELLOW, 'dark': mix(YELLOW, PEACH, .45)}, 1, 2))
    stamp(c, ('##', '##', '##', '##', '##', '##', '..', '##'), 83, y + 4, {'#': BASE})


def gear(c, cx, cy, turn, r_out=12.5, r_root=9.8, teeth=12, color=LAVENDER, holes=4, tooth=3.4, hub=2.6):
    """A gear centered at (cx, cy); `turn` is its rotation in turns. Its teeth are square bars
    `tooth` pixels wide (not wedges, which came out ragged), lit from the upper left."""
    shape = disc(cx, cy, r_root)
    for i in range(teeth):
        a = (turn + (i + .25) / teeth) * 2 * math.pi
        ux, uy = math.cos(a), math.sin(a)
        shape |= capsule(cx + ux * (r_root - 1.5), cy + uy * (r_root - 1.5),
                         cx + ux * (r_out - tooth / 2), cy + uy * (r_out - tooth / 2), tooth / 2, 8.0)
    shape = tidy(shape) - disc(cx, cy, hub)
    for i in range(holes):
        ang = (turn + i / holes) * 2 * math.pi
        shape -= disc(cx + math.cos(ang) * 6.2, cy + math.sin(ang) * 6.2, 1.7)
    lite, dark = mix(color, WHITE, .35), mix(color, BASE, .35)
    for x, y in sorted(shape):
        s = (x + .5 - cx) * .6 + (y + .5 - cy) * .8
        c.put(x, y, lite if s < -6.5 else dark if s > 6 else color)
    c.fill(edge(disc(cx, cy, hub + 1)) & shape, dark)


def gears(c, turn):
    """The big lavender gear at his arm and a small one meshing with it, turning the other way."""
    gear(c, 88.5, 12.5, -turn * 12 / 8 + 1 / 16, r_out=7.4, r_root=5.2, teeth=8, color=SUBTEXT, holes=0, tooth=2.4, hub=2.2)
    gear(c, 74.5, 24.5, turn)


# --- writing: a notepad page, the pen in his right hand, his forearm reaching from behind his nub

PAD = (61, 20, 88, 36)            # the page: left, top, right, bottom
PAD_RULES = (27, 31, 35)          # the faint rules; the writing sits on the first two
PAD_INK = mix(BASE, MAUVE, .18)
PAD_LINE_X = 66                   # where each line of writing starts, right of the margin
PEN = 10                          # the pen's length, nib to cap, held near its top


def handwriting(c, row, x0, x1):
    """A line of handwriting on the rule below `row`: small loops and humps, a gap between
    words, ending at column x1."""
    shape = (0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0)   # 1: the pixel a row higher
    gaps = {5, 12, 19, 25}                                   # word breaks, from the line start
    for x in range(x0, x1 + 1):
        k = x - x0
        if k in gaps:
            continue
        c.put(x, row - shape[k % len(shape)], PAD_INK)


def pen(c, tx, ty):
    """A mauve pen two pixels thick, leaning up and to the left, its nib at (tx, ty): a light
    and a dark side, a dark cap at the top, a silver nib."""
    lite, dark, cap = mix(MAUVE, WHITE, .25), mix(MAUVE, BASE, .42), mix(MAUVE, BASE, .62)
    for k in range(2, PEN + 1):
        c.put(tx - k, ty - k, cap if k >= PEN - 1 else lite)
        c.put(tx - k + 1, ty - k, cap if k >= PEN - 1 else dark)
    c.fill({(tx - 1, ty - 1), (tx, ty - 1)}, SUBTEXT)
    c.put(tx, ty, PAD_INK)


def forearm(c, pose, hx, hy, r=FORE_R):
    """Claude's right forearm reaching from behind his nub to a hand at (hx, hy): the arm's
    tones, drawn as a prop so that his own pixels stay those of his pose."""
    x0, y0, _, _ = body_box(pose)
    sx, sy = shoulder(x0, y0)
    arm = capsule(SOLO_W - sx - 4, sy, hx, hy, r, ARM_SQUARE)
    c.paint(shade(arm, SKIN, light=2, dark=2))


def notepad(c, pose, step):
    """A pale notepad page at the right with faint rules and a margin; step 1 one short stroke
    written, 2 the first line longer, 3 two lines and a dot. The pen's nib is at the end of
    the writing; his right forearm reaches to it from behind his nub, the paw around the pen."""
    x0, y0, x1, y1 = PAD
    page, edge_, rule = TEXT, SUBTEXT, mix(TEXT, BLUE, .4)
    c.fill(rect(x0 + 1, y0 + 1, x1 + 1, y1 + 1), edge_)            # the pages under it
    c.fill(rect(x0, y0, x1, y1), page)
    c.fill(rect(x0, y0, x1, y0 + 2), PEACH)                          # the gummed binding
    c.fill(rect(x0, y0 + 2, x1, y0 + 2), mix(PEACH, BASE, .3))
    c.fill(rect(x0, y0, x1, y0), mix(PEACH, WHITE, .3))
    for row in PAD_RULES:
        c.fill(rect(x0 + 1, row, x1 - 1, row), rule)
    c.fill(rect(PAD_LINE_X - 2, y0 + 3, PAD_LINE_X - 2, y1), mix(TEXT, RED, .45))
    a, b = PAD_RULES[0] - 1, PAD_RULES[1] - 1
    if step == 1:
        handwriting(c, a, PAD_LINE_X, PAD_LINE_X + 2)
        tip = (PAD_LINE_X + 3, a)
    elif step == 2:
        handwriting(c, a, PAD_LINE_X, PAD_LINE_X + 9)
        tip = (PAD_LINE_X + 10, a)
    else:
        handwriting(c, a, PAD_LINE_X, x1 - 3)
        handwriting(c, b, PAD_LINE_X, PAD_LINE_X + 6)
        c.put(PAD_LINE_X + 8, b, PAD_INK)
        tip = (PAD_LINE_X + 9, b)
    tx, ty = tip
    forearm(c, pose, tx - 6, ty - 7)
    pen(c, tx, ty)
    paw(c, tx - 8, ty - 9)                  # around the pen's top, its cap showing above


# --- a skill: a parchment scroll unrolling

SCROLL_X = (68, 91)               # the paper's columns
PAPER = (mix(YELLOW, WHITE, .35), YELLOW, mix(YELLOW, PEACH, .5))


def roll(c, y, rows):
    """A roll of paper on a lavender rod, `rows` thick, its top at y: the paper's rolled ends a
    shade darker, the rod's knobs out past them at both ends."""
    a, b = SCROLL_X
    body = rect(a - 1, y, b + 1, y + rows - 1)
    c.paint(shade(body, {'light': PAPER[0], 'base': PAPER[1], 'dark': PAPER[2]}, light=1, dark=1))
    c.fill(rect(a - 1, y, a - 1, y + rows - 1) | rect(b + 1, y, b + 1, y + rows - 1), PAPER[2])
    for kx in (a - 3, b + 2):
        knob = rect(kx, y, kx + 1, y + rows - 1)
        c.fill(knob, LAVENDER)
        c.fill(rect(kx, y, kx + 1, y), mix(LAVENDER, WHITE, .4))
        c.fill(rect(kx, y + rows - 1, kx + 1, y + rows - 1), mix(LAVENDER, BASE, .35))


def scroll(c, full):
    """A parchment scroll hanging at the right: half unrolled (two lines of writing, a fat roll
    at the bottom) or all the way (four lines and a green check, the roll thin)."""
    a, b = SCROLL_X
    top = 5
    bottom = 33 if full else 21
    c.fill(rect(a, top + 3, b, bottom), PAPER[1])
    c.fill(rect(a, top + 3, b, top + 3), PAPER[2])                   # in the roll's shade
    c.fill(rect(a, top + 3, a, bottom) | rect(b, top + 3, b, bottom), mix(PAPER[1], PAPER[2], .5))
    ink = mix(YELLOW, SURFACE2, .55)
    lines = ((11, (5, 7, 4)), (15, (3, 6, 5, 2)), (19, (6, 4, 6)), (23, (4, 5, 3, 4)))
    for row, words in lines[:4 if full else 2]:
        x = a + 3
        for n in words:
            if x + n - 1 <= b - 3:
                c.fill(rect(x, row, x + n - 1, row), ink)
            x += n + 2
    if full:
        stamp(c, ('.....g', '....gg', 'g..gg.', 'gggg..', '.gg...'), a + 9, 26, {'g': GREEN})
        c.put(a + 14, 26, mix(GREEN, WHITE, .4))
    roll(c, top, 4)
    roll(c, bottom + 1, 3 if full else 5)


# --- a tool call to a server: a cable from his hand to a plug, and a wall socket

SOCKET = (94, 11, 102, 27)        # the plate: left, top, right, bottom
SLOTS = (16, 22)                  # the rows of its two slots, and of the plug's prongs


def socket(c):
    """A wall socket at the right: a surface-colored plate lit from the upper left, its two
    slots dark, set in a recessed face."""
    x0, y0, x1, y1 = SOCKET
    plate = rounded(x0, y0, x1, y1, (2, 1))
    c.paint(shade(plate, {'light': SUBTEXT, 'base': mix(SURFACE2, SUBTEXT, .3), 'dark': SURFACE1}, light=1, dark=1))
    c.fill({(x0, y) for y in range(y0 + 2, y1 - 1)}, mix(SURFACE2, SUBTEXT, .6))
    c.fill({(x1, y) for y in range(y0 + 2, y1 - 1)}, SURFACE1)
    face = rounded(x0 + 2, SLOTS[0] - 2, x1 - 2, SLOTS[1] + 2, (1,))
    c.fill(face, SURFACE2)
    c.fill(rect(x0 + 3, SLOTS[0] - 2, x1 - 3, SLOTS[0] - 2), SURFACE1)      # the face's upper lip, in shade
    for row in SLOTS:
        c.fill(rect(x0 + 3, row, x1 - 3, row), BASE)
        c.fill(rect(x0 + 3, row + 1, x1 - 3, row + 1), mix(SURFACE2, SUBTEXT, .35))


def plug(c, x, plugged):
    """A plug seen from the side, its prongs toward the socket; x is the left of its body."""
    top, bottom = SLOTS[0] - 2, SLOTS[1] + 2
    body = rounded(x, top, x + 6, bottom, (1,))
    c.paint(shade(body, {'light': mix(TEXT, WHITE, .3), 'base': TEXT, 'dark': SUBTEXT}, light=1, dark=2))
    c.fill(rect(x + 2, top + 2, x + 2, bottom - 2), SUBTEXT)          # the grip's ridges
    c.fill(rect(x + 4, top + 2, x + 4, bottom - 2), SUBTEXT)
    c.fill(rect(x - 2, SLOTS[0] + 1, x - 1, SLOTS[1] - 1), SUBTEXT)   # the strain relief
    if not plugged:
        for row in SLOTS:
            c.fill(rect(x + 7, row, x + 9, row), mix(YELLOW, PEACH, .3))


SPARK = ('y...y',
         '.yWy.',
         '.WWW.',
         '.yWy.',
         'y...y')


def spark(c, x, y):
    """A small yellow spark centered at (x, y), white at its heart."""
    stamp(c, SPARK, x - 2, y - 2, {'y': YELLOW, 'W': WHITE})


def cable(c, start, end, sag):
    """A cable two pixels thick from start to end, sagging `sag` pixels at its middle."""
    (ax, ay), (bx, by) = start, end
    n = max(8, int(abs(bx - ax)))
    points = []
    for i in range(n + 1):
        t = i / n
        points.append((ax + (bx - ax) * t, ay + (by - ay) * t + sag * 4 * t * (1 - t)))
    px = line_px([(round(x), round(y)) for x, y in points])
    c.fill({(x, y + 1) for x, y in px}, mix(SURFACE2, BASE, .2))
    c.fill(set(px), SUBTEXT)


def plugged(c, pose, step):
    """Claude's cable, from behind his right hand, ending in a plug: a few pixels short of the
    socket (step 1) or plugged in, a spark at the join (step 2)."""
    socket(c)
    hx, hy = hand(pose)
    x = SOCKET[0] - 7 - (6 if step == 1 else 0)
    mid = (SLOTS[0] + SLOTS[1]) // 2
    cable(c, (hx - 1, hy), (x - 2, mid), 9 if step == 1 else 6)
    plug(c, x, step == 2)
    if step == 2:
        spark(c, SOCKET[0], SLOTS[0] - 4)
        c.put(SOCKET[0] - 3, SLOTS[1] + 4, mix(YELLOW, WHITE, .4))
        c.put(SOCKET[0] + 3, SLOTS[0] - 7, YELLOW)


# ------------------------------------------------------------------------------- frames

def solo(pose, *front):
    """A 70x40 frame: Claude, then the props in front of him."""
    c = Canvas(SOLO_W)
    c.pose = pose
    c.paste(claude(pose))
    for draw in front:
        draw(c)
    return c


def scene(pose, *behind):
    """A 105x40 frame: the props behind, at the right, then Claude in the left 70 columns,
    every pixel as in his solo pose."""
    c = Canvas(SCENE_W)
    c.pose = pose
    for draw in behind:
        draw(c)
    c.paste(claude(pose))
    return c


def confetti_cheer(stage):
    if stage == 1:
        return [(5, 9, YELLOW, '+'), (64, 8, PINK, '+'), (3, 16, SKY, '.'), (66, 15, GREEN, '.'),
                (9, 3, MAUVE, '.'), (60, 2, YELLOW, '.')]
    if stage == 2:
        return [(4, 3, YELLOW, '+'), (12, 1, PINK, '-'), (24, 1, SKY, '.'), (33, 1, GREEN, '+'),
                (42, 1, MAUVE, '|'), (49, 0, YELLOW, '.'), (58, 3, PINK, '+'), (65, 2, SKY, '-'),
                (2, 12, GREEN, '|'), (67, 11, MAUVE, '+'), (5, 21, PINK, '.'), (64, 19, YELLOW, '|'),
                (18, 0, MAUVE, '.'), (54, 0, GREEN, '-')]
    return [(5, 14, YELLOW, '+'), (12, 8, PINK, '|'), (25, 3, SKY, '.'), (33, 4, GREEN, '-'),
            (44, 3, MAUVE, '.'), (52, 6, YELLOW, '|'), (60, 12, PINK, '+'), (66, 18, SKY, '.'),
            (3, 22, GREEN, '.'), (65, 26, MAUVE, '-'), (8, 28, PINK, '.'), (62, 31, YELLOW, '.')]


FRAMES = {
    'idle': lambda: solo(IDLE),
    'idleUp': lambda: solo(IDLE_UP),
    'blink': lambda: solo(BLINK),
    'blinkHalf': lambda: solo(BLINK_HALF),
    'lookL': lambda: solo(LOOK_L),
    'lookR': lambda: solo(LOOK_R),
    'lookUp': lambda: solo(LOOK_UP),
    'lookDown': lambda: solo(LOOK_DOWN),
    'armsIn': lambda: solo(ARMS_IN),
    'stepA': lambda: solo(STEP_A),
    'stepB': lambda: solo(STEP_B),
    'hop1': lambda: solo(HOP_1),
    'hop2': lambda: solo(HOP_2),
    'hop3': lambda: solo(HOP_3),
    'wave1': lambda: solo(WAVE_1, lambda c: sparkle(c, 67, 3, YELLOW)),
    'wave2': lambda: solo(WAVE_2, lambda c: sparkle(c, 62, 1, YELLOW)),
    'flinch': lambda: solo(FLINCH, lambda c: sweat_drop(c, 57, 6)),
    'cheer1': lambda: solo(CHEER_1, lambda c: confetti(c, confetti_cheer(1))),
    'cheer2': lambda: solo(CHEER_2, lambda c: confetti(c, confetti_cheer(2))),
    'cheer3': lambda: solo(CHEER_3, lambda c: confetti(c, confetti_cheer(3))),
    'yawn1': lambda: solo(YAWN_1),
    'yawn2': lambda: solo(YAWN_2),
    'sip1': lambda: solo(SIP_1, lambda c: (mug(c, 55, 10), steam(c, 56, 8, 0))),
    'sip2': lambda: solo(SIP_2, lambda c: sip(c, SIP_2)),
    'sweat1': lambda: solo(SWEAT, lambda c: sweat_drop(c, 55, 4)),
    'sweat2': lambda: solo(SWEAT, lambda c: sweat_drop(c, 56, 8)),
    'clock1': lambda: solo(CLOCK_1, lambda c: hourglass(c, 54, 3, .2)),
    'clock2': lambda: solo(CLOCK_2, lambda c: hourglass(c, 54, 3, .8)),
    'pumpkin1': lambda: solo(PUMPKIN_1, lambda c: pumpkin(c, 55, 27, 1)),
    'pumpkin2': lambda: solo(PUMPKIN_2, lambda c: pumpkin(c, 55, 27, 0)),
    'sleep1': lambda: solo(SLEEP_1, lambda c: (nightcap(c, SLEEP_1), zs(c, [(58, 10, Z_SMALL, 235)]))),
    'sleep2': lambda: solo(SLEEP_2, lambda c: (nightcap(c, SLEEP_2), zs(c, [(59, 7, Z_SMALL, 220), (63, 0, Z_BIG, 165)]))),
    'sleep3': lambda: solo(SLEEP_1, lambda c: (nightcap(c, SLEEP_1), zs(c, [(61, 3, Z_SMALL, 150), (65, 0, Z_BIG, 70)]))),
    'sleepCold1': lambda: solo(SLEEP_COLD_1, lambda c: (nightcap(c, SLEEP_COLD_1, True), snowflake(c, 62, 8, False))),
    'sleepCold2': lambda: solo(SLEEP_COLD_2, lambda c: (nightcap(c, SLEEP_COLD_2, True), snowflake(c, 62, 7, True))),

    'think1': lambda: scene(LOOK_UP, lambda c: thought(c, 1)),
    'think2': lambda: scene(LOOK_UP, lambda c: thought(c, 2)),
    'think3': lambda: scene(IDLE, lambda c: thought(c, 3)),
    'read1': lambda: scene(LOOK_DOWN, lambda c: book(c, False)),
    'read2': lambda: scene(replace(LOOK_DOWN, look=(3, 1)), lambda c: book(c, False)),
    'read3': lambda: scene(BLINK, lambda c: book(c, True)),
    'search1': lambda: scene(LOOK_L, lambda c: magnifier(c, 71.5, 11.5)),
    'search2': lambda: scene(IDLE, lambda c: magnifier(c, 82.5, 19.5, YELLOW)),
    'search3': lambda: scene(LOOK_R, lambda c: magnifier(c, 91.5, 27.5)),
    'type1': lambda: scene(ARMS_IN, lambda c: laptop(c, 1)),
    'type2': lambda: scene(IDLE, lambda c: laptop(c, 2)),
    'type3': lambda: scene(ARMS_IN, lambda c: laptop(c, 3)),
    'run1': lambda: scene(STEP_A, lambda c: terminal(c, 1)),
    'run2': lambda: scene(STEP_B, lambda c: terminal(c, 2)),
    'run3': lambda: scene(STEP_A, lambda c: terminal(c, 3)),
    'web1': lambda: scene(LOOK_R, lambda c: globe(c, 0)),
    'web2': lambda: scene(LOOK_R, lambda c: globe(c, 1)),
    'web3': lambda: scene(IDLE, lambda c: globe(c, 2)),
    'webSearch1': lambda: scene(LOOK_R, lambda c: globe_search(c, 0, 77.5, 14.5)),
    'webSearch2': lambda: scene(LOOK_R, lambda c: globe_search(c, 1, 82.5, 20.5, found=True)),
    'webSearch3': lambda: scene(IDLE, lambda c: globe_search(c, 2, 87.5, 25.5)),
    'write1': lambda: scene(LOOK_DOWN, lambda c: notepad(c, LOOK_DOWN, 1)),
    'write2': lambda: scene(LOOK_DOWN, lambda c: notepad(c, LOOK_DOWN, 2)),
    'write3': lambda: scene(BLINK, lambda c: notepad(c, BLINK, 3)),
    'skill1': lambda: scene(LOOK_DOWN, lambda c: scroll(c, False)),
    'skill2': lambda: scene(IDLE, lambda c: scroll(c, True)),
    'plug1': lambda: scene(ARMS_IN, lambda c: plugged(c, ARMS_IN, 1)),
    'plug2': lambda: scene(IDLE, lambda c: plugged(c, IDLE, 2)),
    'team1a': lambda: scene(HOP_2, lambda c: helpers(c, 1, 'a')),
    'team1b': lambda: scene(IDLE, lambda c: helpers(c, 1, 'b')),
    'team2a': lambda: scene(HOP_2, lambda c: helpers(c, 2, 'a')),
    'team2b': lambda: scene(IDLE, lambda c: helpers(c, 2, 'b')),
    'team3a': lambda: scene(HOP_2, lambda c: helpers(c, 3, 'a')),
    'team3b': lambda: scene(IDLE, lambda c: helpers(c, 3, 'b')),
    'ask1': lambda: scene(WAVE_1, lambda c: speech(c, 0)),
    'ask2': lambda: scene(WAVE_2, lambda c: speech(c, 1)),
    'work1': lambda: scene(IDLE, lambda c: gears(c, 0)),
    'work2': lambda: scene(BLINK, lambda c: gears(c, 1 / 8)),
}

# the loops the mod plays, for loops.png
LOOPS = (
    ('breathing', ('idle', 'idleUp')), ('blink', ('idle', 'blinkHalf', 'blink', 'blinkHalf')),
    ('looking', ('lookL', 'idle', 'lookR')), ('walk', ('stepA', 'stepB')),
    ('hop', ('hop1', 'hop2', 'hop3', 'idle')), ('wave', ('wave1', 'wave2')),
    ('cheer', ('cheer1', 'cheer2', 'cheer3', 'cheer2', 'cheer3')),
    ('yawn', ('yawn1', 'yawn2', 'yawn1')), ('sip', ('sip1', 'sip2', 'sip1')),
    ('sweat', ('sweat1', 'sweat2')), ('clock', ('clock1', 'clock2')),
    ('pumpkin', ('pumpkin1', 'pumpkin2')), ('sleep', ('sleep1', 'sleep2', 'sleep3')),
    ('cold sleep', ('sleepCold1', 'sleepCold2')),
    ('think', ('think1', 'think2', 'think3')), ('read', ('read1', 'read2', 'read3')),
    ('search', ('search1', 'search2', 'search3', 'search2')),
    ('type', ('type1', 'type2', 'type3')), ('write', ('write1', 'write2', 'write3')),
    ('run', ('run1', 'run2', 'run3')),
    ('web', ('web1', 'web2', 'web3')), ('web search', ('webSearch1', 'webSearch2', 'webSearch3')),
    ('skill', ('skill1', 'skill2')), ('plug', ('plug1', 'plug2')),
    ('team 1', ('team1a', 'team1b')), ('team 2', ('team2a', 'team2b')), ('team 3', ('team3a', 'team3b')),
    ('ask', ('ask1', 'ask2')), ('work', ('work1', 'work2')),
)


# ------------------------------------------------------------------------------- output

def manifest():
    with open(MANIFEST) as f:
        data = json.load(f)
    entries = data['frames']
    names = [e['name'] for e in entries]
    missing = [n for n in names if n not in FRAMES]
    extra = [n for n in FRAMES if n not in names]
    if missing or extra:
        sys.exit(f'make-frames: frames.json and FRAMES disagree: not drawn {missing}, not in frames.json {extra}')
    return entries


def render(entries):
    canvases = {}
    for e in entries:
        canvas = FRAMES[e['name']]()
        want = SOLO_W if e['kind'] == 'solo' else SCENE_W
        if canvas.w != want:
            sys.exit(f"make-frames: {e['name']} is a {e['kind']} frame but was drawn {canvas.w} wide")
        canvases[e['name']] = canvas
    return canvases


def check_scenes(entries, canvases):
    """Every scene keeps Claude exactly as in the solo frame the footer shows in its place:
    each pixel of that frame's pose, unchanged, in the scene. One allowance: a scene whose pose
    is the solo pose with the eyes turned (read2, the eyes on the right page) may differ where
    the two faces are drawn, and nowhere else. Returns how many scenes were checked and the
    names of those whose eyes are turned."""
    checked, turned = 0, []
    for e in entries:
        if e['kind'] != 'scene':
            continue
        mine, theirs = canvases[e['name']].pose, canvases[e['solo']].pose
        want = claude(theirs).px
        got = canvases[e['name']].px
        bad = {q for q, v in want.items() if got.get(q) != v}
        if bad and mine == replace(theirs, look=mine.look):
            faces = Canvas(SOLO_W)
            face(faces, mine)
            face(faces, theirs)
            mask = {q for q in bad if q not in faces.px}
            mask |= {q for q, v in claude(mine).px.items() if got.get(q) != v}
            if not mask:
                turned.append(e['name'])
                bad = set()
        if bad:
            sys.exit(f"make-frames: {e['name']} does not keep Claude as in {e['solo']}: {len(bad)} pixels differ, first {sorted(bad)[:5]}")
        checked += 1
    return checked, turned


def device(im):
    return im.resize((im.width // 2, im.height // 2), Image.BILINEAR)


def label_font():
    try:
        return ImageFont.load_default(size=13)
    except TypeError:
        return ImageFont.load_default()


def grid_sheet(entries, images, scale_fn, max_w, path):
    font, pad, label_h = label_font(), 14, 18
    tiles = [(e['name'], scale_fn(images[e['name']])) for e in entries]
    rows, row, x = [], [], pad
    for name, im in tiles:
        if row and x + im.width + pad > max_w:
            rows.append(row)
            row, x = [], pad
        row.append((name, im))
        x += im.width + pad
    rows.append(row)
    th = max(im.height for _, im in tiles)
    sheet = Image.new('RGBA', (max_w, pad + len(rows) * (th + label_h + pad)), rgb('#11111b'))
    draw = ImageDraw.Draw(sheet)
    for r, row in enumerate(rows):
        x, y = pad, pad + r * (th + label_h + pad)
        for name, im in row:
            sheet.alpha_composite(im, (x, y))
            draw.text((x, y + th + 2), name, fill=SUBTEXT, font=font)
            x += im.width + pad
    sheet.save(path)


def loops_sheet(images, path):
    font, pad, label_w = label_font(), 12, 96
    strips = [(name, [device(images[f]) for f in frames], frames) for name, frames in LOOPS]
    width = max(label_w + sum(im.width + pad for im in ims) for _, ims, _ in strips) + pad
    th = 80 + 16
    sheet = Image.new('RGBA', (width, pad + len(strips) * (th + pad)), rgb('#11111b'))
    draw = ImageDraw.Draw(sheet)
    for r, (name, ims, frames) in enumerate(strips):
        y = pad + r * (th + pad)
        draw.text((pad, y + 30), name, fill=TEXT, font=font)
        x = label_w
        for im, f in zip(ims, frames):
            sheet.alpha_composite(im, (x, y))
            draw.text((x, y + 82), f, fill=SUBTEXT, font=font)
            x += im.width + pad
    sheet.save(path)


def main():
    entries = manifest()
    canvases = render(entries)
    scenes, turned = check_scenes(entries, canvases)
    images = {name: canvas.image() for name, canvas in canvases.items()}
    os.makedirs(OUT, exist_ok=True)
    for name, im in images.items():
        im.save(os.path.join(OUT, f'{name}.png'), optimize=True)
    stray = sorted(f for f in os.listdir(OUT) if f.endswith('.png') and f[:-4] not in images)
    if stray:
        print(f'make-frames: not in frames.json, delete them: {", ".join(stray)}', file=sys.stderr)
    size = sum(os.path.getsize(os.path.join(OUT, f'{name}.png')) for name in images)
    if size >= MAX_BYTES:
        sys.exit(f'make-frames: the frames come to {size} bytes, over the {MAX_BYTES} the mod allows')
    if '--sheet' in sys.argv:
        out = sys.argv[sys.argv.index('--sheet') + 1]
        os.makedirs(out, exist_ok=True)
        grid_sheet(entries, images, device, 1480, os.path.join(out, 'sheet-device.png'))
        grid_sheet(entries, images, lambda im: im, 2980, os.path.join(out, 'sheet-zoom.png'))
        loops_sheet(images, os.path.join(out, 'loops.png'))
    eyes = f" (the eyes turned in {', '.join(turned)})" if turned else ''
    print(f'{len(images)} frames ({size // 1024} KB), {scenes} scenes keep Claude as in their solo frame{eyes} -> {OUT}')


if __name__ == '__main__':
    main()
