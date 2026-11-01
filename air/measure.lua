-- Writes one TSV row per 10 s and a one-line summary when playback ends.
-- Runs in mpv (measure.sh) and in the shell's libmpv (--measure). Never writes the link.
-- Script opts: measure-label, measure-mode (bare|shell-hidden|shell-shown), measure-dir.
local options = require "mp.options"
local o = { label = "unlabelled", mode = "bare", dir = "" }
options.read_options(o, "measure")

local INTERVAL = 10
local NA = "unavailable"
local HEADER = "wall_s\ttime_pos\tframe_drops\tdecoder_drops\thwdec\tfps_est\tpaused_for_cache\tcpu_total_pct"
-- CPU is summed over these, so compositing cost outside the app is counted.
local CPU_NAMES = { mpv = true, ["mpv.exe"] = true, AlderProof = true,
    ["com.apple.WebKit.WebContent"] = true, WindowServer = true }

if o.dir == "" then o.dir = (os.getenv("HOME") or ".") .. "/AlderProof/results" end
mp.command_native({ name = "subprocess", args = { "mkdir", "-p", o.dir }, playback_only = false })
local stem = o.dir .. "/" .. o.label .. "." .. o.mode
local tsv_path = stem .. ".tsv"

-- A rerun keeps the earlier results.
local old = io.open(tsv_path, "r")
if old then
    old:close()
    os.rename(tsv_path, stem .. ".before-" .. os.time() .. ".tsv")
end
local tsv = assert(io.open(tsv_path, "w"))
tsv:write(HEADER, "\n")
tsv:flush()

local t0 = mp.get_time()
local last = {}          -- last non-nil value; the properties vanish as the file unloads
local base_pos, base_wall, end_wall
local pause_since, paused_total, stalls = nil, 0, 0
local fps_samples, cpu_sum, cpu_n = {}, 0, 0
local timer, finished

local function watch(name, native)
    mp.observe_property(name, native or "native", function(_, v)
        if v == nil then return end
        last[name] = v
        if name == "time-pos" then end_wall = mp.get_time() end
    end)
end
watch("time-pos")
watch("frame-drop-count")
watch("decoder-frame-drop-count")
watch("hwdec-current")
watch("container-fps")

local function close_pause(now)
    if pause_since then
        paused_total = paused_total + (now - pause_since)
        pause_since = nil
    end
end

mp.observe_property("paused-for-cache", "native", function(_, v)
    if v == nil then return end
    last["paused-for-cache"] = v
    local now = mp.get_time()
    if v and not pause_since then
        pause_since = now
        if base_pos then stalls = stalls + 1 end
    elseif not v then
        close_pause(now)
    end
end)

local function fmt(v, pattern)
    if v == nil then return NA end
    if type(v) == "boolean" then return v and "yes" or "no" end
    if pattern and type(v) == "number" then return string.format(pattern, v) end
    return tostring(v)
end

-- Sum of %CPU, or nil when ps does not answer as on macOS or lists none of our processes.
local function cpu_total()
    local r = mp.command_native({ name = "subprocess", args = { "ps", "-axo", "pcpu=,comm=" },
        capture_stdout = true, capture_stderr = true, playback_only = false })
    if not r or r.status ~= 0 or not r.stdout then return nil end
    local sum, seen = 0, false
    for line in r.stdout:gmatch("[^\r\n]+") do
        local pct, comm = line:match("^%s*([%d%.,]+)%s+(.+)$")
        if pct then
            pct = pct:gsub(",", ".")     -- macOS ps follows the locale's decimal mark
            local name = comm:match("([^/]+)$")
            if name and CPU_NAMES[name] and tonumber(pct) then
                sum, seen = sum + tonumber(pct), true
            end
        end
    end
    return seen and sum or nil
end

local function sample()
    local get = mp.get_property_native
    local fps, cpu = get("estimated-vf-fps"), cpu_total()
    if fps then fps_samples[#fps_samples + 1] = fps end
    if cpu then cpu_sum, cpu_n = cpu_sum + cpu, cpu_n + 1 end
    tsv:write(table.concat({
        string.format("%.1f", mp.get_time() - t0),
        fmt(get("time-pos"), "%.3f"),
        fmt(get("frame-drop-count"), "%d"),
        fmt(get("decoder-frame-drop-count"), "%d"),
        fmt(get("hwdec-current")),
        fmt(fps, "%.3f"),
        fmt(get("paused-for-cache")),
        fmt(cpu, "%.1f"),
    }, "\t"), "\n")
    tsv:flush()
end

-- container-fps can be bogus and estimated-vf-fps wobbles under drops: use the container's
-- exact value only when the measured median agrees with it.
local function choose_fps()
    table.sort(fps_samples)
    local est = fps_samples[math.ceil(#fps_samples / 2)]
    local cont = last["container-fps"]
    if est and cont and math.abs(cont - est) / est <= 0.05 then return cont, "container" end
    if est then return est, "estimated" end
    if cont then return cont, "container-unchecked" end
    return nil, NA
end

local function finish()
    if finished then return end
    finished = true
    if timer then timer:kill() end
    local now = end_wall or mp.get_time()
    close_pause(now)
    now = math.max(now, base_wall or now)
    tsv:close()

    local advance = base_pos and last["time-pos"] and (last["time-pos"] - base_pos) or nil
    local drops = last["frame-drop-count"]
    local fps, fps_source = choose_fps()
    local pct, ratio
    if advance and advance > 0 and drops and fps then pct = 100 * drops / (advance * fps) end
    if advance and advance > 0 then
        local wall = now - base_wall - paused_total
        if wall > 0 then ratio = advance / wall end
    end
    local line = table.concat({
        "label=" .. o.label,
        "mode=" .. o.mode,
        "seconds=" .. fmt(advance, "%.1f"),
        "drops=" .. fmt(drops, "%d"),
        "decoder_drops=" .. fmt(last["decoder-frame-drop-count"], "%d"),
        "drop_pct=" .. fmt(pct, "%.2f"),
        "hwdec=" .. fmt(last["hwdec-current"]),
        "realtime=" .. fmt(ratio, "%.3f"),
        "stalls=" .. (last["paused-for-cache"] == nil and NA or tostring(stalls)),
        "fps=" .. fmt(fps, "%.3f"),
        "fps_source=" .. fps_source,
        "cpu_avg=" .. (cpu_n > 0 and string.format("%.1f", cpu_sum / cpu_n) or NA),
    }, " ")
    local f = io.open(stem .. ".summary.txt", "w")
    if f then
        f:write(line, "\n")
        f:close()
    end
end

mp.register_event("file-loaded", function()
    if not timer then timer = mp.add_periodic_timer(INTERVAL, sample) end
end)
-- Timing runs from the first ready frame to the last position update: earlier the player is
-- still opening its window, and later it is only waiting out the end of the file.
mp.register_event("playback-restart", function()
    if base_pos then return end
    base_pos = mp.get_property_native("time-pos") or last["time-pos"]
    if base_pos then
        base_wall = mp.get_time()
        if pause_since then pause_since = base_wall end
    end
end)
mp.register_event("shutdown", finish)
