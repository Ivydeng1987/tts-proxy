const crypto = require('crypto');
const WebSocket = require('ws');

function getAuthUrl(apiKey, apiSecret) {
  const host = 'tts-api.xfyun.cn';
  const path = '/v2/tts';
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');
  return `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }

  const APPID = process.env.XF_APPID;
  const APIKey = process.env.XF_APIKEY;
  const APISecret = process.env.XF_APISECRET;

  try {
    const url = getAuthUrl(APIKey, APISecret);
    const audioChunks = [];

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);

      ws.on('open', () => {
        const params = {
          common: { app_id: APPID },
          business: {
            aue: 'raw',
            auf: 'audio/L16;rate=16000',
            vcn: 'aisbabyxu',
            speed: 50,
            volume: 80,
            pitch: 55,
            tte: 'utf8',
          },
          data: {
            status: 2,
            text: Buffer.from(text).toString('base64'),
          },
        };
        ws.send(JSON.stringify(params));
      });

      ws.on('message', (data) => {
        const result = JSON.parse(data);
        if (result.code !== 0) {
          reject(new Error(`TTS error: ${result.message}`));
          ws.close();
          return;
        }
        if (result.data && result.data.audio) {
          audioChunks.push(Buffer.from(result.data.audio, 'base64'));
        }
        if (result.data && result.data.status === 2) {
          ws.close();
          resolve();
        }
      });

      ws.on('error', reject);
      ws.on('close', resolve);
    });

    const audioBuffer = Buffer.concat(audioChunks);
    res.setHeader('Content-Type', 'audio/wav');

    // Add WAV header for raw PCM
    const wavHeader = Buffer.alloc(44);
    const dataSize = audioBuffer.length;
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + dataSize, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(16000, 24);
    wavHeader.writeUInt32LE(32000, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataSize, 40);

    res.status(200).send(Buffer.concat([wavHeader, audioBuffer]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
