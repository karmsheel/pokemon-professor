# Live view vs agent snapshots

**Date:** 2026-07-21  
**Status:** Approved for implementation planning  
**Parent:** [Pokemon Professor design](./2026-07-17-pokemon-professor-design.md)

## Problem

Today a single path serves both the studio live view and the Hermes agent:

- `GET /frame` always re-captures a PNG from mGBA.
- Live view polls that endpoint on a mode-dependent interval (Drive 80ms / Nudge 140ms / Agent 200ms).
- The agent skill also uses `GET /frame` for vision.

Both consumers fight over the serialized Lua bridge socket. Raising live FPS hurts agent reliability; agent hammering hurts the “smooth game view.” The product needs two *roles* for frames, not two independent emulator streams.

## Goals

1. **Viewing framerate (human):** as high as mGBA capture + localhost paint can sustain.
2. **Agent observation:** explicit tools — pull the latest frame, force a fresh capture, optionally set a background snapshot interval.
3. **Default agent behavior:** on-demand only (`interval_ms = 0`); no background agent captures until configured.
4. **Single source of truth:** agent and live UI always share the same latest PNG buffer (no dual buffers, no dual resolutions in v1).

## Non-goals (v1)

- WebSocket / SSE push for live video.
- Separate agent buffer or lower-res agent JPEG.
- Persisting snapshot interval across runs / restarts.
- Changing Nudge/Drive input semantics (mode still only gates agent `POST /input` and Drive keyboard).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Electron Control API                                         │
│                                                              │
│   CaptureScheduler  (sole caller of backend.getFramePng())   │
│     • liveLoop while rom_loaded → write latest               │
│     • if interval_ms > 0, also pace captures for agent       │
│     • forceCapture() = priority one-shot → write latest      │
│                                                              │
│   latest: { png, width, height, frame_id, captured_at, … }   │
│                                                              │
│   GET  /frame[?raw=1]  → read latest (no capture)            │
│   GET  /snapshot       → read latest as JSON (no capture)    │
│   POST /snapshot       → force capture, return JSON          │
│   GET|PUT /snapshot/config → interval_ms                     │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
              MgbaBackend (persistent TCP + command queue)
```

### Invariants

1. **Only `CaptureScheduler`** calls `backend.getFramePng()`. HTTP routes never capture directly.
2. **One buffer:** `latest`. Live UI and agent always see the same pixels.
3. **Captures are serialized** (one bridge frame command at a time). Force capture is priority over the free-running live loop, not parallel.
4. **Failed captures do not overwrite** last good `latest`.
5. **Mode (agent / nudge / drive)** does not change capture rate or buffer policy.

### Capture loop (conceptual)

```
while rom_loaded:
  if force_pending:
    capture → latest   # agent POST /snapshot
  else:
    capture → latest   # continuous live loop
  # interval_ms > 0 does not add a second buffer; it only ensures
  # captures keep happening at least that often for agent sampling
  # (live loop already max-rate, so interval is mainly for future
  # throttling of live or for when live is paused — see notes)
