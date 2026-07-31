# Pokemon Professor

Local **Agent Emulator Studio** for coaching Hermes through Pokémon FireRed. You are the Professor; Hermes is the disciple. The studio owns mGBA (or a mock backend), a live frame view, mission/run management, and human override (Nudge / Drive). Hermes never talks to the emulator directly — it uses a localhost **Control API**.

Alpha focuses on a vertical slice: mock + mGBA backends, Control API, Electron shell, Hermes chat proxy, Professor skill, Nudge/Drive, savestates, and Resume Run.

## Prerequisites

- **Node.js 22+**
- **Local Hermes gateway** (OpenAI-compatible) reachable for chat — default `http://127.0.0.1:8642`
- A **legal Pokémon FireRed** `.gba` ROM you already own (user-supplied only)
- Windows (primary Alpha target); Electron + mGBA sidecar

Optional env for Hermes:

| Variable | Default |
|----------|---------|
| `HERMES_BASE_URL` | `http://127.0.0.1:8642` |
| `HERMES_API_KEY` | _(empty)_ |
| `HERMES_MODEL` | `hermes-agent` |

## Legal: no ROMs

This project **does not ship, download, or host ROMs**. You must provide your own legally obtained FireRed dump. Do not commit ROM files. Skills and agents must not invent ROM paths or fetch dumps.

## Quick start (agent-first)

1. Install and run local Hermes gateway (`hermes gateway` — see Hermes docs).
2. `npm install`
3. `npm run dev:web` and `npm run dev:electron`
4. **Connect Hermes** in the gate (Retry / Open docs if offline).
5. In chat: **Load FireRed ROM…** → **Start game**
6. Watch Live view; coach in chat; Nudge/Drive only if the agent is stuck.

Legal: provide your own FireRed `.gba`. The app never ships ROMs.

```bash
npm install
npm run dev:web          # Next.js UI on http://localhost:3848
npm run dev:electron     # build electron → launch studio (Control API + UI)
npm test                 # Vitest unit/integration suite
npm run typecheck
npm run build:electron
```

## Control API

- **Bind:** `http://127.0.0.1:7946` (localhost only)
- **Version:** `0.1.0` (see `GET /health`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Ready check, mode, `rom_loaded`, run id |
| GET | `/state` | Partial FireRed state (alpha may be stub/`null`) |
| GET | `/snapshot` | Latest PNG as base64 + `age_ms` (no capture) |
| POST | `/snapshot` | Force fresh capture; returns same shape |
| GET/PUT | `/snapshot/config` | `{ interval_ms }` — default 0; clamp 50–10000 |
| GET | `/frame` | Studio live buffer-read (prefer `/snapshot` for agent vision) |
| POST | `/input` | `{ "buttons": [...] }` max 5; **agent** mode only |
| GET/POST | `/mode` | `agent` \| `nudge` \| `drive` |
| POST | `/save` / `/load` | Savestate by name |
| GET | `/saves` | List savestate names |

In **nudge** or **drive**, `POST /input` returns **409** (agent tools frozen).

## Hermes skill

Repo skill (install into your Hermes skills tree):

```
skills/pokemon-professor/SKILL.md
```

Copy or symlink that folder into Hermes’s skills directory so the agent can coach FireRed via the Control API. The skill documents observe → short input → vision loop, 409 handling, and legal ROM rules.

## Project layout (high level)

- `electron/` — main process, Control API, emulator backends, run store
- `app/`, `components/`, `lib/` — Next.js studio UI + Hermes proxy helpers
- `skills/pokemon-professor/` — official Control API skill
- `tests/` — Vitest contracts (mode machine, Control API, mock/mGBA, Hermes, skill)
- `docs/superpowers/` — design, plan, Alpha checklist

## Alpha acceptance

See [docs/superpowers/plans/alpha-checklist.md](docs/superpowers/plans/alpha-checklist.md). Alpha is done when the full checklist passes on an engineer machine (unit tests automated; live app/mGBA/Hermes items manual).
