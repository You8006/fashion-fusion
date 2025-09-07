export const CLASSIC_9 = [
  "black", "white", "navy",
  "beige", "olive", "burgundy",
  "charcoal gray", "cobalt blue", "khaki"
];

export const PASTEL_9 = [
  "pastel pink", "pastel mint", "pastel lavender",
  "pastel yellow", "pastel peach", "pastel sky blue",
  "sage green", "powder blue", "cream white"
];

export type PaletteId = 'classic9' | 'pastel9';

export const PALETTES: Record<PaletteId, { label: string; colors: string[] }> = {
  classic9: { label: 'Classic 9', colors: CLASSIC_9 },
  pastel9: { label: 'Pastel 9', colors: PASTEL_9 },
};
