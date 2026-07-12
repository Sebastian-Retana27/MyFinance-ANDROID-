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

export type ReceiptDocumentType =
  | 'invoice'
  | 'transfer'
  | 'dataphone'
  | 'payment_receipt'
  | 'paypal'
  | 'ach'
  | 'wire'
  | 'bank_transfer'
  | 'unknown';

export type ReceiptDebugInfo = {
  normalizedText: string;
  normalizedLines: string[];
  documentType: ReceiptDocumentType;
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

type TotalCandidateScored = {
  lineIndex: number;
  line: string;
  candidate: MoneyCandidate;
  score: number;
  reason: string;
};

export type DetectTotalOptions = {
  preferredType?: ReceiptDocumentType;
};

// Keep OCR correction limited to number-looking tokens. Applying it to the full line
// would turn normal product names into numbers (for example, "Soda" -> "5oda").
const MOJIBAKE_CURRENCY_REGEX = /ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¡|Ãƒâ€šÃ‚Â¢|Ã‚Â¢|Ã¢â€šÂ¡|â‚¡|Â¢/g;
const CURRENCY_REGEX = /(?:₡|¢|\bcrc\b|\bcolones?\b)/i;
const MONEY_TOKEN_REGEX = /(?:(?:₡|¢|crc|colones?)\s*)?[-+]?(?:(?:[0-9OoIlSsBbQq]{1,3}(?:[ .,\u00A0][0-9OoIlSsBbQq]{3})+(?:[.,][0-9OoIlSsBbQq]{1,2})?)|(?:[0-9OoIlSsBbQq]+(?:[.,][0-9OoIlSsBbQq]{1,2})?)|(?:[0-9OoIlSsBbQq]{3,}))/gi;
const ID_LIKE_REGEX = /(?:\b\d{8,}\b|\b\d{4}[- ]\d{4}[- ]\d{4,}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b)/;
const HIGH_TOTAL_HINTS = [
  'total a pagar', 'monto total', 'importe total', 'gran total', 'total venta',
  'total colones', 'total crc', 'monto cobrado', 'pago realizado', 'monto pagado',
  'total transferido', 'total enviado', 'total recibido', 'valor total', 'total amount',
  'payment total', 'transfer amount', 'amount sent', 'amount received', 'total debit',
  'total credited', 'total paid', 'you sent', 'you received', 'net amount',
];
const POSITIVE_TOTAL_HINTS = ['total', 'cobrar', 'importe', 'monto'];
const NEGATIVE_TOTAL_HINTS = [
  'subtotal', 'sub total', 'impuesto', 'iva', 'i.v.a', 'descuento', 'vuelto', 'cambio',
  'efectivo recibido', 'tarjeta', 'saldo', 'autorizacion', 'referencia', 'terminal',
  'afiliado', 'numero de cuenta', 'cuenta', 'factura electronica', 'clave', 'consecutivo',
  'cedula', 'telefono', 'celular', 'cliente', 'cajero', 'comision', 'fee', 'service fee',
  'transaction fee', 'exchange rate', 'tipo de cambio', 'routing number', 'aba', 'swift',
  'iban', 'trace number', 'tracking number', 'confirmation number', 'transaction id',
];
const PRODUCT_META_HINTS = [
  ...NEGATIVE_TOTAL_HINTS, 'direccion', 'correo', 'email', 'fecha', 'hora', 'sinpe',
  'origen', 'destino', 'a nombre de', 'gracias por su compra', 'tipo de transaccion',
  'comercio:', 'numero de tarjeta', 'visa', 'mastercard', 'debito', 'credito',
  'banco', 'servicio al cliente', 'copia cliente', 'recibo de pago', 'paypal', 'ach',
  'wire transfer', 'transferencia bancaria', 'deposito directo', 'direct deposit',
];
const TRANSFER_HINTS = ['sinpe', 'monto a transferir', 'monto total', 'comision', 'origen', 'destino', 'transferencia'];
const DATAPHONE_HINTS = ['dataphone', 'autorizacion', 'afiliado', 'terminal', 'tarjeta', 'visa', 'mastercard', 'tipo de transaccion'];
const INVOICE_HINTS = ['factura', 'tiquete', 'subtotal', 'iva', 'articulo', 'cantidad', 'precio', 'gracias por su compra'];
const PAYPAL_HINTS = ['paypal', 'transaction id', 'transaction details', 'you sent', 'you received', 'amount received', 'payment sent'];
const ACH_HINTS = ['ach', 'direct deposit', 'direct debit', 'ach credit', 'ach debit', 'trace number', 'routing number', 'rtn'];
const WIRE_HINTS = ['wire transfer', 'swift', 'iban', 'beneficiary', 'beneficiario', 'fedwire', 'international wire'];
const BANK_TRANSFER_HINTS = ['bank transfer', 'transferencia bancaria', 'transferencia interbancaria', 'deposit', 'deposito', 'transfer confirmation'];

function fixMojibake(value: string): string {
  return value
    .replace(MOJIBAKE_CURRENCY_REGEX, '₡')
    .replace(/ÃƒÂ³|Ã³/g, 'ó')
    .replace(/ÃƒÂ©|Ã©/g, 'é')
    .replace(/ÃƒÂ¡|Ã¡/g, 'á')
    .replace(/ÃƒÂ­|Ã­/g, 'í')
    .replace(/ÃƒÂº|Ãº/g, 'ú')
    .replace(/ÃƒÂ±|Ã±/g, 'ñ');
}

function normalizeForMatch(value: string): string {
  return fixMojibake(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\t ]+/g, ' ')
    .trim();
}

