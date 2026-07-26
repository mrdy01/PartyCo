# Font assets

These files are **not committed** — they are third-party binaries fetched once at setup.
`packages/tokens/src/fonts.css` expects exactly these filenames in this directory:

```
IBMPlexSans-Regular.woff2
IBMPlexSans-Medium.woff2
IBMPlexSans-SemiBold.woff2
JetBrainsMono-Regular.woff2
JetBrainsMono-Medium.woff2
JetBrainsMono-SemiBold.woff2
```

## Where to get them

Both families are **SIL Open Font License 1.1**, which permits bundling them inside the
application. Keep a copy of each licence next to the fonts (`OFL-IBMPlexSans.txt`,
`OFL-JetBrainsMono.txt`) — the OFL requires the licence to travel with the font.

- IBM Plex Sans — <https://github.com/IBM/plex> (`packages/plex-sans/fonts/complete/woff2/`)
- JetBrains Mono — <https://github.com/JetBrains/JetBrainsMono/releases>

Subsetting to Latin + Cyrillic is worth doing: the UI is RU/EN and the full character sets are
several times larger than needed. `glyphhanger` or `fonttools pyftsubset` both work.

## Until they are here

The app still runs. `FONT_STACKS` in `packages/tokens/src/palette.ts` falls back to
Segoe UI Variable Text / Cascadia Mono on Windows and system fonts on macOS. Metrics differ
slightly, so do not sign off pixel parity against the design source without the real fonts in
place.
