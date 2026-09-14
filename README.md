# LCSC → Fusion library manager

Desktop app (Tauri 2 + React + TypeScript) that imports parts from LCSC/JLCPCB part numbers into a single
Autodesk Fusion Electronics library (`.lbr`, Eagle 9.x XML). Symbol and footprint data come from EasyEDA's
public component API and are converted to Eagle packages, symbols and devicesets.

## Setup

Requirements: Node ≥ 22.18 (24 recommended), Rust toolchain, and the Tauri 2 platform prerequisites
(<https://tauri.app/start/prerequisites/>).

```sh
npm install
npm test               # Vitest unit + golden tests (pure TS, no Tauri needed)
npm run typecheck
npm run tauri dev      # desktop app
```

## Dev CLI

```sh
npm run convert -- C3131                                   # print the intermediate model as JSON
npm run convert -- C3131 --out model.json
npm run convert -- --fixture fixtures/easyeda/C14663.json  # offline from a committed fixture
```

Warnings go to stderr; exit code 1 when the conversion produced errors.

## Layout

See `AGENTS.md` for conventions, decisions and milestone status.
