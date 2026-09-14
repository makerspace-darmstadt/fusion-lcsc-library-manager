# Fusion validation checklist

Use this once per new geometry rule (and for any part that produced warnings) to confirm that what the
converter writes is what Fusion Electronics shows. Generate a standalone library first:

```sh
npm run convert -- C14663 --lbr C14663.lbr          # or --fixture fixtures/easyeda/C14663.json --lbr …
```

Open it in Fusion: **Electronics → Libraries → Open library** (or drag the `.lbr` onto Fusion), then open
the package, the symbol and the device in turn.

## Package (footprint)

- [ ] **Pad sizes vs datasheet.** Compare `dx`/`dy` (SMD) or `drill`/`diameter` (THT) with the datasheet's
      recommended land pattern. Suggested first checks:
      C14663 (0603): 0.8 × 0.9 mm pads, 1.4 mm apart. C124375 header: ⌀1.1 mm drill, ⌀1.8 mm pads, 2.54 mm pitch.
- [ ] **Pad positions and rotation.** Pin 1 at the expected corner; rotated pads (QFN sides, C2040) are
      oriented tangentially, not radially.
- [ ] **Oval SMD pads** (SOIC C6961, LQFP C8734) are stadium-shaped (`roundness="100"`).
- [ ] **THT square/round**: pad 1 square, others round (C124375).
- [ ] **Slot pads** (C3131, C165948): the `long` pad is centred on the slot and the Milling (46) wire covers
      the slot length. Decide whether to keep the Milling wire for fabrication or delete it.
- [ ] **Polygon pads** (C165948 `A1B12`): bounding-box SMD plus copper polygon looks like the EasyEDA pad,
      and DRC does not complain about the polygon touching its own SMD.
- [ ] **Exposed pad** (C2040 pad 57) exists and is connected to GND.
- [ ] **Silkscreen** (tPlace 21): outline, pin-1 marker and arcs curve in the right direction (the 0603
      rounded corners must bulge outwards).
- [ ] **tDocu (51)** shows the body outline and lead shapes; nothing important ended up only on tDocu.
- [ ] **Nothing on paste/mask layers** was needed (EasyEDA layers 5–8 are dropped by design).
- [ ] `>NAME` on tNames (25) above and `>VALUE` on tValues (27) below the part, size 1.27 mm, readable.

## Symbol

- [ ] **Pin names and numbers**: hover each pin; number (pad) and name match EasyEDA/the datasheet.
- [ ] **Pin direction/rotation**: pins point away from the body; pin ends land on the 0.1 in grid
      (parts with `PIN_OFF_GRID` warnings will not — RP2040 C2040 is on a 50 mil grid in EasyEDA).
- [ ] **Pin length**: 2.54 mm (short) or 5.08 mm (middle) as in EasyEDA; the pin meets the body graphics.
- [ ] **Visibility**: `visible="pad"` shows only the number (op-amps), `"both"` shows name + number.
- [ ] **Multi-unit** (C6961): gates A and B; power pins VCC+/VCC- appear only on gate A.
- [ ] **Duplicate names** (C2040 `IOVDD`, `IOVDD@2`, …) are displayed as `IOVDD` and join one net.
- [ ] **Graphics**: filled circles (pin-1 dot, C124375) are filled; white-filled EasyEDA arrows
      (C8545) are outlines; `RECT_CORNER_RADIUS` rectangles are acceptable with square corners.
- [ ] `>NAME` (95) above the top-left, `>VALUE` (96) below the bottom-left, size 1.778 mm.

## Device / deviceset

- [ ] **Connections**: every pin is connected (device shows "connected" for all gates); every pad is used
      (unused pads were reported as `UNCONNECTED_PAD`).
- [ ] **Attributes visible in Fusion's device properties**: `LCSC` (mandatory), `MANUFACTURER`, `MPN`.
      Place the device on a schematic and check the attributes in the properties panel and in a BOM export.
- [ ] **Prefix**: C/R/L/... from the chosen category; `uservalue="yes"` lets you type `100nF` as the value.
- [ ] **Description** shows the text, the LCSC number and the product link (rendered as HTML).
- [ ] **Category naming**: deviceset name is `<PREFIX>_<title>`; check it sorts sensibly next to existing
      parts.

## Unverified assumptions (no fixture data)

- Footprint `TEXT` primitives (rotation mirroring, layer choice) — no committed fixture contains one.
- EasyEDA rotation sign for non-symmetric shapes (decision 10 in AGENTS.md).
- Eagle DRC behaviour for the polygon-pad copper polygon overlapping its own SMD.
