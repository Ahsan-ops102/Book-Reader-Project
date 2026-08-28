import express from "express";

const router = express.Router();

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

router.post("/query", async (req, res) => {
  const { selectedText, question } = req.body;

  if (!selectedText || !selectedText.trim()) {
    return res.status(400).json({ error: "No text was selected" });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server" });
  }

  const prompt = question?.trim()
    ? `Here is a passage from a book I'm reading:\n\n"""${selectedText}"""\n\nMy question about it: ${question}\n\nAnswer clearly and concisely.`
    : `Summarize the following passage from a book in 2-4 sentences, in plain language:\n\n"""${selectedText}"""`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 512,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return res.status(502).json({ error: "The AI service returned an error" });
    }

    const data = await response.json();
    const answer =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
      "No answer was returned.";

    res.json({ answer });
  } catch (err) {
    console.error("AI query failed:", err);
    res.status(500).json({ error: "Failed to reach the AI service" });
  }
});

// Fix grammar and spelling errors without changing sentence structure or tone
router.post("/fix", async (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "No text was provided" });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server" });
  }

  const prompt = `You are a professional proofreader. Fix ALL grammatical errors, spelling mistakes, punctuation issues, and typos in the following text. Rules:
1. Do NOT change the meaning, tone, or style of any sentence.
2. Do NOT add, remove, or rearrange sentences.
3. Do NOT rewrite or paraphrase — only correct errors.
4. Preserve the original formatting (paragraphs, line breaks, etc.)
5. Return ONLY the corrected text with no explanations, comments, or preamble.

Text to fix:
"""${text}"""`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return res.status(502).json({ error: "The AI service returned an error" });
    }

    const data = await response.json();
    const fixedText =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
      text; // fallback to original if no response

    res.json({ fixedText });
  } catch (err) {
    console.error("AI fix failed:", err);
    res.status(500).json({ error: "Failed to reach the AI service" });
  }
});

// General-purpose AI text transformations for the Writer
const TRANSFORM_PROMPTS = {
  paraphrase: "Rewrite the following text in different words while preserving the exact same meaning. Return ONLY the rewritten text.",
  formal: "Rewrite the following text in a formal, professional tone. Preserve the meaning. Return ONLY the rewritten text.",
  casual: "Rewrite the following text in a casual, friendly tone. Preserve the meaning. Return ONLY the rewritten text.",
  expand: "Expand and elaborate on the following text, adding more detail and explanation while keeping the original meaning. Return ONLY the expanded text.",
  shorten: "Condense the following text to be more concise while preserving all key information. Return ONLY the shortened text.",
  summarize: "Summarize the following text in 2-3 clear sentences. Return ONLY the summary.",
  bullets: "Convert the following text into well-organized bullet points. Return ONLY the bullet points.",
};

router.post("/transform", async (req, res) => {
  const { text, operation } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "No text was provided" });
  }
  if (!TRANSFORM_PROMPTS[operation]) {
    return res.status(400).json({ error: `Unknown operation: ${operation}` });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server" });
  }

  const prompt = `${TRANSFORM_PROMPTS[operation]}\n\nText:\n"""${text}"""`;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.3,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return res.status(502).json({ error: "The AI service returned an error" });
    }

    const data = await response.json();
    const result =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
      text;

    res.json({ result });
  } catch (err) {
    console.error("AI transform failed:", err);
    res.status(500).json({ error: "Failed to reach the AI service" });
  }
});

export default router;

