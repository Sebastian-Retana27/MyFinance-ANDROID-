export type ReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type ReceiptAnalysis = {
  items: ReceiptItem[];
  totalAmount: number;
  totalUnits: number;
};

const IGNORE_LINE_PATTERNS = [
  /\btotal\b/i,
  /\bsubtotal\b/i,
  /\bimpuesto\b/i,
  /\bitbms\b/i,
  /\biva\b/i,
  /\bchange\b/i,
  /\bvuelto\b/i,
  /\bpagado\b/i,
  /\bvisa\b/i,
  /\bmaster\b/i,
  /\bfecha\b/i,
  /\bhora\b/i,
  /\btransaccion\b/i,
];

const MONEY_TOKEN_REGEX = /\$?\s*\d[\d.,]*/g;

function parseMoneyToken(raw: string): number {
  const cleaned = raw.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned || !/\d/.test(cleaned)) {
    return Number.NaN;
  }

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma === -1 && lastDot === -1) {
    return Number(cleaned);
  }

  const decimalIndex = Math.max(lastComma, lastDot);
  const digitsAfter = cleaned.length - decimalIndex - 1;

  if (digitsAfter >= 1 && digitsAfter <= 2) {
    const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
    const decimalPart = cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, '');
    return Number(`${integerPart}.${decimalPart}`);
  }

  return Number(cleaned.replace(/[.,]/g, ''));
}

function detectQuantity(line: string): number {
  const patterns = [
    /(\d+)\s*[xX]\b/,
    /\bx\s*(\d+)\b/i,
    /\b(\d+)\s*(?:ud|uds|unidad|unidades)\b/i,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      const quantity = Number(match[1]);
      if (Number.isFinite(quantity) && quantity > 0) {
        return quantity;
      }
    }
  }

  return 1;
}

function extractName(line: string): string {
  return line
    .replace(MONEY_TOKEN_REGEX, ' ')
    .replace(/\b\d+\s*[xX]\b/g, ' ')
    .replace(/\bx\s*\d+\b/gi, ' ')
    .replace(/\b\d+\s*(?:ud|uds|unidad|unidades)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\-*_=]+/g, ' ')
    .trim();
}

function shouldIgnoreLine(line: string): boolean {
  if (line.length < 3) {
    return true;
  }

  return IGNORE_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

export function analyzeReceiptText(rawText: string): ReceiptAnalysis {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: ReceiptItem[] = [];
  let unnamedCount = 1;

  for (const line of lines) {
    if (shouldIgnoreLine(line)) {
      continue;
    }

    const parsedAmounts = (line.match(MONEY_TOKEN_REGEX) ?? [])
      .map((token) => parseMoneyToken(token))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (parsedAmounts.length === 0) {
      continue;
    }

    const quantity = detectQuantity(line);
    const lastAmount = parsedAmounts[parsedAmounts.length - 1];
    if (!Number.isFinite(lastAmount) || lastAmount <= 0) {
      continue;
    }

    let unitPrice = lastAmount;
    let lineTotal = lastAmount;

    if (parsedAmounts.length >= 2) {
      const maybeUnit = parsedAmounts[parsedAmounts.length - 2];
      if (Number.isFinite(maybeUnit) && maybeUnit > 0) {
        unitPrice = maybeUnit;
      }
    }

    if (quantity > 1) {
      if (parsedAmounts.length === 1) {
        unitPrice = Number((lineTotal / quantity).toFixed(2));
      } else {
        const computed = Number((unitPrice * quantity).toFixed(2));
        lineTotal = Math.abs(computed - lastAmount) <= 0.05 ? computed : lastAmount;
      }
    }

    const extractedName = extractName(line);
    const name = extractedName || `Producto ${unnamedCount++}`;

    items.push({
      name,
      quantity,
      unitPrice,
      lineTotal,
    });
  }

  const totalAmount = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    items,
    totalAmount,
    totalUnits,
  };
}
