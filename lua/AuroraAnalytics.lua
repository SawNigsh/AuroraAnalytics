-- Aurora Analytics client
-- Replace these values before using the script.

local API_URL = "https://auroraanalytics.onrender.com/api/v1"
local API_KEY = "API_KEY=a83f1c7d9e0a4b2c6f1e8d5a7b9c2d4e8f6a1b3c5d7e9f0a2b4c6d8e1f3a5"
local SCRIPT_VERSION = "1.0.0"
local HEARTBEAT_SECONDS = 10

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")

local function getRequestFunction()
    if type(request) == "function" then
        return request
    end

    if type(http_request) == "function" then
        return http_request
    end

    if type(syn) == "table" and type(syn.request) == "function" then
        return syn.request
    end

    if type(fluxus) == "table" and type(fluxus.request) == "function" then
        return fluxus.request
    end

    return nil
end

local requestFunction = getRequestFunction()

if not requestFunction then
    warn("[Aurora Analytics] No supported HTTP request function was found.")
    return
end

local function safeJsonEncode(value)
    local ok, result = pcall(function()
        return HttpService:JSONEncode(value)
    end)

    if ok then
        return result
    end

    return "{}"
end

local function send(method, endpoint, body)
    local ok, response = pcall(function()
        return requestFunction({
            Url = API_URL .. endpoint,
            Method = method,
            Headers = {
                ["Content-Type"] = "application/json",
                ["X-API-Key"] = API_KEY
            },
            Body = safeJsonEncode(body or {})
        })
    end)

    if not ok then
        warn("[Aurora Analytics] HTTP request failed:", response)
        return nil
    end

    local status = tonumber(response and (response.StatusCode or response.status_code or response.Status)) or 0
    local rawBody = response and (response.Body or response.body)

    if status < 200 or status >= 300 then
        warn("[Aurora Analytics] Server returned status:", status)
        return nil
    end

    if type(rawBody) ~= "string" or rawBody == "" then
        return {}
    end

    local decodeOk, decoded = pcall(function()
        return HttpService:JSONDecode(rawBody)
    end)

    if decodeOk then
        return decoded
    end

    return {}
end

local function getExecutorName()
    local candidates = {
        "getexecutorname",
        "identifyexecutor"
    }

    for _, name in ipairs(candidates) do
        local fn = getgenv and getgenv()[name]
        if type(fn) == "function" then
            local ok, a, b = pcall(fn)
            if ok then
                local value = a or b
                if value ~= nil and tostring(value) ~= "" then
                    return tostring(value)
                end
            end
        end
    end

    return "unknown"
end

local function createClientId()
    local ok, guid = pcall(function()
        return HttpService:GenerateGUID(false)
    end)

    if ok and guid then
        return guid
    end

    return tostring(math.random(100000, 999999)) .. "-" .. tostring(os.clock()):gsub("%.", "")
end

local clientId = createClientId()
local executor = getExecutorName()
local placeId = tostring(game.PlaceId or 0)
local jobId = tostring(game.JobId or "unknown")

local startResponse = send("POST", "/start", {
    clientId = clientId,
    scriptVersion = SCRIPT_VERSION,
    executor = executor,
    placeId = placeId,
    jobId = jobId
})

if not startResponse or not startResponse.sessionId then
    warn("[Aurora Analytics] Could not create a session.")
    return
end

local sessionId = startResponse.sessionId
print("[Aurora Analytics] Session:", sessionId)

local stopped = false

local function heartbeatLoop()
    while not stopped do
        task.wait(HEARTBEAT_SECONDS)

        if stopped then
            break
        end

        local response = send("POST", "/heartbeat", {
            sessionId = sessionId
        })

        if response and response.durationSeconds then
            -- Intentionally quiet; the server is tracking duration.
        end
    end
end

task.spawn(heartbeatLoop)

-- Optional manual cleanup:
-- Call endSession() from your own script when the user leaves your hub.
function endSession()
    if stopped then
        return
    end

    stopped = true
    send("POST", "/end", {
        sessionId = sessionId
    })
end
