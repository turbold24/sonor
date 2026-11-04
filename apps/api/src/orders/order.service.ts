import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toolError } from '../catalog/catalog.types.js';
import type { OrderStatus, Prisma } from '../generated/prisma/client.js';
import type { PaidOrderAlert } from '../messenger/owner-messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  parseItems,
  priceOrder,
  type PricedLine,
  type RequestedItem,
} from './order-lines.js';
import { CANCEL_ORDER, CONFIRM_ORDER, CREATE_ORDER } from './order.tools.js';

const OPEN: OrderStatus[] = ['DRAFT', 'CONFIRMED'];
const CHECKOUT_TTL_HOURS = 24;

const LINK_INCLUDE = {
  tenant: { select: { name: true, facebookPageId: true } },
  order: { include: { items: { orderBy: { id: 'asc' } } } },
} as const satisfies Prisma.PaymentLinkInclude;

type CheckoutLink = Prisma.PaymentLinkGetPayload<{
  include: typeof LINK_INCLUDE;
}>;

export interface PaymentLinkInfo {
  url: string;
  orderCode: string;
  total: number;
}

export interface OrderToolResult {
  /** Given to the model as the tool output. */
  output: unknown;
  /** Set when this call produced a payment link for Sonor to send. */
  paymentLink?: PaymentLinkInfo;
  /** Set when a new draft waits for the customer's yes. */
  awaitingConfirmation?: boolean;
}

export type CheckoutState = 'pending' | 'paid' | 'expired' | 'cancelled';

