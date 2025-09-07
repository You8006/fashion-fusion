export function colorGridPrompt(colors: string[], baseW: number, baseH: number) {
  return `You are a professional fashion compositor.\n\nInput: a composite fashion photo of a person already wearing the item.\n\nTask: Produce ONE 3x3 collage (9 panels) showing color variations of the GARMENT ONLY. Keep identity, pose, anatomy, background, lighting identical.\n\nSTRICT LAYOUT / ASPECT RATIO CONSTRAINTS:\n- Original single-frame aspect ratio: ${baseW}:${baseH}.\n- EACH panel MUST be EXACTLY ${baseW}x${baseH} (no square-forcing, no cropping, no letterboxing that changes size).\n- Full collage MUST be EXACTLY ${baseW * 3}x${baseH * 3} (3 columns × 3 rows).\n- If original is non-square you MUST output a non-square collage; do NOT pad to a square and do NOT distort.\n\nRequested palette (may be overridden for distinctness):\n${colors.map((c,i)=>`${i+1}) ${c}`).join(', ')}\n\nABSOLUTE DISTINCT COLOR OVERRIDE (enforce these EXACT vivid, high-contrast garment colors top-left → bottom-right; ignore requested palette if it conflicts):\n1) Vivid Pure Red (#FF0000)\n2) Vivid Pure Blue (#0055FF)\n3) Vivid Pure Yellow (#FFD700)\n4) Vivid Pure Green (#00B140)\n5) Vivid Pure Purple (#7A00FF)\n6) Vivid Pure Orange (#FF7A00)\n7) Pure Black (#000000)\n8) Pure White (#FFFFFF)\n9) Neutral Mid Gray (#808080)\n\nRECOLOR RULES:\n- Recolor ONLY garment pixels per panel. Preserve shading, fabric texture, wrinkles, stitching, shadows, global lighting.\n- Background / skin / hair / accessories remain unchanged (bitwise identical where possible).\n- No added objects, patterns, gradients, logos, or text. SOLID flat recolor only.\n- Uniform minimal light gutter between panels; no outer frame.\n- If multi-piece outfit, recolor only the PRIMARY garment.\n- Do NOT shift pose or facial features; identity stays identical.\n- Each of the 9 panels MUST clearly differ at a glance; maximize perceptual color distance.\n\nPANEL COUNT (CRITICAL – ZERO TOLERANCE):\n- EXACTLY 9 panels (3 columns × 3 rows). NEVER 4 rows (12 panels). NEVER 2×5, 4×3, or any other layout.\n- If you start to generate any extra row or column you MUST self-correct before finalizing output.\n- Return ONE PNG only (no textual explanation).\n\nSANITY CHECK BEFORE RETURNING: Internally verify width==${baseW*3} AND height==${baseH*3} AND panelCount==9. If any mismatch, regenerate internally and only then return.\n`;
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

export function colorGridPromptStrict(colors: string[], baseW: number, baseH: number) {
  return `
You are a professional fashion compositor.

Task: Using the provided composite photo (person + garment) AND the provided
binary GARMENT MASK (white=garment, black=non-garment), produce ONE 3x3 collage
(9 panels) showing color variations of the GARMENT ONLY.

HARD CONSTRAINTS:
- Apply recolor strictly INSIDE the white-mask region.
- All pixels OUTSIDE the mask must remain BITWISE IDENTICAL to the input.
- Preserve fabric wrinkles, stitching, shading and occlusion.
- No extra text or borders. Thin uniform gutters only.
- Each panel EXACTLY ${baseW}x${baseH}; full collage EXACTLY ${baseW*3}x${baseH*3}.
- NEVER output any other grid shape. If mismatch, internally fix before returning.

Colors (top-left → bottom-right):
${colors.map((c, i) => `${i + 1}) ${c}`).join(', ')}
`;
}
