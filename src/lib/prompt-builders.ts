import { UNIVERSAL_PROMPT } from './prompt-universal';
import { sizeHint } from './prompt-size-hint';

// Unified composite prompt builder including aspect ratio directives.
// We list explicit MUST NOT + JSON spec to prevent the model defaulting to square outputs.
export function buildCompositePrompt(w: number, h: number) {
  const aspect = w / h;
  const aspectStr = `${w}:${h}`;
  const aspectDecimal = aspect.toFixed(6);
  return [
  // (1) Top-weighted size & aspect enforcement (model pays strongest attention to the beginning)
    `SIZE_ENFORCEMENT: OUTPUT EXACTLY ${w}x${h} pixels (original person aspect ${aspectStr} = ${aspectDecimal}). THIS IS NON-SQUARE; DO NOT RETURN ANY SQUARE (1:1) SIZE (e.g. 1024x1024, 1536x1536) AND DO NOT PAD / LETTERBOX / ADD BORDERS OR BARS.`,
  // (2) Machine-readable JSON spec (extra reinforcement)
    `OUTPUT_SPEC_JSON={"width":${w},"height":${h},"aspect_ratio":"${aspectStr}","aspect_decimal":${aspectDecimal},"forbid_square":true,"strict":true}`,
  // (3) Universal task instruction
    UNIVERSAL_PROMPT.trim(),
  // (4) Secondary size hint (legacy phrasing retained)
    sizeHint(w, h),
  // (5) Hard requirements (intentional redundancy for strength)
    'Hard Requirements:',
    `- Render EXACTLY ${w}x${h}. Never internally settle on 1024x1024 or any 1:1 then upscale/pad.`,
    '- Zero padding / letterboxing / solid or transparent bars.',
    '- If vertical area seems lacking, OUTPAINT background or garment continuation; never squarify subject.',
    '- Integrate the fashion item (Image2) once only (no duplicates).',
    '- Preserve face, hair, body proportions (no distortion to force aspect).',
    '- Natural occlusion, scale, lighting & soft contact shadows.',
    '- No extra text, watermarks, borders, frames.',
  // Mode-specific directive for single color variant cell composition (fully English)
  'IF MODE=single_color_variant_cell: ABSOLUTE REQUIREMENT: Preserve person face, body, background, camera framing, global lighting 100% identical to the original composite; ONLY integrate recolored garment pixels. Do NOT alter any background pixel, skin tone, hair, hair style, or accessories. No pose change. Only the garment base diffuse color may change—no other region may shift.',
    'Self-Check BEFORE returning: if (width!=' + w + ' OR height!=' + h + ' OR aspect!=' + aspectDecimal + ') internally fix THEN return.',
    'Return only the composite image.'
  ].join('\n');
}

