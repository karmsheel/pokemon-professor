# mGBA backend — manual checklist

Automated CI does **not** run real mGBA (no display / no ROM). Use this checklist on a Windows machine with a legal FireRed dump.

**Never commit ROMs.**

## Prerequisites

- Windows 10/11
- 7-Zip installed (for first-run download of the official `.7z` portable build), or place `mGBA.exe` manually under Electron `userData/mgba/`
- Your own Pokémon FireRed `.gba` ROM
- Studio running:
  1. `npm run dev:web`
  2. `npm run build:electron`
  3. `$env:PP_EMULATOR="mgba"; $env:PP_DEV_URL="http://127.0.0.1:3848"; npx electron .`

Force mock anytime with `PP_EMULATOR=mock`. Unset + no binary → mock by default.

## Checklist

### 1. Download mGBA via app

- [ ] In Run rail, click **Download mGBA** (or confirm “mGBA ready”)
- [ ] Progress finishes without checksum error
- [ ] `userData/mgba/mGBA.exe` exists (Electron userData path from `studio:getPaths` → `mgba`)

Pinned release: **mGBA 0.10.5 win64**  
URL: `https://github.com/mgba-emu/mgba/releases/download/0.10.5/mGBA-0.10.5-win64.7z`  
SHA256: `b497a57c7d9093834dadc64f33a90f7c411439c21fdb8a0143255a45ea37563a`

### 2. Load FireRed

- [ ] **Pick ROM** → select your FireRed `.gba`
- [ ] **Start Run**
- [ ] mGBA window opens with the game

### 3. Load Lua bridge (required on mGBA 0.10.x)

mGBA 0.10 has **no CLI script autoload** ([issue #3289](https://github.com/mgba-emu/mgba/issues/3289)).

- [ ] In mGBA: **Tools → Scripting…**
- [ ] **File → Load script…**
- [ ] Choose `electron/emulator/mgba-bridge.lua` (path also shown in Run rail)
- [ ] Console shows: `[pp-bridge] listening on 127.0.0.1:7947`
- [ ] Studio finishes waiting (run starts; health updates)

### 4. Frame shows game screen

- [ ] Live view shows the GBA framebuffer (not a solid mock pixel forever)
- [ ] `curl http://127.0.0.1:7946/frame` returns PNG base64 with `width: 240`, `height: 160`

### 5. Drive: move character

- [ ] Click **Drive**
- [ ] Arrow keys / face buttons move the player (or advance menus)
- [ ] `POST /input` while in agent mode still works for agent path; Drive uses IPC

### 6. Save / load savestate

- [ ] Savestate name e.g. `pre_drive` → **Save**
- [ ] Move character
- [ ] **Load** → position restores
- [ ] Files under `userData/runs/<runId>/saves/*.ss0`

### 7. Health reports mGBA

```powershell
curl http://127.0.0.1:7946/health
```

- [ ] JSON includes `"emulator":"mgba"` and `"rom_loaded":true`

## Bridge protocol smoke (optional)

With bridge loaded, from PowerShell / any TCP client:

```text
{"cmd":"ping"}           → {"ok":true,"pong":true}
{"cmd":"frame"}          → {"ok":true,"width":240,"height":160,"png_base64":"..."}
{"cmd":"input","buttons":["A"]} → {"ok":true,"executed":["A"]}
```

Control API remains on **7946**; bridge TCP is **7947**.

## Failure modes (expected clear errors)

| Situation | Expected |
|-----------|----------|
| No mGBA binary, `PP_EMULATOR=mgba` | createRun error → download first |
| Checksum mismatch | download throws; archive deleted |
| 7-Zip missing | extract error mentions install / `SEVEN_ZIP_PATH` |
| Script not loaded within 60s | start fails with path to `mgba-bridge.lua` |
| Bridge port in use | Lua console bind error |

## Dev defaults

| `PP_EMULATOR` | Binary present | Backend |
|---------------|----------------|---------|
| unset | no | mock |
| unset | yes | mgba |
| `mock` | * | mock |
| `mgba` | * | mgba (must download if missing) |
