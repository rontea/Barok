async function run() {
  try {
    const res = await fetch("http://localhost:3000/api/react/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "Write a simple math script",
        model: "qwen-coder",
        maxSteps: 3
      })
    });
    const text = await res.text();
    console.log(text);
  } catch(e) {
    console.error(e);
  }
}
run();
