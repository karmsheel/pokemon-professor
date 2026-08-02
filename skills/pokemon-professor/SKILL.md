# Pokemon Professor

Play Pokémon FireRed inside the **Pokemon Professor** studio by driving its localhost Control API. The studio owns mGBA (or a mock backend); you never talk to the emulator directly.

**Control API version:** `0.1.0`  
**Base URL:** `http://127.0.0.1:7946`

## When to Use

- User wants to play FireRed in Pokemon Professor / the Local Agent Studio
- User says "play pokemon", "coach the agent", "continue the mission", or similar while the studio is running
- User references the studio Control API, live view, Nudge, or Drive modes
- User assigns a mission via studio chat (you are the disciple Hermes agent)

Do **not** use the separate `pokemon-player` / `pokemon-agent` stack when the studio Control API is available. Prefer this skill.

## Hard Rules

- **Never download or provide ROM files.** The user supplies a legal FireRed dump in the studio. Do not invent or guess ROM paths.
- **Do not invent ROM paths, save paths, or run IDs.** The studio loads the ROM; you only call the Control API.
- **Read the current mission from user/studio chat.** Follow that objective. Do not invent a different story goal.
- **Max 5 buttons per `POST /input`.** Prefer 2–4 movement steps, then re-observe.
- **On HTTP 409 for input:** mode is `nudge` or `drive` (or ROM not loaded). Tell the user agent tools are frozen / human is in control, and **wait** until mode is `agent` again. Do not spam `/input`.
- **Never `POST /mode`.** Mode changes (`agent` / `nudge` / `drive`) are owned by the Professor UI only. You may `GET /mode` or `GET /health` to observe mode.

## Preconditions

1. Pokemon Professor studio is running (Control API on `127.0.0.1:7946`).
2. User has loaded FireRed and started a run/mission in the studio.
3. Confirm readiness:

```http
GET http://127.0.0.1:7946/health
```

Expect JSON including `ok: true`, `api_version: "0.1.0"`, `rom_loaded: true`, and `mode: "agent"` before issuing input. If `mode` is `nudge` or `drive`, wait and tell the user.

## Endpoints (0.1.0)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | API version, mode, emulator kind, rom_loaded, run_id |
| GET | `/state` | Partial `FireRedState` or `{ "state": null }` (alpha stub) |
| GET | `/snapshot` | Latest PNG as base64 + `age_ms` (no capture) |
| POST | `/snapshot` | Force fresh capture; returns same shape |
| GET/PUT | `/snapshot/config` | `{ interval_ms }` — default 0; clamp 50–10000 |
| GET | `/frame` | Studio live buffer (prefer `/snapshot` for vision) |
| POST | `/input` | `{ "buttons": ["A","RIGHT",...] }` — max 5; agent mode only |
| GET | `/mode` | Read `agent` \| `nudge` \| `drive` (observe only — never POST /mode) |
| POST | `/save` | `{ "name": "descriptive_name" }` |
| POST | `/load` | `{ "name": "descriptive_name" }` |
| GET | `/saves` | List savestate names |

### Valid buttons

`A`, `B`, `START`, `SELECT`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `L`, `R`

## Gameplay Loop

### 1. OBSERVE

Always do both when possible:

```http
GET http://127.0.0.1:7946/state
GET http://127.0.0.1:7946/snapshot
```

- Decode `/snapshot` `data` (base64 PNG), save to a temp file (e.g. `/tmp/pp-frame.png` or `%TEMP%\pp-frame.png`), and use vision to inspect the screen. Response includes `age_ms` (how old the buffer is).
- After input or screen fade, force a fresh capture:

```http
POST http://127.0.0.1:7946/snapshot
```

- `/state` may be null in alpha — **vision is primary**. Ask specific questions: "what is one tile north?", "is dialog open?", "am I in battle?"
- Prefer `/snapshot` for vision. Do **not** hammer `/frame` — it is a studio live buffer read, not an agent capture tool.

### 2. ORIENT

- Dialog/text → advance with `A` (use `B` holds via repeated short presses if text is slow)
- In battle → fight or run per mission
- Low HP → head to a Pokémon Center if that fits the mission
- Otherwise navigate toward the **mission from chat**

### 3. DECIDE

Priority: dialog → battle → heal (if critical) → **current mission** → explore

### 4. ACT (short sequences)

```http
POST http://127.0.0.1:7946/input
Content-Type: application/json

{ "buttons": ["UP", "UP", "A"] }
```

- **Max 5 buttons** per request (server returns 400 if more).
- Prefer **2–4** steps then re-check vision. Do not spam 10–15 moves.
- Success: `200` `{ "ok": true, "executed": [...], "mode": "agent" }`

