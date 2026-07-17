# Pokemon Professor — Design Spec

**Date:** 2026-07-17  
**Status:** Draft for user review  
**Product:** Local Agent Emulator Studio (v1 phase)  
**Release strategy:** Spec targets **Beta B (Coach Studio)**; implement **Alpha A (vertical slice)** first.

---

## 1. Problem & thesis

Older-generation Pokémon fans and agent builders need a better loop than “Hermes terminal + headless pokeplayer.” **Pokemon Professor** casts the user as Professor Oak: they coach an AI disciple (Hermes Agent) that plays Pokémon FireRed inside a real emulator, with a live view, non-techy chat, and human rescue when the agent gets stuck.

**Core thesis:** The product is a **studio harness** (emulator control plane + coach UX), not another agent framework. Users bring Hermes and pay their own model costs. Online leaderboards, credits, tournaments, and custom harnesses come later; the Control API is designed so they can plug in without rewriting the studio.

**Inspiration / prior art:**

- Hermes optional skill [pokemon-player](https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/gaming/gaming-pokemon-player) (`pokemon-agent` / PyBoy) — gameplay loop patterns, not the runtime we ship.
- [hermes-forge](https://github.com/karmsheel/hermes-forge) — Electron + Next + local Hermes chat proxy and global chat bar patterns (inspired, not forked).
- Nous issue #418 (play history dashboard) — live monitoring UX lessons.

---

## 2. Goals & non-goals

### Goals (this phase)

1. Ship a **desktop Local Agent Studio** where a human coaches Hermes through FireRed.
2. **Native mGBA** as the emulator (sidecar), with live frames in-app.
3. **Local Hermes required** — BYO-Hermes / BYOK; studio proxies chat.
4. **Coach / mission-giver** workflow with structured missions and (Beta) FireRed templates.
5. **Layered override:** Nudge (re-prompt) and Drive (human controls emulator).
6. Stable **HTTP Control API** owned by the studio; official Hermes skill is a client.
7. **Runs + savestates + autosave (Beta)** so long sessions are recoverable.
8. Legal hygiene: **user-supplied ROM only**; first-run **mGBA download** with consent and checksum.

### Non-goals (explicitly out of this phase)

| Out of scope | Notes |
|--------------|--------|
| Online accounts / control panel | Future “who’s playing” site |
| Paid credits / marketplace | Efficiency economy later |
| Tournaments / hackathon infra | After play loop is loved |
| Blockchain | Deferred; not required for studio |
| Multi-game support | FireRed only |
| pokemon-agent / PyBoy as primary backend | May inform skill tips only |
| In-process libmGBA embed | Later upgrade path from sidecar |
| Hard dollar/token budgets | Best-effort Hermes usage display only |
| Custom non-Hermes harness UX | API stays harness-ready; no multi-runtime UI yet |
| Shipping or downloading ROMs | Never |

---

## 3. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | V1 product | Local Agent Studio only |
| 2 | Emulator | Native mGBA |
| 3 | Integration | Sidecar + frame stream + input IPC (embed later) |
| 4 | Agent runtime | Local Hermes required |
| 5 | Human role | Coach / mission-giver |
| 6 | Game | Pokémon FireRed only; user ROM |
| 7 | App shell | Greenfield Electron + Next.js, forge-inspired (not a fork) |
| 8 | Override | Nudge + Drive |
| 9 | Missions | Structured objects + freeform + FR template pack (Beta) |
| 10 | Control plane | Studio HTTP Control API + Hermes skill |
| 11 | Observation | Frame-first; `FireRedState` stub → B-lite |
| 12 | Persistence | Run + savestates + autosave policy (Beta) |
| 13 | Cost | Best-effort from Hermes if exposed |
| 14 | mGBA install | Download on first run into user-data |
| 15 | Ship bar | Spec = Beta B; implement Alpha A first |
| 16 | Build approach | Vertical-slice first |

---

## 4. Personas & core loop

**Professor (user):** Writes missions, watches live play, Nudges strategy, Drives out of softlocks, manages saves.

**Disciple (Hermes + skill):** Observes frame/state, issues short input sequences via Control API, follows mission text.

**Happy path:**

1. Open studio → mGBA ready → load FireRed ROM → create Run.  
2. Assign mission (chat or template).  
3. Agent plays; frames stream continuously.  
4. On stuck: Nudge or Drive.  
5. Savestate / resume another day.

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Pokemon Professor (Electron + Next.js studio)              │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────┐  │
│  │ Live View    │  │ Global Chat │  │ Run / Mission UI   │  │
│  │ (frames)     │  │ (Hermes)    │  │ Override Nudge/Drive│ │
│  └──────┬───────┘  └──────┬──────┘  └─────────┬──────────┘  │
│         │                 │                    │             │
│  ┌──────┴─────────────────┴────────────────────┴──────────┐ │
│  │  Studio Core                                           │ │
│  │  • Hermes proxy → localhost:8642 (configurable)        │ │
│  │  • Control API (HTTP, localhost) — source of truth     │ │
│  │  • Run / Mission / Savestate store                     │ │
│  │  • mGBA Supervisor (download, spawn, IPC, autosave)    │ │
│  └──────────────────────────┬─────────────────────────────┘ │
└─────────────────────────────┼───────────────────────────────┘
                              │ frames + input + savestates
                    ┌─────────▼─────────┐
                    │  mGBA sidecar     │
                    │  (user-data bin)  │
                    │  FireRed.gba      │  ← user-supplied ROM
                    └───────────────────┘

┌─────────────────────┐     HTTP tools      ┌──────────────────┐
│  Hermes Agent       │ ─────────────────► │  Control API     │
│  + Professor skill  │                     │  /frame /state   │
│  (user's gateway)   │                     │  /input /save…   │
└─────────────────────┘                     └──────────────────┘
```

### Principles

1. **Studio owns emulator and run state.** Hermes never talks to mGBA directly.  
2. **Control API is the stable contract** for Alpha, Beta, and future harnesses.  
3. **Sidecar isolation:** mGBA crash does not take down the studio.  
4. **Coach loop over turn-by-turn babysitting.**  
5. **Legal:** no ROM distribution; mGBA fetch only with consent + checksum.

### Process model

| Process | Role |
|---------|------|
| Electron main | Window lifecycle, user-data paths, mGBA supervisor, Control API host (or colocated server) |
| Next.js renderer | Live view, chat, missions, override UI |
| mGBA child | Emulation only |
| Hermes gateway | External, user-managed |

---

## 6. Components

### 6.1 Studio shell

- Single-window Electron app wrapping Next.js (forge-inspired packaging and chat chrome).  
- Layout (conceptual): live game center; global Hermes chat; side rail for Run, mission, override, savestates.  
- Data lives in Electron user-data directory.

### 6.2 mGBA supervisor

- First-run download of official mGBA build into user-data after consent; verify checksum.  
- Fallback: user can point at a local mGBA binary if download fails.  
- Spawn/stop; ROM path; savestate directory per Run.  
- Frame pipeline into UI; input injection from Control API and Drive mode.  
- Crash detection, status surfacing, restart without losing Run metadata.  
- Attribution / license notes for mGBA in About and docs.

### 6.3 Control API (HTTP, localhost only)

Canonical agent-facing surface. Version advertised on `GET /health` as `api_version`.

| Area | Conceptual routes | Alpha | Beta |
|------|-------------------|-------|------|
| Health | `GET /health` | ✓ | ✓ |
| Frame | `GET /frame` | ✓ | ✓ |
| State | `GET /state` → partial `FireRedState` or nulls | stub | B-lite |
| Input | `POST /input` short button sequences | ✓ | ✓ |
| Mode | `GET/POST /mode` → `agent` \| `nudge` \| `drive` | ✓ | ✓ |
| Save | `POST /save`, `POST /load`, `GET /saves` | ✓ | ✓ + autosave |
| Runs / missions | CRUD under `/runs` | minimal | full + templates |
| Events | Append-only log | thin | timeline UI |

**Mode rules:**

- `agent`: skill may `POST /input`.  
- `nudge` / `drive`: `POST /input` returns **409** with current mode; agent must wait.  
- Input batches stay short; re-observe after few actions (pokeplayer discipline).

### 6.4 Hermes integration

- Chat proxy to local gateway (default `http://localhost:8642`), key/CORS patterns analogous to hermes-forge.  
- Official **Pokemon Professor** skill documents Control API usage and FireRed coaching tips.  
- Usage display: best-effort if gateway exposes tokens/model; never block play if absent.

### 6.5 Run / Mission engine

**Run:** `id`, ROM path (local), `created_at`, `status`, savestates[], missions[], events[].

**Mission:** `id`, `prompt`, `source` (`template` | `freeform`), `status` (`active` | `paused` | `done` | `aborted`), timestamps.

**Templates (Beta):** FireRed pack (examples: leave Pallet / starter arc, parcel delivery arc, prep for Brock / first gym). One-click assign; prompt still editable.

### 6.6 Override controller

- **Nudge:** mode=`nudge` → freeze agent input → human re-missions via chat → Resume → `agent`.  
- **Drive:** mode=`drive` → keyboard/gamepad to mGBA; chat does not steal game keys while Drive focused → Return to Agent.  
- Beta: autosave before entering Drive.

### 6.7 Observation (`FireRedState`)

```text
FireRedState (fields optional until implemented)
  map_id?, map_name?
  x?, y?
  party[]?: { species?, level?, hp?, max_hp?, status? }
  in_battle?: boolean
  badges?: bitfield | count
  money?
```

Alpha: primarily frames; state mostly null. Beta: fill B-lite via mGBA memory/script hooks without breaking clients when fields appear.

---

## 7. Alpha A vs Beta B

| Capability | Alpha A (build first) | Beta B (public “v1” / spec target) |
|------------|------------------------|-------------------------------------|
| Platform | Windows focus | Windows polished; macOS backlog |
| mGBA | First-run download + sidecar | Same + robust fail/fallback UX |
| ROM | User picks FireRed | Same + clear legal copy in UI |
| Live view | Working frames | Smooth reconnect / status |
| Hermes chat | Global bar + proxy | Connection status UX |
| Agent control | Skill + `/input` + `/frame` | + richer `/state` |
| Override | Nudge + Drive | + autosave-before-Drive |
| Missions | Freeform + one demo path | Full FR template pack + freeform |
| Runs | Create/resume + savestate | Timeline, autosave policy, summary |
| Usage | If Hermes provides | Same, non-blocking |
| FireRedState | Stub | Partial map/party/battle/badges |

**Alpha success criteria:** Load FR → live view → Hermes moves character via API → Nudge works → Drive works → savestate → resume Run.

**Beta success criteria:** Same loop feels product-ready: templates teach coaching, partial state reduces vision thrash, autosave protects long sessions.

---

## 8. Data flows

### First run

1. Install/open app.  
2. Consent to download mGBA → checksum → ready (or manual binary path).  
3. Select local FireRed ROM.  
4. Optionally verify Hermes; degrade chat if down.  
5. Create Run → spawn mGBA → frames.

### Coach loop

1. Start mission (freeform or template).  
2. mode=`agent`.  
3. Skill: observe → act (short) → verify; repeat.  
4. UI streams frames continuously.

### Nudge / Drive / Save

As in component rules above; all transitions append to Run event log.

### Mission completion (v1)

Professor marks mission done, or starts a new mission. **Alpha does not require automatic story-milestone detection.** Beta may add optional heuristics later; not a launch blocker.

---

## 9. Error handling

| Failure | Behavior |
|---------|----------|
| mGBA download fail | Retry + pick local binary; app remains usable for non-emulation screens |
| Checksum mismatch | Discard binary; refuse run; clear error |
| mGBA crash | Banner + restart; preserve Run; offer last savestate |
| Bad/missing ROM | Re-pick file; no crash loop |
| Hermes down | Chat guidance; Drive/emulator still work |
| Input while nudge/drive | HTTP 409 + mode |
| Frame stall | “No signal” + healthcheck + restart path |
| Savestate fail | Explicit error; never silent success |
| Skill/API mismatch | `/health.api_version`; skill documents required version |

---

## 10. Security & legal

- Control API binds **localhost only** by default.  
- ROM paths stay local; no ROM bytes in analytics/logs destined for network (no network product yet).  
- mGBA obtained under upstream license terms; document in About.  
- No Professor cloud account required in this phase.  
- User responsible for legal right to their FireRed ROM dump.

---

## 11. Testing strategy

### Alpha gates

- Unit: mode machine; 409 when not agent; mission/run transitions.  
- Integration: supervisor + Control API smoke (`/health`, `/input`, `/frame`).  
- Manual E2E checklist: download/cached mGBA, ROM load, frames, Hermes press, Nudge, Drive, savestate, resume.  
- Skill against mock Control API: observe → act → handle 409.

### Beta gates

- Template load/create mission.  
- Autosave triggers + load round-trip.  
- FireRedState parsers where hooks exist; ignore unknown fields.  
- UI connection + optional usage display.

### Not CI gates

- Full badge runs, model quality, broad OS matrix.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| mGBA frame/input IPC harder than expected | Spike frames+input before UI polish (vertical slice) |
| Vision-only thrash / cost | State stub early; prioritize B-lite after Alpha |
| Hermes API variance | Thin proxy; optional usage |
| Scope creep (league, chain, multi-ROM) | Non-goals table; refuse until studio loop is fun |
| ROM legal confusion | Explicit UI copy: user must own ROM; we never provide one |

---

## 13. Future phases (out of spec detail)

Ordered only as intent, not commitments:

1. **Online run logging + control panel** (opt-in account).  
2. **Richer metering** for efficiency stats.  
3. **Tournaments** (least prompts / complexity / $).  
4. **Open Control API** for custom agent harnesses.  
5. **In-process mGBA embed** if sidecar UX is insufficient.  
6. Additional games via new state packs.  
7. Blockchain only if a concrete hackathon proof/prize design needs it.

---

## 14. Implementation sequence (guidance for plan)

Follow **vertical-slice first**:

1. Repo scaffold: Electron + Next, user-data paths.  
2. mGBA supervisor spike: download or pin binary, spawn, **frame + input**.  
3. Control API: health, frame, input, mode, save/load.  
4. Live view + Drive mode.  
5. Hermes proxy + global chat + Professor skill.  
6. Nudge + minimal Run/mission + savestate resume.  
7. **Alpha checklist complete.**  
8. Beta: templates, autosave policy, FireRedState B-lite, polish, usage display.

Detailed task breakdown belongs in the implementation plan (writing-plans), not this spec.

---

## 15. Success metrics (qualitative for v1)

- A non-terminal user can coach an agent for a meaningful FireRed segment without using Hermes CLI.  
- Override recovers from stuck states without restarting the app.  
- Runs survive overnight via savestates.  
- Control API is documented enough that a second client could drive the emulator.

---

## 16. Open implementation choices (deferred to plan / spikes)

These do not block the product design:

- Exact mGBA IPC mechanism (Lua socket, debugger protocol, wrapper binary, etc.).  
- Frame transport (shared memory vs encoded frames over localhost).  
- SQLite vs JSON files for Run store in Alpha (Beta may standardize on SQLite).  
- Precise FireRed memory map sources for B-lite fields.

---

**End of design spec.**  
Next step after user approval: invoke **writing-plans** to produce an implementation plan starting with Alpha A.
