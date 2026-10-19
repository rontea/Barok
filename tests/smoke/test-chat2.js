fetch("https://text.pollinations.ai/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "openai",
    messages: [{ role: "user", content: "test" }]
  })
}).then(async res => {
  if (res.ok) {
    const text = await res.text();
    console.log(text);
  } else {
    console.log("Error", res.status, await res.text());
  }
}).catch(console.error);
