// Universal prompt for one-pass auto classification + composition
// 人物 + ファッションアイテム(種類自動判別) 合成用
export const UNIVERSAL_PROMPT = `
You are a professional fashion compositor.
You receive two images: [Image1]=person photo, [Image2]=a fashion item (hat, sunglasses, top, pants, dress, skirt, logo, shoes, bag, etc.).

Task:
1) From Image2, IDENTIFY the item type automatically (no user input).
2) Composite the item onto the person in Image1 using the correct rules for that type.
3) Keep the person's face, hair, body shape, pose, and background unchanged.
4) Match perspective, scale, lighting, color, and add soft realistic contact shadows.
5) Output exactly one photorealistic image (no extra text).

Placement rules:
- If HAT: place on head; align with head tilt; allow hair to overlap the brim where appropriate.
- If SUNGLASSES: align with the eyes using the interpupillary line; respect face curvature; keep eyelashes/eyebrows visible where natural.
- If TOP (shirt/sweater/jacket): replace the upper garment only; follow shoulder slope, neckline, sleeve length; keep hands and background intact.
- If PANTS (or SKIRT/DRESS): replace the lower garment only; fit waist/hips/legs naturally; preserve shoes and floor shadows unless the item itself is shoes.
- If SHOES: align with feet orientation and floor plane; maintain contact shadows.
- If LOGO/PRINT: warp to the fabric folds; look like it is printed/embroidered; do not modify the face or body.
- If BAG: place on shoulder/hand naturally with proper occlusion; keep arm/hand relationships realistic.
- Otherwise (unknown): overlay naturally onto the most plausible region without altering anatomy or background.

Extra:
- If Image2 has a plain white background, segment it cleanly before compositing.
- Avoid adding any text, watermarks, or borders yourself.
- Target size ≈ 1024×1024.
`;
