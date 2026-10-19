import fetch from "node-fetch";

fetch("https://text.pollinations.ai/models")
  .then(res => res.json())
  .then(res => console.log(res))
  .catch(console.error);
