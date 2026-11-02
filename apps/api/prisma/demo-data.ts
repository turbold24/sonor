import type { Prisma } from '../src/generated/prisma/client.js';

// Fictional businesses for the DemoConnector. Any resemblance to a real shop is accidental.
// Stock levels are deliberately mixed (plenty, low, zero, one inactive item) to exercise the agent.

export type DemoProduct = Omit<
  Prisma.ProductCreateManyInput,
  'id' | 'tenantId'
>;

export interface DemoTenant {
  name: string;
  slug: string;
  businessType: string;
  /** Placeholder, not a real Facebook Page. */
  facebookPageId: string;
  agentGreeting: string;
  agentHandoffContact: string;
  products: DemoProduct[];
}

const salkhinDeel: DemoTenant = {
  name: 'Салхин Дээл',
  slug: 'salkhin-deel',
  businessType: 'clothing',
  facebookPageId: 'demo-page-salkhin-deel',
  agentGreeting:
    'Сайн байна уу! Салхин Дээлд тавтай морилно уу. Дээл, өвлийн хувцасны талаар асуух зүйл байвал бичээрэй.',
  agentHandoffContact:
    'Манай менежер удахгүй энэ чатад хариулна. Ажлын цаг: Даваа-Баасан 10:00-19:00.',
  products: [
    {
      name: 'Орчин үеийн хээтэй дээл',
      description:
        'Уламжлалт хээг орчин үеийн шулуун загвартай хослуулсан өдөр тутмын дээл. Ажил, найр наадамд аль алинд нь тохирно.',
      price: 285000,
      stock: 8,
      category: 'Дээл',
      attributes: {
        sizes: ['S', 'M', 'L', 'XL'],
        colors: ['хар хөх', 'бордо', 'цайвар саарал'],
        material: 'торгомсог даавуу',
      },
    },
    {
      name: 'Торгон зуны дээл',
      description:
        'Хөнгөн, агаар сайн нэвтрүүлдэг байгалийн торгон дээл. Зуны баяр, Наадамд өмсөхөд тохиромжтой.',
      price: 320000,
      stock: 5,
      category: 'Дээл',
      attributes: {
        sizes: ['S', 'M', 'L'],
        colors: ['цэнхэр', 'ягаан', 'цагаан'],
        material: 'байгалийн торго',
      },
    },
    {
      name: 'Эрэгтэй богино дээл',
      description:
        'Өвдөг хүртэлх урттай, хөдөлгөөнд саадгүй эрэгтэй дээл. Жинсэн өмд, гуталтай хослуулж өмсөж болно.',
      price: 245000,
      stock: 6,
      category: 'Дээл',
      attributes: {
        sizes: ['M', 'L', 'XL', 'XXL'],
        colors: ['хар', 'хүрэн', 'хөх'],
      },
    },
    {
      name: 'Хүүхдийн баярын дээл',
      description:
        'Зөөлөн хөвөн доторлогоотой хүүхдийн дээл. Цагаан сар, сургуулийн арга хэмжээнд өмсөхөд гоё.',
      price: 120000,
      stock: 10,
      category: 'Дээл',
      attributes: {
        sizes: ['3-4 нас', '5-6 нас', '7-8 нас'],
        colors: ['улаан', 'ногоон', 'цэнхэр'],
      },
    },
    {
      name: 'Хурганы арьсан дотортой өвлийн дээл',
      description:
        'Хурганы арьсан дотортой, -40°C хүйтэнд ч дулаан байлгах өвлийн дээл. Гадна тал нь ус нэвтрүүлэхгүй даавуу.',
      price: 690000,
      stock: 2,
      category: 'Дээл',
      attributes: {
        sizes: ['M', 'L', 'XL'],
        colors: ['хар', 'бор'],
      },
    },
    {
      name: 'Ноолууран богино хүрэм',
      description:
        'Ноолуур холимог даавуугаар хийсэн богино хүрэм. Намар, хаврын сэрүүн өдрүүдэд тохиромжтой.',
      price: 210000,
      stock: 4,
      category: 'Өвлийн хувцас',
      attributes: {
        sizes: ['S', 'M', 'L'],
        colors: ['тэмээн шар', 'саарал'],
      },
    },
    {
      name: 'Урт өдөн куртка',
      description:
        '90% нугасны өдөн дүүргэлттэй, малгайтай урт куртка. Хотын өвөлд хөнгөн бөгөөд дулаан.',
      price: 459000,
      stock: 7,
      category: 'Өвлийн хувцас',
      attributes: {
        sizes: ['S', 'M', 'L', 'XL'],
        colors: ['хар', 'цагаан', 'хаки'],
      },
    },
    {
      name: 'Тэмээний ноосон хантааз',
      description:
        'Тэмээний ноосоор дулаалсан хантааз. Дээл, курткан дотуур өмсөхөд тохиромжтой.',
      price: 165000,
      stock: 0,
      category: 'Өвлийн хувцас',
      attributes: {
        sizes: ['M', 'L', 'XL'],
        colors: ['байгалийн бор'],
      },
    },
    {
      name: 'Ноолууран малгай',
      description:
        '100% ноолууран сүлжмэл малгай. Зөөлөн бөгөөд чихийг бүрэн хамгаална.',
      price: 59000,
      stock: 15,
      category: 'Дагалдах хэрэгсэл',
      attributes: {
        sizes: ['нэг хэмжээ'],
        colors: ['саарал', 'хар', 'цөцгийн цагаан'],
      },
    },
    {
      name: 'Ноолууран ороолт',
      description: 'Урт, өргөн ноолууран ороолт. Бэлэг болгоход тохиромжтой.',
      price: 89000,
      stock: 0,
      category: 'Дагалдах хэрэгсэл',
      attributes: {
        colors: ['бордо', 'хар хөх', 'тэмээн шар'],
      },
    },
    {
      name: 'Арьсан дулаан бээлий',
      description:
        'Үхрийн арьсан, ноосон доторлогоотой бээлий. Хурууны үзүүрээр утасны дэлгэц ашиглаж болно.',
      price: 75000,
      stock: 12,
      category: 'Дагалдах хэрэгсэл',
      attributes: {
        sizes: ['S', 'M', 'L'],
        colors: ['хар', 'бор'],
      },
    },
    {
      name: 'Орчин үеийн монгол гутал',
      description:
        'Уламжлалт монгол гутлын хэлбэрийг хөнгөн ул, дулаан доторлогоотой хослуулсан гутал.',
      price: 380000,
      stock: 0,
      category: 'Гутал',
      attributes: {
        sizes: ['37', '38', '39', '40', '41', '42', '43', '44'],
        colors: ['хар', 'бор'],
      },
    },
  ],
};

