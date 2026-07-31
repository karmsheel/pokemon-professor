# Pokemon Professor — Agent-First Studio Design

**Date:** 2026-07-31  
**Status:** Draft for user review  
**Product:** Local Agent Emulator Studio (UX product upgrade)  
**Supersedes (UX intent):** Human-first “playable emulator” framing from interim planning discussion.  
**Builds on:** [2026-07-17-pokemon-professor-design.md](./2026-07-17-pokemon-professor-design.md) (Control API, mGBA ownership, coach modes, legal ROM rules).

---

## 1. Problem & thesis

Users who want to play FireRed themselves already have many emulators. **Pokemon Professor is not competing with those.** It is an **agent-driven** FireRed experience: connect a local Hermes agent, load a user-owned ROM once, start the game from the chat experience, watch the agent play in-app, and coach through conversation.

**Core thesis:** The first-class loop is **Hermes connected → welcome → load ROM if needed → Start game → agent plays + narrates**, all inside one Studio window. No terminal, no separate mGBA window, no engineer “load the Lua bridge” step in the happy path.

Human **Nudge** and **Drive** remain as **coach rescue tools**, not the product identity.

---

## 2. Goals & non-goals

### Goals (this upgrade)

1. **Hermes hard gate on startup** — user must connect a local Hermes gateway before the main agent experience; offline state offers **Retry** and **Open Hermes docs** only (no “play offline as primary path”).
2. **Chat-led onboarding** — after connect, welcome the user, explain the coach/disciple relationship, and guide ROM load / Start game from the chat interface (with CTAs, not only free text).
3. **Start game from chat** — primary action lives in chat (button and/or recognized phrase); starts headless emulator + live view + **agent mode** by default.
4. **Agent-owned play** — once running, Hermes drives input via Control API and **occasionally** messages the user (progress, decisions, trouble) without spamming every step.
5. **Zero external apps in happy path** — no terminal; no manual mGBA; Studio owns emulator lifecycle (headless fork preferred).
6. **Remember last ROM** — if a ROM path was previously chosen and still exists, offer **Start game** without re-picking.
7. Keep **legal ROM rules**: user-supplied FireRed only; never ship or download ROMs.

### Non-goals (this upgrade)

| Out of scope | Notes |
|--------------|--------|
| Full mGBA menu parity (Tools, Scripting, debug) | Wrong product shape |
| In-process libmGBA embed | Later if sidecar packaging fails users |
| Multi-agent marketplace / non-Hermes primary UX | Hermes-first; Control API remains harness-ready |
| Shipping Hermes binary inside Studio | User installs Hermes; Studio links to it |
| Offline “play FireRed yourself” as a first-class product path | Drive remains rescue-only |
| Auto-downloading ROMs or inventing ROM paths | Hard forbid (skill + studio) |
| Online accounts / multiplayer | Unchanged deferral |

---

## 3. Locked product decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | Product identity | Agent-driven FireRed studio, not a general emulator |
| 2 | Primary agent | Local Hermes (OpenAI-compatible gateway) |
| 3 | Connect gate | **Hard gate (option 3):** must connect before main experience; UI offers **Retry** + **Open Hermes docs** only |
| 4 | Default control after Start game | **`agent` mode** |
| 5 | Where Start lives | Chat interface primary CTA (+ optional thin toolbar mirror) |
| 6 | Who loads ROM / spawns emulator | **Studio** (IPC + Control API), not Hermes tools inventing paths |
| 7 | Who plays | **Hermes** via Control API skill after `rom_loaded` |
| 8 | Human override | Nudge + Drive as rescue; return to agent when done |
| 9 | Emulator packaging | Prefer **headless mGBA fork** (auto-bridge); stock mGBA + manual Lua is Advanced / fallback only |
| 10 | Narration | Sparse: milestones, stuck, mode blocks, user questions — not every button |

---

## 4. User experience

### 4.1 Happy path (cold start)

```text
Launch Studio
  → Connect Hermes screen (hard gate)
       Test connection → success
  → Main shell: Live view (empty/placeholder) + Chat
  → Welcome turn in chat (studio-orchestrated and/or first Hermes reply)
  → If no remembered ROM path (or path missing on disk):
       CTA: [Load FireRed ROM…] → native file picker → path stored
  → Else:
       Chat: “ROM ready: <filename>. [Start game]”
  → User clicks Start game (or says “start game”)
       → Studio spawns headless emulator, loads ROM, starts capture
       → mode = agent
       → Live view shows game
       → Hermes receives session context + begins play loop
       → Occasional chat updates from agent
  → User coaches in chat; Nudge/Drive if agent stuck
```

### 4.2 Connect Hermes gate (option 3)

**When shown:** On every launch until a successful health/probe of the configured gateway, and again if the gateway drops and the user tries agent actions (Start game, chat send that needs the model).

