export type ReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type MoneyCandidate = {
  token: string;
  amount: number;
  hasCurrency: boolean;
  start: number;
  end: number;
};

export type DetectedTotal = {
  amount: number;
  sourceLine: string;
  confidence: number;
  reason: string;
};

export type TotalCandidateDebug = {
  lineIndex: number;
  line: string;
  token: string;
  amount: number;
  score: number;
  reason: string;
  selected: boolean;
};

export type ReceiptDebugInfo = {
  normalizedText: string;
  normalizedLines: string[];
  totalCandidates: TotalCandidateDebug[];
  selectedTotal: DetectedTotal | null;
};

export type ReceiptAnalysis = {
  items: ReceiptItem[];
  totalAmount: number;
  totalUnits: number;
  detectedTotal?: DetectedTotal;
  warnings: string[];
  rawLines: string[];
  debug?: ReceiptDebugInfo;
};

const CURRENCY_REGEX = /\u20A1|¢|\bcrc\b|\bcolones?\b/i;
const MONEY_TOKEN_REGEX =
  /(?:(?:\u20A1|¢)\s*|(?:\bcrc\b)\s*)?[0-9OoIlSsB,\.\s]{2,}(?:,\d{1,2}|\.\d{1,2})?/gi;

const HIGH_POSITIVE_TOTAL = [
  'total a pagar',
  'monto total',
  'importe total',
  'gran total',
  'total venta',
  'total colones',
  'total crc',
  'monto cobrado',
  'pago realizado',
  'monto pagado',
];

const POSITIVE_TOTAL = ['total', 'cobrar'];

const NEGATIVE_TOTAL = [
  'subtotal',
  'impuesto',
  'iva',
  'i.v.a',
  'descuento',
  'vuelto',
  'cambio',
  'efectivo',
  'tarjeta',
  'recibido',
  'saldo',
  'autorizacion',
  'referencia',
  'terminal',
  'afiliado',
  'cuenta',
  'factura electronica',
  'clave',
  'consecutivo',
];

const NON_PRODUCT_LINE = [
  'cedula juridica',
  'cedula',
  'telefono',
  'direccion',
  'email',
  'fecha',
  'hora',
  'factura',
  'consecutivo',
  'clave',
  'autorizacion',
  'referencia',
  'tarjeta',
  'visa',
  'mastercard',
  'sinpe',
  'terminal',
  'afiliado',
  'cajero',
  'cliente',
  'gracias por su compra',
  'subtotal',
  'impuesto',
  'iva',
  'descuento',
  'vuelto',
  'cambio',
  'monto total',
  'total a pagar',
];

