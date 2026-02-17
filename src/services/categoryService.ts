export const DEFAULT_PRODUCT_CATEGORIES = ['varios', 'celular', 'comida', 'hogar', 'transporte'] as const;
export const FALLBACK_CATEGORY = 'varios';

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  varios: [],
  celular: [
    'celular',
    'movil',
    'smartphone',
    'telefono',
    'iphone',
    'samsung',
    'xiaomi',
    'huawei',
    'cargador',
    'audifono',
    'funda',
  ],
  comida: [
    'pan',
    'leche',
    'arroz',
    'huevo',
    'pollo',
    'carne',
    'queso',
    'fruta',
    'verdura',
    'agua',
    'jugo',
    'cafe',
    'azucar',
    'snack',
    'galleta',
    'comida',
  ],
  hogar: [
    'detergente',
    'jabon',
    'cloro',
    'papel',
    'limpieza',
    'esponja',
    'foco',
    'bombillo',
    'toalla',
    'servilleta',
    'hogar',
    'basura',
    'cocina',
  ],
  transporte: [
    'uber',
    'didi',
    'taxi',
    'bus',
    'autobus',
    'metro',
    'tren',
    'peaje',
    'gasolina',
    'diesel',
    'combustible',
    'pasaje',
    'transporte',
    'parqueo',
  ],
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function detectProductCategory(name: string): string {
  const normalizedName = normalizeText(name);

  for (const category of DEFAULT_PRODUCT_CATEGORIES) {
    if (category === FALLBACK_CATEGORY) {
      continue;
    }

    const found = CATEGORY_KEYWORDS[category].some((keyword) => normalizedName.includes(keyword));
    if (found) {
      return category;
    }
  }

  return FALLBACK_CATEGORY;
}
