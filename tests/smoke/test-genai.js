import { GoogleGenAI } from '@google/genai';

async function test() {
  try {
    const ai = new GoogleGenAI({ apiKey: 'fake_key', httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }});
    const contents = "Test";
    let systemInstruction;
    await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction
      }
    });
    console.log("SUCCESS");
  } catch(e) {
    console.error("ERROR:", e.message || String(e));
  }
}
test();
