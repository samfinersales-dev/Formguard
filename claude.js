// netlify/functions/claude.js — FormGuard
// Passes form image or PDF to Claude for USCIS error checking
// Environment variables: ANTHROPIC_API_KEY

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { messages } = body;
  if (!messages || !messages.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No messages provided' }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API error:', response.status, JSON.stringify(data).substring(0, 200));
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Analysis failed: ' + (data.error?.message || response.status) }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ content: data.content }) };

  } catch(err) {
    console.error('Function error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
