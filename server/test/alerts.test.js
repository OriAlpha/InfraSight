'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clearCache, setConfig } = require('../utils/config');
const { sendWebhookAlert } = require('../utils/alerts');

const originalFetch = globalThis.fetch;
let sentRequests = [];

test.beforeEach(() => {
  sentRequests = [];
  globalThis.fetch = async (url, options) => {
    sentRequests.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, status: 200 };
  };
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('alerts: does not dispatch when conditions are not met', async () => {
  clearCache();
  process.env.ALERT_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test/valid/key';
  process.env.ALERT_LATENCY_THRESHOLD_MS = '5000';
  process.env.ALERT_ON_FAILURE = 'true';

  // Request succeeded and latency is under threshold (100ms < 5000ms)
  await sendWebhookAlert({
    id: 'req-clean',
    model: 'meta-llama/test',
    latency_ms: 100,
    status: 'success',
  });

  assert.equal(sentRequests.length, 0);

  delete process.env.ALERT_SLACK_WEBHOOK_URL;
  delete process.env.ALERT_LATENCY_THRESHOLD_MS;
  delete process.env.ALERT_ON_FAILURE;
});

test('alerts: dispatches Slack and Discord when error occurs', async () => {
  clearCache();
  process.env.ALERT_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test/valid/key';
  process.env.ALERT_DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/valid/key';
  process.env.ALERT_ON_FAILURE = 'true';

  await sendWebhookAlert({
    id: 'req-err-1',
    model: 'meta-llama/test',
    latency_ms: 50,
    status: 'error',
    error_message: 'Out of memory upstream',
  });

  assert.equal(sentRequests.length, 2);

  const slackReq = sentRequests.find(r => r.url.includes('slack.com'));
  assert.ok(slackReq);
  assert.equal(slackReq.body.attachments[0].color, '#ff3333');

  const discordReq = sentRequests.find(r => r.url.includes('discord.com'));
  assert.ok(discordReq);
  assert.equal(discordReq.body.embeds[0].color, 16724787);

  delete process.env.ALERT_SLACK_WEBHOOK_URL;
  delete process.env.ALERT_DISCORD_WEBHOOK_URL;
  delete process.env.ALERT_ON_FAILURE;
});

test('alerts: dispatches when latency threshold exceeded even on success', async () => {
  clearCache();
  process.env.ALERT_SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test/valid/key';
  process.env.ALERT_LATENCY_THRESHOLD_MS = '2000';

  await sendWebhookAlert({
    id: 'req-slow',
    model: 'meta-llama/test',
    latency_ms: 3500,
    status: 'success',
  });

  assert.equal(sentRequests.length, 1);
  assert.match(sentRequests[0].body.attachments[0].text, /latency exceeded threshold/);

  delete process.env.ALERT_SLACK_WEBHOOK_URL;
  delete process.env.ALERT_LATENCY_THRESHOLD_MS;
});

test('alerts: ignores insecure non-https webhook URLs safely', async () => {
  clearCache();
  process.env.ALERT_SLACK_WEBHOOK_URL = 'http://insecure-http-webhook.com';

  await sendWebhookAlert({
    id: 'req-bad-url',
    model: 'meta-llama/test',
    latency_ms: 50,
    status: 'error',
  });

  assert.equal(sentRequests.length, 0);
  delete process.env.ALERT_SLACK_WEBHOOK_URL;
});
