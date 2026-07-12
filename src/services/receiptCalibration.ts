import { analyzeReceiptText, detectReceiptDocumentType, detectReceiptTotalWithOptions, type ReceiptDocumentType } from './receiptAnalyzer';

export type OcrCalibrationCase = {
  id: string;
  rawText: string;
  expectedTotal: number;
  expectedType?: ReceiptDocumentType;
};

export type OcrCalibrationRow = {
  id: string;
  detectedType: ReceiptDocumentType;
  expectedType: ReceiptDocumentType | null;
  typeOk: boolean;
  detectedTotal: number;
  expectedTotal: number;
  absoluteError: number;
  totalOk: boolean;
  confidence: number;
  itemsDetected: number;
  warningsCount: number;
};

export type OcrCalibrationReport = {
  totalCases: number;
  typeAccuracy: number;
  totalAccuracy: number;
  avgAbsoluteError: number;
  rows: OcrCalibrationRow[];
};

const DEFAULT_TOTAL_TOLERANCE = 1;

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function runOcrCalibration(
  cases: OcrCalibrationCase[],
  options?: { totalTolerance?: number }
): OcrCalibrationReport {
  const tolerance = options?.totalTolerance ?? DEFAULT_TOTAL_TOLERANCE;
  const rows: OcrCalibrationRow[] = [];

  for (const entry of cases) {
    const detectedType = detectReceiptDocumentType(entry.rawText);
    const preferredType = entry.expectedType ?? detectedType;
    const total = detectReceiptTotalWithOptions(entry.rawText, { preferredType });
    const analysis = analyzeReceiptText(entry.rawText);

    const detectedTotal = round2(total?.amount ?? analysis.totalAmount ?? 0);
    const absoluteError = round2(Math.abs(detectedTotal - entry.expectedTotal));
    const totalOk = absoluteError <= tolerance;
    const expectedType = entry.expectedType ?? null;
    const typeOk = expectedType == null ? true : detectedType === expectedType;

    rows.push({
      id: entry.id,
      detectedType,
      expectedType,
      typeOk,
      detectedTotal,
      expectedTotal: round2(entry.expectedTotal),
      absoluteError,
      totalOk,
      confidence: total?.confidence ?? 0,
      itemsDetected: analysis.items.length,
      warningsCount: analysis.warnings.length,
    });
  }

  const typeHits = rows.filter((r) => r.typeOk).length;
  const totalHits = rows.filter((r) => r.totalOk).length;
  const absErr = rows.reduce((sum, r) => sum + r.absoluteError, 0);
  const count = rows.length || 1;

  return {
    totalCases: rows.length,
    typeAccuracy: round2((typeHits / count) * 100),
    totalAccuracy: round2((totalHits / count) * 100),
    avgAbsoluteError: round2(absErr / count),
    rows,
  };
}

export const OCR_CALIBRATION_TEMPLATE: OcrCalibrationCase[] = [
  {
    id: 'real-001',
    expectedType: 'invoice',
    expectedTotal: 0,
    rawText: '',
  },
  {
    id: 'real-002',
    expectedType: 'transfer',
    expectedTotal: 0,
    rawText: '',
  },
];
