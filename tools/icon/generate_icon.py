# Generates the Longleaf Atlas app icon (procedural longleaf pine in a wiregrass savanna).
# Usage: pip install cairosvg && python3 tools/icon/generate_icon.py  (writes icon4*.png / icon4.svg; copy into public/icons/)
import math, random
import cairosvg
W = 512
out = []; A = out.append

def tuft(cx, cy, r, n, cols, sw=(1.3, 2.1), op=(0.8, 1.0)):
    """Fountain-shaped longleaf needle cluster: needles spring up/out from the twig tip and droop."""
    s = []
    for _ in range(n):
        ang = random.uniform(-math.pi, math.pi)
        if random.random() < 0.35: ang = random.gauss(-math.pi / 2, 0.7)   # extra upward burst
        L = r * random.uniform(0.55, 1.0)
        dx, dy = math.cos(ang), math.sin(ang)
        droop = L * (0.18 + 0.22 * max(0, dy + 0.3)) * random.uniform(0.6, 1.2)
        mx, my = cx + dx * L * 0.5, cy + dy * L * 0.5
        ex = cx + dx * L
        ey = cy + dy * L + droop
        s.append(f'<path d="M{cx:.1f} {cy:.1f} Q{mx:.1f} {my:.1f} {ex:.1f} {ey:.1f}" stroke="{random.choice(cols)}" '
                 f'stroke-width="{random.uniform(*sw):.2f}" fill="none" stroke-linecap="round" opacity="{random.uniform(*op):.2f}"/>')
    return "\n".join(s)

def limb(pts, w, col):
    d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
    return f'<path d="{d}" stroke="{col}" stroke-width="{w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'

def pine(x, base, top, trunk_w, crown_w, seed, bark, needles_back, needles_front, scale=1.0, detail=True):
    random.seed(seed)
    g = []
    # tapered, very slightly sinuous trunk
    tw0, tw1 = trunk_w, trunk_w * 0.35
    lean = random.uniform(-4, 4) * scale
    g.append(f'<path d="M{x-tw0/2:.1f} {base} C{x-tw0/2+lean*0.3:.1f} {base-(base-top)*0.4:.1f} {x-tw1/2+lean:.1f} {top+(base-top)*0.25:.1f} {x-tw1/2+lean:.1f} {top:.1f} '
             f'L{x+tw1/2+lean:.1f} {top:.1f} C{x+tw1/2+lean:.1f} {top+(base-top)*0.25:.1f} {x+tw0/2+lean*0.3:.1f} {base-(base-top)*0.4:.1f} {x+tw0/2:.1f} {base} Z" fill="{bark}"/>')
    tx = x + lean
    crown_h = (base - top) * 0.32
    limbs = []
    nl = 7 if detail else 5
    for i in range(nl):
        y0 = top + crown_h * (i / nl) * 0.95 + random.uniform(0, 6) * scale
        side = -1 if i % 2 == 0 else 1
        reach = crown_w / 2 * random.uniform(0.45, 1.0) * (0.75 + 0.35 * (i / nl))
        pts = [(tx, y0)]
        n = 3
        for k in range(1, n + 1):
            f = k / n
            px = tx + side * reach * f + random.uniform(-6, 6) * scale
            py = y0 - reach * 0.55 * f ** 1.4 + random.uniform(-5, 5) * scale   # upswept, crooked
            pts.append((px, py))
        limbs.append(pts)
    tips = []
    for L in limbs:
        g.append(limb(L, max(1.2, 4.6 * scale), bark if not detail else "#5a3826"))
        # short side twigs ending in tufts
        for (px, py) in L[1:]:
            tips.append((px, py))
            if detail and random.random() < 0.6:
                qx = px + random.uniform(-16, 16) * scale; qy = py - random.uniform(6, 16) * scale
                g.append(limb([(px, py), (qx, qy)], 2.2 * scale, "#4b2f1e"))
                tips.append((qx, qy))
    tips.append((tx, top - 2 * scale))
    clumped = []
    for (px, py) in tips:
        clumped.append((px, py))
        if detail:
            for _ in range(1):
                clumped.append((px + random.uniform(-9, 9) * scale, py + random.uniform(-5, 7) * scale))
    tips = clumped
    r = 16 * scale
    for (px, py) in tips:
        g.append(tuft(px, py + 3 * scale, r * 0.95, int(30 * (1 if detail else .9)), needles_back, sw=(0.9*scale+.3, 1.5*scale+.3)))
    for (px, py) in tips:
        g.append(tuft(px, py, r, int(48 * (1 if detail else .7)), needles_front, sw=(0.8*scale+.25, 1.3*scale+.3)))
    return "\n".join(g), tx, top