const shuuderGoo: DemoTenant = {
  name: 'Шүүдэр Гоо',
  slug: 'shuuder-goo',
  businessType: 'cosmetics',
  facebookPageId: 'demo-page-shuuder-goo',
  agentGreeting:
    'Сайн байна уу! Шүүдэр Гоо дэлгүүрт тавтай морилно уу. Арьс арчилгаа, гоо сайхны бүтээгдэхүүний талаар асуугаарай.',
  agentHandoffContact:
    'Манай гоо сайхны зөвлөх удахгүй холбогдоно. Ажлын цаг: Даваа-Ням 11:00-20:00.',
  products: [
    {
      name: 'Чийгшүүлэгч нүүрний тос',
      description:
        'Гиалуроны хүчил, алоэ вера агуулсан өдөр тутмын чийгшүүлэгч. Хүйтэн, хуурай агаараас арьсыг хамгаална.',
      price: 48000,
      stock: 20,
      category: 'Арьс арчилгаа',
      attributes: { volume: '50 мл', skinTypes: ['хуурай', 'хэвийн'] },
    },
    {
      name: 'Нарнаас хамгаалах тос SPF50',
      description:
        'Хөнгөн бүтэцтэй, цагаан ул мөр үлдээдэггүй нарнаас хамгаалах тос. Жилийн турш өдөр бүр хэрэглэнэ.',
      price: 39000,
      stock: 0,
      category: 'Арьс арчилгаа',
      attributes: { volume: '50 мл', skinTypes: ['бүх төрлийн арьс'] },
    },
    {
      name: 'Гиалуроны хүчилтэй серум',
      description:
        'Арьсыг гүн чийгшүүлж, уян хатан болгох серум. Өглөө, орой тос түрхэхээс өмнө хэрэглэнэ.',
      price: 62000,
      stock: 12,
      category: 'Арьс арчилгаа',
      attributes: { volume: '30 мл', skinTypes: ['бүх төрлийн арьс'] },
    },
    {
      name: 'Зөөлөн цэвэрлэгч хөөс',
      description:
        'Нүүрний тос, тоос шороог арьс хуурайшуулахгүйгээр цэвэрлэнэ.',
      price: 28000,
      stock: 25,
      category: 'Арьс арчилгаа',
      attributes: { volume: '150 мл', skinTypes: ['тослог', 'холимог'] },
    },
    {
      name: 'Уруулын будаг',
      description: 'Удаан тогтдог, уруул хатаадаггүй матт будаг.',
      price: 32000,
      stock: 9,
      category: 'Будаг',
      attributes: {
        shades: ['01 Улаан', '02 Шаргал ягаан', '03 Хүрэн'],
        finish: 'матт',
      },
    },
    {
      name: 'Нүүрний даавуун маск, 10 ширхэг',
      description:
        'Чийгшүүлэх, тайвшруулах үйлчилгээтэй 10 ширхэг даавуун маск. 7 хоногт 2-3 удаа хэрэглэнэ.',
      price: 25000,
      stock: 30,
      category: 'Арьс арчилгаа',
      attributes: { pieces: 10 },
    },
    {
      name: 'Чацарганы тостой гарын тос',
      description:
        'Чацарганы тос агуулсан, хагарсан гарыг хурдан тэжээх тос. Өвлийн улиралд зайлшгүй хэрэгтэй.',
      price: 15000,
      stock: 0,
      category: 'Арьс арчилгаа',
      attributes: { volume: '75 мл' },
    },
    {
      name: 'Тональ крем',
      description:
        'Арьсны өнгийг жигдлэх, хөнгөн бүрхэцтэй тональ крем. Өдөржин тогтоно.',
      price: 55000,
      stock: 4,
      category: 'Будаг',
      attributes: {
        volume: '30 мл',
        shades: ['21 Цайвар', '23 Байгалийн', '25 Шаргал'],
      },
    },
    {
      name: 'Нүдний доорх крем',
      description:
        'Кофеин агуулсан, нүдний доорх хаван, харлалтыг багасгах крем.',
      price: 45000,
      stock: 2,
      category: 'Арьс арчилгаа',
      attributes: { volume: '15 мл' },
    },
    {
      name: 'Ургамлын хандтай шампунь',
      description:
        'Халгай, ромашкийн ханд агуулсан, хуйхыг зөөлөн цэвэрлэх шампунь.',
      price: 26000,
      stock: 18,
      category: 'Үс арчилгаа',
      attributes: { volume: '300 мл' },
    },
    {
      name: 'Хязгаарлагдмал цуглуулгын сүрчиг',
      description:
        'Өнгөрсөн улирлын хязгаарлагдмал цуглуулга. Одоогоор худалдаанд байхгүй.',
      price: 89000,
      stock: 6,
      category: 'Сүрчиг',
      attributes: { volume: '50 мл' },
      active: false,
    },
  ],
};

export const demoTenants: DemoTenant[] = [salkhinDeel, shuuderGoo];
