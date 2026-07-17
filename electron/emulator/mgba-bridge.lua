-- Pokemon Professor mGBA bridge
-- Protocol: line-delimited JSON over TCP on 127.0.0.1:7947
-- Load via: Tools → Scripting → File → Load script… (mGBA 0.10.x has no CLI script flag yet)
--
-- Commands: ping | frame | input | save | load

local BRIDGE_HOST = "127.0.0.1"
local BRIDGE_PORT = 7947
local HOLD_FRAMES = 12

-- Isolate API lookups so version drift fails with clear errors.
local API = {}

function API.core()
  if emu then return emu end
  error("emu core not available (is a ROM loaded?)")
end

function API.keyIndex(name)
  local upper = string.upper(tostring(name or ""))
  if C and C.GBA_KEY and C.GBA_KEY[upper] ~= nil then
    return C.GBA_KEY[upper]
  end
  -- Fallback indices from mGBA docs (GBA_KEY)
  local map = {
    A = 0, B = 1, SELECT = 2, START = 3,
    RIGHT = 4, LEFT = 5, UP = 6, DOWN = 7,
    R = 8, L = 9,
  }
  if map[upper] ~= nil then return map[upper] end
  error("unknown button: " .. tostring(name))
end

function API.saveFlags()
  if C and C.SAVESTATE and C.SAVESTATE.ALL ~= nil then
    return C.SAVESTATE.ALL
  end
  return 31
end

function API.loadFlags()
  -- Default load flags from docs (29)
  return 29
end

-- ---------- minimal JSON helpers (responses + command parse) ----------

local function json_escape(s)
  s = tostring(s)
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  return s
end

