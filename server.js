const express = require("express");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json({ limit: "20mb" }));

app.post("/api/agent/upload", (req, res) => {
  console.log("Received upload:", req.body && Object.keys(req.body).length ? 'payload' : 'empty');
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  res.send("Server is running ✅");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