A(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {W}">')
A('''<defs>
 <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#22414a"/><stop offset=".5" stop-color="#557a74"/>
  <stop offset=".74" stop-color="#d7a05c"/><stop offset=".8" stop-color="#eebc72"/>
 </linearGradient>
 <linearGradient id="bark" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#3e2618"/><stop offset=".4" stop-color="#7d4f31"/><stop offset=".65" stop-color="#9c6640"/><stop offset="1" stop-color="#4a2c1b"/>
 </linearGradient>
 <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#d9ab66"/><stop offset=".3" stop-color="#55807f"/><stop offset="1" stop-color="#1d3f47"/>
 </linearGradient>
 <clipPath id="rr"><rect width="512" height="512" rx="108"/></clipPath>
</defs><g clip-path="url(#rr)">
<rect width="512" height="512" fill="url(#sky)"/>
<circle cx="372" cy="384" r="40" fill="#f6d48e" opacity=".9"/>''')

sil = "#25392d"
for (x, h, w, sd, sc) in [(54, 150, 6, 11, 0.42), (118, 118, 5, 22, 0.34), (178, 96, 4, 33, 0.28), (404, 170, 6, 44, 0.46), (462, 128, 5, 55, 0.36), (340, 88, 4, 66, 0.26)]:
    s, _, _ = pine(x, 400, 400 - h, w, 90 * sc / 0.42, sd, sil, (sil,), (sil, "#2c4434"), scale=sc, detail=False)
    A(f'<g opacity=".9">{s}</g>')

# wiregrass
A('<path d="M0 392 Q140 382 256 390 T512 388 V424 H0 Z" fill="#2f4a2f"/>')
random.seed(3)
for _ in range(320):
    x = random.uniform(-4, 516); y = random.uniform(388, 424); h = random.uniform(7, 19); lean = random.uniform(-8, 8)
    c = random.choice(["#4d6e3b", "#62804a", "#3a5932", "#9a9a58", "#7b8a4c"])
    A(f'<path d="M{x:.1f} {y:.1f} q{lean*0.3:.1f} {-h*0.6:.1f} {lean:.1f} {-h:.1f}" stroke="{c}" stroke-width="1.2" fill="none" stroke-linecap="round"/>')

A('<rect x="0" y="420" width="512" height="92" fill="url(#water)"/>')
A('<path d="M70 444 H210 M290 450 H440 M130 468 H340 M40 486 H180 M310 492 H470" stroke="#f3d39a" stroke-width="2.5" stroke-linecap="round" opacity=".4"/>')
A('<path d="M248 422 L245 505 L255 505 L266 422 Z" fill="#2e2118" opacity=".35"/>')

# main tree
s, tx, top = pine(256, 424, 96, 24, 300, 101, "url(#bark)",
                  ("#24402a", "#2d4b2e", "#31502f"),
                  ("#4f7a3c", "#5e8945", "#456f36", "#7a9f5a", "#9cb874"), scale=1.0)
A(s)
# plated bark texture on main trunk
random.seed(5)
for y in range(200, 420, 8):
    t = (y - 92) / 332
    half = 5 + 10 * t
    x0 = 256 - half + random.uniform(1, 4); x1 = 256 + half - random.uniform(1, 4)
    xm = (x0 + x1) / 2 + random.uniform(-4, 4)
    A(f'<path d="M{x0:.1f} {y:.1f} L{xm:.1f} {y+random.uniform(-1.5,1.5):.1f}" stroke="#2c180e" stroke-width="1.3" opacity=".6"/>')
    A(f'<path d="M{xm+2:.1f} {y+3.5:.1f} L{x1:.1f} {y+3.5+random.uniform(-1.5,1.5):.1f}" stroke="#2c180e" stroke-width="1.1" opacity=".5"/>')
    A(f'<path d="M{x0+2:.1f} {y+2:.1f} L{xm-2:.1f} {y+2:.1f}" stroke="#c08455" stroke-width=".9" opacity=".4"/>')
A('</g></svg>')
open('icon4.svg', 'w').write("\n".join(out))
for sz in (512, 192, 64):
    cairosvg.svg2png(url='icon4.svg', write_to=f'icon4-{sz}.png', output_width=sz, output_height=sz)
print('ok')
