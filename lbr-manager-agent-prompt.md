# Implementation brief: LCSC → Autodesk Fusion `.lbr` library manager

You are implementing a small cross-platform desktop app (macOS + Windows). Work milestone by milestone, commit at the end of each, and keep every milestone independently runnable and tested. Do not skip ahead. Ask only when something below is contradictory; otherwise decide and note the decision in `AGENTS.md`.

## 1. Goal

A desktop app that manages **one** Autodesk Fusion Electronics library file (`.lbr`, Eagle 9.x XML format). The user enters an LCSC/JLCPCB part number (e.g. `C3131`), sees the part (title, package, datasheet link, symbol + footprint preview), assigns a category, and clicks **Add to library**. The app fetches the part's schematic symbol and PCB footprint from EasyEDA, converts both to Eagle/Fusion format, creates a deviceset with a device whose `LCSC` attribute equals the part number, and merges everything into the existing `.lbr` without disturbing what is already in it.

Out of scope for v1: 3D models (Fusion links these via cloud URNs, not via the file), managed/cloud libraries, keyword search (part numbers only), editing existing parts.

## 2. Stack (fixed)

- **Tauri 2** shell, **TypeScript** everywhere, **Vite + React** frontend. No Rust beyond what `create-tauri-app` generates plus plugin registration.
- Tauri plugins: `@tauri-apps/plugin-http` (fetch without CORS; allowlist `https://easyeda.com/*`, `https://modules.easyeda.com/*` in capabilities), `@tauri-apps/plugin-dialog` (open/save file), `@tauri-apps/plugin-fs` (read/write the lbr), `@tauri-apps/plugin-store` (settings: lbr path, categories).
- XML: use a library that preserves element order and unknown content on round-trip (`@xmldom/xmldom` DOM, or `fast-xml-parser` in `preserveOrder` mode). The choice must pass the round-trip test in §7.
- Tests: **Vitest**. The converter must be pure TypeScript with zero Tauri imports so it runs under Node.
- Package manager: npm. Node 22 LTS.

## 3. Repository layout

```
src/                     React UI (thin; no conversion logic here)
src/core/easyeda/        fetch + parse EasyEDA JSON into a typed intermediate model
src/core/eagle/          emit Eagle XML (package, symbol, deviceset) from the model
src/core/lbr/            load / merge / save an .lbr document
src/core/units.ts        unit + layer mapping constants
cli/convert.ts           dev CLI: `npm run convert -- C3131 [--out part.xml]`
fixtures/easyeda/*.json  committed API responses for test parts
fixtures/lbr/            reference .lbr files exported from Fusion (provided by the user)
tests/                   Vitest unit + golden tests
AGENTS.md                conventions, decisions, milestone status
README.md                setup, build, usage
```

## 4. Data source (EasyEDA, unofficial API)

```
GET https://easyeda.com/api/products/{LCSC}/components?version=6.4.19.5
GET https://easyeda.com/api/products/{LCSC}/svgs
```

Send headers `User-Agent: Mozilla/5.0 ...`, `Accept: application/json`, `Referer: https://easyeda.com/`. The first call returns `{ success, result }`. Relevant fields in `result`:

- `title`, `lcsc?.number` or the requested id, `packageDetail.title` (package name), `szlcsc.number`, `dataStr.head.c_para` (map with `pre` = designator prefix like `C?`, `Manufacturer`, `Manufacturer Part`, `package`, `Supplier Part`), datasheet URL if present.
- `dataStr.head.x`, `dataStr.head.y`: symbol origin in canvas px; **subtract from all symbol coordinates**.
- `dataStr.shape`: array of strings, one primitive each (symbol).
- `packageDetail.dataStr.head.x/y`: footprint origin, same rule.
- `packageDetail.dataStr.shape`: array of strings (footprint).

The `/svgs` call returns `result[]` with `svg` strings (symbol and footprint) — use them only for the UI preview, never for conversion.

Handle: HTTP errors, `success: false`, parts that exist on LCSC but return no `dataStr` (newer "EasyEDA Pro"-only parts) → show "not importable" with the reason. Cache the last N responses in memory; never hammer the endpoint.

### 4.1 EasyEDA primitive format

Each shape string is `TYPE~field~field~...`; some types use `^^` to separate sub-records and `#@$` when several shapes are packed in one string (split on `#@$` first). Coordinates are canvas px. **Units: 1 px = 10 mil = 0.254 mm** for both symbol and footprint. **Y axis points down** in EasyEDA and **up** in Eagle → negate Y after subtracting the origin.

