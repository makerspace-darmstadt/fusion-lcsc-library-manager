# AGENTS.md — conventions, decisions, status

Working notes for anyone (human or agent) continuing this project. Keep it current.

## Conventions

- **Pure core.** Everything under `src/core/` is plain TypeScript with no Tauri, DOM or Node-only imports
  (except `node:` modules in `cli/` and `tests/`). It must run under Vitest in Node and inside the Tauri webview.
- **Imports use explicit `.ts` extensions** (`import x from './y.ts'`) so the CLI runs directly under Node's type
  stripping (`node --experimental-strip-types`, default-on in Node ≥ 22.18 / 24). Consequences: no `enum`,
  no `namespace`, no constructor parameter properties, `import type` for types (`verbatimModuleSyntax`).
- **Warnings are data.** Conversion problems are collected as `{ code, message, severity, raw? }` via
  `WarningCollector`, never logged. Primitives that cannot be mapped produce a warning carrying the raw string.
- **Coordinates in the model are already Eagle-ready**: mm, Y up, origin subtracted, arc curves in Eagle
  convention (degrees, CCW positive). The parser owns the coordinate conversion; the emitter only maps
  shapes and layers.
- Numbers are rounded to 4 decimals (`round()` in `src/core/units.ts`); `-0` is normalised to `0`.
- Tests: Vitest, `tests/**/*.test.ts`. Every non-obvious geometry rule has a hand-checked expected value.
- Commit at the end of each milestone. Commit signing is disabled for this repo (`git config commit.gpgsign
  false`) because the 1Password signer is not available in non-interactive shells.

## Decisions (with reasons)

