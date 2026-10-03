#!/usr/bin/env python3
"""Drive a real interactive Claude Code session in a pseudo-terminal and capture its screen.

`claude -p` draws nothing, so a mod's drawing (a band, a pane, the SessionMode and Spinner
sites) and the status line can only be checked in an interactive session. This runs one in a
pty, feeds its output to a terminal emulator (pyte) and saves the screen as text and as a PNG
at the moments you name. It found two bugs in mize-coworker that every `claude plugin test`
passed over (docs/coworker.md).

Setup, once, anywhere outside the repo:
    python3 -m venv /tmp/tui-venv && /tmp/tui-venv/bin/pip install pyte pillow

usage:
    /tmp/tui-venv/bin/python scripts/tui-capture.py --cols 150 --rows 34 --out /tmp/shot --cwd ~/Dev \
      --step "10:@snap:idle" --step "0.3:Read README.md then reply with one word." --step "0.8:\r" \
      --step "3:@snap:busy" --step "12:@snap:after" --step "0.3:/exit" --step "0.5:\r" \
      -- ~/.local/bin/claude --model sonnet --plugin-dir plugins/<name> --debug-file /tmp/shot.log

Each --step is "SECONDS:KEYS": wait SECONDS (reading output), then type KEYS (\r is Enter,
\x03 ctrl-c). Send Enter as its own step: text and Enter in one burst are taken as a paste.
"@snap:NAME" saves <out>-NAME.txt and <out>-NAME.png instead of typing. Use a cwd whose
workspace trust is already accepted (a new folder stops at the trust dialog). The session is a
real one on this machine and is killed by PID at the end (it is this script's own child).
Braille cells are drawn as dots, the way Ghostty draws them; glyphs missing from the font
(JetBrainsMono Nerd Font Mono here) show as boxes in the PNG only."""
import os, pty, sys, time, select, fcntl, termios, struct, signal, json
import pyte
from PIL import Image, ImageDraw, ImageFont

def main():
    a = sys.argv[1:]
    cut = a.index('--'); opts, cmd = a[:cut], a[cut + 1:]
    def opt(name, default=None):
        return opts[opts.index(name) + 1] if name in opts else default
    cols, rows = int(opt('--cols', '170')), int(opt('--rows', '45'))
    out, cwd = opt('--out', 'shot'), opt('--cwd', os.getcwd())
    steps = [opts[i + 1] for i, v in enumerate(opts) if v == '--step']
    screen = pyte.Screen(cols, rows); stream = pyte.ByteStream(screen)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor', COLUMNS=str(cols), LINES=str(rows),
                   TERM_PROGRAM='ghostty', FORCE_HYPERLINK='1')
        os.execvpe(cmd[0], cmd, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    raw = open(out + '.raw', 'wb')
    def pump(seconds):
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.1)
            if fd in r:
                try: data = os.read(fd, 65536)
                except OSError: return False
                if not data: return False
                raw.write(data); stream.feed(data)
        return True
    try:
        for step in steps:
            secs, keys = step.split(':', 1)
            if not pump(float(secs)): break
            if keys.startswith('@snap:'):
                snap(screen, cols, rows, f'{out}-{keys[6:]}')
            else:
                os.write(fd, keys.encode().decode('unicode_escape').encode('latin-1'))
        pump(1.0)
    finally:
        try: os.kill(pid, signal.SIGTERM)
        except ProcessLookupError: pass
        time.sleep(0.5)
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
        for _ in range(30):   # reap without blocking forever
            try:
                done, _ = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError: break
            if done: break
            time.sleep(0.1)
        raw.close()

NAMED = {'black': (69, 71, 90), 'red': (243, 139, 168), 'green': (166, 227, 161), 'brown': (249, 226, 175), 'blue': (137, 180, 250),
         'magenta': (245, 194, 231), 'cyan': (148, 226, 213), 'white': (186, 194, 222), 'default': None,
         'brightblack': (88, 91, 112), 'brightred': (243, 139, 168), 'brightgreen': (166, 227, 161), 'brightbrown': (249, 226, 175),
         'brightblue': (137, 180, 250), 'brightmagenta': (245, 194, 231), 'brightcyan': (148, 226, 213), 'brightwhite': (205, 214, 244)}
def rgb(c, default):
    if c in NAMED: return NAMED[c] or default
    if len(c) == 6:
        try: return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError: pass
    return default

def snap(screen, cols, rows, base):
    lines = []
    for y in range(rows):
        row = screen.buffer[y]
        lines.append(''.join(row[x].data or ' ' for x in range(cols)).rstrip())
    open(base + '.txt', 'w').write('\n'.join(lines) + '\n')
    SIZE = 20
    font = ImageFont.truetype(os.path.expanduser('~/Library/Fonts/JetBrainsMonoNerdFontMono-Regular.ttf'), SIZE)
    cw = font.getlength('M'); ch = int(SIZE * 1.5)
    BG = (0x11, 0x11, 0x1b); FG = (0xcd, 0xd6, 0xf4)
    img = Image.new('RGB', (int(cols * cw) + 20, rows * ch + 20), BG); d = ImageDraw.Draw(img)
    for y in range(rows):
        row = screen.buffer[y]
        for x in range(cols):
            c = row[x]
            bg = rgb(c.bg, BG); fg = rgb(c.fg, FG)
            if c.reverse: fg, bg = bg, fg
            if bg != BG: d.rectangle([10 + x * cw, 10 + y * ch, 10 + (x + 1) * cw, 10 + (y + 1) * ch], fill=bg)
            if c.data and c.data != ' ':
                o = ord(c.data[0])
                if 0x2800 <= o <= 0x28ff:   # braille: draw the dots the way Ghostty does
                    bits = o - 0x2800
                    for (bit, dx, dy) in ((1, 0, 0), (2, 0, 1), (4, 0, 2), (0x40, 0, 3), (8, 1, 0), (0x10, 1, 1), (0x20, 1, 2), (0x80, 1, 3)):
                        if bits & bit:
                            px = 10 + x * cw + cw * (0.25 + 0.5 * dx); py = 10 + y * ch + ch * (0.2 + 0.2 * dy)
                            d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=fg)
                else:
                    d.text((10 + x * cw, 10 + y * ch + 2), c.data, font=font, fill=fg)
    img.save(base + '.png')
    print('snap', base, flush=True)

if __name__ == '__main__':
    main()
