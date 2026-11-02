import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import type { PaymentReceipt } from './receipt.service.js';

export function renderReceipt(receipt: PaymentReceipt): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'A-Health - Risiti ya malipo', Author: 'A-Health' } });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font(fileURLToPath(new URL('../../assets/NotoSans-Regular.ttf', import.meta.url)));
    const teal = '#124E47', ink = '#152A26', muted = '#526460', width = 499;
    const money = (value: number) => `${receipt.currency} ${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    doc.fillColor(teal).fontSize(26).text('A-Health', 48, 42);
    doc.fillColor(ink).fontSize(19).text('Risiti ya malipo', 48, 88);
    doc.fontSize(9).fillColor(muted).text(receipt.number, 48, 120, { width });
    let y = 153;
    if (receipt.environment !== 'live') {
      const label = ['simulated', 'test'].includes(receipt.environment)
        ? 'MAJARIBIO - SI UTHIBITISHO WA FEDHA HALISI'
        : 'REKODI YA ZAMANI - HALI YA LIVE HAIJATHIBITISHWA';
      doc.rect(48, y, width, 46).fill('#FFF0DA');
      doc.fillColor('#713E08').fontSize(11).text(label, 60, y + 12, { width: width - 24 });
      y += 66;
    }
    const row = (label: string, value: string) => {
      const height = Math.max(30, doc.fontSize(11).heightOfString(value, { width: 340 }) + 16);
      doc.fillColor(muted).fontSize(9).text(label, 48, y + 2, { width: 140 });
      doc.fillColor(ink).fontSize(11).text(value, 207, y, { width: 340 });
      y += height;
    };
    row('Mlipaji', receipt.payerName);
    row('Huduma', receipt.title);
    row('Kumbukumbu ya bili', receipt.billReference);
    row('Tarehe ya malipo', `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Dar_es_Salaam', dateStyle: 'medium', timeStyle: 'short' }).format(receipt.settledAt)} EAT`);
    row('Njia ya malipo', ({ mpesa: 'M-Pesa', tigo_pesa: 'Mixx by Yas', airtel_money: 'Airtel Money' } as Record<string, string>)[receipt.provider] ?? receipt.provider);
    row('Kumbukumbu ya muamala', receipt.transactionReference);
    row('Hali', receipt.refundedAmount >= receipt.amount ? 'Fedha zimerudishwa zote' : receipt.refundedAmount > 0 ? 'Sehemu ya fedha imerudishwa' : 'Malipo yamethibitishwa');
    y += 12;
    doc.moveTo(48, y).lineTo(547, y).lineWidth(1).stroke('#C7DAD5');
    y += 20;
    doc.fillColor(muted).fontSize(10).text('KIASI KILICHOLIPWA', 48, y);
    doc.fillColor(teal).fontSize(25).text(money(receipt.amount), 48, y + 20, { width });
    y += 70;
    if (receipt.refundedAmount > 0) {
      row('Fedha zilizorudishwa', money(receipt.refundedAmount));
      row('Kiasi baada ya refund', money(receipt.amount - receipt.refundedAmount));
    }
    doc.fillColor(muted).fontSize(9).text('Hifadhi risiti hii kwa kumbukumbu zako. Kwa msaada, tumia kumbukumbu ya bili iliyo hapo juu.', 48, Math.max(y + 20, 720), { width, lineGap: 3 });
    doc.end();
  });
}