Symbol primitives (fields after the type, in order):
- `P` pin: `display~electric~pinNumber~x~y~rotation~id~locked ^^ dotX~dotY ^^ path~color ^^ nameVisible~x~y~rot~name~anchor~font~size ^^ numberVisible~x~y~rot~number~anchor~font~size ^^ dotVisible~x~y ^^ clockVisible~path`. `(x,y)` is the connection point. `path` like `M 640 320 h -20` gives pin length (20 px = 200 mil = 5.08 mm) and direction (the body lies in the direction the path moves).
- `R` rectangle: `x~y~rx~ry~width~height~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked`
- `E` ellipse: `cx~cy~rx~ry~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked`
- `PL` polyline / `PG` polygon: `points~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked` (points: `x y x y ...`)
- `A` arc: `path~helperDots~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked` (SVG path with `A` command)
- `PT` path: `path~strokeColor~strokeWidth~strokeStyle~fillColor~id~locked` (SVG path: M, L, H, V, Z, A, C — approximate curves with line segments)
- `T` text: `mark~x~y~rotation~color~fontFamily~fontSize~fontWeight~fontStyle~baseline~textType~text~visible~anchor~id~locked`; `mark` is `N` for name, `P` for prefix (→ `>NAME`), `V` for value.

Footprint primitives:
- `PAD`: `shape~x~y~width~height~layer~net~number~holeRadius~points~rotation~id~holeLength~holePoints~plated~locked`. `shape` ∈ ELLIPSE, RECT, OVAL, POLYGON. `layer` 1 = top SMD, 2 = bottom SMD, 11 = multilayer (THT). `holeRadius` > 0 ⇒ THT; `holeLength` > 0 ⇒ slot.
- `TRACK`: `strokeWidth~layer~net~points~id~locked`
- `ARC`: `strokeWidth~layer~net~path~helperDots~id~locked`
- `CIRCLE`: `cx~cy~r~strokeWidth~layer~id~locked`
- `RECT`: `x~y~width~height~strokeWidth~id~layer~...` (check field order against fixtures; EasyEDA is inconsistent here)
- `HOLE`: `cx~cy~r~id~locked`
- `SOLIDREGION`: `layer~net~path~type~id~locked`
- `TEXT`: `type~x~y~strokeWidth~rotation~mirror~layer~net~fontSize~text~path~display~id~font~locked`
- `SVGNODE`: JSON blob for the 3D model — ignore in v1.

EasyEDA footprint layers: 1 TopLayer, 2 BottomLayer, 3 TopSilk, 4 BottomSilk, 5 TopPaste, 6 BottomPaste, 7 TopSolderMask, 8 BottomSolderMask, 10 BoardOutline, 12 Document, 13 Multi-Layer, 15 Mechanical, 99 ComponentShape, 100 LeadShape, 101 ComponentMarking.

Do not trust this section blindly: **fetch the fixture parts first, inspect the real strings, and adjust the parser to what you observe.** Reference implementations for the format are `uPesy/easyeda2kicad.py` (Python, `easyeda/easyeda_importer.py`) and `tscircuit/easyeda-converter` (TypeScript, MIT). Reading them is encouraged; depending on them is optional.

## 5. Target format (Eagle 9.x `.lbr`, as written by Fusion)

Root skeleton:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<eagle version="9.7.0">
<drawing>
<settings>…</settings><grid …/><layers>…</layers>
<library>
  <description>…</description>
  <packages>…</packages>
  <symbols>…</symbols>
  <devicesets>…</devicesets>
</library>
</drawing>
</eagle>
```

When creating a **new** lbr, copy `<settings>`, `<grid>` and the full `<layers>` block from `fixtures/lbr/reference.lbr` (never invent the layer list). When merging into an existing lbr, leave everything outside `<library>` untouched and only append to `<packages>`, `<symbols>`, `<devicesets>` (creating those containers if absent, in that order). Fusion also writes a `<packages3d>` block; leave it as is, do not add entries.

Eagle layers used: 1 Top, 16 Bottom, 20 Dimension, 21 tPlace, 22 bPlace, 25 tNames, 27 tValues, 39 tKeepout, 46 Milling, 48 Document, 51 tDocu, 52 bDocu, 94 Symbols, 95 Names, 96 Values. All package coordinates in **mm**, symbol coordinates in mm on a **2.54 mm (0.1 in) grid** — EasyEDA pins sit on 10 px = 100 mil, so this lines up exactly; assert it and warn if a pin is off-grid.

### 5.1 Package

```xml
<package name="C0603">
  <description>…</description>
  <smd name="1" x="-0.8" y="0" dx="0.9" dy="0.95" layer="1" roundness="0" rot="R90"/>
  <pad name="1" x="0" y="0" drill="1.0" diameter="1.8" shape="round|square|octagon|long|offset" rot="R0"/>
  <wire x1= y1= x2= y2= width= layer= curve=/>
  <circle x= y= radius= width= layer=/>
  <rectangle x1= y1= x2= y2= layer= rot=/>
  <polygon width= layer=><vertex x= y= curve=/>…</polygon>
  <hole x= y= drill=/>
  <text x= y= size="1.27" layer="25" ratio="8" rot= align=>&gt;NAME</text>
  <text … layer="27">&gt;VALUE</text>