**Fields (minimal):**

- Base URL (default `http://127.0.0.1:8642`)
- API key (optional, empty by default)
- Model id (default from env / `hermes-agent` as today)

**Actions:**

- **Test connection** / **Connect** — probe OpenAI-compatible endpoint (e.g. models list or minimal chat readiness as implemented today by proxy)
- **Retry** — re-run probe
- **Open Hermes docs** — open external URL to Hermes install/run docs (configurable constant; e.g. official Hermes agent docs)

**Not offered on the gate:** Skip, “continue offline”, “play without agent”, mock-only primary CTA.

**After success:** Persist settings (userData). Enter main shell. Show status pill: `Hermes · connected`.

**If later disconnect:** Chat send and Start game that require the agent show an inline reconnect strip (same Retry + Open docs); do not silently fall into human-emulator product mode.

### 4.3 Welcome & discussion

After connect, the user always gets a short welcome that:

1. Names the relationship (Professor / disciple).
2. States that Hermes will play FireRed; user coaches.
3. States legal ROM requirement (user must own the dump).
4. Next step: Load ROM or Start game.

Implementation note: Welcome may be a **studio system message** (deterministic, always shown) plus optional first Hermes reply, so cold start is never an empty chat if the model is slow.

### 4.4 ROM load

- Triggered by chat CTA **Load FireRed ROM…** or File-equivalent action.
- Uses existing Electron `pickRom` dialog (`.gba` only).
- Persist last successful path in userData (`lastRomPath`).
- On next launch, if file still exists, skip picker and offer Start game.
- If path missing, explain and re-prompt Load ROM.
- **Never** invent paths or download ROMs.

### 4.5 Start game

**Primary control:** Chat CTA **Start game** (also accept natural language “start”, “start game”, “let’s play” routed by UI to the same action when appropriate).

**Studio does (atomic user-facing action):**

1. Ensure Hermes still connected (else reconnect strip).
2. Ensure ROM path present and file exists.
3. Ensure headless emulator backend ready (fork preferred; download/setup errors in chat + toast).
4. `createRun` / start backend with ROM; start capture scheduler.
5. Set Control mode to **`agent`**.
6. Inject a short system/context turn for Hermes: ROM loaded, mode agent, mission if any, skill reminder (Control API base URL).
7. Optionally auto-send a user-visible kickoff: “Game started — take it from the title screen.”

**Visible result:** Live view shows frames; agent begins input loop via skill; chat is active.

### 4.6 Agent narration policy

Hermes skill / system guidance should prioritize:

| When to message user | Examples |
|----------------------|----------|
| Session start | “On the title screen — starting a new game.” |
| Clear progress | Town reached, badge, story beat |
| Trouble | Same screen 3+ attempts, 409 mode block, battle confusion |
| User asked | Answer questions about plan |
| After Nudge | Acknowledge new mission |

| When **not** to message | Examples |
|-------------------------|----------|
| Every 2–4 button batch | Silent play unless stuck |
| Pure observation chatter | “I see grass” every step |

Technical: narration uses the existing chat channel (Hermes completions), not a second bus, unless we later add structured “status events” from studio.

### 4.7 Human rescue (secondary)

- **Nudge** — freeze agent input (409), user re-prompts, resume agent.
- **Drive** — human keyboard to emulator; agent input frozen; Escape/UI returns to agent.
- Chat may expose “I’ll take over” / “You play” as mode switches via Studio (Professor owns mode; agent never `POST /mode`).

### 4.8 Menus (minimal, product-shaped)

Not mGBA parity. Suggested:

- **File:** Load ROM… · Start game · Save state · Load state · Quit  
- **Agent:** Hermes settings (re-open connect) · Connection status  
- **Help:** ROM legal notice · Open Hermes docs · Troubleshooting  

Run rail engineer details (bridge port, script path, attach bridge) move under **Advanced** or stay hidden unless `PP_DEBUG=1`.

---

## 5. Architecture

### 5.1 Unchanged ownership

```text
┌──────────────────────────────────────────────────────────┐
│ Electron Studio                                          │
│  · Hermes connect + chat proxy (existing /api/hermes)    │
│  · Control API :7946                                     │
│  · Emulator supervisor (headless fork → bridge :7947)    │
│  · Live view polls /frame or studio buffer               │
│  · Mode machine: agent | nudge | drive                   │
└───────────────┬──────────────────────────▲───────────────┘
                │ skill HTTP               │ chat proxy
                ▼                          │
         Local Hermes gateway ◄────────────┘
         (user-installed)
```

- **Studio** owns: ROM path, process spawn, modes, saves, connect gate UI.
- **Hermes** owns: reasoning, vision/state observe, `POST /input`, sparse chat narration.
- Hermes **must not** invent ROM paths or spawn mGBA outside Studio.

