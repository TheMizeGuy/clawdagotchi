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


# >>> skits control: poses and props

# --- tally: a judge's score paddle, its card showing how many agents are working

TALLY_LOW = Arm(-6, 2)                 # the paddle hanging at his side, its back to us
TALLY_HIGH = Arm(-9, -4.5)             # held up beside his head
TALLY_0 = Pose(arms=(REST, TALLY_LOW), eyes='focus', look=(2, 1))
TALLY_N = Pose(arms=(REST, TALLY_HIGH), eyes='happy', blush=True)
TALLY_W, TALLY_H = 13, 11              # the card
TALLY_RIM = {'light': mix(BLUE, WHITE, .25), 'base': BLUE, 'dark': mix(BLUE, BASE, .4)}
TALLY_STICK = {'light': mix(YELLOW, WHITE, .3), 'base': mix(YELLOW, PEACH, .5), 'dark': mix(PEACH, BASE, .25)}
TALLY_GLYPHS = {
    '1': ('..##.', '.###.', '..##.', '..##.', '..##.', '..##.', '.####'),
    '2': ('.###.', '##.##', '...##', '..##.', '.##..', '##...', '#####'),
    '3': ('####.', '...##', '...##', '.###.', '...##', '...##', '####.'),
    '4': ('##.##', '##.##', '##.##', '#####', '...##', '...##', '...##'),
    '5': ('#####', '##...', '####.', '...##', '...##', '##.##', '.###.'),
    '6': ('.###.', '##...', '##...', '####.', '##.##', '##.##', '.###.'),
    '7': ('#####', '...##', '...##', '..##.', '..##.', '.##..', '.##..'),
    '8': ('.###.', '##.##', '##.##', '.###.', '##.##', '##.##', '.###.'),
    '9': ('.###.', '##.##', '##.##', '.####', '...##', '...##', '.###.'),
    '+': ('...', '...', '.#.', '###', '.#.', '...', '...'),
}


def tally_card(c, x, y, text):
    """The paddle's card, top-left at (x, y): a light face in a colored rim with `text` on it in
    bold dark digits, or (text None) its plain colored back."""
    card = rounded(x, y, x + TALLY_W - 1, y + TALLY_H - 1, (1,))
    c.paint(shade(card, TALLY_RIM, light=1, dark=1))
    inner = rect(x + 1, y + 1, x + TALLY_W - 2, y + TALLY_H - 2)
    if text is None:
        c.fill(inner, mix(BLUE, WHITE, .45))
        c.fill(rect(x + 1, y + 1, x + TALLY_W - 2, y + 1), mix(BLUE, WHITE, .65))
        return
    c.fill(inner, TEXT)
    c.fill(rect(x + 1, y + 1, x + TALLY_W - 2, y + 1), WHITE)
    glyphs = [TALLY_GLYPHS[ch] for ch in text]
    width = sum(len(g[0]) for g in glyphs) + len(glyphs) - 1
    gx = x + (TALLY_W - width) // 2
    for g in glyphs:
        stamp(c, g, gx, y + 2, {'#': BASE})
        gx += len(g[0]) + 1


def tally_stick(c, x, y0, y1):
    """The paddle's handle, three pixels wide (x the left), from row y0 to row y1."""
    c.paint(shade(rect(x, y0, x + 2, y1), TALLY_STICK, light=0, dark=0))
    c.fill(rect(x, y0, x, y1), TALLY_STICK['light'])
    c.fill(rect(x + 2, y0, x + 2, y1), TALLY_STICK['dark'])


def tally_paddle(c, pose, text=None):
    """The score paddle in his right hand: held up above it, its face to us showing `text`, or
    (text None) hanging below it at his side, its back to us."""
    hx, hy = hand(pose)
    mid = math.floor(hx)                      # the handle's middle column
    x = mid - TALLY_W // 2
    hy = math.floor(hy)
    if text is None:
        tally_stick(c, mid - 1, hy - 3, hy + 3)
        tally_card(c, x, hy + 4, None)
    else:
        top = hy - 5 - TALLY_H
        tally_stick(c, mid - 1, top + TALLY_H, hy + 2)
        tally_card(c, x, top, text)
    paw(c, mid - 2, hy - 2)


# --- radar: a round scope on a short stand, the agents as blips on it

RADAR = (63, 22, 6)                    # the scope's center (between pixels) and radius
RADAR_BLIPS = ((318, 4.1), (40, 4.0), (140, 4.2))   # bearing (degrees clockwise from up), distance:
                                                    # each 2x2 inside the rim, clear of every sweep line
RADAR_DARK = mix(GREEN, BASE, .82)
RADAR_METAL = {'light': SUBTEXT, 'base': SURFACE2, 'dark': SURFACE1}
RADAR_WATCH = Pose(look=(2, 1))                  # his right arm reaches behind the scope
RADAR_CONTENT = Pose(eyes='happy', look=(2, 1), blush=True)


def radar_bearing(cx, cy, x, y):
    return math.degrees(math.atan2(x + .5 - cx, cy - (y + .5))) % 360


def radar(c, quarter):
    """The scope with its sweep at bearing 90 * quarter (0 up, 1 right, 2 down, 3 left), the
    quarter just swept lit behind it in two flat steps; a blip flares white as the sweep passes
    it, then fades to green and to dim."""
    cx, cy, r = RADAR
    sweep = 90 * quarter
    # the stand: a short post and a foot on the floor
    post = rect(cx - 1, cy + r + 1, cx, GROUND - 2)
    c.fill(post, SURFACE2)
    c.fill(rect(cx - 1, cy + r + 1, cx - 1, GROUND - 2), SUBTEXT)
    foot = rounded(cx - 5, GROUND - 1, cx + 4, GROUND, (1,))
    c.paint(shade(foot, RADAR_METAL, light=1, dark=0))
    floor(c, cx, 6)
    # the bezel, the screen, its lit rim
    face = disc(cx, cy, r)
    bezel = disc(cx, cy, r + 1.2) - face
    c.paint({q: (SUBTEXT if (q[0] + .5 - cx) + (q[1] + .5 - cy) < 0 else SURFACE2) for q in bezel})
    c.fill(face, RADAR_DARK)
    rim = edge(face)
    inner = face - rim
    for x, y in sorted(inner):
        behind = (sweep - radar_bearing(cx, cy, x, y)) % 360
        if behind < 45:
            c.put(x, y, mix(RADAR_DARK, GREEN, .38))
        elif behind < 90:
            c.put(x, y, mix(RADAR_DARK, GREEN, .18))
    c.fill(rim, mix(GREEN, BASE, .15))
    # the blips: 2x2, white just after the sweep, then green, then dim
    for bearing, dist in RADAR_BLIPS:
        a = math.radians(bearing)
        bx, by = round(cx + math.sin(a) * dist) - 1, round(cy - math.cos(a) * dist) - 1
        behind = (sweep - bearing) % 360
        color = WHITE if behind < 90 else GREEN if behind < 180 else mix(GREEN, RADAR_DARK, .35)
        c.fill(rect(bx, by, bx + 1, by + 1) & inner, color)
    # the sweep line, two pixels wide, from the center to the rim
    a = math.radians(sweep)
    line = capsule(cx, cy, cx + math.sin(a) * r, cy - math.cos(a) * r, 1.0) & inner
    c.fill(line, mix(GREEN, WHITE, .7))


