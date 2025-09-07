import { GoogleGenAI } from "@google/genai";
import { writeFileSync } from "node:fs";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    console.error("Set GEMINI_API_KEY in your environment (.env.local) before running.");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey });
  const prompt = "Create a photorealistic image of an orange cat with green eyes, sitting on a couch.";
  console.log("Generating image with Nano Banana (Gemini 2.5 Flash Image Preview)...");
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image-preview",
    contents: prompt,
  });
  const parts = response.candidates?.[0]?.content?.parts || [];
  const img = parts.find(p => (p as any).inlineData)?.inlineData?.data;
  if (!img) {
    console.error("No image returned.");
    return;
  }
  const buffer = Buffer.from(img, 'base64');
  writeFileSync('hello-banana.png', buffer);
  console.log("Saved hello-banana.png (", buffer.length, "bytes )");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