// 3x3 pose grid prompt builder
export function buildPoseGridPrompt(cellW: number, cellH: number) {
  const gridW = cellW * 3; const gridH = cellH * 3;
  const aspectCell = (cellW / cellH).toFixed(6);
  return [
  `POSE_GRID_SPECS_JSON={"cell_width":${cellW},"cell_height":${cellH},"grid_width":${gridW},"grid_height":${gridH},"cells":9,"columns":3,"rows":3,"cell_aspect":${aspectCell},"forbid_layouts":["3x4","4x3","4x4","2x5","5x2"],"strict":true}`,
  'Task: Generate EXACTLY a 3 columns x 3 rows (TOTAL 9) pose variation grid of the SAME person & outfit.',
  'ABSOLUTE LAYOUT RULE: It MUST be 3 wide by 3 tall. NEVER produce 3x4, 4x3, 4x4, or any layout with >9 cells. If an internal attempt becomes 10-12 cells or adds a 4th row/column, you MUST internally discard & regenerate a strict 3x3 before returning.',
  'Hard Requirements:',
  `- FULL grid EXACT ${gridW}x${gridH} px. No resizing to alternative aspect.`,
  `- EACH cell EXACT ${cellW}x${cellH} px (aspect ${aspectCell}).`,
  '- Forbidden layouts: 3x4, 4x3, any 4th row, any extra column, any padding bands to fake layout.',
  '- Do NOT shrink cells to fit a 4th row. Maintain exact math: width=cell_width*3, height=cell_height*3.',
  '- Identity, outfit, colors, fabric texture, lighting & background consistent across all 9 cells.',
  '- Only pose / subtle camera angle varies. No near duplicates; each pose distinct & fashion/editorial natural.',
  // Absolute pose preservation requirement (English only)
  'ABSOLUTE POSE REQUIREMENT: Face, garment colors/textures, background, lighting, color balance, garment details remain perfectly fixed across all 9 cells (bitwise-identical intent). ONLY pose (joint articulation / body posture) and minimal camera angle may vary. DO NOT recolor garment or background. DO NOT change garment folds except natural deformation caused by pose shift. NO new accessories / patterns / text.',
  '- Uniform ultra-thin gutters only; no thick borders / watermark / text / outer frame.',
  `CELL INDEXING (top-left -> bottom-right): (r1c1,r1c2,r1c3,r2c1,...,r3c3). EXACT count = 9.`,
  `SELF_CHECK: assert(total_cells==9 && rows==3 && cols==3 && width==${gridW} && height==${gridH}); if fails -> regenerate internally THEN return.`,
  'Return ONLY one PNG image (no textual explanation).',
  ].join('\n');
}

