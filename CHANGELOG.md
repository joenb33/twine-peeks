# Changelog

## 1.7.0 — 2026-07-07

**Project renamed to Twine Peeks** (formerly "Twine DevTools"), with a new original logo — earlier private builds used placeholder icons borrowed from TwineHacker (see [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md)).

### Inspect mode overhaul
- The panel now hides while inspecting, with a floating HUD pill — the full game is visible
- Hover tooltip previews elements before clicking: link kind, target passage (warns on missing passages), `data-setter` code, referenced variables
- New lightweight `peekGameElement` page API powers hover previews (throttled, cheap)
- Fixed: highlight box and crosshair cursor were invisible (styles lived in the shadow root but the elements live in the page DOM — now inlined)
- Fixed: coordinates now translate correctly for games attached inside same-origin iframes
- Fixed: full click gesture (mousedown/pointerdown/…) is suppressed during inspect, so games that navigate on mousedown can't fire
- Fixed: overview auto-refresh no longer re-scrolls the game to the highlighted element every tick
- Fixed: the floating button can no longer be "inspected"
- Fixed: dragged panel re-clamps into view on window resize

## 1.6.0

- Performance: cached storydata passage parse and adapter detection; targeted BFS for Map neighborhood views; graph edge batching above ~1200 edges
- 5000-passage benchmarks: passage list ~40 ms, neighborhood map ~0 ms, full graph ~53 ms

## 1.5.0

- **Chat tab** (when [hituro CHATSYSTEM](https://github.com/hituro/hituro-makes-macros) is detected) — conversation inspector, `_curr` branch debugger, dev actions
- **Raw browser storage** in Saves tab — browse/delete `localStorage` and `sessionStorage` keys
- **Passage hints** — flags `<<msg>>` / `<<chat>>` / `<<history>>` macros and implied conversation ids

## 1.4.0

- **Format adapter layer** — per-format detection, link parsing, and capability profiles
- **Analysis tab** — broken links, orphan passages, dead ends, unreachable from start
- **Twee export** from any format
- **Chapbook / Snowman** — full variable edit, navigation, passage edit, diff/locks
- **Harlowe** — read-only variables, Harlowe link parser on map/analysis
- **SugarCube temp variables** toggle; **history restore**; format-aware UI badges

## 1.3.0

- **Change log (diff)** — tracks variable mutations with passage context
- **Variable locks** — pin values so game updates cannot overwrite them
- **Map / Set editing** in the variable tree
- **Global search** across variables and passage source
