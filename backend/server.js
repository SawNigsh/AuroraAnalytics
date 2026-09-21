require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ACTIVE_WINDOW_SECONDS = Math.max(30, Number(process.env.ACTIVE_WINDOW_SECONDS || 90));
const API_KEY = process.env.API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables: API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const ingestionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests' }
});

function timingSafeEqualStrings(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function requireApiKey(req, res, next) {
  const supplied = req.get('x-api-key') || req.body?.apiKey || '';
  if (!supplied || !timingSafeEqualStrings(supplied, API_KEY)) {
    return res.status(401).json({ ok: false, error: 'Invalid API key' });
  }
  next();
}

function cleanString(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!cleaned) return fallback;
  return cleaned.slice(0, maxLength);
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isoFromNowMinusSeconds(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function secondsBetween(start, end = new Date()) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 1000));
}

async function expireStaleSessions() {
  const cutoff = isoFromNowMinusSeconds(ACTIVE_WINDOW_SECONDS);

  const { data: staleSessions, error: findError } = await supabase
    .from('sessions')
    .select('id, started_at, last_seen_at')
    .is('ended_at', null)
    .lt('last_seen_at', cutoff)
    .limit(200);

  if (findError) {
    console.error('expire stale sessions find error:', findError);
    return;
  }

  if (!staleSessions?.length) return;

  for (const session of staleSessions) {
    const endedAt = session.last_seen_at;
    const duration = secondsBetween(session.started_at, endedAt);

    const { error: updateError } = await supabase
      .from('sessions')
      .update({
        ended_at: endedAt,
        duration_seconds: duration
      })
      .eq('id', session.id)
      .is('ended_at', null);

    if (updateError) {
      console.error(`expire session ${session.id} error:`, updateError);
    }
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'Aurora Analytics', time: new Date().toISOString() });
});

app.post('/api/v1/start', ingestionLimiter, requireApiKey, async (req, res) => {
  try {
    const sessionId = isUuid(req.body?.sessionId) ? req.body.sessionId : crypto.randomUUID();
    const clientId = cleanString(req.body?.clientId, crypto.randomUUID(), 120);

    const row = {
      id: sessionId,
      client_id: clientId,
      script_version: cleanString(req.body?.scriptVersion, 'unknown', 40),
      executor: cleanString(req.body?.executor, 'unknown', 100),
      place_id: cleanString(req.body?.placeId, '0', 100),
      job_id: cleanString(req.body?.jobId, 'unknown', 120),
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      ended_at: null,
      duration_seconds: 0
    };

    const { error } = await supabase.from('sessions').insert(row);
    if (error) {
      console.error('start insert error:', error);
      return res.status(500).json({ ok: false, error: 'Database error' });
    }

    res.status(201).json({ ok: true, sessionId });
  } catch (error) {
    console.error('start error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.post('/api/v1/heartbeat', ingestionLimiter, requireApiKey, async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    if (!isUuid(sessionId)) {
      return res.status(400).json({ ok: false, error: 'Invalid sessionId' });
    }

    const now = new Date().toISOString();
    const { data: existing, error: findError } = await supabase
      .from('sessions')
      .select('id, started_at, ended_at')
      .eq('id', sessionId)
      .maybeSingle();

    if (findError) {
      console.error('heartbeat find error:', findError);
      return res.status(500).json({ ok: false, error: 'Database error' });
    }

    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    if (existing.ended_at) {
      return res.status(409).json({ ok: false, error: 'Session already ended' });
    }

    const duration = secondsBetween(existing.started_at, now);
    const { error } = await supabase
      .from('sessions')
      .update({ last_seen_at: now, duration_seconds: duration })
      .eq('id', sessionId);

    if (error) {
      console.error('heartbeat update error:', error);
      return res.status(500).json({ ok: false, error: 'Database error' });
    }

    res.json({ ok: true, durationSeconds: duration });
  } catch (error) {
    console.error('heartbeat error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.post('/api/v1/end', ingestionLimiter, requireApiKey, async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    if (!isUuid(sessionId)) {
      return res.status(400).json({ ok: false, error: 'Invalid sessionId' });
    }

    const now = new Date().toISOString();
    const { data: existing, error: findError } = await supabase
      .from('sessions')
      .select('id, started_at, ended_at')
      .eq('id', sessionId)
      .maybeSingle();

    if (findError) {
      console.error('end find error:', findError);
      return res.status(500).json({ ok: false, error: 'Database error' });
    }

    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    const duration = secondsBetween(existing.started_at, now);
    const { error } = await supabase
      .from('sessions')
      .update({ last_seen_at: now, ended_at: now, duration_seconds: duration })
      .eq('id', sessionId);

    if (error) {
      console.error('end update error:', error);
      return res.status(500).json({ ok: false, error: 'Database error' });
    }

    res.json({ ok: true, durationSeconds: duration });
  } catch (error) {
    console.error('end error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.get('/api/v1/stats', async (_req, res) => {
  try {
    await expireStaleSessions();
    const since = isoFromNowMinusSeconds(ACTIVE_WINDOW_SECONDS);

    const [totalResult, activeResult, todayResult] = await Promise.all([
      supabase.from('sessions').select('*', { count: 'exact', head: true }),
      supabase.from('sessions').select('id, started_at, last_seen_at, duration_seconds').gte('last_seen_at', since).is('ended_at', null),
      supabase.from('sessions').select('*', { count: 'exact', head: true }).gte('started_at', new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString())
    ]);

    if (totalResult.error || activeResult.error || todayResult.error) {
      console.error('stats error:', totalResult.error || activeResult.error || todayResult.error);
      return res.status(500).json({ ok: false, error: 'Database error' });
    }

    const active = activeResult.data || [];
    const activeWithDuration = active.map((session) => ({
      id: session.id,
      durationSeconds: secondsBetween(session.started_at)
    }));

    res.json({
      ok: true,
      data: {
        totalExecutions: totalResult.count || 0,
        executionsToday: todayResult.count || 0,
        activeSessions: active.length,
        activeWindowSeconds: ACTIVE_WINDOW_SECONDS,
        activeSessionsData: activeWithDuration,
        serverTime: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('stats error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.get('/api/v1/recent', async (_req, res) => {
  try {
    await expireStaleSessions();
    const { data, error } = await supabase
      .from('sessions')
      .select('id, client_id, script_version, executor, place_id, job_id, started_at, last_seen_at, ended_at, duration_seconds')
      .order('started_at', { ascending: false })
      .limit(25);

    if (error) {
      console.error('recent error:', error);
      return res.status(500).json({ ok: false, error: 'Database error' });
    }

    const now = Date.now();
    const recent = (data || []).map((item) => {
      const active = !item.ended_at && (now - new Date(item.last_seen_at).getTime()) <= ACTIVE_WINDOW_SECONDS * 1000;
      return {
        ...item,
        active,
        liveDurationSeconds: active ? secondsBetween(item.started_at) : item.duration_seconds
      };
    });

    res.json({ ok: true, data: recent });
  } catch (error) {
    console.error('recent error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.use(express.static(path.join(__dirname, '..', 'web'), {
  extensions: ['html']
}));

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Aurora Analytics running on http://localhost:${PORT}`);
});