| # | Decision | Reason |
|---|----------|--------|
| 1 | XML library: `@xmldom/xmldom` (DOM) | Preserves element order, unknown elements, DOCTYPE and whitespace text nodes; passes the round-trip test (M3). |
| 2 | Node 24 in use (brief says Node 22 LTS) | Machine has Node 24; scripts only need ≥ 22.18 for type stripping. `engines` set accordingly. |
| 3 | Fixture parts differ from the brief's list | The brief's part numbers do not match their descriptions on LCSC (C3131 is a fuse holder, C8734 an LQFP-48 STM32, C2040 the RP2040, C2913204 an ESP32-S3 module). See "Fixtures" below for the substitutions. |
| 4 | Pin body direction = path endpoint farthest from the connection point | The pin path starts at *either* end in real data (`M cx cy h 20` in TL072, `M -10 0 h -10` in C0603). The EasyEDA `rotation` field is only a fallback when the path is missing. |
| 5 | Units are shifted onto the 2.54 mm grid when all pins share one offset | EasyEDA often puts the symbol origin on a half-grid point (5 px), so every pin is 1.27 mm off. Shifting the whole unit keeps the geometry and makes the grid assertion meaningful. Pins that remain off-grid (source symbol on a 50 mil grid, e.g. RP2040) get `PIN_OFF_GRID`. |
| 6 | EasyEDA multi-layer pad layer is **11** (not 13 as in the brief) | Verified in the fixtures' `layers` table: 11 = Multi-Layer, 13 = TopAssembly. |
| 7 | Footprint `RECT` field order is `x~y~width~height~layer~id~locked~strokeWidth~fill` | Observed in C124375 (`RECT~3986.5~2998.5~20~10~3~gge16~0~1~none`); the brief's order would give layer 0. |
| 8 | White-filled symbol shapes (`#FFFFFF`/`#FEFEFE`) are drawn as outlines, dark fills as filled polygons; filled circles get `width="0"` | Eagle has no white fill; a width-0 circle is Eagle's filled circle. |
| 9 | Symbol text size = EasyEDA pt × 0.254 | 7 pt (EasyEDA default) maps exactly to Eagle's default 1.778 mm. |
| 10 | EasyEDA rotation angles are mirrored: Eagle rot = (360 − θ) mod 360 | EasyEDA uses SVG `rotate()` in a Y-down frame (clockwise on screen); Eagle rotates counter-clockwise. Irrelevant for 180°-symmetric pads, relevant for texts (no fixture contains footprint TEXT — verify in Fusion). |
| 11 | Arc angles within 0.02° of a whole degree are snapped | Arc endpoints are stored with 4 decimals, producing 90.005° corners. |
| 12 | Manufacturer names lose a trailing CJK parenthetical (`YAGEO(国巨)` → `YAGEO`) | Keeps attributes ASCII-clean; the English name is always present. |
| 13 | `SVGNODE` (3D model) primitives are ignored silently | Out of scope per brief §4.1; not a lossy conversion of geometry. |
| 14 | The `/svgs` endpoint needs a full browser User-Agent | A bare `Mozilla/5.0` is answered with HTTP 403 by the CDN. Same headers are used for both endpoints. |
| 15 | No datasheet URL: the API does not return one | The part card links to the LCSC product page (`lcsc.url`) instead. |
| 16 | fs capability scope is `**` | The library file lives wherever the user keeps it, and the last-opened path is re-read at startup without a dialog. |
| 17 | Eagle `long` THT pads use `diameter = min(width, height)` (brief said max) | Eagle's long pad is 2:1 with `diameter` as the short axis; using max would double the pad. Non-2:1 ovals get `PAD_ASPECT`. |
| 18 | Slots: `long` pad + Milling (46) wire of drill width along the slot centre line | Eagle has no slotted pads; the wire documents the slot for fabrication (`SLOT_PAD` warning). |
| 19 | Symbol name = deviceset name (`CAT_TITLE`), multi-unit `CAT_TITLE_A`, `_B`; package name = sanitised EasyEDA package title | Symbols are part-specific, packages are shared (every 0603 uses `C0603`), so collisions only occur where reuse is intended. |
| 20 | One pin may connect to several pads (`pad="57 58"`) when pad numbers repeat; repeated pad numbers are renamed `N_2` | Eagle requires unique pad names but allows multi-pad connects. |
| 21 | Second pin with an already-used pin number is left unconnected (`DUPLICATE_PIN_NUMBER`), a pin without pad is an error (`PIN_WITHOUT_PAD`) | Brief §5.3; C138392 is the fixture for this. |
| 22 | Solid regions become polygons with width 0.0254 mm (1 mil) | Eagle grows polygons by half the width; 1 mil keeps the outline exact. |
| 23 | `>NAME`/`>VALUE` are placed by the emitter (package: centred above/below the bbox, size 1.27; symbol: top-left / bottom-left of the body, size 1.778) | EasyEDA data carries no name/value texts. |
| 24 | Region-type warnings only on copper layers | On tDocu a "cutout" region is just a drawing. |
| 25 | Gate positions in the deviceset: gate *i* at x = i × 25.4 | Purely cosmetic in Fusion's device editor. |
| 26 | "Identical after normalisation" = same canonical string: sorted attributes, numbers normalised (`0.70` = `0.7`), whitespace-collapsed text, children in order | Insensitive to formatting, sensitive to any geometry/attribute change. |
| 27 | Deviceset name taken by a *different* part (no matching LCSC) → imported as `NAME_2` automatically | The brief only covers the LCSC-match case; renaming never loses data and is reported in the merge result. |
| 28 | Safe save removes the original after copying it to `.bak`, then renames `.tmp` into place | Windows cannot rename over an existing file; the `.bak` copy is the safety net, and the temp file is read back and verified before the original is touched. |
| 29 | `<packages3d>` and any other unknown library child are preserved in place; new containers are inserted in canonical order before them | Brief §5. |

## Fixtures (`fixtures/easyeda/`)

All fetched on 2026-09-14 from `https://easyeda.com/api/products/<id>/components?version=6.4.19.5`.

