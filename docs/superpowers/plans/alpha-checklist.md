# Alpha acceptance checklist

**Product:** Pokemon Professor (Alpha A vertical slice)  
**Date:** 2026-07-17  
**Machine:** engineer Windows workspace (`alpha-a` worktree)

Alpha is **done** when every row is **Pass** on an engineer machine. Automated checks are filled from CI/local `npm test`; remaining rows require a live studio session (mock and/or real FireRed + Hermes).

| # | Check | Pass? | Notes |
|---|--------|-------|-------|
| 1 | `npm test` all unit/integration pass | **Pass** | 2026-07-17: `vitest run` — **8 files, 33 tests passed** (~1s) |
| 2 | App starts on Windows | **Manual** | Engineer: `npm run dev:web` / `npm run dev:electron`; window + Control API |
| 3 | mGBA download or mock path works | **Manual** | First-run mGBA into user-data **or** mock backend without binary |
| 4 | Load FireRed (real) or mock ROM path | **Manual** | User legal `.gba` or any path for mock (content ignored) |
| 5 | Live frames visible | **Manual** | Live view shows frame stream / frame_id updates |
| 6 | Hermes chat message round-trip | **Manual** | Gateway up; chat bar → proxy → reply (or clear unavailable error) |
| 7 | Skill or curl `POST /input` moves game | **Manual** | Agent mode; buttons applied on mock or mGBA |
| 8 | Nudge blocks input (409) | **Manual** | Mode `nudge` → `POST /input` → **409**; Resume → agent again |
| 9 | Drive human control works | **Manual** | Drive keys move game; Escape / Return to Agent → agent |
| 10 | Savestate save/load/resume | **Manual** | Save name → load; Resume Run loads last savestate if present |

## Automated test record

```
> npm test
> vitest run

Test Files  8 passed (8)
     Tests  33 passed (33)
```

Covered suites include: mode machine, Control API, mock backend, mGBA download + TCP backend smoke, run store, Hermes proxy, skill protocol (observe → input → nudge 409 → resume).

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