### 5.2 New / extended surfaces

| Surface | Role |
|---------|------|
| Connect gate UI | Hard gate; persist settings; Retry + Open docs |
| Chat CTAs | Load ROM, Start game, Resume (if run+ROM known) |
| Session bootstrap message | After Start game: context for Hermes skill loop |
| `lastRomPath` (+ optional last run id) | userData persistence |
| Hermes connection store | URL, key, model, last successful probe time |
| Status pill | Hermes connected/disconnected; rom loaded; mode |

### 5.3 Emulator path (happy path)

1. Prefer `resolveForkExe()` / packaged fork under userData.  
2. Spawn with `--agent-headless` + `--agent-bridge`.  
3. Wait for bridge; fail in chat if timeout.  
4. Stock mGBA + manual Lua: Advanced fallback only; not documented as primary UX.

### 5.4 Failure UX (chat-visible)

| Failure | User-facing |
|---------|-------------|
| Hermes unreachable | Gate or strip: Retry + Open Hermes docs |
| ROM missing | “Load your FireRed ROM to continue.” + CTA |
| Fork/binary missing | “Preparing emulator…” then clear install/download error (no terminal instructions as primary) |
| Bridge timeout | “Game didn’t start — Retry Start game” |
| Agent 409 | Agent tells user mode is nudge/drive; wait |

---

## 6. Phased delivery

### Phase A — Hermes hard gate

- Connect screen on launch; Retry + Open Hermes docs only.  
- Persist settings; status pill.  
- Chat/proxy uses stored settings.

**Exit:** Cannot enter main agent shell without successful connect; docs + retry work.

### Phase B — Chat-led onboarding

- Welcome system message after connect.  
- CTAs: Load ROM, Start game.  
- Remember last ROM path.

**Exit:** Cold start user can connect → load ROM without using engineer Run rail.

### Phase C — Start game → agent play

- Wire Start game to spawn headless + `agent` mode + capture.  
- Bundle/package fork so Start works without external mGBA.  
- Kickoff context to Hermes; skill loop can input.

**Exit:** One window: Start game shows FireRed; agent presses buttons.

### Phase D — Narration & coach polish

- Skill/prompt updates for sparse narration + stuck reporting.  
- Nudge/Drive framed as rescue in UI copy.  
- Hide Advanced emulator chrome.

**Exit:** Session feels coached; chat is not silent and not spammy.

### Phase E — Later (out of this design’s MVP)

- In-process embed; richer menus; multi-agent; resume polish beyond last ROM.

---

## 7. MVP acceptance (agent-first)

Ship the upgrade when an engineer (and then a non-terminal user) can:

1. Launch Studio → **Connect Hermes** (hard gate) succeeds against a running local gateway.  
2. If Hermes is down: only **Retry** and **Open Hermes docs** (no offline play path).  
3. See **welcome** in chat.  
4. **Load ROM** via chat CTA (or use remembered path).  
5. Click **Start game** in chat → Live view shows FireRed; no separate mGBA window.  
6. Mode is **agent**; Hermes issues Control API inputs.  
7. Agent posts at least start + stuck/progress style updates under skill policy.  
8. Nudge/Drive still block agent input (409) and can return to agent.  
9. No ROM is downloaded or shipped by the app.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Users don’t have Hermes installed | Gate copy + Open docs; never pretend agent works offline |
| Headless fork DLL/PATH fragile on Windows | Package fork + runtime deps into userData; test clean machine |
| Chat CTA vs free-text ambiguity | Primary buttons; free-text “start game” maps to same handler |
| Agent silent or spammy | Explicit narration policy in skill; Phase D tuning |
| Confusion with “another emulator” | Marketing/UI copy: agent-driven; Drive is rescue |
| Legal ROM | Existing rules; welcome + Help copy |

---

## 9. Relation to prior design

| Prior (2026-07-17) | This upgrade |
|--------------------|--------------|
| Local Agent Studio + coach | Same, stronger agent-first UX |
| Hermes required | **Enforced in UI** via hard gate |
| mGBA sidecar | Headless fork is primary packaging story |
| Nudge/Drive | Demoted to rescue in product framing |
| Run rail as control surface | Chat becomes primary control surface |
| In-process embed later | Unchanged deferral |

Control API versioning, skill hard rules (no `POST /mode`, no ROM download, max 5 buttons), and mock backend for tests remain as specified in the Alpha design unless a later plan changes them.

---

## 10. Open items (resolved for this doc)

| Item | Resolution |
|------|------------|
| Default mode after Start | `agent` |
| Hermes offline behavior | Hard gate + Retry + Open Hermes docs only |
| Start location | Chat-primary |
| Who owns emulator start | Studio |

No intentional TBDs for MVP scope above. Implementation plan should map Phases A–D to concrete tasks without expanding into full mGBA UI parity.
