import type { Script } from '../common/mongolian-script.js';

// Fixed texts Sonor sends itself (not the model), in the customer's script.

export function formatMnt(amount: number): string {
  return `${amount.toLocaleString('en-US')}₮`;
}

/** Text above the payment button. Up to 640 characters in a button template. */
export function paymentButtonText(
  script: Script,
  orderCode: string,
  total: number,
): string {
  return script === 'latin'
    ? `Zahialga #${orderCode}: ${formatMnt(total)}. Doorh tovchoor tolboroo tolj, hurgeltiin hayagaa oruulna uu.`
    : `Захиалга #${orderCode}: ${formatMnt(total)}. Доорх товчоор төлбөрөө төлж, хүргэлтийн хаягаа оруулна уу.`;
}

/** Button title, at most 20 characters. */
export function paymentButtonTitle(script: Script): string {
  return script === 'latin' ? 'Tolbor toloh' : 'Төлбөр төлөх';
}

export function paidNotice(
  script: Script,
  orderCode: string,
  total: number,
): string {
  return script === 'latin'
    ? `Tolbor amjilttai hiigdlee, bayarlalaa! Zahialga #${orderCode} (${formatMnt(total)}) batalgaajlaa. Hurgeltiin talaar manai ajiltan udahgui holbogdono.`
    : `Төлбөр амжилттай хийгдлээ, баярлалаа! Захиалга #${orderCode} (${formatMnt(total)}) баталгаажлаа. Хүргэлтийн талаар манай ажилтан удахгүй холбогдоно.`;
}
