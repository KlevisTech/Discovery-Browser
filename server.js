const express = require('express');

const app = express();

function buildPayload() {
  const rawMode = String(process.env.UPDATE_MODE || process.env.UPDATE_POLICY || '').trim().toLowerCase();
  const forced = ['forced', 'force', 'required', 'mandatory', 'true', '1', 'yes'].includes(rawMode)
    || ['true', '1', 'yes'].includes(String(process.env.FORCE_UPDATE || '').trim().toLowerCase());
  const updateMode = forced ? 'forced' : 'lenient';
  const defaultMessage = String(process.env.UPDATE_MESSAGE || '').trim();
  const forcedMessage = String(process.env.FORCED_UPDATE_MESSAGE || process.env.UPDATE_MESSAGE_FORCED || defaultMessage).trim();
  const lenientMessage = String(process.env.LENIENT_UPDATE_MESSAGE || process.env.UPDATE_MESSAGE_LENIENT || defaultMessage).trim();
  return {
    latestVersion: String(process.env.LATEST_VERSION || '').trim(),
    updateUrl: String(
      process.env.UPDATE_URL || 'https://discovery-web.onrender.com'
    ).trim(),
    updateMode,
    forceUpdate: forced,
    message: forced ? forcedMessage : lenientMessage,
    lenientMessage,
    forcedMessage,
    checkedAt: new Date().toISOString(),
  };
}

app.get('/', (req, res) => {
  res.json(buildPayload());
});

app.get('/version.json', (req, res) => {
  res.json(buildPayload());
});

app.get('/update.json', (req, res) => {
  res.json(buildPayload());
});

app.get('/api/version', (req, res) => {
  res.json(buildPayload());
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Discovery update service listening on port ${port}`);
});
