export type AppCurrencyCode =
  | 'CRC' | 'USD' | 'EUR' | 'JPY' | 'GBP' | 'CHF' | 'CAD' | 'AUD' | 'NZD'
  | 'CNY' | 'HKD' | 'SGD' | 'KRW' | 'INR' | 'MXN' | 'BRL' | 'ARS' | 'CLP'
  | 'COP' | 'PEN' | 'UYU' | 'PYG' | 'BOB' | 'DOP' | 'GTQ' | 'HNL' | 'NIO'
  | 'PAB' | 'VES';

export type CurrencyOption = {
  code: AppCurrencyCode;
  symbol: string;
  nameEs: string;
  nameEn: string;
  nameIt: string;
  nameJa: string;
  decimals: number;
};

export const DEFAULT_CURRENCY_CODE: AppCurrencyCode = 'CRC';

// Account balances are kept in their original currency. MyFinance never silently converts them.
export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'CRC', symbol: '₡', nameEs: 'Colón costarricense', nameEn: 'Costa Rican colón', nameIt: 'Colón costaricano', nameJa: 'コスタリカ・コロン', decimals: 2 },
  { code: 'USD', symbol: '$', nameEs: 'Dólar estadounidense', nameEn: 'US dollar', nameIt: 'Dollaro statunitense', nameJa: '米ドル', decimals: 2 },
  { code: 'EUR', symbol: '€', nameEs: 'Euro', nameEn: 'Euro', nameIt: 'Euro', nameJa: 'ユーロ', decimals: 2 },
  { code: 'JPY', symbol: '¥', nameEs: 'Yen japonés', nameEn: 'Japanese yen', nameIt: 'Yen giapponese', nameJa: '日本円', decimals: 0 },
  { code: 'GBP', symbol: '£', nameEs: 'Libra esterlina', nameEn: 'Pound sterling', nameIt: 'Sterlina britannica', nameJa: '英ポンド', decimals: 2 },
  { code: 'CHF', symbol: 'CHF', nameEs: 'Franco suizo', nameEn: 'Swiss franc', nameIt: 'Franco svizzero', nameJa: 'スイス・フラン', decimals: 2 },
  { code: 'CAD', symbol: 'C$', nameEs: 'Dólar canadiense', nameEn: 'Canadian dollar', nameIt: 'Dollaro canadese', nameJa: 'カナダドル', decimals: 2 },
  { code: 'AUD', symbol: 'A$', nameEs: 'Dólar australiano', nameEn: 'Australian dollar', nameIt: 'Dollaro australiano', nameJa: 'オーストラリアドル', decimals: 2 },
  { code: 'NZD', symbol: 'NZ$', nameEs: 'Dólar neozelandés', nameEn: 'New Zealand dollar', nameIt: 'Dollaro neozelandese', nameJa: 'ニュージーランドドル', decimals: 2 },
  { code: 'CNY', symbol: '¥', nameEs: 'Yuan chino', nameEn: 'Chinese yuan', nameIt: 'Yuan cinese', nameJa: '中国人民元', decimals: 2 },
  { code: 'HKD', symbol: 'HK$', nameEs: 'Dólar de Hong Kong', nameEn: 'Hong Kong dollar', nameIt: 'Dollaro di Hong Kong', nameJa: '香港ドル', decimals: 2 },
  { code: 'SGD', symbol: 'S$', nameEs: 'Dólar de Singapur', nameEn: 'Singapore dollar', nameIt: 'Dollaro di Singapore', nameJa: 'シンガポールドル', decimals: 2 },
  { code: 'KRW', symbol: '₩', nameEs: 'Won surcoreano', nameEn: 'South Korean won', nameIt: 'Won sudcoreano', nameJa: '韓国ウォン', decimals: 0 },
  { code: 'INR', symbol: '₹', nameEs: 'Rupia india', nameEn: 'Indian rupee', nameIt: 'Rupia indiana', nameJa: 'インドルピー', decimals: 2 },
  { code: 'MXN', symbol: '$', nameEs: 'Peso mexicano', nameEn: 'Mexican peso', nameIt: 'Peso messicano', nameJa: 'メキシコペソ', decimals: 2 },
  { code: 'BRL', symbol: 'R$', nameEs: 'Real brasileño', nameEn: 'Brazilian real', nameIt: 'Real brasiliano', nameJa: 'ブラジルレアル', decimals: 2 },
  { code: 'ARS', symbol: '$', nameEs: 'Peso argentino', nameEn: 'Argentine peso', nameIt: 'Peso argentino', nameJa: 'アルゼンチンペソ', decimals: 2 },
  { code: 'CLP', symbol: '$', nameEs: 'Peso chileno', nameEn: 'Chilean peso', nameIt: 'Peso cileno', nameJa: 'チリペソ', decimals: 0 },
  { code: 'COP', symbol: '$', nameEs: 'Peso colombiano', nameEn: 'Colombian peso', nameIt: 'Peso colombiano', nameJa: 'コロンビアペソ', decimals: 2 },
  { code: 'PEN', symbol: 'S/', nameEs: 'Sol peruano', nameEn: 'Peruvian sol', nameIt: 'Sol peruviano', nameJa: 'ペルーソル', decimals: 2 },
  { code: 'UYU', symbol: '$U', nameEs: 'Peso uruguayo', nameEn: 'Uruguayan peso', nameIt: 'Peso uruguaiano', nameJa: 'ウルグアイペソ', decimals: 2 },
  { code: 'PYG', symbol: '₲', nameEs: 'Guaraní paraguayo', nameEn: 'Paraguayan guaraní', nameIt: 'Guaraní paraguaiano', nameJa: 'パラグアイ・グアラニー', decimals: 0 },
  { code: 'BOB', symbol: 'Bs', nameEs: 'Boliviano', nameEn: 'Bolivian boliviano', nameIt: 'Boliviano', nameJa: 'ボリビアーノ', decimals: 2 },
  { code: 'DOP', symbol: 'RD$', nameEs: 'Peso dominicano', nameEn: 'Dominican peso', nameIt: 'Peso dominicano', nameJa: 'ドミニカペソ', decimals: 2 },
  { code: 'GTQ', symbol: 'Q', nameEs: 'Quetzal guatemalteco', nameEn: 'Guatemalan quetzal', nameIt: 'Quetzal guatemalteco', nameJa: 'グアテマラ・ケツァル', decimals: 2 },
  { code: 'HNL', symbol: 'L', nameEs: 'Lempira hondureño', nameEn: 'Honduran lempira', nameIt: 'Lempira honduregna', nameJa: 'ホンジュラス・レンピラ', decimals: 2 },
  { code: 'NIO', symbol: 'C$', nameEs: 'Córdoba nicaragüense', nameEn: 'Nicaraguan córdoba', nameIt: 'Córdoba nicaraguense', nameJa: 'ニカラグア・コルドバ', decimals: 2 },
  { code: 'PAB', symbol: 'B/.', nameEs: 'Balboa panameño', nameEn: 'Panamanian balboa', nameIt: 'Balboa panamense', nameJa: 'パナマ・バルボア', decimals: 2 },
  { code: 'VES', symbol: 'Bs.', nameEs: 'Bolívar venezolano', nameEn: 'Venezuelan bolívar', nameIt: 'Bolívar venezuelano', nameJa: 'ベネズエラ・ボリバル', decimals: 2 },
];

export function isSupportedCurrencyCode(value: string): value is AppCurrencyCode {
  return CURRENCY_OPTIONS.some((currency) => currency.code === value);
}

export function getCurrencyOption(code: string): CurrencyOption {
  return CURRENCY_OPTIONS.find((currency) => currency.code === code) ?? CURRENCY_OPTIONS[0];
}

export function roundCurrencyAmount(value: number, currencyCode: string): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const decimals = getCurrencyOption(currencyCode).decimals;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
