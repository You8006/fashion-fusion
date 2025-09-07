export function colorGridPrompt(colors: string[], baseW: number, baseH: number) {
  return `You are a professional fashion compositor.\n\nInput: a composite fashion photo of a person already wearing the item.\n\nTask: Produce ONE 3x3 collage (9 panels) showing color variations of the GARMENT ONLY. Keep identity, pose, anatomy, background, lighting identical.\n\nSTRICT LAYOUT / ASPECT RATIO CONSTRAINTS:\n- Original single-frame aspect ratio: ${baseW}:${baseH}.\n- EACH panel MUST be EXACTLY ${baseW}x${baseH} (no square-forcing, no cropping, no letterboxing that changes size).\n- Full collage MUST be EXACTLY ${baseW * 3}x${baseH * 3} (3 columns × 3 rows).\n- If original is non-square you MUST output a non-square collage; do NOT pad to a square and do NOT distort.\n\nColors (top-left -> bottom-right):\n${colors.map((c,i)=>`${i+1}) ${c}`).join(', ')}\n\nRECOLOR RULES:\n- Recolor ONLY garment pixels per panel. Preserve shading, fabric texture, wrinkles, stitching, shadows, global lighting.\n- Background / skin / hair / accessories remain unchanged (bitwise identical where possible).\n- No added objects, patterns, or text.\n- Uniform minimal light gutter between panels; no outer frame.\n- If multi-piece outfit, recolor only the PRIMARY garment.\n\nPANEL COUNT (CRITICAL):\n- EXACTLY 9 panels (3 columns × 3 rows). NEVER 4 rows (12 panels).\n- If you begin producing more than 9, correct to 9 before returning.\n- Return ONE PNG only.\n`;
}

// --- Strict (mask-assisted) variation prompts ---
export const GARMENT_MASK_PROMPT = `
You receive one composite fashion photo of a person wearing a garment.
Return exactly ONE black-and-white MATTE MASK image the same size:
- White (255) = garment pixels ONLY
- Black (0)   = everything else
- Keep crisp edges with slight anti-aliasing; respect hair/hand occlusion.
- No text, no borders, no collage. Image output only.
`;

export function colorGridPromptStrict(colors: string[]) {
  return `
You are a professional fashion compositor.

Task: Using the provided composite photo (person + garment) AND the provided
binary GARMENT MASK (white=garment, black=non-garment), produce ONE 3x3 collage
(9 panels) showing color variations of the GARMENT ONLY.

HARD CONSTRAINTS:
- Apply recolor strictly INSIDE the white-mask region.
- All pixels OUTSIDE the mask must remain BITWISE IDENTICAL to the input.
- Preserve fabric wrinkles, stitching, shading and occlusion.
- No extra text or borders. Thin white gutters between panels only.
- Output ~1536x1536, square.

Colors (top-left → bottom-right):
${colors.map((c, i) => `${i + 1}) ${c}`).join(', ')}
`;
}
