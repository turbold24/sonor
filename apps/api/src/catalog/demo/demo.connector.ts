import { Injectable } from '@nestjs/common';
import type { Tenant } from '../../generated/prisma/client.js';
import type { ToolDefinition } from '../../model/model.types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toolError, type CatalogConnector } from '../catalog.types.js';
import { isOffered, rankProducts } from '../product-search.js';
import { availabilityOf } from '../stock-policy.js';

const AVAILABILITY_NOTE =
  'availability is one of in_stock, few_left, out_of_stock. Exact counts are never shared.';

export const DEMO_TOOLS: ToolDefinition[] = [
  {
    name: 'search_products',
    description: `Search this shop's catalog. The query may be Mongolian in Cyrillic or Latin letters ("дээл" or "deel"). Returns products with productId, price in MNT and availability. Always search before stating a price. ${AVAILABILITY_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Product words as the customer wrote them, e.g. "ноолууран малгай" or "nuurnii tos". May be empty when filtering by category or price.',
        },
        category: {
          type: 'string',
          description: 'Optional category, e.g. "Дээл" or "Гутал".',
        },
        maxPrice: {
          type: 'integer',
          description: 'Optional maximum price in MNT.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_product',
    description: `Full details of one product by productId from search results: description, options (sizes, colors, shades, volume), price in MNT and availability. ${AVAILABILITY_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'productId from search.' },
      },
      required: ['productId'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_availability',
    description: `Check if a product is available, optionally in a size or color/shade. Says whether the size or color is offered. ${AVAILABILITY_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'productId from search.' },
        size: {
          type: 'string',
          description: 'Optional size, e.g. "L" or "42".',
        },
        color: {
          type: 'string',
          description: 'Optional color or shade, e.g. "хар" or "har".',
        },
      },
      required: ['productId'],
      additionalProperties: false,
    },
  },
];

const BUSINESS_TYPES: Record<string, string> = {
  clothing: 'хувцасны дэлгүүр',
  cosmetics: 'гоо сайхны бүтээгдэхүүний дэлгүүр',
};

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  stock: number;
  attributes: unknown;
}

const PRODUCT_FIELDS = {
  id: true,
  name: true,
  description: true,
  category: true,
  price: true,
  stock: true,
  attributes: true,
} as const;

/** Tools over Sonor's own Product table, for DEMO tenants. Every query is tenant-scoped. */
@Injectable()
export class DemoConnector implements CatalogConnector {
  constructor(private readonly prisma: PrismaService) {}

  tools(): Promise<ToolDefinition[]> {
    return Promise.resolve(DEMO_TOOLS);
  }

  async execute(
    tenant: Tenant,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (name) {
      case 'search_products':
        return this.search(tenant.id, args);
      case 'get_product':
        return this.getProduct(tenant.id, args);
      case 'check_availability':
        return this.checkAvailability(tenant.id, args);
      default:
        return toolError('unknown_tool', `No tool named ${name}.`);
    }
  }

  async brief(tenant: Tenant): Promise<string> {
    const rows = await this.prisma.product.findMany({
      where: { tenantId: tenant.id, active: true },
      distinct: ['category'],
      select: { category: true },
    });
    const categories = rows.flatMap((row) => row.category ?? []);
    return [
      `${tenant.name}: ${BUSINESS_TYPES[tenant.businessType] ?? tenant.businessType}.`,
      `Барааны ангилал: ${categories.join(', ')}.`,
      'Үнэ төгрөгөөр (₮). Хүргэлт, буцаалт, төлбөрийн нөхцөлийн талаар мэдээлэл байхгүй.',
    ].join('\n');
  }

  private async search(tenantId: string, args: Record<string, unknown>) {
    const products = await this.activeProducts(tenantId);
    const matches = rankProducts(products, {
      query: string(args.query) ?? '',
      category: string(args.category),
      maxPrice: typeof args.maxPrice === 'number' ? args.maxPrice : undefined,
    });
    if (matches.length === 0) {
      return {
        results: [],
        message: 'No matching products in this shop.',
        categories: [...new Set(products.flatMap((p) => p.category ?? []))],
      };
    }
    return { results: matches.map(summary) };
  }

  private async getProduct(tenantId: string, args: Record<string, unknown>) {
    const product = await this.findProduct(tenantId, args.productId);
    if (!product) return notFound();
    return { ...summary(product), description: product.description };
  }

  private async checkAvailability(
    tenantId: string,
    args: Record<string, unknown>,
  ) {
    const product = await this.findProduct(tenantId, args.productId);
    if (!product) return notFound();

    const options = isRecord(product.attributes) ? product.attributes : {};
    const size = string(args.size);
    const color = string(args.color);
    const sizeOffered = size ? isOffered(size, options.sizes) : undefined;
    const colorOffered = color
      ? isOffered(color, [options.colors, options.shades])
      : undefined;

    return {
      productId: product.id,
      name: product.name,
      availability:
        sizeOffered === false || colorOffered === false
          ? 'not_offered'
          : availabilityOf(product.stock),
      ...(size ? { size, sizeOffered, sizes: options.sizes ?? [] } : {}),
      ...(color
        ? {
            color,
            colorOffered,
            colors: options.colors ?? options.shades ?? [],
          }
        : {}),
      note: 'Availability is for the product overall, not per size or color.',
    };
  }

  private activeProducts(tenantId: string): Promise<ProductRow[]> {
    return this.prisma.product.findMany({
      where: { tenantId, active: true },
      select: PRODUCT_FIELDS,
    });
  }

  private findProduct(
    tenantId: string,
    productId: unknown,
  ): Promise<ProductRow | null> {
    const id = string(productId);
    if (!id) return Promise.resolve(null);
    return this.prisma.product.findFirst({
      where: { id, tenantId, active: true },
      select: PRODUCT_FIELDS,
    });
  }
}

function summary(product: ProductRow) {
  return {
    productId: product.id,
    name: product.name,
    price: product.price,
    currency: 'MNT',
    category: product.category,
    availability: availabilityOf(product.stock),
    options: product.attributes ?? {},
  };
}

function notFound() {
  return toolError('not_found', 'No such product in this shop.');
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