| File | Part | Why it is here |
|------|------|----------------|
| C14663 | CC0603KRX7R9BB104, C0603 | 0603 capacitor, 2 SMD pads, silkscreen ARCs (the brief's "C3131") |
| C25804 | 0603WAF1002T5E, R0603 | 0603 resistor |
| C20526 | MMBT3904, SOT-23-3 | SOT-23 transistor (the brief's "C8734") |
| C8545 | 2N7002, SOT-23-3 | white-filled symbol polygons, vertical pins |
| C6961 | TL072CDT, SOIC-8 | SOIC-8 **and** multi-unit (`subparts`, 2 gates, shared power pins); the brief's "C14663" |
| C8734 | STM32F103C8T6, LQFP-48 | many OVAL SMD pads, half-grid symbol origin |
| C2040 | RP2040, LQFN-56-EP | QFN with exposed pad 57, duplicate pin names (IOVDD ×6), 50 mil symbol grid (the brief's "C2913204") |
| C2913204 | ESP32-S3-WROOM-1, module | many pads (the brief's "C2040") |
| C124375 | 2-pin 2.54 mm header | THT ELLIPSE + RECT pads, footprint `RECT` primitive (the brief's "C165948") |
| C165948 | TYPE-C-31-M-12 USB-C | OVAL THT **slot** pads, POLYGON pads with combined numbers (`A1B12`), HOLEs |
| C3131 | 5x20 fuse holder | THT OVAL slot pads; also the part in `fixtures/lbr/reference.lbr` |
| C138392 | RJ45 jack | data-quality case: duplicate pin number, unnumbered (`0`) pads → not importable |
| C14663.svgs | `/svgs` response | docType 2 = symbol SVG, 4 = footprint SVG |
| notfound | `success:false` | API error path |
| nodatastr | synthetic | C14663 with `dataStr` removed → NOT_IMPORTABLE path |

## EasyEDA format notes (verified against fixtures)

- `PAD~shape~x~y~width~height~layer~net~number~holeRadius~points~rotation~id~holeLength~holePoints~plated~locked~…`.
  `holeLength` is the **total** slot length; `holePoints` is the slot centre line.
- Pin string sections split on `^^`: head `P~display~electric~number~x~y~rotation~id~locked`, dot, `path~color`,
  name `visible~x~y~rot~text~anchor~font~size`, number (same), dot `visible~x~y`, clock `visible~path`.
  Path forms seen: `M 60 130 h 20`, `M390,310h10`, `M 400 300 h-20`.
- Multi-unit parts: top-level `dataStr.shape` is empty and `result.subparts` is an object keyed `"0"`, `"1"`, …
  each with its own `dataStr` (and `c_para.subpart_no`).
- Symbol `T` texts observed only with mark `L` (labels); `>NAME`/`>VALUE` are not present in the data and are
  placed by the emitter.

## Milestone status

- [x] **M1** scaffold + fetch + parse + CLI + fixtures + parser tests.
- [x] **M2** Eagle emitter (`src/core/eagle`), golden tests (`tests/golden/*.xml`, regenerate with
      `UPDATE_GOLDEN=1 npm test`), standalone `.lbr` via `--lbr`, `VALIDATION.md`. 81 tests.
- [x] **M3** merge (`src/core/lbr/merge.ts`), round-trip test, collision handling (identical → reuse,
      differing → caller resolves reuse/rename), `.tmp` + `.bak` safe save with injectable fs
      (`src/core/lbr/save.ts`), CLI `--into existing.lbr [--on-conflict rename|reuse]`. 97 tests.
- [ ] **M4** UI.
- [ ] **M5** packaging + CI.

## Known limitations

- Symbols whose pins are on a 50 mil grid in EasyEDA (e.g. RP2040) stay off-grid; they work but Fusion's
  default 0.1 in grid will not hit them.
- Elliptical (non-circular) arcs and Bézier curves are flattened to line segments.
- Footprint `TEXT` handling is implemented from the brief's field order only; no fixture contains one.