local function json_encode(value)
  local t = type(value)
  if value == nil then
    return "null"
  elseif t == "boolean" then
    return value and "true" or "false"
  elseif t == "number" then
    return tostring(value)
  elseif t == "string" then
    return '"' .. json_escape(value) .. '"'
  elseif t == "table" then
    local is_array = true
    local n = 0
    for k, _ in pairs(value) do
      n = n + 1
      if type(k) ~= "number" then
        is_array = false
        break
      end
    end
    if is_array then
      local parts = {}
      for i = 1, #value do
        parts[i] = json_encode(value[i])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      for k, v in pairs(value) do
        parts[#parts + 1] = '"' .. json_escape(k) .. '":' .. json_encode(v)
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return '""'
end

-- Very small JSON decoder for our command shapes only.
local function json_decode(str)
  local i = 1
  local s = str

  local function skip_ws()
    while true do
      local c = s:sub(i, i)
      if c == " " or c == "\t" or c == "\n" or c == "\r" then
        i = i + 1
      else
        break
      end
    end
  end

  local parse_value

  local function parse_string()
    if s:sub(i, i) ~= '"' then error("expected string") end
    i = i + 1
    local out = {}
    while i <= #s do
      local c = s:sub(i, i)
      if c == '"' then
        i = i + 1
        return table.concat(out)
      elseif c == "\\" then
        local n = s:sub(i + 1, i + 1)
        local map = { n = "\n", r = "\r", t = "\t", ['"'] = '"', ["\\"] = "\\" }
        out[#out + 1] = map[n] or n
        i = i + 2
      else
        out[#out + 1] = c
        i = i + 1
      end
    end
    error("unterminated string")
  end

  local function parse_number()
    local j = i
    while s:sub(j, j):match("[%d%+%-%.eE]") do j = j + 1 end
    local n = tonumber(s:sub(i, j - 1))
    if not n then error("bad number") end
    i = j
    return n
  end

  local function parse_array()
    i = i + 1 -- [
    local arr = {}
    skip_ws()
    if s:sub(i, i) == "]" then
      i = i + 1
      return arr
    end
    while true do
      arr[#arr + 1] = parse_value()
      skip_ws()
      local c = s:sub(i, i)
      if c == "]" then
        i = i + 1
        return arr
      elseif c == "," then
        i = i + 1
        skip_ws()
      else
        error("expected , or ]")
      end
    end
  end

  local function parse_object()
    i = i + 1 -- {
    local obj = {}
    skip_ws()
    if s:sub(i, i) == "}" then
      i = i + 1
      return obj
    end
    while true do
      skip_ws()
      local key = parse_string()
      skip_ws()
      if s:sub(i, i) ~= ":" then error("expected :") end
      i = i + 1
      skip_ws()
      obj[key] = parse_value()
      skip_ws()
      local c = s:sub(i, i)
      if c == "}" then
        i = i + 1
        return obj
      elseif c == "," then
        i = i + 1
      else
        error("expected , or }")
      end
    end
  end

  parse_value = function()
    skip_ws()
    local c = s:sub(i, i)
    if c == '"' then
      return parse_string()
    elseif c == "{" then
      return parse_object()
    elseif c == "[" then
      return parse_array()
    elseif c == "t" and s:sub(i, i + 3) == "true" then
      i = i + 4
      return true
    elseif c == "f" and s:sub(i, i + 4) == "false" then
      i = i + 5
      return false
    elseif c == "n" and s:sub(i, i + 3) == "null" then
      i = i + 4
      return nil
    elseif c:match("[%d%-]") then
      return parse_number()
    end
    error("unexpected token at " .. i)
  end

  local ok, result = pcall(parse_value)
  if not ok then error("json parse failed: " .. tostring(result)) end
  return result
end

-- ---------- base64 (for PNG frames) ----------

local b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

local function base64_encode(data)
  local out = {}
  local len = #data
  local i = 1
  while i <= len do
    local a = data:byte(i) or 0
    local b = data:byte(i + 1) or 0
    local c = data:byte(i + 2) or 0
    local n = a * 65536 + b * 256 + c
    local remaining = len - i + 1
    local c1 = math.floor(n / 262144) % 64 + 1
    local c2 = math.floor(n / 4096) % 64 + 1
    local c3 = math.floor(n / 64) % 64 + 1
    local c4 = n % 64 + 1
    if remaining == 1 then
      out[#out + 1] = b64chars:sub(c1, c1) .. b64chars:sub(c2, c2) .. "=="
    elseif remaining == 2 then
      out[#out + 1] = b64chars:sub(c1, c1) .. b64chars:sub(c2, c2) .. b64chars:sub(c3, c3) .. "="
    else
      out[#out + 1] = b64chars:sub(c1, c1) .. b64chars:sub(c2, c2) .. b64chars:sub(c3, c3) .. b64chars:sub(c4, c4)
    end
    i = i + 3
  end
  return table.concat(out)
end

-- ---------- key hold queue ----------

local keyEventQueue = {}

local function enqueue_buttons(mask, duration)
  local core = API.core()
  local startFrame = core:currentFrame()
  table.insert(keyEventQueue, {
    keyMask = mask,
    startFrame = startFrame,
    endFrame = startFrame + (duration or HOLD_FRAMES),
    pressed = false,
  })
end

local function update_keys()
  if not emu then return end
  local indexesToRemove = {}
  local frame = emu:currentFrame()
  for index, ev in ipairs(keyEventQueue) do
    if frame >= ev.startFrame and frame <= ev.endFrame and not ev.pressed then
      emu:addKeys(ev.keyMask)
      ev.pressed = true
    elseif frame > ev.endFrame then
      emu:clearKeys(ev.keyMask)
      table.insert(indexesToRemove, index)
    end
  end
  for i = #indexesToRemove, 1, -1 do
    table.remove(keyEventQueue, indexesToRemove[i])
  end
end

if callbacks and callbacks.add then
  callbacks:add("frame", update_keys)
end

local function buttons_to_mask(buttons)
  local mask = 0
  local executed = {}
  for _, name in ipairs(buttons or {}) do
    local idx = API.keyIndex(name)
    mask = mask | (1 << idx)
    executed[#executed + 1] = string.upper(tostring(name))
  end
  return mask, executed
end

local function frame_temp_path()
  local tmp = os.getenv("TEMP") or os.getenv("TMP") or "."
  tmp = tmp:gsub("\\", "/")
  return tmp .. "/pp-mgba-frame.png"
end

-- ---------- command handlers ----------

local function handle_ping(_msg)
  return { ok = true, pong = true }
end

local function handle_frame(_msg)
  local core = API.core()
  local path = frame_temp_path()
  if not core.screenshot then
    return { ok = false, error = "screenshot API missing on this mGBA build" }
  end
  core:screenshot(path)
  local f = io.open(path, "rb")
  if not f then
    return { ok = false, error = "screenshot file not readable: " .. path }
  end
  local data = f:read("*a")
  f:close()
  if not data or #data == 0 then
    return { ok = false, error = "screenshot empty: " .. path }
  end
  return {
    ok = true,
    width = 240,
    height = 160,
    png_base64 = base64_encode(data),
    path = path,
  }
end

local function handle_input(msg)
  local buttons = msg.buttons or {}
  if type(buttons) ~= "table" then
    return { ok = false, error = "buttons must be an array" }
  end
  local mask, executed = buttons_to_mask(buttons)
  if #executed == 0 then
    return { ok = false, error = "no buttons provided" }
  end
  enqueue_buttons(mask, HOLD_FRAMES)
  return { ok = true, executed = executed }
end

local function handle_save(msg)
  local path = msg.path
  if not path or path == "" then
    return { ok = false, error = "path required" }
  end
  local core = API.core()
  if not core.saveStateFile then
    return { ok = false, error = "saveStateFile API missing" }
  end
  local ok = core:saveStateFile(path, API.saveFlags())
  if not ok then
    return { ok = false, error = "saveStateFile failed for " .. tostring(path) }
  end
  return { ok = true }
end

local function handle_load(msg)
  local path = msg.path
  if not path or path == "" then
    return { ok = false, error = "path required" }
  end
  local core = API.core()
  if not core.loadStateFile then
    return { ok = false, error = "loadStateFile API missing" }
  end
  local ok = core:loadStateFile(path, API.loadFlags())
  if not ok then
    return { ok = false, error = "loadStateFile failed for " .. tostring(path) }
  end
  return { ok = true }
end

local handlers = {
  ping = handle_ping,
  frame = handle_frame,
  input = handle_input,
  save = handle_save,
  load = handle_load,
}

local function handle_line(line)
  line = (line or ""):match("^(.-)%s*$") or ""
  if line == "" then return nil end
  local ok, msg = pcall(json_decode, line)
  if not ok then
    return { ok = false, error = "invalid json: " .. tostring(msg) }
  end
  if type(msg) ~= "table" or not msg.cmd then
    return { ok = false, error = "missing cmd" }
  end
  local handler = handlers[msg.cmd]
  if not handler then
    return { ok = false, error = "unknown cmd: " .. tostring(msg.cmd) }
  end
  local hok, result = pcall(handler, msg)
  if not hok then
    return { ok = false, error = tostring(result) }
  end
  return result
end

-- ---------- TCP server ----------

local server = nil
local clients = {}
local nextId = 1

local function log(msg)
  if console and console.log then
    console:log("[pp-bridge] " .. tostring(msg))
  end
end

local function log_error(msg)
  if console and console.error then
    console:error("[pp-bridge] " .. tostring(msg))
  else
    log(msg)
  end
end

local function client_stop(id)
  local sock = clients[id]
  clients[id] = nil
  if sock then
    pcall(function() sock:close() end)
  end
end

local function client_send(sock, obj)
  local line = json_encode(obj) .. "\n"
  sock:send(line)
end

local function on_client_received(id)
  local sock = clients[id]
  if not sock then return end
  sock._buffer = sock._buffer or ""
  while true do
    local chunk, err = sock:receive(4096)
    if chunk then
      sock._buffer = sock._buffer .. chunk
      while true do
        local nl = sock._buffer:find("\n", 1, true)
        if not nl then break end
        local line = sock._buffer:sub(1, nl - 1)
        sock._buffer = sock._buffer:sub(nl + 1)
        if line:sub(-1) == "\r" then
          line = line:sub(1, -2)
        end
        local response = handle_line(line)
        if response then
          local sok, serr = pcall(client_send, sock, response)
          if not sok then
            log_error("send failed: " .. tostring(serr))
            client_stop(id)
            return
          end
        end
      end
    elseif err then
      if err ~= socket.ERRORS.AGAIN then
        if err ~= "disconnected" then
          log_error("client " .. id .. " error: " .. tostring(err))
        end
        client_stop(id)
      end
      return
    else
      return
    end
  end
end

local function on_accept()
  local sock, err = server:accept()
  if err then
    log_error("accept: " .. tostring(err))
    return
  end
  local id = nextId
  nextId = id + 1
  clients[id] = sock
  sock:add("received", function() on_client_received(id) end)
  sock:add("error", function() client_stop(id) end)
  log("client " .. id .. " connected")
end

local function begin_server()
  if not socket then
    log_error("socket library missing — need mGBA 0.10+ with Lua sockets")
    return
  end
  local err
  server, err = socket.bind(BRIDGE_HOST, BRIDGE_PORT)
  if not server then
    -- Fall back to all interfaces if host-specific bind fails
    server, err = socket.bind(nil, BRIDGE_PORT)
  end
  if not server then
    log_error("bind failed on port " .. BRIDGE_PORT .. ": " .. tostring(err))
    return
  end
  local ok
  ok, err = server:listen(4)
  if err then
    log_error("listen failed: " .. tostring(err))
    pcall(function() server:close() end)
    server = nil
    return
  end
  server:add("received", on_accept)
  log("listening on " .. BRIDGE_HOST .. ":" .. BRIDGE_PORT)
end

begin_server()