### 5. HANDLE 409 (nudge / drive)

If `POST /input` returns **409**:

```json
{ "ok": false, "error": "input blocked: mode is nudge", "mode": "nudge" }
```

- Tell the user: mode is **nudge** or **drive**; agent input is frozen while they coach or drive.
- **Wait.** Poll `GET /health` or `GET /mode` occasionally; only resume input when `mode` is `agent`.
- Do not invent alternate control paths. Do not fight the human override.

### 6. VERIFY

After every short move sequence, `POST /snapshot` (or `GET /snapshot` if the buffer is already fresh) and confirm with vision that you moved or advanced as intended. This is the most important step.

### 7. SAVE (when useful)

```http
POST http://127.0.0.1:7946/save
Content-Type: application/json

{ "name": "before_brock" }
```

Save before gyms, rival fights, new towns, or risky choices. Names: `[\w.-]+` only.

## Mission Coaching

- The Professor (user) assigns missions in chat. That text is your objective.
- On re-mission during/after nudge: drop the old plan, acknowledge the new mission, continue from the current screen.
- Do not load a ROM or start an external emulator — the studio already did that.

## Narration policy (chat with the Professor)

Message the user **sparingly** in studio chat:

**Do message when:**
- Session start / title screen plan
- Clear progress (new town, badge, major story beat)
- Stuck: same screen or failed plan 3+ times — say what you tried and ask for a nudge
- Control API 409 (nudge/drive) — tell them tools are frozen
- They asked a question

**Do not message when:**
- Every 2–4 button batch succeeds as expected
- Routine grass steps, repeated “I see …” observations

Prefer playing over talking. Short updates (1–3 sentences).

## FireRed Tips (adapted from pokemon-player)

### Use vision constantly

- Snapshot every 2–4 steps via `/snapshot`. Ledges, doors, NPCs, and fences are vision-only when state is stubbed.
- When stuck 3+ attempts: full re-observe (`POST /snapshot`), re-read mission, try a different path.

### Doors and warps

- After walking through a door or stairs, the screen fades. Wait briefly (do not immediately spam more moves). `POST /snapshot` until the new map is visible before trusting position.

### Building exit trap

- Exiting a building places you facing the door. Walking "forward" (often north) walks back inside. **Sidestep left or right 1–2 tiles first**, then proceed.

### Ledges are one-way

- Ledges can only be jumped **down** (south), never climbed up. If blocked going north, go left/right to find a gap. Ask vision which way the gap is.

### Short moves

- 2–4 buttons, then vision. Overshooting wastes time and gets you stuck.
- Dialog: `A` to advance; cancel/back with `B`. Menu: `START`.

### Battles (quick reference)

- Wild trash: cursor to **RUN** (often down + right from FIGHT) then `A`.
- FIGHT: `A` for first move when appropriate.
- Low HP: potions or Pokémon Center per mission priority.

### Gen 1 type reminders

- Water > Fire/Ground/Rock · Fire > Grass/Bug · Grass > Water/Ground/Rock  
- Electric > Water/Flying · Ground > Fire/Electric · Psychic strong in Gen 1

## Control helper CLI (preferred)

**Do not use PowerShell `curl`** (it is not real curl). Prefer the Studio helper:

```bash
# From the pokemon-professor repo (or $env:PP_CONTROL_CLI absolute path)
node scripts/pp-control.cjs health
node scripts/pp-control.cjs snapshot --fresh --save %TEMP%\pp-frame.png
node scripts/pp-control.cjs input RIGHT RIGHT A
node scripts/pp-control.cjs state
node scripts/pp-control.cjs save before_brock
```

Env: `PP_CONTROL_URL` (default `http://127.0.0.1:7946`). Exit code `3` means input blocked (nudge/drive).

### Fallback raw HTTP (if CLI missing)

```bash
# Prefer curl.exe on Windows, not PowerShell curl
curl.exe -s http://127.0.0.1:7946/health
curl.exe -s -X POST http://127.0.0.1:7946/snapshot
curl.exe -s -X POST http://127.0.0.1:7946/input -H "content-type: application/json" -d "{\"buttons\":[\"RIGHT\",\"RIGHT\",\"A\"]}"
```

## Pitfalls

- NEVER download ROMs or invent paths
- NEVER send more than 5 buttons in one `/input`
- NEVER `POST /mode` — Professor UI only
- NEVER keep posting `/input` on 409 — wait for agent mode
- NEVER hammer `/frame` for vision — use `GET`/`POST /snapshot`
- ALWAYS re-observe with `/snapshot` after short move sequences
- ALWAYS sidestep after leaving buildings
- ALWAYS treat chat mission text as the source of truth for objectives