// 3x3 color grid prompt builder (garment color only changes)
export function buildColorGridPrompt(colors: string[], cellW: number, cellH: number) {
  const gridW = cellW * 3; const gridH = cellH * 3;
  const vivid = [
    '1) Vivid Pure Red (#FF0000)',
    '2) Vivid Pure Blue (#0055FF)',
    '3) Vivid Pure Yellow (#FFD700)',
    '4) Vivid Pure Green (#00B140)',
    '5) Vivid Pure Purple (#7A00FF)',
    '6) Vivid Pure Orange (#FF7A00)',
    '7) Pure Black (#000000)',
    '8) Pure White (#FFFFFF)',
    '9) Neutral Mid Gray (#808080)'
  ];
  // Canonical vivid palette (fixed order TL->BR). We still accept external colors param but we will instruct model to override with this palette for clarity.
  const canonical = [
    { name: 'Pure Red', hex: '#FF0000' },
    { name: 'Pure Blue', hex: '#0055FF' },
    { name: 'Pure Yellow', hex: '#FFD700' },
    { name: 'Pure Green', hex: '#00B140' },
    { name: 'Pure Purple', hex: '#7A00FF' },
    { name: 'Pure Orange', hex: '#FF7A00' },
    { name: 'Pure Black', hex: '#000000' },
    { name: 'Pure White', hex: '#FFFFFF' },
    { name: 'Neutral Mid Gray', hex: '#808080' }
  ];
  return [
  // Layout / size enforcement
    `SIZE_ENFORCEMENT: OUTPUT EXACTLY ${gridW}x${gridH} px (grid of 9) -> each cell EXACT ${cellW}x${cellH} px. DO NOT RETURN ANY 1:1 SQUARE like 1024x1024 / 1536x1536 / 2048x2048. NO PADDING, NO LETTERBOX, NO CROPPING TO FORCE SQUARE.`,
    `COLOR_GRID_SPECS_JSON={"cell_width":${cellW},"cell_height":${cellH},"grid_width":${gridW},"grid_height":${gridH},"cells":9,"columns":3,"rows":3,"panel_content":"full_person_composite","forbid_square":true,"forbid_layouts":["3x4","4x3","4x4","2x5","5x2"],"strict":true,"canonical_palette":[${canonical.map(c=>`{"name":"${c.name}","hex":"${c.hex}"}`).join(',')}]}`,
  // Task definition (full person composite maintained)
    'Task: Produce EXACTLY a 3x3 (3 columns x 3 rows = 9) FULL PERSON composite color-variation grid where ONLY the garment color changes. The person, pose, framing, background and lighting are identical to the provided composite image. Do NOT isolate or cut out the garment. USE THE CANONICAL 9-COLOR PALETTE in the exact order top-left to bottom-right for maximally distinct vivid garment recolors.',
    'ABSOLUTE LAYOUT RULE: Never output a 10th-12th panel, never add a 4th row or column. If an internal attempt is 3x4/4x3 -> regenerate as 3x3 before returning.',
    'Hard Requirements:',
    `- EACH panel EXACT ${cellW}x${cellH} px; FULL grid EXACT ${gridW}x${gridH} px.`,
    '- Panels show the full person (head to included framing) exactly like the composite reference; forbid: floating garment, mannequin, transparent cutout, cropped torso-only, item-only silhouette.',
    '- Preserve identity (face, hair), pose, anatomy, proportions, background scene, camera angle, lighting, shadows, fabric folds (except color/albedo).',
    '- Recolor ONLY base garment diffuse color; NO new patterns, logos, text, gradients, added accessories, or background edits. Color must be a clean solid base (allow natural shading) clearly matching the canonical color name + hex.',
  // New ultra-strict pixel lock section
  'PIXEL LOCK (NON-GARMENT): All non-garment pixels (skin, hair, face features, eyes, teeth, lips, background, environment objects, shadows on ground) MUST remain visually identical to the reference composite (acceptable deviation < 1% per-channel; ΔE < 2). DO NOT introduce ANY global color grading, white balance shift, contrast/brightness change, saturation shift, hue shift, sharpening halo, noise addition, vignette, bloom, or style filter. If any non-garment region shifts, internally discard and regenerate preserving those pixels unchanged.',
  'FORBIDDEN NON-GARMENT CHANGES: background tinting, ambient hue shift, skin tone drift (lighter/darker/redder), hair recolor, eye color change, lip saturation change, lighting direction change, shadow length/intensity change. ONLY the garment base albedo hue changes.',
  'METHOD: Internally segment the garment region; duplicate the original image; recolor ONLY garment pixels; then composite recolored garment back over the ORIGINAL unchanged pixels. Do NOT repaint background or person from scratch. Maintain identical edges and microtexture of fabric (only hue/value of base color layer changed).',
  'NO COLOR CAST: Ensure histogram of non-garment areas matches reference (aside from unavoidable minimal compression).',
  'HAIR COLOR LOCK: Hair hue, saturation, brightness, highlight placement, strand texture MUST remain 100% unchanged (ΔE overall < 1.5; hue shift < 1°). Any hair tint drift -> discard & regenerate.',
  // Absolute color variation requirement (English only)
  'ABSOLUTE COLOR REQUIREMENT: Person (face/skin/hair/pose), background, camera framing, lighting, shadows, garment shape/silhouette/folds/material texture remain identical across all 9 cells. Only the garment base color may change. DO NOT change pose or background. DO NOT shift skin or hair tone. Avoid brightness/contrast changes except minimal internal adjustment for consistent shading.',
    '- No square forcing / no padding bars / no aspect distortion.',
    '- Minimal uniform thin gutters; no outer frame / watermark / caption / numbering.',
    'Canonical Palette (TL→BR EXACT order, override any other palette request):',
    vivid.join('\n'),
    'Panel Distinctness: All 9 clearly distinguishable, no near duplicates. Each garment region must be instantly classifiable as the listed color (no ambiguous in-between hues).',
    'FORBIDDEN: isolated garment on blank background, garment floating without person, duplicated persons, pose changes (pose must remain constant across all 9).',
  'SELF-CHECK NON-GARMENT: verify average RGB difference of non-garment regions vs reference composite < 1% and no perceptual hue drift; if fail -> internally regenerate before returning.',
    `COLOR_SELF_VALIDATION: verify rows==3 && cols==3 && total_cells==9 && width==${gridW} && height==${gridH} && palette_matches_canonical==true; if any check fails -> internally regenerate a correct 3x3 canonical set THEN output.`,
    'Return ONLY one PNG (no text).'
  ].join('\n');
}