```

**`interval_ms` (v1 — explicit):**

- Live loop always runs at max rate while `rom_loaded`.
- `POST /snapshot`: one forced capture (await); always updates `latest`.
- `interval_ms = 0` (default): no timer.
- `interval_ms > 0`: a timer that requests a capture only if `age(latest) >= interval_ms` (skip if live loop already fresher). Purpose: agent can declare a sampling floor without Hermes polling; no double-capture when live is faster.


## Control API

### `GET /frame` and `GET /frame?raw=1`

| | |
|--|--|
| **Role** | Studio live view |
| **Capture?** | **No** — serves `latest` |
| **Binary** | `?raw=1` or `Accept: image/png` → `image/png` body |
| **JSON** | default → `{ mime, data, width, height, frame_id, captured_at? }` |
| **Headers (raw)** | `x-frame-id`, `x-frame-width`, `x-frame-height`, `x-captured-at` (unix ms) |
| **Errors** | `409` ROM not loaded; `404` no frame yet |

Back-compat: path and shapes stay; semantics change from “capture now” to “read buffer.” Callers that need a new screenshot use `POST /snapshot`.

### `GET /snapshot`

| | |
|--|--|
| **Role** | Agent pull latest |
| **Capture?** | **No** |
| **Body** | `{ mime, data, width, height, frame_id, captured_at, age_ms }` |
| **Errors** | `409` ROM not loaded; `404` no frame yet |

### `POST /snapshot`

| | |
|--|--|
| **Role** | Agent force capture |
| **Capture?** | **Yes** — scheduler priority; updates `latest` |
| **Body** | Same JSON as GET, reflecting the new capture |
| **Errors** | `409` ROM not loaded; `502` capture failed (last good retained for GET) |

### `GET /snapshot/config`

```json
{
  "interval_ms": 0,
  "live_loop": true,
  "has_frame": true,
  "last_frame_id": 42,
  "last_captured_at": 1720000000000
}
```

Optional `capture_fps` (rolling estimate) if cheap to compute.

### `PUT /snapshot/config`

```json
{ "interval_ms": 0 }
```

- `0` — no background agent timer (default).  
- `> 0` — clamp to **[50, 10000]** ms; start/replace timer.  
- Invalid → `400`.

### Health (optional small extension)

`GET /health` may include `has_frame` and `snapshot_interval_ms` for debugging. Not required for v1 if config endpoint exists.

## Live view (UI)

1. Poll `GET /frame?raw=1` with **max backpressure**: start next fetch when the previous completes (and image paint/load settles), no mode-based 80/140/200 capture throttle.
2. Optional safety floor (e.g. 16ms) only to avoid tight empty loops if responses are instant.
3. Keep last-good paint behavior (no blank on bad/404 mid-stream).
4. Meta line:
   - **display fps** — paints in last 1s  
   - **age** or **capture** — from `x-captured-at` / frame_id if useful  
5. Mode no longer changes stream interval; Drive still owns keyboard focus only.

## Hermes skill

Update `skills/pokemon-professor/SKILL.md`:

| Action | Call |
|--------|------|
| Observe (usual) | `GET /snapshot` — decode base64, vision |
| Observe after move / fade | `POST /snapshot` when a guaranteed-fresh frame is needed |
| Optional passive sampling | `PUT /snapshot/config` with `interval_ms` |
| Do not | Hammer `/frame` for vision; `/frame` is for the studio UI |

Gameplay loop “OBSERVE / VERIFY” sections switch from `/frame` to `/snapshot`. Hard rules unchanged for input/mode.

## Lifecycle

| Event | Behavior |
|-------|----------|
| Attach / ROM loaded | Start live capture loop; **reset `interval_ms` to 0** |
| Detach / stop / unload | Stop loops and timer; **clear `latest`** |
| Bridge blip | Keep last good `latest`; age grows; force returns `502` without clearing buffer |
| Mode change | No effect on capture |

## Error table

| Case | Status | Notes |
|------|--------|--------|
| ROM not loaded | 409 | `/frame`, `/snapshot*` |
| No frame yet | 404 | GET latest paths |
| Capture failed | 502 | POST `/snapshot` only |
| Bad `interval_ms` | 400 | Outside clamp / non-number |
| Concurrent force | serialize | Second waits on scheduler queue |

## Tests

1. **CaptureScheduler (unit, mock backend)**  
   - Many `GET /frame` / `GET /snapshot` → capture count does not grow with GET count.  
   - Each `POST /snapshot` → +1 capture.  
   - `interval_ms = 100` over ~500ms → bounded captures (≥1, not unbounded spam).  
2. **Control API integration**  
   - 409 without ROM; 404 before first capture; GET after capture; POST advances `frame_id`; PUT/GET config.  
3. **Regression**  
   - Existing raw PNG headers still present.  
   - Tests that assumed every `/frame` advances `frame_id` updated to use `POST /snapshot`.  
4. **Docs**  
   - Skill + README endpoint tables list `/snapshot` and note `/frame` is buffer-read.

## Implementation sketch (for plan)

| Area | Work |
|------|------|
| `electron/emulator/capture-scheduler.ts` (new) | Buffer, live loop, force, interval timer, stats |
| `electron/control-api/routes.ts` | Wire `/frame` to buffer; add `/snapshot` + config |
| `electron/control-api/context.ts` / server bootstrap | Own scheduler; start/stop with backend ROM lifecycle |
| `electron/main.ts` | Start/stop scheduler on attach/createRun/stop |
| `components/live-view.tsx` | Max backpressure poll; drop mode POLL_MS for capture |
| `lib/control-client.ts` | Snapshot helpers; optional age headers |
| `skills/pokemon-professor/SKILL.md` | Agent API |
| `tests/*` | As above |

## Success criteria

- Live view can run at the capture ceiling without the agent skill calling `/frame`.  
- Agent can pull latest without forcing a capture, force when needed, and set interval (default off).  
- Single buffer: agent and UI always consistent.  
- No intermittent “Frame 500” regression from opening new bridge sockets per request (scheduler uses existing backend queue).

## Open decisions closed in design

| Decision | Choice |
|----------|--------|
| Default agent sampling | On-demand only (`interval_ms = 0`) |
| Buffer model | Shared `latest` only |
| Force vs latest API | GET = latest, POST = force |
| Live HTTP semantics | Buffer read (not capture-on-GET) |
| Mode vs FPS | Mode does not throttle live stream |
| Interval reset on attach | Yes, to 0 |