# --- radio: mission control, a headset with a mic

RADIO_LISTEN = Pose(look=(-2, -2))
RADIO_TALK = Pose(look=(-2, 0), mouth='radio')
RADIO_COPY = Pose(eyes='happy', blush=True)
MOUTHS['radio'] = ('####', '#tt#', '.##.')
RADIO_SET = {'light': mix(LAVENDER, WHITE, .35), 'base': LAVENDER, 'dark': mix(LAVENDER, BASE, .35)}


RADIO_ARCS = (('##.', '.##', '.##', '##.'),                          # a short sound arc, bulging right,
              ('##..', '.##.', '..##', '..##', '.##.', '##..'))       # and a longer one past it


def radio_arcs(c, x, y, outward):
    """Two sound arcs centered between rows y - 1 and y, beginning at column x and going
    outward (1: to the right, bulging right; -1: to the left from x, bulging left)."""
    at = x
    for rows in RADIO_ARCS:
        w = len(rows[0])
        if outward < 0:
            rows = tuple(r[::-1] for r in rows)
        stamp(c, rows, at if outward > 0 else at - w + 1, y - len(rows) // 2, {'#': WHITE})
        at += (w + 1) * outward


def radio_headset(c, pose, light=None, hear=False, talk=False, check=False):
    """A headset: a band over the top of his head, an ear cup at his left (our left), a boom from
    it to a mic by his mouth. light: the cup's lamp color; hear: sound arcs coming in by the
    cup; talk: sound arcs going out by the mic; check: a green check beside the cup."""
    x0, y0, x1, y1 = body_box(pose)
    pts = [(x0 - .5, y0 + 4), (x0 + 3.5, y0 - 1), (x1 - 3.5, y0 - 1), (x1 + .5, y0 + 4)]
    band = set()
    for a, b in zip(pts, pts[1:]):
        band |= capsule(a[0], a[1], b[0], b[1], 1.0)
    c.paint(shade(band, RADIO_SET, light=1, dark=0))
    c.fill(rounded(x1 - 1, y0 + 2, x1 + 2, y0 + 7, (1,)), RADIO_SET['dark'])       # the pad
    cup = rounded(x0 - 4, y0 + 1, x0 + 2, y0 + 9, (2, 1))
    c.paint(shade(cup, RADIO_SET, light=2, dark=2))
    boom = line_px([(x0 + 1, y0 + 9), (x0 + 5, y0 + 13), (x0 + 13, y0 + 15)])
    c.fill(set(boom), BASE)
    c.fill(rounded(x0 + 13, y0 + 14, x0 + 17, y0 + 16, (1,)), BASE)                 # the mic
    c.put(x0 + 14, y0 + 14, SURFACE2)
    c.fill(rect(x0 - 3, y0 + 3, x0, y0 + 6), SURFACE1)                              # the lamp's socket
    c.fill(rect(x0 - 2, y0 + 4, x0 - 1, y0 + 5), light or SURFACE2)                 # the lamp, off or lit
    if hear:
        radio_arcs(c, x0 - 6, y0 + 6, -1)
    if talk:
        radio_arcs(c, x0 + 23, y0 + 17, 1)
    if check:
        stamp(c, ('......gg', '.....gg.', 'gg..gg..', '.gggg...', '..gg....'), x0 - 14, y0 + 3,
              {'g': GREEN})
# <<< skits control


# >>> skits helpers: poses and props
# --- skit "report": a helper brings him the finished report (a background agent is done)

REPORT_REACH = Arm(-6.5, -4)                   # his right hand out to the page
REPORT_HOLD = Arm(-8.5, -8.5, elbow=ELBOW)     # the forearm up, the page held by his face
REPORT_TAKE = Pose(look=(2, 0), arms=(REST, REPORT_REACH))
REPORT_READ = Pose(eyes='focus', look=(2, -2), arms=(REST, REPORT_HOLD))
REPORT_GLAD = Pose(eyes='happy', look=(1, 0), blush=True, arms=(REST, REPORT_HOLD))
REPORT_INK = mix(SUBTEXT, SURFACE2, .55)
REPORT_TICK, REPORT_TICK_DARK = rgb('#40a02b'), rgb('#2c7a1c')
REPORT_HELD = (57, 1)                          # the page's top-left while he holds it

REPORT_PAGE = ('wwwwwwwk..',
               'wbbbbwwkk.',
               'wbbbbwwkkk',
               'wwwwwwwwwe',
               'wiiiiiiiwe',
               'wwwwwwwwwe',
               'wiiiiwiiwe',
               'wwwwwwwwwe',
               'wiiiiiiwwe',
               'wwwwwwwwwe',
               'wiiiwwwwwe',
               'wwwwwwwwwe',
               'eeeeeeeeee')
REPORT_CHECK = ('.......gg',
                '......ggd',
                'gg...ggd.',
                'dgg.ggd..',
                '.dgggd...',
                '..dgd....')
REPORT_ARM = ('....lb',                       # the helper's left arm raised, from its side
              '....lb',                       # up past its head (the right arm mirrors it)
              '...lb.',
              '..lb..',
              '.lb...',
              'lb....',
              'lb....',
              'bd....')
REPORT_CHEER = ('lb',                         # the helper's left arm thrown straight up beside
                'lb',                         # its head, empty-handed (the right one mirrors it)
                'lb',
                'lb',
                'lb',
                'lb',
                'bd')


def report_page(c, x, y, checked=False):
    """The report: a white page 10x13 with a dog-eared corner, a blue title and grey lines of
    text; checked, a bold green check over its middle (clear of the paw that holds it)."""
    stamp(c, REPORT_PAGE, x, y, {'w': WHITE, 'e': TEXT, 'k': SUBTEXT, 'b': BLUE, 'i': REPORT_INK})
    if checked:
        stamp(c, REPORT_CHECK, x + 1, y + 4, {'g': REPORT_TICK, 'd': REPORT_TICK_DARK})


def report_helper(c, pose, x, foot, hop=0, page=False, cheer=False):
    """The helper (mini_claude) at x, looking at him, laid over him with a deep line where it
    covers him; page: its arms raised from its sides, the report held over its head; cheer:
    both arms thrown straight up, empty-handed."""
    own = Canvas(SOLO_W)
    mini_claude(own, x, foot, hop, shadow=False)
    top = foot - 10 - hop
    if page or cheer:
        skin = {'l': SKIN['light'], 'b': SKIN['base'], 'd': SKIN['dark']}
        own.erase(rect(x, top + 4, x + 1, top + 6) | rect(x + 17, top + 4, x + 18, top + 6))
        if page:
            arm_l, at_l, at_r, at_y = REPORT_ARM, x, x + 13, top - 3
        else:
            arm_l, at_l, at_r, at_y = REPORT_CHEER, x, x + 17, top - 2
        arm_r = tuple(row[::-1] for row in arm_l) if page else arm_l   # straight: lit at the left too
        arms = mask_of(arm_l, at_l, at_y) | mask_of(arm_r, at_r, at_y)
        stamp(own, arm_l, at_l, at_y, skin)
        stamp(own, arm_r, at_r, at_y, skin)
        own.fill(around(arms) & mask_of(MINI, x, top) - arms, SKIN['deep'])
        if page:
            report_page(own, x + 5, top - 15)
            for hx in (x + 4, x + 13):
                stamp(own, ('lb', 'bd'), hx, top - 3, skin)
    floor(c, x + 9.5, 6 if hop else 8, foot + 1)
    him = {q for q in c.px if q[1] <= GROUND}
    c.fill(around(set(own.px)) & him, SKIN['deep'])
    c.paste(own)


def report(c, pose, step):
    """1: the helper coming in at the right edge, the page over its head; 2: hopping beside
    him, the page held up to his reaching hand; 3: he holds the page up by his face and reads
    it, the helper watching; 4: a green check on the page, the helper hopping, arms up. The helper
    walks in 2 pixels a step (55, 53, 51), so the page stays whole in the frame."""
    hx, hy = hand(pose)
    if step == 1:
        report_helper(c, pose, 55, GROUND, page=True)
    elif step == 2:
        report_helper(c, pose, 53, GROUND, hop=2, page=True)
        paw(c, math.floor(hx) - 2, math.floor(hy) - 2)
    else:
        report_page(c, *REPORT_HELD, checked=step == 4)
        paw(c, math.floor(hx) - 2, math.floor(hy) - 2, pose)
        # 4: a little jump for joy, arms up; at hop 1 its legs still reach the floor, so it
        # does not hang in the air for the whole second report4 is held
        report_helper(c, pose, 51, GROUND, hop=1 if step == 4 else 0, cheer=step == 4)
        if step == 4:
            sparkle(c, 68, 6, YELLOW)
            sparkle(c, 55, 2, YELLOW)


# --- skit "launch": a small rocket lifts off at his right

ROCKET = ('.....l.....',
          '....lRd....',
          '....lRd....',
          '...lRRRd...',
          '..lRRRRRd..',
          '..WTTTTTS..',
          '..WTTTTTS..',
          '..WTgbbTS..',
          '..WTbbbTS..',
          '..WTbbBTS..',
          '..WTTTTTS..',
          '..WTTTTTS..',
          '.lWTTTTTSd.',
          'lRWTTTTTSRd',
          'lRWTTTTTSRd',
          'lR.nnnnn.Rd',
          'l...nnn...d')
LAUNCH_WOW = Pose(eyes='wide', look=(2, 0), mouth='o')
LAUNCH_BYE = Pose(eyes='happy', look=(2, -2), blush=True)
ROCKET_RED = mix(RED, rgb('#d20f39'), .5)      # Mocha's RED alone reads pink this small


def rocket(c, x, y):
    """A small rocket 11x17, its top-left at (x, y): a white body lit from the left, a red nose
    and fins, a blue porthole."""
    stamp(c, ROCKET, x, y, {'l': mix(ROCKET_RED, WHITE, .3), 'R': ROCKET_RED, 'd': mix(ROCKET_RED, BASE, .3),
                            'W': WHITE, 'T': TEXT, 'S': SUBTEXT, 'g': WHITE, 'b': BLUE,
                            'B': mix(BLUE, BASE, .3), 'n': SUBTEXT})


def rocket_flame(c, cx, y, n):
    """A flame under a nozzle centered at column cx, from row y, n rows long."""
    for k in range(n):
        w = 2 if k < n - 2 else 1 if k < n - 1 else 0
        for dx in range(-w, w + 1):
            col = WHITE if abs(dx) == 0 and k < n - 2 else YELLOW if abs(dx) <= 1 and k < n - 1 else PEACH
            c.put(cx + dx, y + k, col)


def rocket_smoke(c, puffs):
    """Smoke: round puffs (cx, cy, r) drawn in turn, each one over the last, lit at its upper
    left and grey at its lower right, so the cloud billows."""
    for cx, cy, r in puffs:
        for x, y in sorted(disc(cx, cy, r)):
            s = ((x + .5 - cx) * .6 + (y + .5 - cy) * .8) / r
            c.put(x, y, WHITE if s < -.35 else SUBTEXT if s > .4 else TEXT)


def launch(c, step):
    """1: the rocket on the floor at his right; 2: ignition, a few pixels up on its flame,
    smoke billowing at its base, the flame drawn over it; 3: leaving through the top right
    over a plume of smoke. It climbs straight up column 59, a pixel clear of his arm's tip."""
    if step == 1:
        floor(c, 64.5, 6)
        rocket(c, 59, 21)
    elif step == 2:
        floor(c, 64.5, 6)
        rocket(c, 59, 17)
        rocket_smoke(c, ((64.5, 38.5, 2.0), (52.5, 37.5, 2.2), (69.5, 36, 2.8), (56, 36, 2.8)))
        rocket_flame(c, 64, 34, 5)
    else:
        rocket_smoke(c, ((64.5, 18, 1.3), (63.5, 21.5, 1.8), (65, 24.5, 2.0), (63, 27.5, 2.4), (65, 30.5, 2.6),
                         (63.5, 33.5, 3.0), (54, 37.5, 2.0), (68.5, 35.5, 2.8), (58, 36, 2.8), (63, 36.5, 3.2)))
        rocket(c, 59, -6)
        rocket_flame(c, 64, 11, 6)


# --- skit "perch": a helper stands on his head

PERCH_1 = Pose(lift=-3, tall=-2, wide=1, look=(0, -2))
PERCH_2 = Pose(lift=-3, tall=-3, wide=1, eyes='squeeze')
PERCH_X = 25


def perch(c, pose, hop):
    """The helper standing on his head (hop: in a hop off it), a shadow under it there."""
    x0, y0, x1, y1 = body_box(pose)
    head = rounded(x0, y0, x1, y1, CORNER)
    a, b = (PERCH_X + 3, PERCH_X + 15) if not hop else (PERCH_X + 5, PERCH_X + 13)
    c.fill(rect(a, y0, b, y0) & head, SKIN['base'])
    mini_claude(c, PERCH_X, y0 - 1, hop, 0, shadow=False)
    if hop:                     # two little springs under it, off his head
        for x, d in ((PERCH_X + 1, -1), (PERCH_X + 17, 1)):
            c.fill({(x, y0 - 2), (x + d, y0 - 3), (x + 2 * d, y0 - 4)}, TEXT)


# --- skit "conduct": he conducts the orchestra of agents

CONDUCT_UP = Arm(-9.5, -11.5, elbow=ELBOW)     # the baton raised up and out
CONDUCT_LOW = Arm(-6.5, 4.5)                    # swept down low
CONDUCT_1 = Pose(arms=(REST, CONDUCT_UP), eyes='happy', blush=True)
CONDUCT_2 = Pose(arms=(REST, CONDUCT_LOW), eyes='happy', blush=True, mouth='o')
CONDUCT_3 = Pose(arms=(REST, WAVE_IN), eyes='happy', blush=True)
CONDUCT_NOTE = ('..##...',
                '..####.',
                '..##.##',
                '..##..#',
                '..##...',
                '####...',
                '####...',
                '.##....')
CONDUCT_BEAM = ('..#######',
                '..#######',
                '..##...##',
                '..##...##',
                '..##...##',
                '####.####',
                '####.####',
                '.##...##.')


def conduct_baton(c, pose, tip):
    """A thin white baton from his right hand out to `tip`."""
    hx, hy = hand(pose)
    own = claude(pose).px
    stick = [q for q in line_px([(math.floor(hx), math.floor(hy)), tip]) if q not in own]
    for i, q in enumerate(stick):
        c.put(q[0], q[1], WHITE)
        if i < 2:
            c.fill(set(near(*q)) - set(own) - set(stick), mix(PEACH, BASE, .15))


def conduct(c, pose, step):
    """The baton in his right hand (1 up and out, 2 swept down low, 3 up and in toward his
    head) and music notes in sky, pink and yellow drifting up at the upper left, 2 pixels a
    step and clear of his head (the loop plays 1, 2, 3, 2, so they bob to the beat)."""
    tips = {1: (69, 0), 2: (69, 35), 3: (50, 1)}
    conduct_baton(c, pose, tips[step])
    notes = {1: [(CONDUCT_NOTE, 0, 11, SKY), (CONDUCT_BEAM, 6, 2, PINK)],
             2: [(CONDUCT_NOTE, 1, 9, SKY), (CONDUCT_BEAM, 7, 1, PINK), (CONDUCT_NOTE, 0, 19, YELLOW)],
             3: [(CONDUCT_NOTE, 2, 7, SKY), (CONDUCT_BEAM, 8, 0, PINK), (CONDUCT_NOTE, 1, 17, YELLOW)]}
    for rows, x, y, col in notes[step]:
        stamp(c, rows, x, y, {'#': col})
# <<< skits helpers


# >>> skits gags: poses and props

# --- juggle: three balls in a shower over his head, each one spot further round every frame

JUGGLE_UP = Arm(-6, -9)            # the hand at a throw or a catch, up by its ball
JUGGLE_LOW = Arm(-2.5, 2.5)        # the other hand, low
JUGGLE_MID = Arm(-4.5, -4.5)       # both hands on their way
JUGGLE_BASE = Pose(tall=-1, look=(0, -2), mouth='juggle_line')     # lips pressed, concentrating
MOUTHS['juggle_line'] = ('####',)
JUGGLE_1 = replace(JUGGLE_BASE, arms=(JUGGLE_UP, JUGGLE_LOW))
JUGGLE_2 = replace(JUGGLE_BASE, arms=(JUGGLE_LOW, JUGGLE_UP))
JUGGLE_3 = replace(JUGGLE_BASE, arms=(JUGGLE_MID, JUGGLE_MID))
# the ball centers round the loop: just thrown from his left hand, at the top, falling to his right
JUGGLE_SPOTS = ((9, 10), (35, 2), (60, 10))
JUGGLE_COLORS = (BLUE, GREEN, mix(YELLOW, rgb('#f6c945'), .5))
JUGGLE_BALL = ('.lbb.', 'lwbbb', 'bbbbb', 'bbbbd', '.ddd.')
JUGGLE_SPEED = ((-4, 0, 190), (-5, 1, 130), (-6, 1, 80))    # behind the top ball: (dx, dy, alpha)


def juggle_ball(c, cx, cy, color):
    """A 5x5 ball centered at (cx, cy), a white glint at its upper left."""
    stamp(c, JUGGLE_BALL, cx - 2, cy - 2,
          {'l': mix(color, WHITE, .45), 'w': WHITE, 'b': color, 'd': mix(color, BASE, .35)})


def juggle_balls(c, step):
    """The three balls on their spots, each one spot further round than in the step before; a
    pale speed line behind the top one shows which way they go round."""
    tx, ty = JUGGLE_SPOTS[1]
    for dx, dy, a in JUGGLE_SPEED:
        c.put(tx + dx, ty + dy, fade(TEXT, a))
    for k, (x, y) in enumerate(JUGGLE_SPOTS):
        juggle_ball(c, x, y, JUGGLE_COLORS[(k - step) % 3])


def juggle_tongue(c, pose):
    """The tip of his tongue poking out at the right corner of his mouth, in concentration."""
    x0, y0, x1, _ = body_box(pose)
    mx, my = (x0 + x1 + 1) // 2 - len(MOUTHS['juggle_line'][0]) // 2, y0 + EYE_TOP + 9
    c.fill(rect(mx + 3, my + 1, mx + 4, my + 2), PINK)
    c.put(mx + 4, my + 2, mix(PINK, RED, .4))


# --- gum: a bubble that grows and pops

GUM_TONES = {'light': mix(PINK, WHITE, .3), 'base': mix(PINK, RED, .5), 'dark': mix(RED, MAUVE, .3)}
GUM_RIM = mix(RED, BASE, .25)
GUM_1 = Pose(eyes='gum_lidded')
EYES['gum_lidded'] = (0, 3, ('####', '#o##', '####', '.##.'), False)   # heavy lids, unbothered
GUM_2 = Pose(eyes='wide')
GUM_3 = FLINCH


def gum_bubble(c, pose, r):
    """A pink bubble of radius r blown from his mouth: lit from the upper left, a darker rim,
    a white glint."""
    x0, y0, x1, _ = body_box(pose)
    cx, cy = (x0 + x1 + 1) / 2, y0 + EYE_TOP + 10.5
    ball = disc(cx, cy, r)
    for x, y in sorted(ball):
        s = ((x + .5 - cx) * .6 + (y + .5 - cy) * .8) / r
        c.put(x, y, GUM_TONES['light'] if s < -.45 else GUM_TONES['dark'] if s > .45 else GUM_TONES['base'])
    if r > 4:
        c.fill(edge(ball), GUM_RIM)
        gx, gy = math.floor(cx - r * .45), math.floor(cy - r * .45)
        c.fill({(gx, gy), (gx + 1, gy - 1), (gx + 2, gy - 1), (gx, gy + 1)}, WHITE)
    else:
        c.put(math.floor(cx) - 1, math.floor(cy) - 1, WHITE)


# the popped bubble splatted over his mouth: blobs as (dx, dy, radius) from the mouth, two
# strands dripping off his chin as (left dx, right dx, bottom dy), and flecks flung onto the
# top of his head and above his right brow as (dx, dy) from the top middle of his head
GUM_SPLAT = ((0, 0, 4.6), (-7, -1, 3.1), (7, 1, 3.1), (-3, 3.5, 2.4), (4, -3.2, 2.2))
GUM_STRANDS = ((-4, -3, 7), (6, 6, 6))
GUM_FLECKS = ((-5, -1), (-4, -1), (-3, -1), (-4, 0), (-4, 1), (14, 3), (15, 3), (15, 4))
# white burst marks ringing the splat two pixels clear of it, (ax, ay, bx, by) from the mouth:
# out to each side, up between his eyes, and down and out at the lower corners
GUM_BURSTS = ((-16, 0, -13, 0), (12, 0, 15, 0), (0, -11, 0, -8), (-12, 3, -14, 5), (11, 3, 13, 5))


def gum_pop(c, pose):
    """The bubble popped: a splat of pink gum stuck over his mouth and cheeks, two strands
    dripping off his chin, flecks on the top of his head and above his brow, a deep line under
    it where it sits on him, and short white burst marks ringing the splat."""
    x0, y0, x1, y1 = body_box(pose)
    cx, cy = (x0 + x1 + 1) // 2, y0 + EYE_TOP + 10
    film = set()
    for dx, dy, r in GUM_SPLAT:
        film |= disc(cx + dx, cy + dy, r)
    for a, b, bottom in GUM_STRANDS:
        film |= rect(cx + a, cy, cx + b, cy + bottom)
    film = tidy(film)
    goo = film | {(cx + dx, y0 + dy) for dx, dy in GUM_FLECKS}
    body = rounded(x0, y0, x1, y1, CORNER)
    c.fill({(x, y + 1) for x, y in goo if (x, y + 1) not in goo} & body, SKIN['deep'])
    c.paint(shade(goo, GUM_TONES, light=1, dark=1))
    c.fill({(cx - 2, cy - 2), (cx - 1, cy - 3), (cx, cy - 3)}, mix(PINK, WHITE, .7))
    for ax, ay, bx, by in GUM_BURSTS:
        c.fill(set(line_px([(cx + ax, cy + ay), (cx + bx, cy + by)])), WHITE)


# --- popcorn: he watches the agents like a film

POPCORN_1 = Pose(look=(-2, -2), mouth='o')
POPCORN_2 = Pose(eyes='happy', mouth='popcorn_munch', blush=True)
MOUTHS['popcorn_munch'] = ('#.#.#', '.#.#.')
POPCORN_RIM = (54, 23)            # the bucket's rim: left column, top row
POPCORN_KERNEL = ('.wW.', 'wWWw', 'wwwy', '.yy.')
POPCORN_KERNEL_COLORS = {'W': WHITE, 'w': mix(YELLOW, WHITE, .6), 'y': mix(YELLOW, PEACH, .35)}
POPCORN_TRAIL = ((5, -1, 200), (7, -2, 130), (9, -2, 80))   # behind the flying kernel: (dx, dy, alpha)
# the bucket's stripes, a cinema red (toward Catppuccin Latte's red) and white: light, base, dark
POPCORN_RED = mix(RED, rgb('#d20f39'), .55)
POPCORN_REDS = (mix(RED, rgb('#d20f39'), .25), POPCORN_RED, mix(POPCORN_RED, BASE, .3))
POPCORN_WHITES = (WHITE, WHITE, TEXT)


def popcorn_bucket(c, pose):
    """A red-and-white striped bucket at his right side, heaped with popcorn, his paw at its rim."""
    x0, y0 = POPCORN_RIM
    w, h = 13, 12
    bucket = set()
    for j in range(h):
        k = j // 5
        bucket |= rect(x0 + k, y0 + j, x0 + w - 1 - k, y0 + j)
    stripes = (0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0)      # 0 red, 1 white, by column
    for x, y in sorted(bucket):
        tone = 0 if x - x0 <= 1 else 2 if x - x0 >= w - 2 or y == y0 + h - 1 else 1
        c.put(x, y, (POPCORN_WHITES if stripes[x - x0] else POPCORN_REDS)[tone])
    c.fill(rect(x0, y0, x0 + w - 1, y0), WHITE)
    heap = set()
    for hx, hy, r in ((x0 + 2.5, y0 - 1, 2.2), (x0 + 5.5, y0 - 2.5, 2.4), (x0 + 9, y0 - 2, 2.3),
                      (x0 + 11, y0 - .5, 1.8), (x0 + 7.5, y0 - 4.5, 1.9), (x0 + 4, y0 - 4, 1.4)):
        heap |= disc(hx, hy, r)
    heap = tidy(heap) - bucket
    c.paint(shade(heap, {'light': WHITE, 'base': mix(YELLOW, WHITE, .65), 'dark': mix(YELLOW, PEACH, .3)}, light=1, dark=1))
    c.fill({(x0 + 4, y0 - 2), (x0 + 8, y0 - 3), (x0 + 10, y0 - 1)}, YELLOW)
    paw(c, x0 - 1, y0 - 1, pose, bucket | heap)


def popcorn_dropped(c):
    """A kernel he dropped, on the floor by the bucket."""
    stamp(c, POPCORN_KERNEL, 66, 34, POPCORN_KERNEL_COLORS)


def popcorn_kernel(c, pose):
    """One kernel in the air beside his open mouth and clear of his eye, on its way in from
    the bucket (a faint trail behind it), a deep line where it lies on him."""
    x0, y0, x1, y1 = body_box(pose)
    x, y = (x0 + x1 + 1) // 2 + 3, y0 + EYE_TOP + 7
    c.fill(around(mask_of(POPCORN_KERNEL, x, y)) & rounded(x0, y0, x1, y1, CORNER), SKIN['deep'])
    for dx, dy, a in POPCORN_TRAIL:
        c.put(x + dx, y + dy, fade(POPCORN_KERNEL_COLORS['w'], a))
    stamp(c, POPCORN_KERNEL, x, y, POPCORN_KERNEL_COLORS)


# --- plane: a paper plane that comes back

PLANE_1 = Pose(arms=(REST, Arm(-5, -7)), look=(2, -2))
PLANE_2 = Pose(arms=(REST, Arm(-7, -8)), eyes='happy', blush=True)
PLANE_3 = Pose(look=(2, -2), mouth='plane_smile', blush=True)
PLANE_4 = Pose(eyes='wide', look=(-2, 0))
PLANE_5 = FLINCH
MOUTHS['plane_smile'] = ('#..#', '.##.')
PLANE_SIZE = (15, 5.5, 3.4, 4.5)       # length, the upper wing's spread, the lower's, the notch


def plane_shape(nx, ny, angle):
    """A paper plane seen from a little above, an arrowhead with a notch at its tail, its nose
    at (nx, ny) pointing `angle` degrees below the horizontal to the right: (the upper wing,
    the lower wing in its shade) as masks."""
    a = math.radians(angle)
    ca, sa = math.cos(a), math.sin(a)

    def at(u, v):
        return (nx + .5 + u * ca - v * sa, ny + .5 + u * sa + v * ca)
    L, up, down, notch = PLANE_SIZE
    nose, fold = at(1, 0), at(-L + notch, .3)
    upper = polygon([nose, at(-L, -up), fold])
    lower = polygon([nose, fold, at(-L + 1.5, down)]) - upper
    return upper, lower


def plane_paper(c, nx, ny, angle, hide=frozenset()):
    """The plane, white above its fold and lavender grey below, less any pixels in `hide`."""
    upper, lower = plane_shape(nx, ny, angle)
    c.fill(upper - hide, WHITE)
    c.fill({q for q in upper if any(n in lower for n in near(*q))} - hide, TEXT)
    c.fill(lower - hide, mix(SUBTEXT, LAVENDER, .3))
    return upper | lower


def plane_speed(c, lines):
    """Short pale speed lines, each from (ax, ay) to (bx, by)."""
    for ax, ay, bx, by in lines:
        c.fill(set(line_px([(ax, ay), (bx, by)])), fade(TEXT, 170))


def plane_alarm(c, x, y):
    """A small yellow exclamation mark, its top at (x, y)."""
    c.fill(rect(x, y, x + 1, y + 3), YELLOW)
    c.fill(rect(x, y + 5, x + 1, y + 6), YELLOW)


def plane_held(c, pose):
    """The plane up at his right, pinched under its fold by his paw."""
    hx, hy = hand(pose)
    plane_paper(c, math.floor(hx) + 8, math.floor(hy) - 6, -6)
    paw(c, math.floor(hx) - 2, math.floor(hy) - 3)


PLANE_STUCK = (2, 2, 10)               # the nose's offset from the body's top left, the angle


def plane_bonk(c, pose):
    """The plane's nose stuck in the top left of his head, flown in from the left, a deep dent
    round it; two stars over his head."""
    x0, y0, x1, y1 = body_box(pose)
    head = rounded(x0, y0, x1, y1, CORNER)
    dx, dy, angle = PLANE_STUCK
    plane = plane_paper(c, x0 + dx, y0 + dy, angle, head)
    c.fill(around(plane - head) & head, SKIN['deep'])
    sparkle(c, x0 + 15, y0 - 5, YELLOW)
    sparkle(c, x0 + 27, y0 - 3, YELLOW)


# --- zen: he meditates, floating, while the agents work

ZEN_ARM = Arm(-7, -1)
ZEN_1 = Pose(eyes='sleepy', feet=(3, 3, 3, 3), arms=(ZEN_ARM, ZEN_ARM), mouth='zen_smile')
ZEN_2 = replace(ZEN_1, lift=1, feet=(4, 4, 4, 4))
MOUTHS['zen_smile'] = ('#..#', '.##.')
ZEN_TWINKLE = ('..c..', '..c..', 'ccwcc', '..c..', '..c..')


def zen_twinkle(c, x, y):
    """A lavender twinkle 5x5 centered at (x, y), white at its heart."""
    stamp(c, ZEN_TWINKLE, x - 2, y - 2, {'c': LAVENDER, 'w': WHITE})
# <<< skits gags


# >>> skits time: poses and props
# --- garden: a potted plant at his right that grows the longer the agents run

GARDEN_LOOK = Pose(look=(2, 1))                                   # eyeing the pot
GARDEN_PROUD = Pose(eyes='happy', look=(2, 0), blush=True)        # it flowered
GARDEN_WATER = Pose(arms=(REST, HIGH), look=(2, 1))               # the can held up over the pot

GARDEN_POT_XY = (57, 29)          # the pot's top-left: 12 wide, the soil on row 29, its foot on row 37
GARDEN_STEM = 62                  # the stem's left column (it is 2 wide); the plant keeps clear of
                                  # his right hand (rows 18 to 24, out to column 59)
GARDEN_CLAY = {'L': rgb('#f0a073'), 'l': rgb('#d9744a'), 'b': rgb('#c45a38'), 'd': rgb('#8f3f28'),
               's': rgb('#6b4434')}
GARDEN_POT = ('LssssssssssL',
              'LLLLLLLLLLLL',
              'llbbbbbbbbbd',
              '.dddddddddd.',
              '.lbbbbbbbbd.',
              '.lbbbbbbbbd.',
              '..lbbbbbbd..',
              '..lbbbbbbd..',
              '..dddddddd..')
GARDEN_GREENS = {'L': mix(GREEN, WHITE, .35), 'g': GREEN, 'D': mix(GREEN, BASE, .3),
                 's': mix(GREEN, BASE, .15), 'S': mix(GREEN, BASE, .4)}
GARDEN_LEAF = ('...LL',           # a leaf reaching up and out to the right from the stem
               '.LLgg',
               'ggggD',
               '.DD..')
GARDEN_SPROUT = ('LL....LL',
                 'gLL..LLg',
                 '.Dg..gD.')
GARDEN_PETALS = {'P': mix(PINK, WHITE, .25), 'p': mix(PINK, RED, .35), 'q': mix(RED, MAUVE, .35),
                 'y': YELLOW, 'Y': mix(YELLOW, PEACH, .6), 'g': GREEN, 'D': mix(GREEN, BASE, .3)}
GARDEN_BUD = ('.PP.',
              'Pppq',
              'gqqg',
              'gggD',
              '.gD.')
GARDEN_FLOWER = ('.PP.Pp.',
                 'PPPpPpq',
                 'PpyyYpq',
                 '.pyYYq.',
                 'PpYYYqq',
                 'ppqpqqq',
                 '.qq.qq.')


def garden_pot(c):
    """A terracotta pot on the floor at his right: a lit rim round the soil, a tapered body."""
    x, y = GARDEN_POT_XY
    floor(c, x + 6, 6, y + 9)
    stamp(c, GARDEN_POT, x, y, GARDEN_CLAY)


def garden_leaf(c, y, left):
    """A leaf on the stem, its stalk end on row y + 2, on the stem's left or its right."""
    if left:
        stamp(c, tuple(r[::-1] for r in GARDEN_LEAF), GARDEN_STEM - 5, y, GARDEN_GREENS)
    else:
        stamp(c, GARDEN_LEAF, GARDEN_STEM + 2, y, GARDEN_GREENS)


def garden_stem(c, top):
    """The stem, two pixels wide (lit on the left), from row `top` down to the soil."""
    c.fill(rect(GARDEN_STEM, top, GARDEN_STEM, 28), GARDEN_GREENS['s'])
    c.fill(rect(GARDEN_STEM + 1, top, GARDEN_STEM + 1, 28), GARDEN_GREENS['S'])


def garden_plant(c, stage):
    """The pot and the plant at a stage: 1 a sprout, 2 a stem with two leaves, 3 taller with a
    third leaf and a closed bud, 4 the bud open in a pink flower."""
    garden_pot(c)
    s = GARDEN_STEM
    if stage == 1:
        garden_stem(c, 27)
        stamp(c, GARDEN_SPROUT, s - 3, 25, GARDEN_GREENS)
        return
    garden_stem(c, {2: 20, 3: 18, 4: 19}[stage])
    garden_leaf(c, 25, True)
    garden_leaf(c, 21, False)
    if stage == 2:
        stamp(c, ('.LL', 'Lg.'), s, 18, GARDEN_GREENS)
    if stage >= 3:
        garden_leaf(c, 14, True)
    if stage == 3:
        stamp(c, GARDEN_BUD, s - 1, 13, GARDEN_PETALS)
    if stage == 4:
        stamp(c, GARDEN_FLOWER, s - 3, 13, GARDEN_PETALS)


GARDEN_CAN = ('..DDD........',      # a watering can tipped forward, its spout down to the right
              '.DD.DDD......',      # the handle a 2-pixel loop, so it survives at terminal size
              '.LL...DD.....',
              'LBBLL.DD.....',
              'BBBBBLLL.....',
              'BBBBBBBBL....',
              '.BBBBBBBBss..',
              '..DBBBBBBDss.',
              '....DDDDD..RR',
              '...........RR')
GARDEN_CAN_COLORS = {'L': mix(SKY, WHITE, .45), 'B': SKY, 'D': mix(SKY, SAPPHIRE, .7),
                     's': SKY, 'R': mix(SKY, WHITE, .45)}
GARDEN_CAN_XY = (51, 0)           # the can's top-left: on his raised hand, its rose over the stem
GARDEN_DROP = ('.s', 'ss', 'Ss')
GARDEN_SPRAY = ((62, 10), (57, 11), (67, 11))      # a cone from the rose, clear of a bud or a flower
GARDEN_DROPS = {1: ((62, 12), (63, 16), (62, 20)), 2: ((62, 11), (63, 14), (61, 17)),
                3: GARDEN_SPRAY, 4: GARDEN_SPRAY}


def garden_water(c, stage):
    """Watering: the plant at its stage, the can tipped over it on his raised right hand and
    three drops falling from the rose onto the plant."""
    garden_plant(c, stage)
    stamp(c, GARDEN_CAN, *GARDEN_CAN_XY, GARDEN_CAN_COLORS)
    for x, y in GARDEN_DROPS[stage]:
        stamp(c, GARDEN_DROP, x, y, {'s': SKY, 'S': SAPPHIRE})


def garden_sparkles(c):
    """Two sparkles about the flower, for his pride in it."""
    sparkle(c, 67, 11, YELLOW)
    sparkle(c, 57, 9, PINK)


# --- lantern: the night shift

EYES['lantern_drowsy'] = (0, 4, ('####', '####', '.##.'), False)   # a flat lid half down a round eye
MOUTHS['lantern_yawn'] = ('.##.', '#..#', '.##.')                     # a small yawn
LANTERN_1 = Pose(arms=(REST, HOLD), eyes='lantern_drowsy', look=(2, 0), mouth='lantern_yawn')
LANTERN_2 = Pose(arms=(REST, HOLD), eyes='blink', look=(2, 0))
LANTERN_XY = (57, 21)             # the lantern's top-left (9 wide), its bail on the tip of his right hand
LANTERN_RED = rgb('#e64553')
LANTERN_GLOW = mix(YELLOW, rgb('#ffb02e'), .6)   # warmer than the glass, so the halo reads as light
LANTERN_METAL = {'M': mix(LANTERN_RED, WHITE, .3), 'm': LANTERN_RED, 'n': mix(LANTERN_RED, BASE, .45)}
LANTERN = ('...nnn...',
           '..n...n..',
           '..MMMMm..',
           '.MMmmmmn.',
           'MMmmmmmmn',
           '.n.....n.',
           '.n.....n.',
           '.n.....n.',
           '.n.....n.',
           '.n.....n.',
           'MMmmmmmmn',
           '.nnnnnnn.')


def lantern(c, lit):
    """A red lantern hanging from his right hand: its glass bright yellow round a white flame,
    a warm halo about it (lit), or dim, the flame an orange stub and the halo small (low)."""
    x, y = LANTERN_XY
    glass = rect(x + 2, y + 5, x + 6, y + 9)
    cx, cy = x + 4.5, y + 7.5
    if lit:
        for r, a in ((7.5, 30), (6.5, 42), (5, 60)):      # r 7.5 ends on column 68, inside the frame
            c.fill(ellipse(cx, cy, r, r - .5), fade(LANTERN_GLOW, a))
        c.fill(glass, YELLOW)
        stamp(c, ('.w.', 'wWw', 'wWw'), x + 3, y + 6, {'w': mix(YELLOW, WHITE, .6), 'W': WHITE})
    else:
        c.fill(ellipse(cx, cy, 5, 4.5), fade(LANTERN_GLOW, 40))
        c.fill(glass, mix(YELLOW, BASE, .5))
        stamp(c, ('.o.', 'oOo'), x + 3, y + 8, {'o': mix(PEACH, BASE, .2), 'O': PEACH})
    stamp(c, LANTERN, x, y, LANTERN_METAL)


# --- lunch: a sandwich at noon

MOUTHS['lunch_grin'] = ('####', '.##.')       # open, eager
MOUTHS['lunch_munch'] = ('#..#', '.##.')      # closed, chewing
LUNCH_1 = Pose(arms=(REST, HOLD), eyes='wide', look=(2, -1), mouth='lunch_grin')
LUNCH_2 = Pose(arms=(REST, HOLD), eyes='happy', look=(1, 0), blush=True, mouth='lunch_munch')
LUNCH_XY = (53, 9)                # the sandwich's top-left (15 wide, 8 high), on his right hand
LUNCH = ('..CCCCCCCCCCC..',
         '.CBBBBBBBBBBBC.',
         '.cBBBBBBBBBBBc.',
         'gGLGGLGGLGGLGGg',
         '.TTgTTTgTTTgTT.',
         '.TTTTTTTTTTTTt.',
         '.cBBBBBBBBBBBc.',
         '..ccccccccccc..')
LUNCH_RED = rgb('#e64553')
LUNCH_COLORS = {'C': mix(PEACH, rgb('#c97b3f'), .35), 'c': mix(PEACH, rgb('#a65f2d'), .5),
                'B': mix(YELLOW, WHITE, .35), 'L': mix(GREEN, WHITE, .35), 'G': GREEN,
                'g': mix(GREEN, BASE, .25), 'T': LUNCH_RED, 't': mix(LUNCH_RED, BASE, .3)}


def lunch(c, bitten):
    """A sandwich on his right hand: two thick slices of bread, frilly lettuce, red tomato.
    Bitten: a round C-shaped bite gone from its right end through every layer, the bread
    on the bite's rim lighter (the cut face), crumbs falling."""
    x, y = LUNCH_XY
    stamp(c, LUNCH, x, y, LUNCH_COLORS)
    if bitten:
        bite = disc(x + 16.2, y + 4, 4.2)
        c.erase(bite)
        bread = {(x + i, y + j) for j, row in enumerate(LUNCH) for i, ch in enumerate(row) if ch == 'B'}
        c.fill(around(bite) & bread, mix(YELLOW, WHITE, .7))
        stamp(c, ('CC', 'cc'), x + 13, y + 9, LUNCH_COLORS)
        stamp(c, ('BB',), x + 11, y + 12, LUNCH_COLORS)
        stamp(c, ('C', 'c'), x + 14, y + 14, LUNCH_COLORS)


# --- term: a shell running in the background

TERM_LOOK = Pose(look=(2, -1))
TERM_BOX = (56, 2, 68, 16)        # the window: left, top, right, bottom


def term_window(c, step):
    """A tiny terminal window at his right: a light border, a title bar with three dots, a
    green prompt and a command, a line of output, then the cursor (step 1) or a second line of
    output, the cursor off (step 2)."""
    x0, y0, x1, y1 = TERM_BOX
    c.fill(rounded(x0, y0, x1, y1, (1,)), SUBTEXT)
    c.fill(rect(x0 + 1, y0 + 1, x1 - 1, y0 + 3), SURFACE2)
    c.fill(rect(x0 + 1, y0 + 4, x1 - 1, y1 - 1), BASE)
    for i, col in enumerate((RED, YELLOW, GREEN)):
        c.put(x0 + 2 + 2 * i, y0 + 2, col)
    stamp(c, ('#..', '.#.', '#..'), x0 + 2, y0 + 5, {'#': GREEN})
    c.fill(rect(x0 + 6, y0 + 6, x0 + 10, y0 + 6), SKY)
    c.fill(rect(x0 + 2, y0 + 9, x0 + 10, y0 + 9), SUBTEXT)
    if step == 1:
        c.fill(rect(x0 + 2, y0 + 11, x0 + 3, y0 + 12), TEXT)     # a dark row under it, clear of the border
    else:
        c.fill(rect(x0 + 2, y0 + 12, x0 + 7, y0 + 12), SUBTEXT)
# <<< skits time


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
    # >>> skits control: frames
    'tally0': lambda: solo(TALLY_0, lambda c: tally_paddle(c, TALLY_0)),
    'tally1': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '1')),
    'tally2': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '2')),
    'tally3': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '3')),
    'tally4': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '4')),
    'tally5': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '5')),
    'tally6': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '6')),
    'tally7': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '7')),
    'tally8': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '8')),
    'tally9': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '9')),
    'tallyMany': lambda: solo(TALLY_N, lambda c: tally_paddle(c, TALLY_N, '9+')),
    'radar1': lambda: solo(RADAR_WATCH, lambda c: radar(c, 0)),
    'radar2': lambda: solo(RADAR_WATCH, lambda c: radar(c, 1)),
    'radar3': lambda: solo(RADAR_WATCH, lambda c: radar(c, 2)),
    'radar4': lambda: solo(RADAR_CONTENT, lambda c: radar(c, 3)),
    'radio1': lambda: solo(RADIO_LISTEN, lambda c: radio_headset(c, RADIO_LISTEN, hear=True)),
    'radio2': lambda: solo(RADIO_TALK, lambda c: radio_headset(c, RADIO_TALK, RED, talk=True)),
    'radio3': lambda: solo(RADIO_COPY, lambda c: radio_headset(c, RADIO_COPY, GREEN, check=True)),
    # <<< skits control
    # >>> skits helpers: frames
    'report1': lambda: solo(LOOK_R, lambda c: report(c, LOOK_R, 1)),
    'report2': lambda: solo(REPORT_TAKE, lambda c: report(c, REPORT_TAKE, 2)),
    'report3': lambda: solo(REPORT_READ, lambda c: report(c, REPORT_READ, 3)),
    'report4': lambda: solo(REPORT_GLAD, lambda c: report(c, REPORT_GLAD, 4)),
    'launch1': lambda: solo(LOOK_R, lambda c: launch(c, 1)),
    'launch2': lambda: solo(LAUNCH_WOW, lambda c: launch(c, 2)),
    'launch3': lambda: solo(LAUNCH_BYE, lambda c: launch(c, 3)),
    'perch1': lambda: solo(PERCH_1, lambda c: perch(c, PERCH_1, 0)),
    'perch2': lambda: solo(PERCH_2, lambda c: perch(c, PERCH_2, 3)),
    'conduct1': lambda: solo(CONDUCT_1, lambda c: conduct(c, CONDUCT_1, 1)),
    'conduct2': lambda: solo(CONDUCT_2, lambda c: conduct(c, CONDUCT_2, 2)),
    'conduct3': lambda: solo(CONDUCT_3, lambda c: conduct(c, CONDUCT_3, 3)),
    # <<< skits helpers
    # >>> skits gags: frames
    'juggle1': lambda: solo(JUGGLE_1, lambda c: (juggle_tongue(c, JUGGLE_1), juggle_balls(c, 0))),
    'juggle2': lambda: solo(JUGGLE_2, lambda c: (juggle_tongue(c, JUGGLE_2), juggle_balls(c, 1))),
    'juggle3': lambda: solo(JUGGLE_3, lambda c: (juggle_tongue(c, JUGGLE_3), juggle_balls(c, 2))),
    'gum1': lambda: solo(GUM_1, lambda c: gum_bubble(c, GUM_1, 2.6)),
    'gum2': lambda: solo(GUM_2, lambda c: gum_bubble(c, GUM_2, 7.5)),
    'gum3': lambda: solo(GUM_3, lambda c: gum_pop(c, GUM_3)),
    'popcorn1': lambda: solo(POPCORN_1, lambda c: (popcorn_bucket(c, POPCORN_1), popcorn_dropped(c), popcorn_kernel(c, POPCORN_1))),
    'popcorn2': lambda: solo(POPCORN_2, lambda c: (popcorn_bucket(c, POPCORN_2), popcorn_dropped(c))),
    'plane1': lambda: solo(PLANE_1, lambda c: plane_held(c, PLANE_1)),
    'plane2': lambda: solo(PLANE_2, lambda c: (plane_paper(c, 69, 0, -32), plane_speed(c, ((46, 5, 49, 3), (49, 7, 52, 5))))),
    'plane3': lambda: solo(PLANE_3, lambda c: sparkle(c, 66, 2, YELLOW)),
    'plane4': lambda: solo(PLANE_4, lambda c: (plane_paper(c, 11, 10, 0), plane_speed(c, ((0, 4, 3, 4), (0, 17, 3, 17))), plane_alarm(c, 58, 0))),
    'plane5': lambda: solo(PLANE_5, lambda c: plane_bonk(c, PLANE_5)),
    'zen1': lambda: solo(ZEN_1, lambda c: zen_twinkle(c, 7, 5)),
    'zen2': lambda: solo(ZEN_2, lambda c: zen_twinkle(c, 62, 4)),
    # <<< skits gags
    # >>> skits time: frames
    'plant1': lambda: solo(GARDEN_LOOK, lambda c: garden_plant(c, 1)),
    'plant2': lambda: solo(GARDEN_LOOK, lambda c: garden_plant(c, 2)),
    'plant3': lambda: solo(GARDEN_LOOK, lambda c: garden_plant(c, 3)),
    'plant4': lambda: solo(GARDEN_PROUD, lambda c: (garden_plant(c, 4), garden_sparkles(c))),
    'water1': lambda: solo(GARDEN_WATER, lambda c: garden_water(c, 1)),
    'water2': lambda: solo(GARDEN_WATER, lambda c: garden_water(c, 2)),
    'water3': lambda: solo(GARDEN_WATER, lambda c: garden_water(c, 3)),
    'water4': lambda: solo(GARDEN_WATER, lambda c: garden_water(c, 4)),
    'lantern1': lambda: solo(LANTERN_1, lambda c: lantern(c, True)),
    'lantern2': lambda: solo(LANTERN_2, lambda c: lantern(c, False)),
    'lunch1': lambda: solo(LUNCH_1, lambda c: lunch(c, False)),
    'lunch2': lambda: solo(LUNCH_2, lambda c: lunch(c, True)),
    'term1': lambda: solo(TERM_LOOK, lambda c: term_window(c, 1)),
    'term2': lambda: solo(TERM_LOOK, lambda c: term_window(c, 2)),
    # <<< skits time
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
    # >>> skits control: loops
    ('tally', ('tally0', 'tally3', 'tallyMany', 'tally0')),
    ('radar', ('radar1', 'radar2', 'radar3', 'radar4')),
    ('radio', ('radio1', 'radio2', 'radio1', 'radio2', 'radio3')),
    # <<< skits control
    # >>> skits helpers: loops
    ('report', ('report1', 'report2', 'report3', 'report4')),
    ('launch', ('launch1', 'launch2', 'launch3')),
    ('perch', ('perch1', 'perch2', 'perch1', 'perch2', 'perch1')),
    ('conduct', ('conduct1', 'conduct2', 'conduct3', 'conduct2')),
    # <<< skits helpers
    # >>> skits gags: loops
    ('juggle', ('juggle1', 'juggle2', 'juggle3')), ('gum', ('gum1', 'gum2', 'gum3')),
    ('popcorn', ('popcorn1', 'popcorn2')), ('plane', ('plane1', 'plane2', 'plane3', 'plane4', 'plane5')),
    ('zen', ('zen1', 'zen2')),
    # <<< skits gags
    # >>> skits time: loops
    ('garden', ('water1', 'plant1', 'water2', 'plant2', 'water3', 'plant3', 'water4', 'plant4')),
    ('lantern', ('lantern1', 'lantern2')), ('lunch', ('lunch1', 'lunch2')), ('term', ('term1', 'term2')),
    # <<< skits time
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