// Person + item direct 3x3 composite color variation prompt
export function buildColorCompositeGridPrompt(cellW: number, cellH: number) {
  const gridW = cellW * 3; const gridH = cellH * 3;
  return [
    `COLOR_COMPOSITE_GRID_JSON={"mode":"person_plus_item","cell_width":${cellW},"cell_height":${cellH},"grid_width":${gridW},"grid_height":${gridH},"cells":9,"columns":3,"rows":3,"pipeline":"recolor_item_then_composite","strict":true}`,
    'Task: Generate a 3x3 (rows=3, cols=3, total 9) grid of FULL PERSON composites. For each cell: internally recolor ONLY the garment (from the uploaded item image) to a distinct canonical vivid color, then seamlessly integrate it onto the original person image with correct fit, drape, lighting and shadows.',
    'Canonical 9 Colors (TL→BR order, MUST use exact sequence):',
    '1) Pure Red (#FF0000)\n2) Pure Blue (#0055FF)\n3) Pure Yellow (#FFD700)\n4) Pure Green (#00B140)\n5) Pure Purple (#7A00FF)\n6) Pure Orange (#FF7A00)\n7) Pure Black (#000000)\n8) Pure White (#FFFFFF)\n9) Neutral Mid Gray (#808080)',
    'Hard Requirements:',
    `- OUTPUT EXACT GRID SIZE ${gridW}x${gridH} px; each cell EXACT ${cellW}x${cellH}.`,
    '- Layout EXACT 3 columns x 3 rows. Never 3x4 / 4x3 / 4th row / extra panels.',
    '- Person: identity, face, pose, anatomy, proportions, camera angle, background, lighting remain IDENTICAL in all 9 cells.',
    '- Only garment base color changes (solid vivid tone + natural shading). No new patterns/logos/text/accessories.',
  'PIXEL LOCK (NON-GARMENT): All non-garment pixels (background, skin, hair, face details, accessories not being recolored) must remain unchanged (ΔE < 2, per-channel difference < 1%). NO global grading, NO saturation shifts outside garment. If any drift detected -> internally regenerate.',
  'METHOD: Perform localized hue/brightness remap confined strictly to garment segmentation mask; re-use original pixels elsewhere 1:1. Do NOT re-synthesize full scene from scratch for each panel.',
  'HAIR COLOR LOCK: Preserve hair base hue, saturation, specular highlight pattern, shadow tonality exactly (ΔE < 1.5, hue shift < 1°). Any change -> regenerate.',
  'ABSOLUTE COLOR COMPOSITE REQUIREMENT: Background, person face/skin/hair/pose/camera framing/lighting/shadows remain identical across all 9 cells. Only garment base color changes. DO NOT alter pose, background, body shape, facial expression, or global tone curve.',
    '- Integration: natural occlusion, consistent fabric folds, realistic contact shadows, no halos or cutout edges.',
    '- No padding bars, no outer frame, no numbering, no watermark, no added text.',
    '- Each recolor must be instantly classifiable as its target canonical color (no ambiguous tints).',
    'Forbidden: floating garment alone, mannequin stand-ins, changing background, altering pose, duplicating faces.',
  'SELF-CHECK NON-GARMENT: ensure histogram of non-garment zones matches reference across R,G,B within 1% tolerance; if not -> regenerate.',
    `Self-Check: assert(rows==3 && cols==3 && total_cells==9 && width==${gridW} && height==${gridH}); if fail -> internally regenerate before returning.`,
    'Return ONLY one PNG image (no text).'
  ].join('\n');
}


