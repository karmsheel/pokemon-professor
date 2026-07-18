# Automated test log — 2026-07-18T10:12:05.6606889+02:00

## Section 0
- Node v24.15.0, npm 11.12.1
- npm test: 35/35 PASS

## Live services
- Next.js :3848 → 200
- Electron Control API :7946 → health ok (mock, no run yet)
- Hermes gateway :8642 /health → ok (v0.18.2)
- Hermes chat completions → 500 (Nous Portal: need `hermes model` re-auth)
- Next /api/hermes/chat GET health → 200
- Next /api/hermes/chat POST → 502 (upstream Hermes 500 auth)

## Mock coach-loop smoke (scripts/alpha-mock-smoke.cjs)
15/15 PASS: run, health, frame, state, mission, agent input, nudge 409, resume, drive 409, drive press, save/load/list, resume savestate, max-5

## Skill
- Installed + hermes skills list shows pokemon-professor enabled (local)

## Blocked without user
- FireRed ROM (none found on common paths)
- Hermes model provider login (`hermes model`)
- GUI: Start Run / Drive keys / visual frame in Electron (IPC only from UI)
- Real mGBA path (needs ROM + manual Lua load)

## Running processes (left up for you)
- Next dev :3848
- Electron mock with Control API :7946

## FireRed live attach (2026-07-18 later)
- Bridge loaded by user; ping/frame/input smoke 4/4
- firered-attach-smoke.cjs on :7948 → **13/13 PASS**
- Hermes proxy READY
- Savestate alpha_test.ss0 OK
- Frame snapshot: scripts/last-firered-frame.png
- Note: client N error on disconnect is benign (smoke closed sockets)
