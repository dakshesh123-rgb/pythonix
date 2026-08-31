// Cloudflare Pages Function — replaces app.py
// POST /api/generate → proxies to Gemini API
export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const apiKey = env.GEMINI_API_KEY;

        if (!apiKey) {
            return Response.json(
                { error: "GEMINI_API_KEY not configured. Set it in Cloudflare Pages > Settings > Environment Variables." },
                { status: 500 }
            );
        }

        const body = await request.json();
        const prompt = body.prompt || "";

        if (!prompt.trim()) {
            return Response.json({ error: "No prompt provided" }, { status: 400 });
        }

        // Limit prompt size to prevent abuse
        if (prompt.length > 50000) {
            return Response.json({ error: "Prompt too long (max 50,000 characters)" }, { status: 400 });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
        const payload = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        const apiResponse = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const result = await apiResponse.json();

        if (!apiResponse.ok) {
            return Response.json(
                { error: `Gemini API Error: ${JSON.stringify(result)}` },
                { status: 500 }
            );
        }

        if (result.candidates && result.candidates[0]?.content?.parts?.[0]?.text) {
            const text = result.candidates[0].content.parts[0].text;
            return Response.json({ text });
        } else {
            return Response.json(
                { error: "Unexpected response from Gemini" },
                { status: 500 }
            );
        }
    } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