</package>
```

Mapping rules:
- SMD PAD (layer 1/2, no hole): `<smd>` with `dx=width`, `dy=height`, `roundness` = 0 for RECT, 100 for OVAL/ELLIPSE; `rot="R<deg>"`. POLYGON pads: emit an `<smd>` with the bounding box **and** a `<polygon layer="1">` of the outline, plus a conversion warning.
- THT PAD (holeRadius > 0): `<pad drill=2·holeRadius diameter=max(width,height)>`; shape `round` for ELLIPSE, `square` for RECT, `long` for OVAL (Eagle `long` is a 2:1 oblong; if aspect differs, warn). Slots (holeLength > 0): `long` pad with `drill` = 2·holeRadius plus a Milling-layer (46) wire for the slot, and a warning.
- TRACK → `<wire>` per segment; ARC → `<wire curve=…>` (compute the sweep angle from the SVG arc; approximate with segments only if the arc is elliptical); CIRCLE → `<circle>`; SOLIDREGION → `<polygon>`; HOLE → `<hole>`; TEXT → `<text>` (EasyEDA `>NAME`-style texts become `>NAME` / `>VALUE` on layers 25/27; other texts go to 21/51).
- Layer map: EasyEDA 3 → 21, 4 → 22, 12 → 51 (top) , 15 → 51, 99/100/101 → 51, 10 → 20. Paste/mask layers (5–8) are dropped — Eagle derives them from the pad. Anything unmapped → 51 + warning.
- Name = sanitised `packageDetail.title` (uppercase, `[^A-Z0-9_.-]` → `_`, max 64 chars).

### 5.2 Symbol

```xml
<symbol name="CAP">
  <pin name="1" x="-5.08" y="0" visible="pad" length="short" direction="pas" rot="R0"/>
  <wire … layer="94"/>
  <text x= y= size="1.778" layer="95">&gt;NAME</text>
  <text x= y= size="1.778" layer="96">&gt;VALUE</text>
</symbol>
```

- Pin `(x,y)` = EasyEDA connection point (converted). `length`: 0 → `point`, 2.54 → `short`, 5.08 → `middle`, 7.62 → `long`; other lengths → nearest, with warning. `rot`: the pin points from its connection point toward the body: body to the right → `R0`, up → `R90`, left → `R180`, down → `R270`. `direction` from EasyEDA `electric` (0 undefined → `pas`, 1 input → `in`, 2 output → `out`, 3 bidirectional → `io`, 4 power → `pwr`); `visible="pin"` if the EasyEDA name is shown, `"pad"` if only the number is, `"both"` if both, `"off"` otherwise. `function="dot"` if `dotVisible`, `"clk"` if `clockVisible`, `"dotclk"` if both.
- Pin **name** = EasyEDA pin name (fallback: number). Pin names inside one symbol must be unique — suffix duplicates with `@2`, `@3` (Eagle convention for same-named pins).
- Body graphics: R/E/PL/PG/A/PT → `<wire>` / `<circle>` / `<polygon>` on layer 94, width 0.254.
- Multi-unit symbols (EasyEDA parts with several `dataStr` entries / gates): one `<symbol>` per unit, one `<gate>` per unit named `A`, `B`, … (v1: support it if the data is there, otherwise warn and import the first unit).
- Name = sanitised symbol title or the deviceset name.

### 5.3 Deviceset and device

```xml
<deviceset name="CAP_0603_100N_50V" prefix="C" uservalue="yes">
  <description>100nF 50V X7R ±10% 0603 — LCSC C3131 — Samsung CL10B104KB8NNNC. Keywords: capacitor, ceramic, mlcc</description>
  <gates><gate name="G$1" symbol="CAP" x="0" y="0"/></gates>
  <devices>
    <device name="" package="C0603">
      <connects>
        <connect gate="G$1" pin="1" pad="1"/>
        <connect gate="G$1" pin="2" pad="2"/>
      </connects>
      <technologies>
        <technology name="">
          <attribute name="LCSC" value="C3131" constant="no"/>
          <attribute name="MANUFACTURER" value="…" constant="no"/>
          <attribute name="MPN" value="…" constant="no"/>
        </technology>
      </technologies>
    </device>
  </devices>
