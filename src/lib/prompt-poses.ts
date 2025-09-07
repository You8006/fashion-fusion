// Pose generation prompts
export function poseGridPrompt(baseW: number, baseH: number) {
  const example = `${baseW}x${baseH} cell -> ${baseW * 3}x${baseH * 3} grid`;
  return [
    'Generate a 3x3 grid (9 cells) of DIFFERENT full or mid-body fashion poses.',
    'CRITICAL NON-SQUARE / ASPECT RATIO CONSTRAINTS:',
    `- ORIGINAL single image aspect ratio MUST be preserved in EVERY cell: ${baseW}:${baseH}.`,
    `- Each cell EXACT pixel size: ${baseW}x${baseH} (no cropping, no padding to make square, no stretching).`,
    `- Overall grid resolution EXACT: ${baseW * 3}x${baseH * 3} (${example}).`,
    '- If original ratio is not 1:1 you MUST NOT coerce cells into squares. Do NOT add extra side bars to square it.',
    '- Reject (do not produce) any internal layout that squares or crops the content; instead keep full frame.',
    'CONSISTENCY:',
    'Same identity (face likeness, hair), body type, outfit design, fabric texture, colors, accessories, background style and lighting in ALL cells.',
    'VARIATION:',
    'Change ONLY the pose and subtle camera framing. Natural editorial fashion poses; no extreme distortions; no duplicates.',
    'QUALITY & GUTTERS:',
    '- Uniform minimal gutters between cells; no thick borders; no outer frame; no text/watermarks.',
    'OUTPUT:',
    'Return ONE PNG image only containing the 3x3 grid under these constraints.',
  ].join('\n');
}

export function hiResPosePrompt() {
  return [
    'Refine this single pose into a high-resolution photorealistic fashion image.',
    'Preserve: identity (face likeness, hair), outfit design & colors, fabric texture, accessories, background style, lighting mood.',
    'Keep the given pose composition. Improve sharpness, edge clarity (especially around limbs & garment edges), facial detail and fabric shading.',
    'Do NOT change colors, pattern layout, or introduce new objects. No text. Return one PNG image only.'
  ].join('\n');
}
