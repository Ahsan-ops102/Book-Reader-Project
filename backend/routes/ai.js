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

export default router;
