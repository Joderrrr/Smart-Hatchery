/**
 * SMS Service Module
 * Handles SMS sending via TextBee API
 */

const TEXTBEE_API_URL = 'https://api.textbee.dev/api/v1/gateway/devices';

/**
 * Send SMS via TextBee API
 * @param {string} message - The SMS message content
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendSms(message) {
  const apiKey = process.env.TEXTBEE_API_KEY;
  const deviceId = process.env.TEXTBEE_DEVICE_ID;
  const phoneNumber = process.env.TEXTBEE_PHONE_NUMBER;

  if (!apiKey || !deviceId || !phoneNumber) {
    console.warn('SMS service disabled. Set TEXTBEE_API_KEY, TEXTBEE_DEVICE_ID, TEXTBEE_PHONE_NUMBER in environment.');
    return { success: false, error: 'SMS service not configured.' };
  }

  const url = `${TEXTBEE_API_URL}/${deviceId}/sendSMS`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        recipients: [`+${phoneNumber}`],
        message: message,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`TextBee API error: ${response.status} - ${errorText}`);
      return { success: false, error: `API returned ${response.status}` };
    }

    const result = await response.json().catch(() => ({}));
    console.log('SMS sent successfully:', result);
    return { success: true };
  } catch (error) {
    console.error('SMS sending failed:', error.message || error);
    return { success: false, error: error.message || 'Network error' };
  }
}

module.exports = {
  sendSms,
};
