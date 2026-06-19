/**
 * Real-time alerting dispatch utility.
 * Sends structured webhook notifications to Slack and/or Discord channels.
 *
 * @module utils/alerts
 */
'use strict';

const { getConfig } = require('./config');

/**
 * Sends real-time alerting notification to Slack & Discord if configured thresholds are met.
 *
 * @param {Object} params
 * @param {string} params.id - Request UUID
 * @param {string} params.model - Model name/ID
 * @param {number} params.latency_ms - Request latency in milliseconds
 * @param {string} params.status - Request status ('success' or 'error')
 * @param {string|null} params.error_message - Error message details if any
 */
async function sendWebhookAlert({ id, model, latency_ms, status, error_message }) {
  try {
    const slackUrl = await getConfig('ALERT_SLACK_WEBHOOK_URL');
    const discordUrl = await getConfig('ALERT_DISCORD_WEBHOOK_URL');
    const alertOnFailureVal = await getConfig('ALERT_ON_FAILURE');
    const latencyThresholdVal = await getConfig('ALERT_LATENCY_THRESHOLD_MS');

    const alertOnFailure = alertOnFailureVal !== 'false';
    const latencyThreshold = latencyThresholdVal ? parseInt(latencyThresholdVal, 10) : 0;

    const isErrorAlert = status === 'error' && alertOnFailure;
    const isLatencyAlert = latencyThreshold > 0 && latency_ms >= latencyThreshold;

    if (!isErrorAlert && !isLatencyAlert) {
      return; // No alerts needed
    }

    let alertTitle = '🚨 InfraSight Observability Alert';
    let alertReason = '';
    if (isErrorAlert && isLatencyAlert) {
      alertReason = `Request failed and exceeded latency threshold (${latency_ms}ms >= ${latencyThreshold}ms).`;
    } else if (isErrorAlert) {
      alertReason = 'Request execution failed.';
    } else {
      alertReason = `Request latency exceeded threshold (${latency_ms}ms >= ${latencyThreshold}ms).`;
    }

    const payloadFields = [
      { name: 'Request ID', value: id },
      { name: 'Model', value: model },
      { name: 'Status', value: status.toUpperCase() },
      { name: 'Latency', value: `${latency_ms} ms` },
      { name: 'Trigger Reason', value: alertReason }
    ];

    if (error_message) {
      payloadFields.push({ name: 'Error Details', value: error_message });
    }

    // 1. Send Slack notification
    if (slackUrl) {
      try {
        const slackPayload = {
          attachments: [
            {
              color: status === 'error' ? '#ff3333' : '#ffaa00',
              title: alertTitle,
              text: alertReason,
              fields: payloadFields.map(f => ({
                title: f.name,
                value: f.value,
                short: f.name !== 'Error Details' && f.name !== 'Trigger Reason'
              })),
              ts: Math.floor(Date.now() / 1000)
            }
          ]
        };

        const slackRes = await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(slackPayload)
        });
        if (!slackRes.ok) {
          console.error(`[alerts] Slack webhook returned status ${slackRes.status}`);
        }
      } catch (slackErr) {
        console.error('[alerts] Error posting to Slack webhook:', slackErr.message);
      }
    }

    // 2. Send Discord notification
    if (discordUrl) {
      try {
        const discordPayload = {
          embeds: [
            {
              title: alertTitle,
              description: alertReason,
              color: status === 'error' ? 16724787 : 16755200, // RGB: Red vs Amber
              fields: payloadFields.map(f => ({
                name: f.name,
                value: f.value,
                inline: f.name !== 'Error Details' && f.name !== 'Trigger Reason'
              })),
              timestamp: new Date().toISOString()
            }
          ]
        };

        const discordRes = await fetch(discordUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discordPayload)
        });
        if (!discordRes.ok) {
          console.error(`[alerts] Discord webhook returned status ${discordRes.status}`);
        }
      } catch (discordErr) {
        console.error('[alerts] Error posting to Discord webhook:', discordErr.message);
      }
    }
  } catch (err) {
    console.error('[alerts] Error dispatching webhook alerts:', err.message);
  }
}

module.exports = {
  sendWebhookAlert
};