export function normalizeOcrText(rawText: string): string {
  return fixMojibake(rawText ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeMoneyToken(raw: string): string {
  return fixMojibake(raw)
    .replace(/(?:₡|¢|\bcrc\b|\bcolones?\b)/gi, '')
    .replace(/[OoQq]/g, '0')
    .replace(/[Il|!]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[^\d,\.\-\s]/g, '')
    .replace(/[\s\u00a0]/g, '')
    .trim();
}

/** Parses common CR/LatAm and US monetary formats without using device locale. */
export function parseMoneyToken(raw: string): number {
  const value = normalizeMoneyToken(raw);
  if (!value || !/\d/.test(value)) return Number.NaN;

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const commas = [...unsigned.matchAll(/,/g)].map((match) => match.index ?? 0);
  const dots = [...unsigned.matchAll(/\./g)].map((match) => match.index ?? 0);
  const separators = [...commas, ...dots].sort((a, b) => a - b);
  const digitsOnly = unsigned.replace(/[.,]/g, '');
  if (!separators.length) return Number(`${negative ? '-' : ''}${digitsOnly}`);

  const lastSeparator = separators[separators.length - 1];
  const fractionLength = unsigned.length - lastSeparator - 1;
  const hasBothSeparators = commas.length > 0 && dots.length > 0;
  const previousPart = unsigned.slice(0, lastSeparator).replace(/[.,]/g, '');
  const fraction = unsigned.slice(lastSeparator + 1).replace(/\D/g, '');

  // A final one/two digit group is a decimal fraction. With 3 digits, it is
  // normally a thousands group (2.450), unless there is a second separator.
  if (fractionLength >= 1 && fractionLength <= 2 && fraction.length === fractionLength) {
    return Number(`${negative ? '-' : ''}${previousPart}.${fraction}`);
  }
  if (hasBothSeparators && fractionLength > 0 && fractionLength <= 3 && fraction.length > 0) {
    return Number(`${negative ? '-' : ''}${previousPart}.${fraction}`);
  }
  return Number(`${negative ? '-' : ''}${digitsOnly}`);
}

export function extractMoneyCandidates(line: string): MoneyCandidate[] {
  const candidates: MoneyCandidate[] = [];
  for (const match of line.matchAll(MONEY_TOKEN_REGEX)) {
    const token = (match[0] ?? '').trim();
    const amount = parseMoneyToken(token);
    const digitCount = (token.match(/\d/g) ?? []).length;
    if (!token || !Number.isFinite(amount) || amount <= 0 || digitCount < 2) continue;
    candidates.push({
      token,
      amount: Number(amount.toFixed(2)),
      hasCurrency: CURRENCY_REGEX.test(fixMojibake(token)),
      start: match.index ?? 0,
      end: (match.index ?? 0) + token.length,
    });
  }
  return candidates;
}

function isLikelyIdentifier(line: string, candidate: MoneyCandidate): boolean {
  const clean = normalizeForMatch(line);
  const before = clean.slice(0, candidate.start);
  const tokenDigits = candidate.token.replace(/\D/g, '');
  return (
    ID_LIKE_REGEX.test(candidate.token) ||
    tokenDigits.length >= 8 ||
    /(?:clave|consecutivo|factura|referencia|autorizacion|telefono|celular|cuenta|tarjeta|cedula)/.test(before)
  );
}

function scoreTotalCandidate(
  normalizedLine: string,
  lineIndex: number,
  lineCount: number,
  candidate: MoneyCandidate,
  documentType: ReceiptDocumentType
): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];
  const hasHighTotal = HIGH_TOTAL_HINTS.some((hint) => normalizedLine.includes(hint));

  for (const hint of HIGH_TOTAL_HINTS) {
    if (normalizedLine.includes(hint)) {
      score += 22;
      reasons.push(`total:${hint}`);
      break;
    }
  }
  if (!hasHighTotal) {
    for (const hint of POSITIVE_TOTAL_HINTS) {
      if (normalizedLine.includes(hint)) {
        score += hint === 'total' ? 11 : 5;
        reasons.push(`label:${hint}`);
        break;
      }
    }
  }
  if (lineIndex >= Math.floor(lineCount * 0.65)) {
    score += 5;
    reasons.push('near-end');
  }
  if (candidate.hasCurrency) {
    score += 5;
    reasons.push('currency');
  }
  for (const hint of NEGATIVE_TOTAL_HINTS) {
    if (normalizedLine.includes(hint)) {
      score -= hasHighTotal ? 3 : 18;
      reasons.push(`exclude:${hint}`);
      break;
    }
  }
  if (isLikelyIdentifier(normalizedLine, candidate)) {
    score -= 30;
    reasons.push('identifier');
  }
  if (documentType === 'transfer') {
    if (/monto total|total transferido|total enviado|total recibido/.test(normalizedLine)) {
      score += 15;
      reasons.push('transfer-total');
    }
    if (/comision|monto a transferir/.test(normalizedLine) && !/monto total/.test(normalizedLine)) {
      score -= 12;
      reasons.push('transfer-non-total');
    }
  }
  if (documentType === 'paypal') {
    if (/total|amount sent|amount received|you sent|you received|net amount/.test(normalizedLine)) {
      score += 14;
      reasons.push('paypal-amount');
    }
  }
  if (documentType === 'ach') {
    if (/payment amount|deposit amount|credit amount|debit amount|amount/.test(normalizedLine)) {
      score += 10;
      reasons.push('ach-amount');
    }
  }
  if (documentType === 'wire' || documentType === 'bank_transfer') {
    if (/transfer amount|amount sent|amount received|total debit|total credited|monto transferido|monto enviado|monto recibido/.test(normalizedLine)) {
      score += 14;
      reasons.push('bank-transfer-amount');
    }
  }
  if (documentType === 'dataphone' && /\bmonto\b/.test(normalizedLine) && !/comision/.test(normalizedLine)) {
    score += 5;
    reasons.push('card-amount');
  }
  return { score, reason: reasons.join(', ') || 'unlabeled amount' };
}

