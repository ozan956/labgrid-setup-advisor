# Labs: several benches on one exporter

A bench is one board with the devices wired to it. A lab is several benches
that share the machine the hardware is plugged into and the coordinator that
hands the boards out. The advisor edits one lab; a lab with a single bench
looks and behaves exactly like the old single-bench editor.

## What is shared and what is per bench

| Level | Fields | Why |
| --- | --- | --- |
| Lab | name, topology (local or remote), who uses it, exporter host, coordinator address, location | One `labgrid-exporter` serves every board on the host; the coordinator and the location are properties of the rack, not of a board. |
| Bench | board, devices, place name, exporter group, Linux login, bootloader | Each board becomes its own place and its own group in `exporter.yaml`, so these stay separate. |

The editor shows the lab fields in the left rail above the bench list, and the
selected bench in the main column with the familiar steps (board, detection,
devices, place and group, login and boot).

## Working with benches

- **Add bench** creates an empty bench whose place is the next free
  `board-NN` name. The new bench is selected and focus moves to its heading.
- **Duplicate bench** is for a second unit of the same board. It copies the
  board, devices, login and bootloader, clears every udev `match` value (the
  serial numbers and USB paths identify the first unit, not the second),
  and picks the next free place name. PDU hosts, models and outlet indices are
  copied unchanged, so check the outlet index on the copy.
- **Remove bench** asks for a second click within four seconds. Removing the
  last bench leaves one empty bench; a lab is never empty.
- **Move up / Move down** reorder benches. The order is cosmetic today; a
  lab-wide plan will use it for the `exporter.yaml` group order.
- Clicking a bench in the rail selects it; every edit in the main column goes
  to the selected bench only. Lab fields apply to all benches at once.

The "See my plan" button stays disabled while any bench has an invalid place
or group name, or while two benches share a place or group name. The hint
next to the button names the bench that needs attention.

## Saving, importing and sharing

- The lab is saved in the browser under `labgrid-advisor-lab` on every change.
  A bench saved by an earlier version under `labgrid-advisor-bench` is read
  once and upgraded to a one-bench lab.
- **Export JSON** writes `lab-profile.json`, the whole lab. **Import JSON**
  accepts both a lab file and an older single-bench `bench-profile.json`, which
  becomes a one-bench lab.
- Share links encode the lab as `#lab=`. Older `#bench=` links keep working
  and open as a one-bench lab. A shared lab is shown but not saved until
  "Save as my bench" is pressed or something is edited.
- **Reset lab** (two clicks) clears the saved lab, every checklist tick, and
  starts over with one empty bench.

## Limits

- The plan page currently shows one bench at a time (the selected one, or the
  first bench that has devices). A lab-wide plan with a merged `exporter.yaml`
  and a combined checklist is the next step.
- A lab holds at most 16 benches.
- Device ids are unique per bench, not per lab; moving a device between benches
  renames it when the target bench already uses the id.

The data model and the pure operations behind the editor live in
`src/bench/lab.ts`; see [bench.md](bench.md) for the per-bench profile.
