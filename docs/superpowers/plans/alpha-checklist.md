# Alpha acceptance checklist

**Product:** Pokemon Professor (Alpha A vertical slice)  
**Date:** 2026-07-17  
**Machine:** engineer Windows workspace (`alpha-a` worktree)

Alpha is **done** when every row is **Pass** on an engineer machine. Automated checks are filled from CI/local `npm test`; remaining rows require a live studio session (mock and/or real FireRed + Hermes).

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| 1 | `npm test` all unit/integration pass | **Pass** | 2026-07-21: `vitest run` — **9 files, 43 tests passed** |
| 2 | App starts on Windows | **Pass** | Next `:3848` + Electron Control API `:7946` |
| 3 | mGBA download or mock path works | **Pass** | mGBA 0.10.5 downloaded; mock smoke 15/15; live FireRed bridge smoke 4/4 + attach Control API 13/13 |
| 4 | Load FireRed (real) or mock ROM path | **Pass** | Real ROM: `.local-roms/PokemonFireRed.gba`; mGBA running `POKEMON FIRE` |
| 5 | Live frames visible | **Pass** | Real FireRed PNG via bridge (`scripts/last-firered-frame.png`); GUI live view still optional eyeball |
| 6 | Hermes chat message round-trip | **Pass** | Proxy 200 → `READY` / `PONG` |
| 7 | Skill or curl `POST /input` moves game | **Pass** | Real FireRed: `POST /input` A + sequential RIGHT/RIGHT/UP; skill installed |
| 8 | Nudge blocks input (409) | **Pass** | Mock + real attach Control API |
| 9 | Drive human control works | **Pass** | Mode gate 409 on real attach + `tests/drive-keys.test.ts` (7 cases: arrow/Z/X/Enter/Shift map, Escape→agent, agent/nudge gate, unmapped none). Keyboard→`driveInput` IPC via `lib/drive-keys.ts` resolver. |
| 10 | Savestate save/load/resume | **Pass** | Real mGBA: save/load `alpha_test.ss0` via bridge |

## Automated test record

```
> npm test
> vitest run

Test Files  9 passed (9)
     Tests  43 passed (43)

> node scripts/alpha-mock-smoke.cjs
SUMMARY 15/15 passed
```

See also `docs/superpowers/plans/alpha-test-log.md`.

## Manual verification hints

```bash
# Health (studio running)
curl -s http://127.0.0.1:7946/health

# Agent input (mode must be agent, ROM loaded)
curl -s -X POST http://127.0.0.1:7946/input \
  -H "content-type: application/json" \
  -d "{\"buttons\":[\"A\"]}"

# After Nudge in UI — expect 409
curl -s -o - -w "\n%{http_code}\n" -X POST http://127.0.0.1:7946/input \
  -H "content-type: application/json" \
  -d "{\"buttons\":[\"A\"]}"
```

Skill source: `skills/pokemon-professor/SKILL.md` · Control API base: `http://127.0.0.1:7946`.

## Status summary

| Automated | Manual (2–10) | Alpha ship bar |
|-----------|---------------|----------------|
| **Pass** (item 1) | Pending engineer machine | Not complete until 2–10 Pass |

Mark rows 2–10 **Pass** only after exercising them on the engineer machine with mock and/or legal FireRed + Hermes as appropriate.

## Agent-first MVP checklist (Task 10)

Manual script for the agent-first studio gate. Run with Hermes gateway up, `npm run dev:web` + `npm run dev:electron`.

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| A1 | Gate blocks without Hermes | _manual_ | Offline gate; Retry / Open docs |
| A2 | Open docs works | _manual_ | Docs link from gate |
| A3 | Connect succeeds | _manual_ | Hermes online → studio unlocks |
| A4 | Welcome + ROM CTA | _manual_ | Chat: Load FireRed ROM… |
| A5 | Start game → frames + mode agent | _manual_ | Live view; mode agent |
| A6 | Chat kickoff | _manual_ | Coach message / agent start |
| A7 | Nudge → input 409 | _manual_ | Agent tools frozen while Nudge |
| A8 | Drive → keys work → back to agent | _manual_ | Drive keys; Escape → agent |

**Automated (2026-07-31 Task 10):** `npm test` — **14 files, 76 tests passed** (unit + e2e; e2e ran when fork available).