function detectQuantity(line: string): number {
  const normalized = normalizeForMatch(line);
  const patterns = [
    /^\s*(\d+)\s*[x×]\s*/,
    /^\s*(\d+)\s+(?=[a-záéíóúñ])/i,
    /\b(?:qty|cant(?:idad)?|und|uds?|unidad(?:es)?)\s*[:x-]?\s*(\d+)\b/i,
    /\b(\d+)\s*(?:und|uds?|unidades?)\b/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const quantity = Number(match?.[1]);
    if (Number.isInteger(quantity) && quantity > 0 && quantity <= 999) return quantity;
  }
  return 1;
}

function isProductLine(line: string): boolean {
  const normalized = normalizeForMatch(line);
  if (normalized.length < 3 || PRODUCT_META_HINTS.some((hint) => normalized.includes(hint))) return false;
  if (/\b(total|monto|importe|cobrar|pagar)\b/.test(normalized)) return false;
  const letters = (normalized.match(/[a-záéíóúñ]/gi) ?? []).length;
  const numbers = extractMoneyCandidates(line);
  return letters >= 2 && numbers.length > 0;
}

function cleanItemName(line: string, amounts: MoneyCandidate[]): string {
  let name = line;
  // Remove from right to left to preserve match indexes.
  [...amounts].sort((a, b) => b.start - a.start).forEach((amount) => {
    name = `${name.slice(0, amount.start)} ${name.slice(amount.end)}`;
  });
  return name
    .replace(/\b(?:qty|cant(?:idad)?|und|uds?|unidad(?:es)?)\s*[:x-]?\s*\d+\b/gi, ' ')
    .replace(/^\s*\d+\s*[x×]?\s*/i, ' ')
    .replace(/\s+\d+\s*$/g, ' ')
    .replace(/[|*_]{2,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseProductsFromLines(lines: string[]): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  let fallbackNumber = 1;
  for (const line of lines) {
    if (!isProductLine(line)) continue;
    const candidates = extractMoneyCandidates(line);
    const quantity = detectQuantity(line);
    const lineTotal = candidates[candidates.length - 1]?.amount ?? 0;
    if (lineTotal <= 0) continue;
    let unitPrice = candidates.length >= 2 ? candidates[candidates.length - 2].amount : lineTotal;
    if (quantity > 1 && candidates.length === 1) unitPrice = Number((lineTotal / quantity).toFixed(2));
    const name = cleanItemName(line, candidates) || `Producto ${fallbackNumber++}`;
    items.push({ name, quantity, unitPrice: Number(unitPrice.toFixed(2)), lineTotal: Number(lineTotal.toFixed(2)) });
  }
  return items;
}

export function detectReceiptDocumentType(rawText: string): ReceiptDocumentType {
  const normalized = normalizeForMatch(rawText);
  const hits = (hints: string[]) => hints.filter((hint) => normalized.includes(hint)).length;
  if (normalized.includes('paypal') || hits(PAYPAL_HINTS) >= 2) return 'paypal';
  if (normalized.includes('wire transfer') || normalized.includes('fedwire') || hits(WIRE_HINTS) >= 2) return 'wire';
  if (hits(ACH_HINTS) >= 2) return 'ach';
  if (normalized.includes('transferencia bancaria') || normalized.includes('transferencia interbancaria') || normalized.includes('bank transfer') || hits(BANK_TRANSFER_HINTS) >= 2) return 'bank_transfer';
  if (hits(TRANSFER_HINTS) >= 2) return 'transfer';
  if (hits(DATAPHONE_HINTS) >= 2) return 'dataphone';
  if (/recibo electronico de pago|comprobante de pago/.test(normalized)) return 'payment_receipt';
  if (hits(INVOICE_HINTS) >= 1) return 'invoice';
  if (/\btotal\b/.test(normalized) && normalized.split('\n').length >= 3) return 'invoice';
  return 'unknown';
}

export function detectReceiptTotalWithOptions(rawText: string, options?: DetectTotalOptions): DetectedTotal | null {
  const lines = normalizeOcrText(rawText).split('\n').map((line) => line.trim()).filter(Boolean);
  const documentType = options?.preferredType ?? detectReceiptDocumentType(rawText);
  const scored: TotalCandidateScored[] = [];
  lines.forEach((line, lineIndex) => {
    const normalized = normalizeForMatch(line);
    for (const candidate of extractMoneyCandidates(line)) {
      const result = scoreTotalCandidate(normalized, lineIndex, lines.length, candidate, documentType);
      scored.push({ lineIndex, line, candidate, score: result.score, reason: result.reason });
    }
  });
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || b.candidate.amount - a.candidate.amount);
  const best = scored[0];
  if (!best || best.score < 1) return null;
  const confidence = Math.max(0.1, Math.min(0.99, Number((best.score / 42).toFixed(2))));
  return { amount: best.candidate.amount, sourceLine: best.line, confidence, reason: best.reason };
}

export function detectReceiptTotal(rawText: string): DetectedTotal | null {
  return detectReceiptTotalWithOptions(rawText);
}

export function analyzeReceiptText(rawText: string): ReceiptAnalysis {
  const normalizedText = normalizeOcrText(rawText);
  const rawLines = normalizedText.split('\n').map((line) => line.trim()).filter(Boolean);
  const documentType = detectReceiptDocumentType(normalizedText);
  const items = documentType === 'transfer' || documentType === 'dataphone' || documentType === 'payment_receipt'
    || documentType === 'paypal' || documentType === 'ach' || documentType === 'wire' || documentType === 'bank_transfer'
    ? []
    : parseProductsFromLines(rawLines);
  const itemsTotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const detectedTotal = detectReceiptTotalWithOptions(normalizedText, { preferredType: documentType });
  const warnings: string[] = [];
  const hasConfidentTotal = Boolean(detectedTotal && detectedTotal.confidence >= 0.75);
  if (!hasConfidentTotal) warnings.push('No pude detectar el total del recibo con seguridad. Revísalo o ingrésalo manualmente.');
  if (!items.length && documentType === 'invoice') warnings.push('No pude detectar productos claros. Puedes editar el texto o registrar solo el total.');
  if (detectedTotal && items.length && Math.abs(detectedTotal.amount - itemsTotal) > Math.max(1, detectedTotal.amount * 0.02)) {
    warnings.push('La suma de productos no coincide con el total detectado. Revísalo antes de guardar.');
  }
  const totalCandidates: TotalCandidateDebug[] = [];
  rawLines.forEach((line, lineIndex) => {
    const normalized = normalizeForMatch(line);
    extractMoneyCandidates(line).forEach((candidate) => {
      const scored = scoreTotalCandidate(normalized, lineIndex, rawLines.length, candidate, documentType);
      totalCandidates.push({
        lineIndex, line, token: candidate.token, amount: candidate.amount, score: scored.score,
        reason: scored.reason,
        selected: Boolean(detectedTotal && detectedTotal.amount === candidate.amount && detectedTotal.sourceLine === line),
      });
    });
  });
  totalCandidates.sort((a, b) => b.score - a.score || b.amount - a.amount);
  const totalAmount = hasConfidentTotal ? detectedTotal!.amount : itemsTotal || detectedTotal?.amount || 0;
  return {
    items, totalAmount: Number(totalAmount.toFixed(2)), totalUnits, detectedTotal: detectedTotal ?? undefined,
    warnings, rawLines,
    debug: { normalizedText, normalizedLines: rawLines, documentType, totalCandidates, selectedTotal: detectedTotal },
  };
}

export function extractSemanticReceiptTotal(rawText: string): number {
  return detectReceiptTotal(rawText)?.amount ?? 0;
}

// Quick manual verification helper for CR OCR amount formats.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function debugParseCrAmountsExample(): Record<string, number> {
  return ['2.450,00', '2,450.00', 'CRC 2450', 'CRC 2 450', '2450,00', '2.450', '2,450', '2450', '1.234.567,89', '1,234,567.89', '₡2.45O,0O']
    .reduce<Record<string, number>>((result, sample) => ({ ...result, [sample]: parseMoneyToken(sample) }), {});
}
