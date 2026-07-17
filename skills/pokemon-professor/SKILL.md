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
| GET | `/frame` | PNG screenshot as base64 (`mime`, `data`, `width`, `height`, `frame_id`) |
| POST | `/input` | `{ "buttons": ["A","RIGHT",...] }` — max 5; agent mode only |
| GET/POST | `/mode` | Read or set `agent` \| `nudge` \| `drive` (human/studio usually owns mode) |
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
GET http://127.0.0.1:7946/frame
```

- Decode `/frame` `data` (base64 PNG), save to a temp file (e.g. `/tmp/pp-frame.png` or `%TEMP%\pp-frame.png`), and use vision to inspect the screen.
- `/state` may be null in alpha — **vision is primary**. Ask specific questions: "what is one tile north?", "is dialog open?", "am I in battle?"

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

After every short move sequence, `GET /frame` again and confirm with vision that you moved or advanced as intended. This is the most important step.

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

## FireRed Tips (adapted from pokemon-player)

### Use vision constantly

- Screenshot every 2–4 steps. Ledges, doors, NPCs, and fences are vision-only when state is stubbed.
- When stuck 3+ attempts: full re-observe, re-read mission, try a different path.

### Doors and warps

- After walking through a door or stairs, the screen fades. Wait briefly (do not immediately spam more moves). Re-fetch `/frame` until the new map is visible before trusting position.

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

## Example curl sequences

```bash
# Observe
curl -s http://127.0.0.1:7946/state
curl -s http://127.0.0.1:7946/frame

# Act (agent mode)
curl -s -X POST http://127.0.0.1:7946/input \
  -H "content-type: application/json" \
  -d "{\"buttons\":[\"RIGHT\",\"RIGHT\",\"A\"]}"

# If 409 — check mode and wait
curl -s http://127.0.0.1:7946/health
# ... after Professor resumes agent ...
curl -s -X POST http://127.0.0.1:7946/input \
  -H "content-type: application/json" \
  -d "{\"buttons\":[\"UP\"]}"
```

## Pitfalls

- NEVER download ROMs or invent paths
- NEVER send more than 5 buttons in one `/input`
- NEVER keep posting `/input` on 409 — wait for agent mode
- ALWAYS re-observe with `/frame` after short move sequences
- ALWAYS sidestep after leaving buildings
- ALWAYS treat chat mission text as the source of truth for objectives
