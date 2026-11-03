import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { MessengerService } from '../messenger/messenger.service.js';
import {
  renderCheckout,
  renderNotFound,
  type CheckoutForm,
} from './checkout-page.js';
import { paidNotice } from './order-messages.js';
import { OrderService, type CheckoutContact } from './order.service.js';

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// The demo checkout behind the Messenger payment button. The random token in the URL is
// the only key, so pages are never cached or indexed and never leak it via referrers.
@Controller('pay')
export class CheckoutController {
  constructor(
    private readonly orders: OrderService,
    private readonly messenger: MessengerService,
  ) {}

  @Get(':token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex')
  @Header('Content-Security-Policy', CSP)
  async show(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const view = TOKEN.test(token) ? await this.orders.checkout(token) : null;
    if (!view) {
      res.status(404);
      return renderNotFound();
    }
    return renderCheckout(view, {
      notice: view.state === 'pending' ? undefined : stateNotice(view.state),
    });
  }

  @Post(':token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex')
  @Header('Content-Security-Policy', CSP)
  async pay(
    @Param('token') token: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (!TOKEN.test(token)) {
      res.status(404);
      return renderNotFound();
    }
    const form = readForm(body);
    const contact = validContact(form);
    if (!contact) {
      const view = await this.orders.checkout(token);
      if (!view) {
        res.status(404);
        return renderNotFound();
      }
      res.status(422);
      return renderCheckout(view, { notice: 'invalid', form });
    }

    const result = await this.orders.pay(token, contact);
    switch (result.state) {
      case 'not_found':
        res.status(404);
        return renderNotFound();
      case 'paid': {
        const { notice } = result;
        if (notice.conversationId) {
          await this.messenger.notifyCustomer(
            notice.tenantId,
            notice.conversationId,
            (script) => paidNotice(script, notice.orderCode, notice.total),
          );
        }
        return renderCheckout(result.view, { notice: 'paid_now' });
      }
      default:
        res.status(409);
        return result.view
          ? renderCheckout(result.view, { notice: result.state })
          : renderNotFound();
    }
  }
}

function stateNotice(state: 'paid' | 'expired' | 'cancelled') {
  return state === 'paid' ? 'already_paid' : state;
}

function readForm(body: unknown): CheckoutForm {
  const value = (
    typeof body === 'object' && body !== null ? body : {}
  ) as Record<string, unknown>;
  const field = (key: string) =>
    typeof value[key] === 'string' ? value[key].trim().slice(0, 300) : '';
  return {
    phone: field('phone'),
    address: field('address'),
    note: field('note'),
  };
}

function validContact(form: CheckoutForm): CheckoutContact | null {
  const phone = (form.phone ?? '').replace(/[\s()-]/g, '');
  const address = form.address ?? '';
  if (!/^\+?\d{8,15}$/.test(phone) || address.length < 5) return null;
  return { phone, address, note: form.note || undefined };
}