function normalizeText(value: string): string {
  return value
    .replace(/â‚¡|Â¢/g, '\u20A1')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function normalizeOcrText(rawText: string): string {
  return normalizeText(rawText)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeMoneyToken(raw: string): string {
  return raw
    .replace(/â‚¡|Â¢/g, '\u20A1')
    .replace(/\bcrc\b/gi, '')
    .replace(/\u20A1|¢/g, '')
    .replace(/[OoQ]/g, '0')
    .replace(/[lI|!]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[^\d,.\s-]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export function parseMoneyToken(raw: string): number {
  const cleaned = normalizeMoneyToken(raw);
  if (!cleaned || !/\d/.test(cleaned)) {
    return Number.NaN;
  }

  const unsigned = cleaned.startsWith('-') ? cleaned.slice(1) : cleaned;
  const negative = cleaned.startsWith('-');
  const commaCount = (unsigned.match(/,/g) ?? []).length;
  const dotCount = (unsigned.match(/\./g) ?? []).length;
  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');

  const parseAsInteger = () => Number((negative ? '-' : '') + unsigned.replace(/[.,]/g, ''));

  if (lastComma === -1 && lastDot === -1) {
    return Number((negative ? '-' : '') + unsigned);
  }

  const applyDecimal = (idx: number): number => {
    const integerPart = unsigned.slice(0, idx).replace(/[.,]/g, '');
    const decimalPart = unsigned.slice(idx + 1).replace(/[^\d]/g, '');
    return Number(`${negative ? '-' : ''}${integerPart}.${decimalPart}`);
  };

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalIndex = Math.max(lastComma, lastDot);
    const digitsAfter = unsigned.length - decimalIndex - 1;
    if (digitsAfter >= 1 && digitsAfter <= 2) {
      return applyDecimal(decimalIndex);
    }
    return parseAsInteger();
  }

  const separator = lastComma !== -1 ? ',' : '.';
  const separatorCount = separator === ',' ? commaCount : dotCount;
  const lastIndex = separator === ',' ? lastComma : lastDot;
  const digitsAfter = unsigned.length - lastIndex - 1;

  if (digitsAfter >= 1 && digitsAfter <= 2) {
    return applyDecimal(lastIndex);
  }

  if (digitsAfter === 3 && separatorCount === 1) {
    return parseAsInteger();
  }

  return parseAsInteger();
}

export function extractMoneyCandidates(line: string): MoneyCandidate[] {
  const candidates: MoneyCandidate[] = [];

  for (const match of line.matchAll(MONEY_TOKEN_REGEX)) {
    const token = match[0].trim();
    if (!token) {
      continue;
    }

    const amount = parseMoneyToken(token);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const digitCount = (token.match(/\d/g) ?? []).length;
    if (digitCount < 2) {
      continue;
    }

    candidates.push({
      token,
      amount: Number(amount.toFixed(2)),
      hasCurrency: CURRENCY_REGEX.test(token),
      start: match.index ?? 0,
      end: (match.index ?? 0) + token.length,
    });
  }

  return candidates;
}

function scoreTotalCandidate(
  normalizedLine: string,
  lineIndex: number,
  totalLines: number,
  candidate: MoneyCandidate
): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  for (const keyword of HIGH_POSITIVE_TOTAL) {
    if (normalizedLine.includes(keyword)) {
      score += 8;
      reasons.push(`matched:${keyword}`);
    }
  }

  for (const keyword of POSITIVE_TOTAL) {
    if (normalizedLine.includes(keyword)) {
      score += 3;
      reasons.push(`contains:${keyword}`);
    }
  }

  if (lineIndex >= Math.floor(totalLines * 0.65)) {
    score += 2;
    reasons.push('near-bottom');
  }

  if (candidate.hasCurrency) {
    score += 2;
    reasons.push('currency');
  }

  for (const keyword of NEGATIVE_TOTAL) {
    if (normalizedLine.includes(keyword)) {
      score -= 7;
      reasons.push(`negative:${keyword}`);
    }
  }

  if (/\b(\d{8,}|\d{4}[- ]\d{4}[- ]\d{4,}|\+?\d{8,})\b/.test(normalizedLine)) {
    score -= 7;
    reasons.push('id-like-number');
  }

  return { score, reason: reasons.join(', ') };
}

type TotalCandidateScored = {
  lineIndex: number;
  line: string;
  candidate: MoneyCandidate;
  score: number;
  reason: string;
};

function detectQuantity(line: string): number {
  const patterns: RegExp[] = [
    /^\s*(\d+)\s*[xX]\b/,
    /\bqty\s*[:\-]?\s*(\d+)\b/i,
    /\b(\d+)\s*(?:und|un|ud|uds|unidad|unidades)\b/i,
    /\bx\s*(\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }
    const qty = Number(match[1]);
    if (Number.isFinite(qty) && qty > 0) {
      return qty;
    }
  }

  return 1;
}

function cleanItemName(line: string): string {
  return line
    .replace(MONEY_TOKEN_REGEX, ' ')
    .replace(/\bqty\s*[:\-]?\s*\d+\b/gi, ' ')
    .replace(/^\s*\d+\s*[xX]\s*/g, ' ')
    .replace(/\b\d+\s*(?:und|un|ud|uds|unidad|unidades)\b/gi, ' ')
    .replace(/[|*_=\-]{2,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function shouldIgnoreProductLine(rawLine: string): boolean {
  const normalized = normalizeText(rawLine).toLowerCase();
  if (normalized.length < 2) {
    return true;
  }

  if (NON_PRODUCT_LINE.some((token) => normalized.includes(token))) {
    return true;
  }

  const letters = (normalized.match(/[a-z]/g) ?? []).length;
  const digits = (normalized.match(/\d/g) ?? []).length;
  if (letters === 0 && digits > 0) {
    return true;
  }

  return false;
}

function parseProductsFromLines(lines: string[]): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  let unnamedCounter = 1;

  for (const line of lines) {
    if (shouldIgnoreProductLine(line)) {
      continue;
    }

    const amounts = extractMoneyCandidates(line).map((candidate) => candidate.amount);
    if (amounts.length === 0) {
      continue;
    }

    const quantity = detectQuantity(line);
    const lineTotal = amounts[amounts.length - 1];
    let unitPrice = amounts.length > 1 ? amounts[amounts.length - 2] : lineTotal;

    if (quantity > 1 && amounts.length === 1) {
      unitPrice = Number((lineTotal / quantity).toFixed(2));
    }

    const maybeComputed = Number((unitPrice * quantity).toFixed(2));
    const finalLineTotal =
      quantity > 1 && Math.abs(maybeComputed - lineTotal) <= 0.15 ? maybeComputed : lineTotal;

    const cleanedName = cleanItemName(line);
    const name = cleanedName.length > 0 ? cleanedName : `Producto ${unnamedCounter++}`;

    items.push({
      name,
      quantity,
      unitPrice: Number(unitPrice.toFixed(2)),
      lineTotal: Number(finalLineTotal.toFixed(2)),
    });
  }

  return items;
}

export function detectReceiptTotal(rawText: string): DetectedTotal | null {
  const normalizedText = normalizeOcrText(rawText);
  const rawLines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const scoredCandidates: TotalCandidateScored[] = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    const normalizedLine = normalizeText(line).toLowerCase();
    const candidates = extractMoneyCandidates(line);

    for (const candidate of candidates) {
      const scored = scoreTotalCandidate(normalizedLine, i, rawLines.length, candidate);
      scoredCandidates.push({
        lineIndex: i,
        line,
        candidate,
        score: scored.score,
        reason: scored.reason || 'best-score',
      });
    }
  }

  if (scoredCandidates.length === 0) {
    return null;
  }

  scoredCandidates.sort((a, b) => b.score - a.score);
  const best = scoredCandidates[0];
  if (!best) {
    return null;
  }

  const confidence = Math.max(0, Math.min(1, Number(((best.score + 12) / 24).toFixed(2))));
  if (confidence <= 0.2) {
    return null;
  }

  return {
    amount: Number(best.candidate.amount.toFixed(2)),
    sourceLine: best.line,
    confidence,
    reason: best.reason,
  };
}

export function analyzeReceiptText(rawText: string): ReceiptAnalysis {
  const normalized = normalizeOcrText(rawText);
  const rawLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const items = parseProductsFromLines(rawLines);
  const itemsTotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const detectedTotal = detectReceiptTotal(rawText);
  const warnings: string[] = [];

  if (!detectedTotal || detectedTotal.confidence < 0.75) {
    warnings.push('No pude detectar el total del recibo. Revisa el texto o ingrésalo manualmente.');
  }

  const hasConfidentTotal = Boolean(detectedTotal && detectedTotal.confidence >= 0.75);
  const chosenTotal = hasConfidentTotal ? detectedTotal!.amount : itemsTotal;

  if (detectedTotal && items.length > 0 && Math.abs(detectedTotal.amount - itemsTotal) > 1) {
    warnings.push('El total detectado no coincide con la suma de productos. Revísalo antes de guardar.');
  }

  const totalCandidatesDebug: TotalCandidateDebug[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    const normalizedLine = normalizeText(line).toLowerCase();
    const candidates = extractMoneyCandidates(line);
    for (const candidate of candidates) {
      const scored = scoreTotalCandidate(normalizedLine, i, rawLines.length, candidate);
      totalCandidatesDebug.push({
        lineIndex: i,
        line,
        token: candidate.token,
        amount: candidate.amount,
        score: scored.score,
        reason: scored.reason || 'best-score',
        selected: Boolean(
          detectedTotal &&
            detectedTotal.amount === candidate.amount &&
            detectedTotal.sourceLine === line
        ),
      });
    }
  }
  totalCandidatesDebug.sort((a, b) => b.score - a.score);

  return {
    items,
    totalAmount: Number((chosenTotal > 0 ? chosenTotal : detectedTotal?.amount ?? 0).toFixed(2)),
    totalUnits,
    detectedTotal: detectedTotal ?? undefined,
    warnings,
    rawLines,
    debug: {
      normalizedText: normalized,
      normalizedLines: rawLines,
      totalCandidates: totalCandidatesDebug,
      selectedTotal: detectedTotal,
    },
  };
}

export function extractSemanticReceiptTotal(rawText: string): number {
  const detected = detectReceiptTotal(rawText);
  return detected ? detected.amount : 0;
}

// Quick manual verification helper for CR OCR amount formats.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function debugParseCrAmountsExample(): Record<string, number> {
  const samples = [
    '2.450,00',
    '2,450.00',
    'CRC 2450',
    'CRC 2 450',
    '2450,00',
    '2.450',
    '2,450',
    '2450',
    '1.234.567,89',
    '1,234,567.89',
    '\u20A12.45O,0O',
  ];

  return samples.reduce<Record<string, number>>((acc, sample) => {
    acc[sample] = parseMoneyToken(sample);
    return acc;
  }, {});
}
