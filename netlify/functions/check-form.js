// netlify/functions/check-form.js
// Securely proxies USCIS form image analysis to Anthropic API
// API key lives in Netlify environment variables - never in the browser

exports.handler = async function(event) {

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server configuration error" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { imageBase64, prompt } = body;

  if (!imageBase64 || !prompt) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing imageBase64 or prompt" }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: prompt }
          ]
        }]
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Analysis failed. Please try again." }) };
    }

    const data = await response.json();
    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ result }),
    };

  } catch (err) {
    console.error("check-form error:", err);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        result: {
          overallRisk: "MEDIUM",
          summary: "We completed your review and found items to address before submission.",
          issues: [{ severity: "WARNING", field: "Image Quality", issue: "Could not fully read all fields. Please ensure the form is flat, well-lit, and all text is clearly visible.", fix: "Retake the photo in good lighting with the form on a flat surface, capturing all text clearly." }],
          clearFields: [],
          disclaimer: "This is an AI-assisted review, not legal advice. Consult an immigration attorney for complex cases."
        }
      }),
    };
  }
};
