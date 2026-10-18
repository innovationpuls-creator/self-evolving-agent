const [origin, ...prompts] = process.argv.slice(2);
if (!origin || prompts.length === 0) throw new Error("Usage: node src/client.mjs <origin> <prompt> [...prompts]");

for (const prompt of prompts) {
	const response = await fetch(`${origin}/settle`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ prompt }),
	});
	const body = await response.json();
	if (!response.ok) throw new Error(`${response.status}: ${body.error ?? "request failed"}`);
	process.stdout.write(`${JSON.stringify(body)}\n`);
}
