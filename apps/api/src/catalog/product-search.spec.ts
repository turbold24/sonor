import { demoTenants } from '../../prisma/demo-data.js';
import { isOffered, rankProducts } from './product-search.js';

const [clothing, cosmetics] = demoTenants.map((tenant) =>
  tenant.products
    .filter((product) => product.active !== false)
    .map((product) => ({
      name: product.name,
      description: product.description ?? null,
      category: product.category ?? null,
      price: product.price,
      attributes: product.attributes,
    })),
);

const names = (
  query: Parameters<typeof rankProducts>[1],
  products = clothing,
) => rankProducts(products, query).map((product) => product.name);

describe('rankProducts', () => {
  it('finds the same products for Cyrillic and Latin queries', () => {
    const cyrillic = names({ query: 'дээл' });
    expect(cyrillic.length).toBeGreaterThan(0);
    expect(names({ query: 'deel' })).toEqual(cyrillic);
    expect(names({ query: 'Дээл байгаа юу?' })).toEqual(cyrillic);
    expect(names({ query: 'deel bga yu' })).toEqual(cyrillic);
  });

  it.each([
    ['ноолууран малгай', 'Ноолууран малгай'],
    ['nooluuran malgai', 'Ноолууран малгай'],
    ['malgay', 'Ноолууран малгай'],
    ['малгайг', 'Ноолууран малгай'],
    ['urt udun kurtka', 'Урт өдөн куртка'],
    ['xurganii ariсан dotortoi deel', 'Хурганы арьсан дотортой өвлийн дээл'],
    ['mongol gutal', 'Орчин үеийн монгол гутал'],
    ['beelii', 'Арьсан дулаан бээлий'],
  ])('ranks "%s" -> %s first', (query, expected) => {
    expect(names({ query })[0]).toBe(expected);
  });

  it.each([
    ['nuurnii tos', 'Чийгшүүлэгч нүүрний тос'],
    ['чийгшүүлэгч тос', 'Чийгшүүлэгч нүүрний тос'],
    ['spf', 'Нарнаас хамгаалах тос SPF50'],
    ['nar hamgaalah', 'Нарнаас хамгаалах тос SPF50'],
    ['uruulyn budag', 'Уруулын будаг'],
    ['chatsargana', 'Чацарганы тостой гарын тос'],
  ])('ranks cosmetics "%s" -> %s first', (query, expected) => {
    expect(names({ query }, cosmetics)[0]).toBe(expected);
  });

  it('returns nothing for products the shop does not sell', () => {
    expect(names({ query: 'тоглоом' })).toEqual([]);
    expect(names({ query: 'laptop' })).toEqual([]);
  });

  it('filters by category in either script and by max price', () => {
    expect(names({ query: '', category: 'gutal' })).toEqual([
      'Орчин үеийн монгол гутал',
    ]);
    expect(names({ query: '', category: 'Гутал' })).toEqual([
      'Орчин үеийн монгол гутал',
    ]);
    const cheap = rankProducts(clothing, { query: '', maxPrice: 80000 });
    expect(cheap.length).toBeGreaterThan(0);
    expect(cheap.every((product) => product.price <= 80000)).toBe(true);
  });

  it('caps the number of results', () => {
    expect(rankProducts(clothing, { query: '' }, 3)).toHaveLength(3);
  });
});

describe('isOffered', () => {
  it('compares options across scripts', () => {
    expect(isOffered('har', ['хар', 'бор'])).toBe(true);
    expect(isOffered('XL', { sizes: ['M', 'L', 'XL'] })).toBe(true);
    expect(isOffered('42', ['41', '42'])).toBe(true);
    expect(isOffered('ногоон', ['хар', 'бор'])).toBe(false);
  });
});
