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

## The lab diagram

Above the form sits an interactive diagram of the lab: the host bar (your
computer, coordinator and exporter in a remote lab; this computer in a local
one), one tile per bench with its device bricks stacked over the board block,
a "+ Add bench" tile and a palette of bricks, one per device kind.

- Drag a brick from one bench onto another to move the device; drop it onto a
  brick to insert it before that brick. Drag a palette brick onto a bench to
  add a blank device of that kind, or click a palette brick to add it to the
  selected bench.
- Click a brick to select the device; the matching device card in the form
  scrolls into view and takes focus. Click a board block to select the bench.
- Without a mouse, every brick has a toolbar: **Move to…** lists the other
  benches, **Up** and **Down** reorder, **Remove** asks for a second click.
  Touch devices use the same toolbar because browsers do not drag with touch.
- Every change is announced once in the editor's status line ("Console moved
  to board-02"). Moving a device keeps its id unless the target bench already
  uses it, in which case it is renamed.
- Network devices (PDU outlets, serial servers, SSH) carry a small network
  glyph and a dashed connector; USB devices connect with a solid line to the
  exporter.

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
- **Move up / Move down** reorder benches; `exporter.yaml` lists the groups
  in that order and the plan page follows it.
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

## The lab plan

The plan page covers the whole lab: a read-only copy of the diagram (click a
bench to jump to its section), insights for the whole lab first and then per
bench, the shared files (`exporter.yaml` with every group, the systemd
drop-in, `SETUP.md`, `lab-profile.json`), and one section per bench with its
client environment (`remote-<place>.yaml`, or `environment-<place>.yaml` in a
local lab), its guides pre-filled from that bench, and the "Contribute this
board" card. The checklist lists the steps that happen once for the lab,
then the steps for each bench, then the final verification; ticks are kept per
lab under `labgrid-advisor-lab-checklist:<lab name or bench ids>`. Cross-bench
rules catch one USB device or power outlet claimed by two benches, duplicate
place or group names, and empty benches. A lab with one bench keeps the
single-bench wording and the plain `environment.yaml` / `remote.yaml` names.

## Limits

- A lab holds at most 16 benches, and a share link grows with the lab (about
  1 kB per bench); beyond a handful of benches, exchange `lab-profile.json`
  instead.
- Device ids are unique per bench, not per lab; moving a device between benches
  renames it when the target bench already uses the id.

The data model and the pure operations behind the editor live in
`src/bench/lab.ts`; the lab-wide files, insights and checklist in
`src/bench/lab-files.ts`, `lab-insights.ts` and `lab-checklist.ts`. See
[bench.md](bench.md) for the per-bench profile and the full list of insight
ids.
