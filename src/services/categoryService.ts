export const DEFAULT_PRODUCT_CATEGORIES = ['varios', 'celular', 'comida', 'hogar', 'transporte'] as const;
export const FALLBACK_CATEGORY = 'varios';

type CategoryName = (typeof DEFAULT_PRODUCT_CATEGORIES)[number];

type CategoryRule = {
  category: CategoryName;
  keywords: string[];
  exact?: string[];
  weight?: number;
  contextualKeywords?: string[];
};

type CategorySuggestion = {
  category: string;
  confidence: number;
};

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'comida',
    weight: 3,
    exact: [
      'masxmenos',
      'mas x menos',
      'maxi pali',
      'fresh market',
      'price smart',
      'taco bell',
      'burger king',
      'dos pinos',
    ],
    keywords: [
      'walmart',
      'mas x menos',
      'pali',
      'maxi pali',
      'automercado',
      'fresh market',
      'pricesmart',
      'megasuper',
      'perimercados',
      'am pm',
      'ampm',
      'musmanni',
      'spoon',
      'mcdonalds',
      'kfc',
      'subway',
      'soda',
      'restaurante',
      'casado',
      'gallo pinto',
      'cafe',
      'pizza',
      'pollo',
      'arroz',
      'frijoles',
      'leche',
      'coca cola',
      'pepsi',
      'pan',
      'carne',
      'queso',
      'huevos',
    ],
  },
  {
    category: 'transporte',
    weight: 3,
    exact: ['in drive', 'recarga bus'],
    contextualKeywords: ['super', 'regular', 'recarga'],
    keywords: [
      'uber',
      'didi',
      'indrive',
      'taxi',
      'bus',
      'autobus',
      'tren',
      'gasolina',
      'super',
      'regular',
      'diesel',
      'parqueo',
      'peaje',
      'recarga',
      'pasaje',
    ],
  },
  {
    category: 'hogar',
    weight: 2,
    exact: ['pequeno mundo', 'pequeno  mundo', 'pequeño mundo'],
    keywords: [
      'epa',
      'cemaco',
      'pequeno mundo',
      'pequeño mundo',
      'detergente',
      'cloro',
      'suavizante',
      'jabon',
      'papel higienico',
      'servilleta',
      'limpieza',
      'escoba',
      'bombillo',
      'cocina',
      'bano',
    ],
  },
  {
    category: 'celular',
    weight: 2,
    exact: ['recarga celular', 'cable usb'],
    keywords: [
      'kolbi',
      'claro',
      'liberty',
      'movistar',
      'internet',
      'telefono',
      'smartphone',
      'cargador',
      'audifonos',
      'funda',
      'cable usb',
    ],
  },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s\n]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizeInlineText(value: string): string {
  return normalizeText(value).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function includesWholeWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
  return pattern.test(text);
}

function hasTransportContext(text: string): boolean {
  const contextWords = ['gasolina', 'diesel', 'combustible', 'estacion', 'servicio', 'bomba'];
  return contextWords.some((word) => includesWholeWord(text, word));
}

function scoreRule(normalizedText: string, rule: CategoryRule): number {
  const weight = rule.weight ?? 1;
  let score = 0;

  for (const exact of rule.exact ?? []) {
    const normalizedExact = normalizeText(exact);
    if (normalizedExact && includesWholeWord(normalizedText, normalizedExact)) {
      score += 6 * weight;
    }
  }

  for (const keyword of rule.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) {
      continue;
    }

    if (
      rule.contextualKeywords?.includes(normalizedKeyword) &&
      !hasTransportContext(normalizedText)
    ) {
      continue;
    }

    if (includesWholeWord(normalizedText, normalizedKeyword)) {
      score += 2 * weight;
      continue;
    }

    if (normalizedText.includes(normalizedKeyword) && normalizedKeyword.length >= 5) {
      score += 1 * weight;
    }
  }

  return score;
}

export function suggestCategoryFromText(text: string): CategorySuggestion {
  const normalized = normalizeInlineText(text);
  if (!normalized) {
    return { category: FALLBACK_CATEGORY, confidence: 0 };
  }

  let bestCategory: string = FALLBACK_CATEGORY;
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    const score = scoreRule(normalized, rule);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }

  if (bestScore <= 0) {
    return { category: FALLBACK_CATEGORY, confidence: 0 };
  }

  return {
    category: bestCategory,
    confidence: Math.min(1, Number((bestScore / 18).toFixed(2))),
  };
}

export function detectCategoryFromReceiptText(rawText: string): string {
  const normalized = normalizeText(rawText);
  if (!normalized) {
    return FALLBACK_CATEGORY;
  }

  // Try full text first (merchant + lines), then line by line for tie-break.
  const full = suggestCategoryFromText(normalized);
  if (full.confidence >= 0.5) {
    return full.category;
  }

  const lineScores = new Map<string, number>();
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const result = suggestCategoryFromText(line);
    const prev = lineScores.get(result.category) ?? 0;
    lineScores.set(result.category, prev + result.confidence);
  }

  let bestCategory = FALLBACK_CATEGORY;
  let bestScore = 0;
  for (const [category, score] of lineScores.entries()) {
    if (category === FALLBACK_CATEGORY) {
      continue;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestScore > 0.6 ? bestCategory : FALLBACK_CATEGORY;
}

export function detectProductCategory(name: string): string {
  return suggestCategoryFromText(name).category;
}