export interface CheckoutView {
  state: CheckoutState;
  shopName: string;
  /** Numeric Page ID for a "back to Messenger" link; null for demo placeholders. */
  pageId: string | null;
  orderCode: string;
  items: {
    name: string;
    options: string[];
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  total: number;
}

export interface CheckoutContact {
  phone: string;
  address: string;
  note?: string;
}

/** What to tell the customer after a successful payment. */
export interface PaidNotice {
  tenantId: string;
  conversationId: string | null;
  orderCode: string;
  total: number;
  /** For the owner's alert, with the contact details from checkout. */
  order: PaidOrderAlert;
}

export type PayResult =
  | { state: 'paid'; view: CheckoutView; notice: PaidNotice }
  | {
      state:
        'not_found' | 'already_paid' | 'expired' | 'cancelled' | 'sold_out';
      view?: CheckoutView;
    };

class CheckoutConflict extends Error {
  constructor(readonly state: 'already_paid' | 'cancelled' | 'sold_out') {
    super(state);
  }
}

/** Short code customers and owners can quote, e.g. #K3F9Q2. */
export function orderCode(orderId: string): string {
  return orderId.slice(-6).toUpperCase();
}

/**
 * Orders for DEMO tenants: drafts from the chat, confirmation with a payment link, and
 * Sonor's demo checkout. Every query is scoped by tenant, except the checkout lookup by
 * its random token, which then uses the link's own tenantId.
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const configured = config.get<string>('PUBLIC_BASE_URL')?.trim();
    const port = config.get<string>('PORT') ?? '3000';
    this.baseUrl = (configured || `http://localhost:${port}`).replace(
      /\/+$/,
      '',
    );
    if (!configured) {
      this.logger.warn(
        'PUBLIC_BASE_URL is not set; payment links point at localhost.',
      );
    }
  }

  runTool(
    tenantId: string,
    conversationId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<OrderToolResult> {
    switch (name) {
      case CREATE_ORDER:
        return this.draft(tenantId, conversationId, args);
      case CONFIRM_ORDER:
        return this.confirm(tenantId, conversationId);
      case CANCEL_ORDER:
        return this.cancel(tenantId, conversationId);
      default:
        return Promise.resolve({
          output: toolError('unknown_tool', `No tool named ${name}.`),
        });
    }
  }

  checkoutUrl(token: string): string {
    return `${this.baseUrl}/pay/${token}`;
  }

  async checkout(token: string): Promise<CheckoutView | null> {
    const link = await this.findLink(token);
    return link ? toView(link, new Date()) : null;
  }

  async pay(token: string, contact: CheckoutContact): Promise<PayResult> {
    const link = await this.findLink(token);
    if (!link) return { state: 'not_found' };
    const now = new Date();
    const view = toView(link, now);
    if (view.state !== 'pending') {
      return {
        state: view.state === 'paid' ? 'already_paid' : view.state,
        view,
      };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.paymentLink.updateMany({
          where: {
            id: link.id,
            tenantId: link.tenantId,
            status: 'PENDING',
            expiresAt: { gt: now },
          },
          data: { status: 'PAID', paidAt: now },
        });
        if (claimed.count === 0) throw new CheckoutConflict('already_paid');

        // Stock goes down only when payment succeeds, and never below zero.
        for (const item of link.order.items) {
          if (!item.productId) continue;
          const taken = await tx.product.updateMany({
            where: {
              id: item.productId,
              tenantId: link.tenantId,
              stock: { gte: item.quantity },
            },
            data: { stock: { decrement: item.quantity } },
          });
          if (taken.count === 0) throw new CheckoutConflict('sold_out');
        }

        const paid = await tx.order.updateMany({
          where: {
            id: link.orderId,
            tenantId: link.tenantId,
            status: 'CONFIRMED',
          },
          data: {
            status: 'PAID',
            paidAt: now,
            contactPhone: contact.phone,
            deliveryAddress: contact.address,
            customerNote: contact.note || null,
          },
        });
        if (paid.count === 0) throw new CheckoutConflict('cancelled');
      });
    } catch (error) {
      if (error instanceof CheckoutConflict)
        return { state: error.state, view };
      throw error;
    }

    this.logger.log(
      `order paid tenant=${link.tenantId} order=${link.orderId} total=${link.order.total}`,
    );
    return {
      state: 'paid',
      view: { ...view, state: 'paid' },
      notice: {
        tenantId: link.tenantId,
        conversationId: link.order.conversationId,
        orderCode: view.orderCode,
        total: view.total,
        order: {
          orderCode: view.orderCode,
          total: view.total,
          items: view.items,
          phone: contact.phone,
          address: contact.address,
          note: contact.note,
        },
      },
    };
  }

  private async draft(
    tenantId: string,
    conversationId: string,
    args: Record<string, unknown>,
  ): Promise<OrderToolResult> {
    const items = parseItems(args.items);
    if (!items) {
      return {
        output: toolError(
          'invalid_arguments',
          'items must be a non-empty list of { productId, quantity, size?, color? }.',
        ),
      };
    }
    const priced = await this.price(tenantId, items);
    if (!priced.ok) return { output: problemsOutput(priced.problems) };

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { customerId: true },
    });
    if (!conversation) throw new Error('conversation not found');

    const order = await this.prisma.$transaction(async (tx) => {
      await closeOpenOrders(tx, tenantId, conversationId);
      return tx.order.create({
        data: {
          tenantId,
          customerId: conversation.customerId,
          conversationId,
          status: 'DRAFT',
          total: priced.total,
          items: { createMany: { data: itemRows(tenantId, priced.lines) } },
        },
      });
    });

    return {
      output: {
        orderCode: orderCode(order.id),
        status: 'draft',
        items: priced.lines.map(describeLine),
        total: priced.total,
        currency: 'MNT',
        next: 'Read the items and total back and ask the customer to confirm. Call confirm_order only after they clearly agree.',
      },
      awaitingConfirmation: true,
    };
  }

  private async confirm(
    tenantId: string,
    conversationId: string,
  ): Promise<OrderToolResult> {
    const now = new Date();
    const order = await this.prisma.order.findFirst({
      where: { tenantId, conversationId, status: { in: OPEN } },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        paymentLinks: {
          where: { status: 'PENDING', expiresAt: { gt: now } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!order) {
      return {
        output: toolError(
          'no_open_order',
          'There is no order to confirm. Draft one with create_order first.',
        ),
      };
    }

    // Already confirmed with a live link: send the same link again.
    const live = order.paymentLinks[0];
    if (order.status === 'CONFIRMED' && live?.token) {
      return this.awaitingPayment(order.id, order.total, live.token);
    }

    // Prices or stock may have changed since the draft.
    const priced = await this.price(
      tenantId,
      order.items.map((item) => ({
        productId: item.productId ?? '',
        quantity: item.quantity,
        ...chosenOptions(item.options),
      })),
    );
    if (!priced.ok) return { output: problemsOutput(priced.problems) };
    if (priced.total !== order.total) {
      await this.prisma.$transaction([
        this.prisma.orderItem.deleteMany({
          where: { orderId: order.id, tenantId },
        }),
        this.prisma.orderItem.createMany({
          data: itemRows(tenantId, priced.lines).map((row) => ({
            ...row,
            orderId: order.id,
          })),
        }),
        this.prisma.order.updateMany({
          where: { id: order.id, tenantId },
          data: { status: 'DRAFT', total: priced.total },
        }),
      ]);
      return {
        output: {
          error: 'price_changed',
          message:
            'Prices changed since the draft. Read the new items and total back and ask the customer to confirm again.',
          orderCode: orderCode(order.id),
          items: priced.lines.map(describeLine),
          total: priced.total,
          currency: 'MNT',
        },
      };
    }

    const token = randomBytes(18).toString('base64url');
    const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_HOURS * 3_600_000);
    await this.prisma.$transaction([
      this.prisma.paymentLink.updateMany({
        where: { orderId: order.id, tenantId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      }),
      this.prisma.paymentLink.create({
        data: {
          tenantId,
          orderId: order.id,
          provider: 'DEMO',
          token,
          paymentUrl: this.checkoutUrl(token),
          expiresAt,
        },
      }),
      this.prisma.order.updateMany({
        where: { id: order.id, tenantId },
        data: { status: 'CONFIRMED', expiresAt },
      }),
    ]);
    return this.awaitingPayment(order.id, order.total, token);
  }

  private async cancel(
    tenantId: string,
    conversationId: string,
  ): Promise<OrderToolResult> {
    const closed = await this.prisma.$transaction((tx) =>
      closeOpenOrders(tx, tenantId, conversationId),
    );
    if (closed.length === 0) {
      return {
        output: toolError(
          'no_open_order',
          'There is no unpaid order to cancel.',
        ),
      };
    }
    return { output: { orderCode: orderCode(closed[0]), status: 'cancelled' } };
  }

  private awaitingPayment(
    orderId: string,
    total: number,
    token: string,
  ): OrderToolResult {
    const code = orderCode(orderId);
    return {
      output: {
        orderCode: code,
        status: 'awaiting_payment',
        total,
        currency: 'MNT',
        paymentLink:
          'Sonor sends it to the customer as a button right after your reply. Do not write a URL.',
        expiresInHours: CHECKOUT_TTL_HOURS,
      },
      paymentLink: { url: this.checkoutUrl(token), orderCode: code, total },
    };
  }

  private async price(tenantId: string, items: RequestedItem[]) {
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        active: true,
        id: { in: items.map((item) => item.productId) },
      },
      select: {
        id: true,
        name: true,
        price: true,
        stock: true,
        attributes: true,
      },
    });
    return priceOrder(products, items);
  }

  private findLink(token: string): Promise<CheckoutLink | null> {
    return this.prisma.paymentLink.findUnique({
      where: { token },
      include: LINK_INCLUDE,
    });
  }
}

/** Cancels this chat's unpaid orders and their pending links; returns their IDs. */
async function closeOpenOrders(
  tx: Prisma.TransactionClient,
  tenantId: string,
  conversationId: string,
): Promise<string[]> {
  const open = await tx.order.findMany({
    where: { tenantId, conversationId, status: { in: OPEN } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const ids = open.map((order) => order.id);
  if (ids.length === 0) return ids;
  await tx.order.updateMany({
    where: { id: { in: ids }, tenantId },
    data: { status: 'CANCELLED' },
  });
  await tx.paymentLink.updateMany({
    where: { orderId: { in: ids }, tenantId, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
  return ids;
}

function itemRows(tenantId: string, lines: PricedLine[]) {
  return lines.map((line) => ({
    tenantId,
    productId: line.productId,
    productName: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    options: line.options,
  }));
}

function describeLine(line: PricedLine) {
  return {
    name: line.name,
    ...line.options,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
  };
}

function problemsOutput(problems: unknown) {
  return {
    error: 'order_problems',
    message:
      'The order was not drafted. Ask the customer about these items (offer the choices), then call create_order again.',
    problems,
  };
}

function chosenOptions(value: unknown): { size?: string; color?: string } {
  if (typeof value !== 'object' || value === null) return {};
  const { size, color } = value as Record<string, unknown>;
  return {
    ...(typeof size === 'string' ? { size } : {}),
    ...(typeof color === 'string' ? { color } : {}),
  };
}

function toView(link: CheckoutLink, now: Date): CheckoutView {
  const state: CheckoutState =
    link.status === 'PAID'
      ? 'paid'
      : link.status === 'CANCELLED'
        ? 'cancelled'
        : link.status === 'EXPIRED' || !link.expiresAt || link.expiresAt <= now
          ? 'expired'
          : 'pending';
  return {
    state,
    shopName: link.tenant.name,
    pageId: /^\d+$/.test(link.tenant.facebookPageId)
      ? link.tenant.facebookPageId
      : null,
    orderCode: orderCode(link.orderId),
    items: link.order.items.map((item) => {
      const options = chosenOptions(item.options);
      return {
        name: item.productName,
        options: [options.size, options.color].filter(
          (option): option is string => Boolean(option),
        ),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.unitPrice * item.quantity,
      };
    }),
    total: link.order.total,
  };
}
