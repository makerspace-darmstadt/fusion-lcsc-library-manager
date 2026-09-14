# LCSC → Fusion library manager

Desktop app (Tauri 2 + React + TypeScript, macOS and Windows) that imports parts from LCSC/JLCPCB part
numbers into **one** Autodesk Fusion Electronics library (`.lbr`, Eagle 9.x XML). Symbol and footprint data
come from EasyEDA's public component API and are converted to Eagle packages, symbols and devicesets; the
device carries the part number in an `LCSC` attribute (plus `MANUFACTURER`/`MPN` when known).

## Usage

1. **Open…** an existing `.lbr` exported from Fusion, or **New…** to create one (settings, grid and the
   full layer table are copied from a Fusion reference file).
2. Type a part number such as `C3131`, press **Fetch**. The card shows title, package, manufacturer, the
   LCSC product page, the EasyEDA symbol/footprint previews and the conversion notes of a dry run.
3. Pick a category (auto-suggested). It decides the deviceset name prefix (`CAP_…`), the designator (`C`)
   and the keywords in the description. Categories are editable under **Settings**.
4. **Add to library.** Packages and symbols that already exist with identical content are reused; if the
   content differs you choose between reusing the existing element or importing it as `NAME_2`. Parts whose
   `LCSC` attribute is already present are skipped. The previous file version is kept as `<file>.bak`.

The table at the bottom lists every deviceset in the library with its package and LCSC number. **Remove**
deletes a deviceset again; the confirmation offers to also drop packages and symbols that no other deviceset
uses. A `.bak` of the previous version is kept.

Out of scope for v1: 3D models, managed/cloud libraries, keyword search, editing existing parts.

## Install (unsigned builds)

Downloads are on the GitHub Releases page (`.dmg` for macOS, `.msi` / `-setup.exe` for Windows). The
builds are not code-signed.

**macOS Gatekeeper.** After copying the app to `/Applications`, macOS refuses to open it ("damaged" or
"unidentified developer"). Remove the quarantine flag once:

```sh
xattr -dr com.apple.quarantine "/Applications/lcsc-lbr-manager.app"
```

Alternatively right-click → Open the first time, or allow it under System Settings → Privacy & Security.

**Windows SmartScreen.** Click "More info" → "Run anyway" in the SmartScreen prompt.

## Development

Requirements: Node ≥ 22.18 (24 recommended), a Rust toolchain, and the Tauri 2 platform prerequisites
(<https://tauri.app/start/prerequisites/>).

```sh
npm install
npm test               # Vitest unit, geometry and golden tests (pure TS, no Tauri needed)
npm run typecheck
npm run tauri dev      # desktop app
npm run tauri build    # .dmg (macOS) / .msi + .exe (Windows) under src-tauri/target/release/bundle
```

### Dev CLI

```sh
npm run convert -- C3131                                   # print the intermediate model as JSON
npm run convert -- C3131 --out model.json
npm run convert -- C3131 --xml                             # Eagle package/symbol/deviceset fragments
npm run convert -- C3131 --lbr C3131.lbr                   # standalone library to open in Fusion
npm run convert -- C3131 --into my.lbr                     # merge into an existing library (my.lbr.bak kept)
npm run convert -- C3131 --into my.lbr --on-conflict rename # resolve package/symbol collisions (rename|reuse)
npm run convert -- --remove CAP_CC0603KRX7R9BB104 --into my.lbr [--keep-unused]  # remove a deviceset
npm run convert -- C3131 --category resistor               # override the suggested category
npm run convert -- --fixture fixtures/easyeda/C14663.json  # offline from a committed fixture
```

Warnings go to stderr; exit code 1 when the conversion produced errors, 3 on unresolved merge conflicts.

`VALIDATION.md` lists what to check in Fusion after opening a generated library. `AGENTS.md` records
conventions, decisions and the milestone status.

### Releases

`.github/workflows/ci.yml` runs typecheck, tests and the frontend build on every push to `main` and on pull
requests. Pushing a tag `v*` runs `.github/workflows/release.yml`, which tests on Linux and builds unsigned
bundles for macOS (Apple Silicon and Intel) and Windows with `tauri-apps/tauri-action`, attached to a draft
GitHub release. Code signing is intentionally not configured yet.

## Layout

```
src/                     React UI (thin; no conversion logic)
src/tauri/               the only code importing Tauri plugins
src/core/easyeda/        fetch + parse EasyEDA JSON into a typed model (mm, Y up)
src/core/eagle/          emit Eagle XML (package, symbol, deviceset)
src/core/lbr/            load / merge / save an .lbr document
src/core/units.ts        unit + layer mapping constants
cli/convert.ts           dev CLI
fixtures/easyeda/*.json  committed API responses for the test parts
fixtures/lbr/            reference .lbr exported from Fusion
tests/                   Vitest unit + golden tests (tests/golden/*.xml)
```
