import { analyzeReceiptText, detectReceiptTotal, parseMoneyToken } from './receiptAnalyzer';

type SampleCase = {
  name: string;
  text: string;
  expectedTotal?: number;
};

export const RECEIPT_ANALYZER_SAMPLES: SampleCase[] = [
  {
    name: 'Supermarket simple',
    text: `Pali
Leche Dos Pinos 1 UND 950,00
Pan dulce 2 x 750 1500
Subtotal 2.450,00
IVA 0,00
Monto total ₡2.450,00`,
    expectedTotal: 2450,
  },
  {
    name: 'Dataphone style',
    text: `BAC
Comercio: PALI SN RAFAEL
Tipo de Transaccion: COMPRA
Monto: CRC 2,450.00
Monto total CRC 2,450.00`,
    expectedTotal: 2450,
  },
  {
    name: 'SINPE transfer',
    text: `SINPE Movil
Monto a transferir
Monto ₡5,000.00
Comision ₡0.00
Monto total ₡5,000.00`,
    expectedTotal: 5000,
  },
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function runReceiptAnalyzerSamples(): string[] {
  const logs: string[] = [];

  for (const sample of RECEIPT_ANALYZER_SAMPLES) {
    const detected = detectReceiptTotal(sample.text);
    const analysis = analyzeReceiptText(sample.text);
    logs.push(
      `${sample.name} -> detected=${detected?.amount ?? 0} conf=${detected?.confidence ?? 0} items=${analysis.items.length} total=${analysis.totalAmount}`
    );
  }

  logs.push(`parseMoneyToken(1.234.567,89)=${parseMoneyToken('1.234.567,89')}`);
  logs.push(`parseMoneyToken(1,234,567.89)=${parseMoneyToken('1,234,567.89')}`);
  logs.push(`parseMoneyToken(₡2.45O,0O)=${parseMoneyToken('₡2.45O,0O')}`);

  return logs;
}