// High-res single pose refinement prompt
export function buildHiResPosePrompt() {
  return [
    'Task: Upscale & refine this single pose image.',
    'Hard Requirements:',
    '- Preserve identity (face, hair), outfit design/colors, fabric texture, pose, background style & lighting.',
    '- Improve sharpness, edge clarity, facial detail, fabric shading; NO new objects or text.',
    '- Do NOT alter colors or introduce artifacts.',
    'Return ONE refined PNG only.'
  ].join('\n');
}

// Standalone item color variation grid prompt
export function buildItemColorGridPrompt(colors: string[], cellW: number, cellH: number) {
  const gridW = cellW * 3; const gridH = cellH * 3;
  return [
    `ITEM_COLOR_GRID_JSON={"cell_width":${cellW},"cell_height":${cellH},"grid_width":${gridW},"grid_height":${gridH},"cells":9,"columns":3,"rows":3}`,
    'Task: Produce a 3x3 (9) color variation grid of ONLY the uploaded fashion item (no person).',
    'Hard Requirements:',
    `- Each panel EXACT ${cellW}x${cellH}; full grid EXACT ${gridW}x${gridH}.`,
    '- Keep geometry, silhouette, material shading, texture, specular highlights identical.',
    '- Recolor ONLY base diffuse color; NO new patterns / gradients / text / logos / extra props.',
  'ABSOLUTE ITEM COLOR REQUIREMENT: Keep geometry, silhouette, wrinkles, material texture, reflections, and background fixed; change ONLY the base color. No background pixel contamination (no color bleed).',
    '- Preserve transparency / background exactly (bitwise identical where possible).',
    '- 9 distinct colors (top-left to bottom-right follow palette order).',
    '- No padding bars, no aspect distortion, no outer frame.',
    'Palette (TL→BR):',
    colors.slice(0, 9).map((c, i) => `${i + 1}) ${c}`).join('\n'),
    'Return ONE PNG only.'
  ].join('\n');
}

export function buildHiResItemColorPrompt() {
  return [
    'Task: Upscale & refine this single item color variant image.',
    'Hard Requirements:',
    '- Preserve exact item shape, edges, material texture, lighting, shadows, reflections.',
    '- Only enhance sharpness and micro-texture; DO NOT change the color provided.',
    '- No background alteration, no new artifacts, no text or borders.',
    'Return ONE refined PNG only.'
  ].join('\n');
}

// Garment binary mask prompt (white = garment, black = everything else)
export function buildGarmentMaskPrompt(w: number, h: number) {
  return [
    `MASK_SPEC_JSON={"type":"binary_alpha","width":${w},"height":${h},"white":"garment","black":"non_garment","strict":true}`,
    `Task: Produce a STRICT binary segmentation mask of ONLY the fashion garment (white garment pixels, black for person skin, hair, face features, background, accessories, hands). Size EXACT ${w}x${h} px.`,
    'Hard Requirements:',
    `- Output EXACT resolution ${w}x${h}.`,
    '- PURE monochrome: garment = #FFFFFF, all else = #000000. No gray, no anti-alias, no soft edges.',
    '- Include ALL visible garment fabric: sleeves, collar, buttons (button metal surfaces should be BLACK unless they are integral cloth areas).',
    '- Exclude skin, hair, face, background, trees, sky, ground, shadows, hands, jewelry.',
    '- No text, no outlines, no color other than pure white / black.',
    'Edge Accuracy:',
    '- Follow garment silhouette tightly (≤1px deviation).',
    '- Avoid holes: fill interior garment areas fully unless true cutouts exist.',
    'Self-Check: if any pixel is not pure #000000 or #FFFFFF -> internally correct before returning.',
    'Return ONLY one PNG mask (no explanation).'
  ].join('\n');
}
