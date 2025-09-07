export type Preset = {
  id: string;
  label: string;
  kind: "add_remove" | "semantic_mask" | "style_transfer" | "multi_image" | "hi_fidelity";
  prompt: (vars?: Record<string, string>) => string;
};

const keepCommon = `
必ず守ること:
- 顔・髪・体型・ポーズ・背景は一切変更しない
- 遠近・スケール・自然なオクルージョン（髪や腕の前後関係）を正しく扱う
- 色温度/露出/ノイズ量を人物側に合わせ、接触部に柔らかい影を追加
- 出力は写真風の1枚のみ。文字や透かしは追加しない
- 解像度はおよそ 1024x1024 を目安`;

export const PRESETS: Preset[] = [
  {
    id: "add_item_hat",
    label: "要素の追加/削除（帽子を被せる）",
    kind: "add_remove",
    prompt: ({ item = "黒いフェルトの中折れ帽" } = {}) => `
提供画像の人物に、${item} を自然に追加する。頭の傾きに沿って配置し、
必要に応じて前髪がツバの上に重なるようにする。${keepCommon}`,
  },
  {
    id: "semantic_mask_top",
    label: "インペイント（セマンティック）上半身を差し替え",
    kind: "semantic_mask",
    prompt: ({ target = "上半身の服", newItem = "白いカジュアルシャツ" } = {}) => `
提供画像の ${target} のみを ${newItem} に置き換える。
袖丈・肩線・襟の形に一致させ、手や背景は一切変更しない。${keepCommon}`,
  },
  {
    id: "style_transfer_fabric",
    label: "画風/質感転送（テクスチャ適用）",
    kind: "style_transfer",
    prompt: ({ region = "上着", styleSrc = "2枚目のファブリック" } = {}) => `
1枚目の人物写真の ${region} に、${styleSrc} の質感/柄を適用して再構成する。
元の形状とドレープは維持したまま、布地のディテールと色調のみ転送する。${keepCommon}`,
  },
  {
    id: "multi_image_dress_on_person",
    label: "高度合成：別画像の服を着せる",
    kind: "multi_image",
    prompt: ({ who = "1枚目の女性", itemSrc = "2枚目の青い花柄ワンピース" } = {}) => `
プロフェッショナルなEC商品写真として、${who} に ${itemSrc} を着用させた全身写真を1枚生成。
照明・色・影を人物の屋外環境に一致させる。裾やウエストは自然にフィット。${keepCommon}`,
  },
  {
    id: "hi_fidelity_logo",
    label: "高忠実度保持（ロゴ配置）",
    kind: "hi_fidelity",
    prompt: ({ logo = "2枚目のロゴ", region = "1枚目の黒いTシャツ胸元" } = {}) => `
${region} に ${logo} を自然に載せる。布のシワに沿って変形させ、
インクの乗り方/光沢/微細な滲みを再現。人物の顔や目、髪は完全に不変。${keepCommon}`,
  },
];
