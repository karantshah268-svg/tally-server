// server.js -- receives agent uploads and writes vouchers into Supabase
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// Read env vars (set on Render)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('WARNING: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
}

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Helpers
function collectVouchers(obj) {
  const out = [];
  function rec(o) {
    if (!o || typeof o !== 'object') return;
    if (o.VOUCHER) {
      if (Array.isArray(o.VOUCHER)) out.push(...o.VOUCHER);
      else out.push(o.VOUCHER);
    }
    for (const k of Object.keys(o)) rec(o[k]);
  }
  rec(obj);
  return out;
}

function normalizeDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`; // YYYYMMDD
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) { const [dd,mm,yyyy] = s.split('-'); return `${yyyy}-${mm}-${dd}`; }
  return null;
}

async function insertVouchers(rows) {
  if (!supabase) throw new Error('Supabase client not initialized (missing env vars).');
  const { data, error } = await supabase.from('vouchers').upsert(rows, { onConflict: 'unique_key' });
  if (error) throw error;
  return data;
}

// Routes
app.get('/', (req, res) => res.send('Server is running ✅'));

app.post('/api/agent/upload', async (req, res) => {
  try {
    const payload = req.body || {};
    const agentId = payload.agentId || 'unknown-agent';
    const company = payload.company || payload.companyName || 'UNKNOWN';
    const ts = payload.ts || new Date().toISOString();

    const parsed = payload.data || {};
    const vouchers = collectVouchers(parsed);

    // If no vouchers, store raw for debugging
    if (!vouchers || vouchers.length === 0) {
      const row = {
        agent_id: agentId,
        company,
        ts,
        voucher_date: null,
        voucher_number: null,
        voucher_type: null,
        unique_key: `${company}|${ts}|no-vouchers`,
        payload: payload
      };
      if (supabase) await insertVouchers([row]);
      return res.json({ ok: true, inserted: 1, note: 'no vouchers, raw payload saved' });
    }

    const rows = vouchers.map(v => {
      const vdateRaw = v.DATE || v.date || null;
      const voucher_date = normalizeDate(vdateRaw);
      const voucher_number = v.VOUCHERNUMBER || v.vouchernumber || null;
      const voucher_type = v.VOUCHERTYPENAME || v.vouchertypename || null;
      const unique_key = `${company}|${voucher_date || vdateRaw || ts}|${voucher_number || Math.random().toString(36).slice(2,9)}`;
      return {
        agent_id: agentId,
        company,
        ts,
        voucher_date,
        voucher_number,
        voucher_type,
        unique_key,
        payload: v
      };
    });

    let insertedCount = 0;
    if (supabase) {
      const inserted = await insertVouchers(rows);
      insertedCount = Array.isArray(inserted) ? inserted.length : 0;
    }
    return res.json({ ok: true, inserted: insertedCount });
  } catch (err) {
    console.error('Upload error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

// GET /api/sales-summary?days=90
// Returns [{ customer, invoices, total }] for the last N days (default 90)
app.get('/api/sales-summary', async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ ok:false, error:'Supabase not configured' });

    const days = Math.max(1, parseInt(req.query.days || '90', 10));
    const fromIso = new Date(Date.now() - days*24*3600*1000).toISOString().slice(0,10); // YYYY-MM-DD

    // fetch vouchers in range (only what we need)
    const { data, error } = await supabase
      .from('vouchers')
      .select('voucher_date, payload')
      .gte('voucher_date', fromIso)
      .lte('voucher_date', new Date().toISOString().slice(0,10))
      .limit(5000); // safety cap for now

    if (error) throw error;

    // group totals by PARTYLEDGERNAME
    const totals = new Map();
    const counts = new Map();

    function toNumber(x) {
      if (x == null) return 0;
      const n = Number(String(x).replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? 0 : n;
    }

    for (const row of (data || [])) {
      const v = row.payload || {};
      const customer = v.PARTYLEDGERNAME || v.partyledgername || 'Unknown';

      // voucher total: prefer sum of line items; else use voucher AMOUNT
      let vTotal = 0;
      const inv = v['ALLINVENTORYENTRIES.LIST'];
      if (inv) {
        const list = Array.isArray(inv) ? inv : [inv];
        for (const it of list) vTotal += toNumber(it && (it.AMOUNT || it.amount));
      } else {
        vTotal = toNumber(v.AMOUNT || v.amount);
      }

      totals.set(customer, (totals.get(customer) || 0) + vTotal);
      counts.set(customer, (counts.get(customer) || 0) + 1);
    }

    // format + sort
    const rows = Array.from(totals.entries())
      .map(([customer, total]) => ({ customer, invoices: counts.get(customer) || 0, total }))
      .sort((a,b) => b.total - a.total);

    res.json({ ok:true, days, rows });
  } catch (e) {
    console.error('sales-summary error:', e);
    res.status(500).json({ ok:false, error: e.message || String(e) });
  }
});
