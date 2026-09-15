# Fusion LCSC Library Manager

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

## Install

Downloads are on the GitHub Releases page (`.dmg` for macOS, `.msi` / `-setup.exe` for Windows). Release
builds are code-signed: macOS with an Apple Developer ID certificate and notarized, Windows via Azure
Artifact Signing (Trusted Signing).

**Local or unsigned builds** (e.g. from `npm run tauri build` on your own machine) trigger Gatekeeper on
macOS. Remove the quarantine flag once after copying the app to `/Applications`:

```sh
xattr -dr com.apple.quarantine "/Applications/Fusion LCSC Library Manager.app"
```

On Windows an unsigned installer shows the SmartScreen prompt: "More info" → "Run anyway".

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
requests. Pushing a tag `v*` runs `.github/workflows/release.yml`, which tests on Linux and builds signed
bundles for macOS (Apple Silicon and Intel, notarized) and Windows with `tauri-apps/tauri-action`, attached
to a draft GitHub release. Keep the version in `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml` equal to the tag.

Signing needs these repository secrets: `APPLE_CERTIFICATE` (base64 `.p12` with the Developer ID Application
certificate and key), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`
(app-specific), `APPLE_TEAM_ID`, and `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` for a service
principal with the *Trusted Signing Certificate Profile Signer* role. Endpoint, account and profile for
Windows are in `bundle.windows.signCommand` of `tauri.conf.json`. The app icon source is
`src-tauri/icons/icon.svg`; regenerate the sizes with `npm run tauri icon <1024px png>`.

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
