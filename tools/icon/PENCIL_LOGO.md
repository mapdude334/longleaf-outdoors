# Longleaf pencil logo

Generated with the built-in image generation tool on October 26, 2026. The user requested a realistic longleaf pine resembling a detailed pencil drawing, replacing the previous illustrated app mark.

Master artwork: `public/icons/longleaf-pencil-master.png`.

The fishing variation is `public/icons/longleaf-fishing-master.png`, edited with the built-in image generation tool from the original tree. It adds a leaning fishing rod with a spinning reel and a tackle box at the roots while retaining the pencil style. The app uses the `pine-fishing-*` derivatives. Regenerate these with `python tools/icon/prepare_pencil_icons.py longleaf-fishing-master.png pine-fishing`.

## Fishing variation edit prompt

Edit this existing detailed graphite pencil drawing. Preserve the entire longleaf pine tree, all its branches and needles, trunk, composition, warm ivory background and exact detailed pencil/charcoal botanical drawing style. Add only two objects near its base: a realistic fishing rod with a clearly recognizable spinning reel attached, leaning diagonally against the lower trunk on the viewer's right, butt resting on the ground next to the roots and tip rising to about the lowest branches; and a compact classic rectangular tackle box resting beside the roots at the foot of the tree, with a lid, latch and carrying handle. Place these in the lower right quadrant, naturally grounded, correctly proportioned to the tree, clearly legible as fishing gear, with fine pencil crosshatching and realistic highlights and shadows matching the tree. Keep them subordinate to the tree and contained inside the square canvas. No text, no logo, no new landscape, no color. Preserve the original tree drawing rather than redesigning it.

To regenerate the resized icons from the saved master, run `python tools/icon/prepare_pencil_icons.py`. This only resizes the generated artwork and adds safe padding for the maskable icon. Original icons remain available under their earlier filenames. The new filenames prevent browsers from reusing old cached icons.

## Generation prompt

Create a finished botanical logo illustration for Longleaf Outdoors. A single botanically realistic mature longleaf pine tree, Pinus palustris, full tree from base of trunk to crown, centered with a broad irregular airy crown occupying the upper half, tall straight slightly weathered trunk with deeply fissured scaly bark, widely spaced angular branching, distinctive very long fine needles in dense tufted fountainlike clusters at branch tips. It must unmistakably look like a real Southeastern longleaf pine, not a triangular Christmas tree, spruce, generic conifer, or palm. Style: exceptionally detailed hand drawn graphite pencil and fine charcoal botanical field-guide plate, confident dark pencil outlines, intricate individual needle strokes, delicate crosshatching and stippled bark, subtle graphite shading, monochrome warm black. Square canvas, tree fills about 90 percent height and 75 percent width with clear strong silhouette that reads as a small app mark. Plain warm ivory paper background, clean with no landscape, no border, no badge, no typography, no words or watermark. Museum-quality natural history pencil drawing, restrained and realistic rather than cartoon or vector.
