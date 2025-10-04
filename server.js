// (put these near the top of server.js once)
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// make sure you have: app.use(express.json({ limit: "20mb" }));

app.post("/api/agent/upload", async (req, res) => {
  try {
    const payload = req.body || {};
    const { company, kind, period, rows } = payload;

    // basic sanity log
    console.log("UPLOAD kind:", kind, "company:", company, "rows:", Array.isArray(rows) ? rows.length : 0);

    if (kind === "sales_by_customer") {
      if (!company || !period?.from || !period?.to || !Array.isArray(rows)) {
        return res.status(400).json({ ok: false, error: "company, period.from, period.to and rows are required" });
      }

      // normalize row keys from PowerShell (TitleCase) to DB columns (snake_case)
      const records = rows.map(r => ({
        company,
        period_from: period.from,     // 'YYYY-MM-DD'
        period_to: period.to,         // 'YYYY-MM-DD'
        customer: r.Customer ?? r.customer ?? null,
        total_sales: Number(r.TotalSales ?? r.total_sales ?? 0),
        lines: Number(r.Lines ?? r.lines ?? 0),
      })).filter(x => x.customer && !Number.isNaN(x.total_sales));

      if (records.length === 0) {
        return res.json({ ok: true, inserted: 0, note: "no valid rows after normalization" });
      }

      const { data, error } = await supabase
        .from("sales_by_customer")
        .insert(records);

      if (error) {
        console.error("Supabase insert error:", error);
        return res.status(500).json({ ok: false, error: error.message });
      }

      return res.json({ ok: true, inserted: data?.length ?? records.length });
    }

    // fallback for other kinds (you can add more handlers later)
    console.log("No handler for kind:", kind);
    return res.json({ ok: true, note: "no handler for this kind" });
  } catch (e) {
    console.error("Upload handler crash:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
