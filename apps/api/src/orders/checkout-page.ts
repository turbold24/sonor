import { formatMnt } from './order-messages.js';
import type { CheckoutView } from './order.service.js';

// Server-rendered demo checkout page, opened from the Messenger payment button. Plain
// HTML with inline CSS and no scripts; every value is escaped.

export interface CheckoutForm {
  phone?: string;
  address?: string;
  note?: string;
}

export type CheckoutNotice =
  | 'paid_now'
  | 'already_paid'
  | 'expired'
  | 'cancelled'
  | 'sold_out'
  | 'invalid';

const NOTICES: Record<CheckoutNotice, { title: string; body: string }> = {
  paid_now: {
    title: 'Төлбөр амжилттай',
    body: 'Баярлалаа! Захиалгын баталгаажуулалтыг Messenger-ээр илгээлээ.',
  },
  already_paid: {
    title: 'Төлбөр төлөгдсөн',
    body: 'Энэ захиалгын төлбөр аль хэдийн төлөгдсөн байна.',
  },
  expired: {
    title: 'Холбоосын хугацаа дууссан',
    body: 'Шинэ холбоос авахын тулд Messenger-ээр захиалгаа дахин баталгаажуулна уу.',
  },
  cancelled: {
    title: 'Захиалга цуцлагдсан',
    body: 'Энэ захиалга цуцлагдсан байна. Messenger-ээр шинээр захиална уу.',
  },
  sold_out: {
    title: 'Уучлаарай, бараа дууссан',
    body: 'Захиалгын зарим бараа дууссан тул төлбөр хийгдсэнгүй. Messenger-ээр бидэнд бичнэ үү.',
  },
  invalid: {
    title: 'Мэдээллээ шалгана уу',
    body: 'Утасны дугаар (8-15 орон) болон хүргэлтийн хаягаа бөглөнө үү.',
  },
};

export function renderCheckout(
  view: CheckoutView,
  options: { notice?: CheckoutNotice; form?: CheckoutForm } = {},
): string {
  const { notice, form = {} } = options;
  const showForm = view.state === 'pending';
  const items = view.items
    .map(
      (item) => `
      <li>
        <div><strong>${escapeHtml(item.name)}</strong>${
          item.options.length
            ? `<span class="muted"> · ${escapeHtml(item.options.join(', '))}</span>`
            : ''
        }</div>
        <div class="row muted"><span>${item.quantity} × ${formatMnt(item.unitPrice)}</span><span>${formatMnt(item.lineTotal)}</span></div>
      </li>`,
    )
    .join('');

  const body = `
    <p class="demo">Демо төлбөр: жинхэнэ мөнгө шилжихгүй.</p>
    <h1>${escapeHtml(view.shopName)}</h1>
    <p class="muted">Захиалга #${escapeHtml(view.orderCode)}</p>
    ${notice ? noticeBlock(notice) : ''}
    <ul class="items">${items}</ul>
    <p class="row total"><span>Нийт</span><span>${formatMnt(view.total)}</span></p>
    ${showForm ? formBlock(view, form) : messengerLink(view)}`;
  return page(`Захиалга #${view.orderCode}`, body);
}

export function renderNotFound(): string {
  return page(
    'Олдсонгүй',
    `<h1>Холбоос олдсонгүй</h1><p class="muted">Энэ төлбөрийн холбоос буруу эсвэл устсан байна.</p>`,
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function noticeBlock(notice: CheckoutNotice): string {
  const { title, body } = NOTICES[notice];
  const tone =
    notice === 'paid_now' || notice === 'already_paid' ? 'ok' : 'warn';
  return `<div class="notice ${tone}"><strong>${title}</strong><p>${body}</p></div>`;
}

function formBlock(view: CheckoutView, form: CheckoutForm): string {
  return `
    <form method="post">
      <label>Утасны дугаар
        <input name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" value="${escapeHtml(form.phone ?? '')}">
      </label>
      <label>Хүргэлтийн хаяг
        <textarea name="address" rows="3" autocomplete="street-address" required maxlength="300">${escapeHtml(form.address ?? '')}</textarea>
      </label>
      <label>Нэмэлт тайлбар (заавал биш)
        <textarea name="note" rows="2" maxlength="300">${escapeHtml(form.note ?? '')}</textarea>
      </label>
      <button type="submit">Төлөх (демо) · ${formatMnt(view.total)}</button>
    </form>`;
}

function messengerLink(view: CheckoutView): string {
  return view.pageId
    ? `<a class="button" href="https://m.me/${view.pageId}">Messenger руу буцах</a>`
    : '';
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f7f9; --card: #fff; --text: #1c1e21; --muted: #65676b; --line: #e4e6eb; --accent: #0866ff; --ok: #e7f6ec; --warn: #fff4e5; }
  @media (prefers-color-scheme: dark) { :root { --bg: #18191a; --card: #242526; --text: #e4e6eb; --muted: #b0b3b8; --line: #3a3b3c; --ok: #1f3a2a; --warn: #3d2f1a; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 480px; margin: 0 auto; padding: 20px 16px 40px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px; }
  h1 { font-size: 22px; margin: 4px 0; }
  .muted { color: var(--muted); }
  .demo { margin: 0 0 12px; padding: 6px 10px; border-radius: 8px; background: var(--warn); font-size: 14px; }
  .items { list-style: none; padding: 0; margin: 16px 0; border-top: 1px solid var(--line); }
  .items li { padding: 12px 0; border-bottom: 1px solid var(--line); }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .total { font-size: 18px; font-weight: 600; margin: 8px 0 20px; }
  label { display: block; margin: 0 0 14px; font-size: 14px; color: var(--muted); }
  input, textarea { display: block; width: 100%; margin-top: 6px; padding: 10px 12px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; }
  button, .button { display: block; width: 100%; padding: 13px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; }
  .notice { padding: 12px 14px; border-radius: 10px; margin: 12px 0; }
  .notice p { margin: 4px 0 0; }
  .notice.ok { background: var(--ok); }
  .notice.warn { background: var(--warn); }
</style>
</head>
<body><main><div class="card">${body}</div></main></body>
</html>`;
}