</deviceset>
```

- `<connect>` list: match symbol pin **number** to footprint pad **number**. Every pad must be connected (unconnected pads → warning; missing pads for a pin → error, the part is not importable).
- `prefix` comes from the chosen category (see §6); fall back to `c_para.pre` without the `?`.
- Deviceset name = `<CATEGORY_PREFIX>_<sanitised title>`; `uservalue="yes"` for passives (R, L, C), otherwise omit.
- The `LCSC` attribute is mandatory; `MANUFACTURER` and `MPN` only when present in the data.

## 6. Categories

The lbr format has no category concept, so categories are emulated. A category has: display name, deviceset name prefix (e.g. `CAP`), Eagle designator prefix (e.g. `C`), keyword line appended to the description. Defaults: Capacitor/CAP/C, Resistor/RES/R, Inductor/IND/L, Diode/DIO/D, Transistor/TRA/Q, IC/IC/U, Connector/CON/J, Switch/SW/S, Crystal/XTAL/Y, LED/LED/D, Misc/MISC/X. Stored in the plugin-store settings and editable in a simple settings panel. Auto-suggest a category from `c_para.pre` and the title; the user confirms before merging.

## 7. Merge rules and safety

- Load the lbr, parse, modify, serialise, write to `<file>.tmp`, then rename over the original; keep one `<file>.bak` of the previous version.
- Collision handling, per element kind: if a `<package>`/`<symbol>` with the same name already exists and is **byte-identical after normalisation**, reuse it (this is the common case — every 0603 capacitor shares `C0603`); if it differs, ask the user: reuse existing / import as `<name>_2`. A `<deviceset>` whose device already carries the same `LCSC` attribute → "already in library", skip.
- Round-trip fidelity test (must pass before any merge code ships): load `fixtures/lbr/reference.lbr`, save it unchanged, and assert the output is semantically identical (same elements, attributes, order, text), ignoring only whitespace and attribute quoting.
- Never reorder or reformat existing content beyond what the serialiser must do.

## 8. UI (keep it minimal)

Single window. Top bar: current lbr path with **Open…** / **New…**. Main: part-number input + **Fetch**; result card with title, package, manufacturer/MPN, datasheet link, the two SVG previews from `/svgs`, category dropdown (auto-suggested), warnings list from the conversion dry run, and **Add to library**. Below: a table of devicesets currently in the lbr (name, package, LCSC attribute) with a filter box, so the user can see what is already there. Status/toast messages for success and errors. No theming work beyond sane defaults; dark mode via `prefers-color-scheme` is enough.

## 9. Test parts (fetch and commit as fixtures in M1)

C3131 (0603 capacitor, 2 pads), C25804 (0603 resistor), C8734 (SOT-23 transistor), C14663 (SOIC-8 IC), C2040 (ESP32 module, many pads), C165948 (THT pin header), C2913204 or another QFN part with an exposed pad, one part with an OVAL THT pad (e.g. a USB-C connector such as C165948's neighbours — pick one and note it). If any of them fails to fetch, substitute and document.

## 10. Milestones

**M1 — Scaffold + fetch + CLI.** `create-tauri-app` (react-ts), plugins registered, `npm run tauri dev` shows a window. `src/core/easyeda/fetch.ts` + `parse.ts` produce the typed model; fixtures committed; `cli/convert.ts` prints the model as JSON. Unit tests for the primitive parser on every fixture.

**M2 — Eagle emitter.** `src/core/eagle/*` emits package/symbol/deviceset XML fragments from the model. Golden tests: one expected XML per fixture, reviewed by hand once, then frozen. The CLI can write a **standalone** new `.lbr` (skeleton from the reference file) containing one part. This is the file the user opens in Fusion to validate geometry — produce a `VALIDATION.md` checklist for that (pad sizes vs datasheet, pin names, `>NAME`/`>VALUE` placement, attribute visible in Fusion's device properties).

**M3 — Merge.** `src/core/lbr/*` with the round-trip test, collision handling, `.bak`/`.tmp` safety. CLI gains `--into existing.lbr`.

**M4 — UI.** Everything in §8, settings/categories, persistence of the last-opened lbr.

**M5 — Packaging.** `npm run tauri build` produces `.dmg` on macOS and `.msi`/`.exe` on Windows. GitHub Actions workflow using `tauri-apps/tauri-action` building both on tag push (unsigned is fine). README with install notes including the macOS Gatekeeper workaround for unsigned apps (`xattr -dr com.apple.quarantine`).

## 11. Guardrails

- Converter and merge code: pure TS, no Tauri/DOM-browser APIs, fully testable in Node.
- Every non-obvious geometry decision (arc direction, pin rotation, roundness, slot handling) gets a unit test with a hand-checked expected value, not just a snapshot.
- Warnings are data (`{ code, message, severity }`) collected during conversion and shown in the UI and CLI; never `console.log` them away.
- Do not silently drop primitives you can't map — emit a warning with the raw string.
- Keep `AGENTS.md` current: conventions, decisions with a one-line reason, milestone status, known limitations.
- Do not add dependencies beyond: React, the Tauri plugins listed, one XML library, Vitest, and optionally `tscircuit/easyeda-converter` if you decide to reuse its parser.
