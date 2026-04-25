const express = require('express');

const app = express();

function buildPayload() {
  return {
    latestVersion: String(process.env.LATEST_VERSION || '1.0.0').trim(),
    updateUrl: String(
      process.env.UPDATE_URL || 'https://discovery-web.onrender.com'
    ).trim(),
    message: String(process.env.UPDATE_MESSAGE || '').trim(),
    checkedAt: new Date().toISOString(),
  };
}

app.get('/', (req, res) => {
  res.json(buildPayload());
});

app.get('/version.json', (req, res) => {
  const payload = buildPayload();
  res.json({ latestVersion: payload.latestVersion });
});

app.get('/update.json', (req, res) => {
  res.json(buildPayload());
});

app.get('/api/version', (req, res) => {
  const payload = buildPayload();
  res.json({ latestVersion: payload.latestVersion });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Discovery update service listening on port ${port}`);
});
