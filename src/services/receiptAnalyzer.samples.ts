import {
  analyzeReceiptText,
  detectReceiptDocumentType,
  detectReceiptTotalWithOptions,
  parseMoneyToken,
  type ReceiptDocumentType,
} from './receiptAnalyzer';

type SampleCase = {
  name: string;
  text: string;
  expectedTotal?: number;
  expectedType?: ReceiptDocumentType;
};

// Manual regression set. It covers common Costa Rican invoices, POS vouchers,
// transfer receipts and noisy OCR patterns without requiring a test framework.
export const RECEIPT_ANALYZER_SAMPLES: SampleCase[] = [
  {
    name: 'Supermarket tax invoice',
    text: `PALI
Leche Dos Pinos 1 UND 950,00
Pan dulce 2 x 750 1.500,00
Subtotal ₡2.450,00
IVA ₡0,00
Total a pagar ₡2.450,00
Clave 50612012600310112345600100001010000000001123456789`,
    expectedTotal: 2450,
    expectedType: 'invoice',
  },
  {
    name: 'Pulpería with bare amounts',
    text: `Pulpería La Esquina
Coca Cola 600ml 1 850
2 x Pan cuadrado 700 1.400
TOTAL CRC 2 250`,
    expectedTotal: 2250,
    expectedType: 'invoice',
  },
  {
    name: 'Restaurant ticket',
    text: `RESTAURANTE LA SODA
Casado pollo 3.500,00
Jugo natural 1.200,00
Sub Total 4.700,00
Servicio 470,00
TOTAL A PAGAR ₡5.170,00
Gracias por su compra`,
    expectedTotal: 5170,
    expectedType: 'invoice',
  },
  {
    name: 'BAC card email receipt without products',
    text: `BAC
Comercio: PALI SAN RAFAEL
Fecha: Feb 15, 2026 18:17
Tipo de Transacción: COMPRA
Autorización: 355831
Referencia: 604700355831
Monto: CRC 2,450.00`,
    expectedTotal: 2450,
    expectedType: 'dataphone',
  },
  {
    name: 'POS voucher with total',
    text: `VISA
AFILIADO 123456
TERMINAL 001245
MONTO CRC 25,000.00
TOTAL ₡25,000.00
AUTORIZACION 874512`,
    expectedTotal: 25000,
    expectedType: 'dataphone',
  },
  {
    name: 'SINPE transfer with commission',
    text: `SINPE Móvil
Origen
Número de cuenta CR 8601 0200 0097 0049 7554
Destino
Número de celular 87929560
Referencia 2026021310284000171762919
Monto a transferir ₡5,000.00
Comisión ₡0.00
Monto total ₡5,000.00`,
    expectedTotal: 5000,
    expectedType: 'transfer',
  },
  {
    name: 'Electronic payment receipt',
    text: `RECIBO ELECTRÓNICO DE PAGO
Factura asociada 00100001010000000001
Monto pagado CRC 16.250,00
Saldo anterior 20.000,00`,
    expectedTotal: 16250,
    expectedType: 'payment_receipt',
  },
  {
    name: 'OCR character substitutions',
    text: `TIQUETE
Hamburguesa ₡3.5OO,OO
TOTAL ₡3.5OO,OO`,
    expectedTotal: 3500,
    expectedType: 'invoice',
  },
  {
    name: 'PayPal payment with fee',
    text: `PayPal
Transaction details
You sent $42.50 USD
Transaction fee $1.99 USD
Total paid $42.50 USD
Transaction ID 8AB12345CD678901E`,
    expectedTotal: 42.5,
    expectedType: 'paypal',
  },
  {
    name: 'US ACH direct deposit',
    text: `ACH DIRECT DEPOSIT
Company: ACME PAYROLL
Deposit amount $1,250.00
Trace number 021000021234567
Effective date 06/15/2026`,
    expectedTotal: 1250,
    expectedType: 'ach',
  },
  {
    name: 'International wire confirmation',
    text: `WIRE TRANSFER CONFIRMATION
Beneficiary: Global Supplier Ltd
Amount sent USD 3,400.00
Wire fee USD 35.00
SWIFT BOFAUS3N
Confirmation number 945678120034`,
    expectedTotal: 3400,
    expectedType: 'wire',
  },
  {
    name: 'Generic bank transfer in Costa Rica',
    text: `Transferencia bancaria
Cuenta origen: 001234567890
Cuenta destino: 009876543210
Monto transferido ₡18.500,00
Referencia: 2026061500000987123`,
    expectedTotal: 18500,
    expectedType: 'bank_transfer',
  },
];

function closeEnough(first: number, second: number, tolerance = 0.01): boolean {
  return Math.abs(first - second) <= tolerance;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function runReceiptAnalyzerSamples(): string[] {
  let passed = 0;
  const rows = RECEIPT_ANALYZER_SAMPLES.map((sample) => {
    const type = detectReceiptDocumentType(sample.text);
    const total = detectReceiptTotalWithOptions(sample.text, { preferredType: sample.expectedType ?? type });
    const analysis = analyzeReceiptText(sample.text);
    const ok = (!sample.expectedType || sample.expectedType === type) && (!sample.expectedTotal || closeEnough(total?.amount ?? 0, sample.expectedTotal));
    if (ok) passed += 1;
    return `${ok ? 'OK' : 'FAIL'} | ${sample.name} | type=${type} | total=${total?.amount ?? 0} | expected=${sample.expectedTotal ?? 'n/a'} | items=${analysis.items.length}`;
  });
  rows.push(`Summary => passed=${passed} failed=${RECEIPT_ANALYZER_SAMPLES.length - passed} total=${RECEIPT_ANALYZER_SAMPLES.length}`);
  ['2.450,00', '2,450.00', 'CRC 2450', 'CRC 2 450', '2450,00', '2.450', '2,450', '2450', '1.234.567,89', '1,234,567.89', '₡2.45O,0O']
    .forEach((value) => rows.push(`parseMoneyToken(${value})=${parseMoneyToken(value)}`));
  return rows;
}
