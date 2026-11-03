import { escapeHtml, renderCheckout, renderNotFound } from './checkout-page.js';
import {
  formatMnt,
  paidNotice,
  paymentButtonText,
  paymentButtonTitle,
} from './order-messages.js';
import type { CheckoutView } from './order.service.js';

const view: CheckoutView = {
  state: 'pending',
  shopName: 'Дулаан Дээл',
  pageId: '1441572565701692',
  orderCode: 'K3F9Q2',
  items: [
    {
      name: 'Ноолууран малгай',
      options: ['нэг хэмжээ', 'хар'],
      quantity: 2,
      unitPrice: 59000,
      lineTotal: 118000,
    },
  ],
  total: 118000,
};

describe('renderCheckout', () => {
  it('shows the order, the demo notice and the form while payment is pending', () => {
    const html = renderCheckout(view);
    expect(html).toContain('Демо төлбөр');
    expect(html).toContain('Захиалга #K3F9Q2');
    expect(html).toContain('2 × 59,000₮');
    expect(html).toContain('нэг хэмжээ, хар');
    expect(html).toContain('<form method="post">');
    expect(html).toContain('Төлөх (демо) · 118,000₮');
    expect(html).not.toContain('<script');
  });

  it('shows the outcome and a way back to Messenger instead of the form', () => {
    const html = renderCheckout(
      { ...view, state: 'paid' },
      { notice: 'paid_now' },
    );
    expect(html).toContain('Төлбөр амжилттай');
    expect(html).not.toContain('<form');
    expect(html).toContain('href="https://m.me/1441572565701692"');
  });

  it('escapes shop, product and form values', () => {
    const html = renderCheckout(
      {
        ...view,
        shopName: '<img src=x onerror=alert(1)>',
        items: [{ ...view.items[0], name: '"><script>x</script>' }],
      },
      { notice: 'invalid', form: { address: '</textarea><b>hi</b>' } },
    );
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('</textarea><b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders a not-found page', () => {
    expect(renderNotFound()).toContain('Холбоос олдсонгүй');
  });

  it('escapes all HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('order messages', () => {
  it('formats tögrög with thousands separators', () => {
    expect(formatMnt(1180000)).toBe('1,180,000₮');
  });

  it('writes in the customer’s script and keeps the button title within 20 characters', () => {
    expect(paymentButtonText('latin', 'K3F9Q2', 118000)).toMatch(
      /^Zahialga #K3F9Q2: 118,000₮\./,
    );
    expect(paymentButtonText('cyrillic', 'K3F9Q2', 118000)).toMatch(
      /^Захиалга #K3F9Q2: 118,000₮\./,
    );
    expect(paidNotice('latin', 'K3F9Q2', 118000)).toContain('118,000₮');
    for (const script of ['latin', 'cyrillic'] as const) {
      expect(paymentButtonTitle(script).length).toBeLessThanOrEqual(20);
    }
  });
});
