/**
 * Pre-launch seed.
 *
 * - Equipment specs are compiled from public manufacturer spec sheets
 *   (ARRI / RED / Sony / Canon / Blackmagic / Aputure / Astera / DJI).
 * - `indicativeDayRate` values are placeholder market estimates in SAR, used
 *   only when no approved vendor stocks an item. Vendors set the real prices,
 *   and an admin can edit these from the catalog screen.
 * - Crew day rates and budget-tier windows are starting points for the admin to
 *   tune; the budget agent reads them from the database, never from code.
 */
import { randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import {
  BudgetTier,
  CameraMovement,
  Complexity,
  PrismaClient,
  Role,
  DayNightSuitability,
} from '@prisma/client';
import { buildDopEmbeddingText, writeDopEmbedding, embedText } from '../src/lib/embeddings';
import { DEFAULT_BUDGET_TIERS, DEFAULT_SETTINGS } from '../src/lib/settings';

const prisma = new PrismaClient();

/**
 * Seeded accounts are real Gmail addresses built with plus-addressing, so every
 * demo inbox (approval mails, inquiries, password resets) lands in the owner's
 * mailbox and can actually be signed into.
 *
 *   SEED_GMAIL=you@gmail.com  →  you+admin@gmail.com, you+producer@gmail.com, …
 *
 * The password comes from SEED_PASSWORD. When it is missing a strong one is
 * generated and printed once, so a public deployment never ships with a
 * password that is committed to the repository.
 */
const SEED_GMAIL = process.env.SEED_GMAIL ?? 'amr.khufra250@gmail.com';

function seedEmail(tag: string) {
  const [local, domain] = SEED_GMAIL.split('@');
  if (!domain) throw new Error('SEED_GMAIL must be a full email address');
  // Strip any existing +tag so re-runs stay idempotent.
  return `${local.split('+')[0]}+${tag}@${domain}`;
}

function seedPassword() {
  const configured = process.env.SEED_PASSWORD;
  if (configured && configured.length >= 8) return { value: configured, generated: false };
  const generated = `Sin-${randomBytes(9).toString('base64url')}`;
  return { value: generated, generated: true };
}

const { LOW, MEDIUM, HIGH } = BudgetTier;
const ALL_TIERS = [LOW, MEDIUM, HIGH];
const { STATIC, HANDHELD, STEADICAM_GIMBAL, CRANE_DOLLY, DRONE } = CameraMovement;
const ALL_MOVES = [STATIC, HANDHELD, STEADICAM_GIMBAL, CRANE_DOLLY];

const CATEGORIES = [
  { slug: 'camera-body', nameEn: 'Camera bodies', nameAr: 'كاميرات', sortOrder: 1 },
  { slug: 'lens', nameEn: 'Lenses', nameAr: 'عدسات', sortOrder: 2 },
  { slug: 'lighting', nameEn: 'Lighting', nameAr: 'إضاءة', sortOrder: 3 },
  { slug: 'grip', nameEn: 'Grip & rigging', nameAr: 'تثبيت وتجهيزات', sortOrder: 4 },
  { slug: 'support', nameEn: 'Camera support & movement', nameAr: 'حركة الكاميرا', sortOrder: 5 },
  { slug: 'sound', nameEn: 'Sound', nameAr: 'صوت', sortOrder: 6 },
  { slug: 'power', nameEn: 'Power & distribution', nameAr: 'طاقة وتوزيع', sortOrder: 7 },
];

type EquipmentSeed = {
  category: string;
  brand: string;
  model: string;
  nameAr?: string;
  specs: Record<string, string | number>;
  summaryEn: string;
  summaryAr: string;
  lighting: Complexity[];
  movement: CameraMovement[];
  tiers: BudgetTier[];
  dayNight: DayNightSuitability;
  capabilities?: string[];
  dayRate: number;
  isCore?: boolean;
};

const EQUIPMENT: EquipmentSeed[] = [
  // ---------------------------------------------------------------- cameras
  {
    category: 'camera-body',
    brand: 'ARRI',
    model: 'ALEXA 35',
    nameAr: 'أليكسا ٣٥',
    specs: {
      sensor: 'Super 35 ALEV 4 CMOS, 4608 x 3164',
      dynamicRange: '17 stops (manufacturer stated)',
      mount: 'LPL (PL via adapter)',
      maxFrameRate: '120 fps at 4.6K 16:9',
      recording: 'ARRIRAW, Apple ProRes',
      weight: '2.9 kg body',
    },
    summaryEn: 'Highest dynamic range in the ARRI line; the reference choice for heavy night work and high-contrast interiors.',
    summaryAr: 'أعلى مدى ديناميكي في عائلة أري، الخيار المرجعي للتصوير الليلي والمشاهد عالية التباين.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 5200,
    isCore: true,
  },
  {
    category: 'camera-body',
    brand: 'ARRI',
    model: 'ALEXA Mini LF',
    specs: {
      sensor: 'Large format ALEV III, 4448 x 3096',
      dynamicRange: '14+ stops (manufacturer stated)',
      mount: 'LPL',
      maxFrameRate: '90 fps at 4.5K LF 2.39:1',
      recording: 'ARRIRAW, ProRes',
      weight: '2.6 kg body',
    },
    summaryEn: 'Large-format ARRI in a compact body — shallow depth of field for premium commercials and drama.',
    summaryAr: 'مستشعر كبير بجسم مدمج، عمق ميدان ضيق للأعمال الإعلانية والدرامية الراقية.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 4600,
    isCore: true,
  },
  {
    category: 'camera-body',
    brand: 'ARRI',
    model: 'ALEXA Mini',
    specs: {
      sensor: 'Super 35 ALEV III, 3424 x 2202',
      dynamicRange: '14+ stops (manufacturer stated)',
      mount: 'PL (EF available)',
      maxFrameRate: '200 fps at 2K',
      recording: 'ARRIRAW, ProRes',
      weight: '2.3 kg body',
    },
    summaryEn: 'The industry workhorse: light enough for gimbal and handheld, with the ARRI colour science drama expects.',
    summaryAr: 'الخيار الأكثر استخداماً: خفيف للاستخدام المحمول والجيمبال مع علم الألوان المعتاد من أري.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 3200,
    isCore: true,
  },
  {
    category: 'camera-body',
    brand: 'RED',
    model: 'V-RAPTOR 8K VV',
    specs: {
      sensor: 'Full-frame VV CMOS, 8192 x 4320',
      dynamicRange: '17+ stops (manufacturer stated)',
      mount: 'RF (PL adapter available)',
      maxFrameRate: '120 fps at 8K full frame',
      recording: 'REDCODE RAW',
      weight: '1.9 kg body',
    },
    summaryEn: 'High-resolution full frame for VFX plates and big-format commercial work.',
    summaryAr: 'دقة عالية بمستشعر كامل، مناسب للمؤثرات البصرية والإعلانات الكبيرة.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['vfx greenscreen', 'vfx plates'],
    dayRate: 3800,
  },
  {
    category: 'camera-body',
    brand: 'RED',
    model: 'KOMODO 6K',
    specs: {
      sensor: 'Super 35 global shutter CMOS, 6144 x 3240',
      dynamicRange: '16+ stops (manufacturer stated)',
      mount: 'Canon RF',
      maxFrameRate: '40 fps at 6K',
      recording: 'REDCODE RAW, ProRes',
      weight: '0.95 kg body',
    },
    summaryEn: 'Compact global-shutter body — crash cam, vehicle mount and gimbal work without rolling-shutter skew.',
    summaryAr: 'جسم مدمج بمصراع عالمي، مناسب للتثبيت على المركبات والجيمبال دون تشويه.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [HANDHELD, STEADICAM_GIMBAL, CRANE_DOLLY, DRONE],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['vehicle mount', 'crash cam', 'drone'],
    dayRate: 1500,
  },
  {
    category: 'camera-body',
    brand: 'Sony',
    model: 'VENICE 2',
    specs: {
      sensor: 'Full-frame CMOS, 8.6K or 6K sensor block',
      dynamicRange: '16 stops (manufacturer stated)',
      mount: 'E-mount with PL adapter',
      dualBaseISO: 'Dual base ISO 800 / 3200',
      recording: 'X-OCN, ProRes',
      extras: 'Rialto extension system',
    },
    summaryEn: 'Full-frame Sony flagship with an extension system for tight interiors and rigging.',
    summaryAr: 'كاميرا سوني الرائدة بمستشعر كامل مع نظام تمديد مناسب للأماكن الضيقة.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 4200,
  },
  {
    category: 'camera-body',
    brand: 'Sony',
    model: 'FX9',
    specs: {
      sensor: 'Full-frame 6K CMOS',
      mount: 'E-mount',
      dualBaseISO: 'Dual base ISO 800 / 4000',
      recording: 'XAVC-I, RAW output',
      extras: 'Built-in variable ND, Fast Hybrid AF',
    },
    summaryEn: 'Documentary and corporate workhorse: internal ND and reliable autofocus for long run-and-gun days.',
    summaryAr: 'خيار موثوق للأفلام الوثائقية: فلتر ND مدمج وتركيز تلقائي لأيام التصوير الطويلة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL],
    tiers: [MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['documentary', 'interview'],
    dayRate: 1100,
  },
  {
    category: 'camera-body',
    brand: 'Sony',
    model: 'FX6',
    nameAr: 'سوني FX6',
    specs: {
      sensor: 'Full-frame 10.2MP CMOS',
      mount: 'E-mount',
      dualBaseISO: 'Dual base ISO 800 / 12800',
      recording: 'XAVC-I up to 4K 120p',
      extras: 'Built-in variable ND, 1.0 kg body',
    },
    summaryEn: 'Dual base ISO 12800 makes this the cost-effective low-light body for night exteriors on a small budget.',
    summaryAr: 'حساسية عالية تصل إلى ١٢٨٠٠ تجعلها الخيار الاقتصادي للتصوير الليلي الخارجي.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL, DRONE],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.NIGHT,
    capabilities: ['low light', 'run and gun'],
    dayRate: 650,
    isCore: true,
  },
  {
    category: 'camera-body',
    brand: 'Canon',
    model: 'EOS C70',
    specs: {
      sensor: 'Super 35 DGO CMOS, 4K',
      mount: 'Canon RF',
      dynamicRange: '16+ stops (manufacturer stated)',
      recording: 'XF-AVC, Cinema RAW Light',
      extras: 'Built-in ND, dual mini-XLR',
    },
    summaryEn: 'Compact Super 35 body with dual-gain output — a strong B-cam for interviews and tight locations.',
    summaryAr: 'جسم مدمج بمستشعر سوبر ٣٥، كاميرا ثانية ممتازة للمقابلات والمواقع الضيقة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 550,
  },
  {
    category: 'camera-body',
    brand: 'Blackmagic Design',
    model: 'Pocket Cinema Camera 6K Pro',
    specs: {
      sensor: 'Super 35 CMOS, 6144 x 3456',
      mount: 'Canon EF',
      dynamicRange: '13 stops (manufacturer stated)',
      recording: 'Blackmagic RAW, ProRes',
      extras: 'Built-in ND filters, tilting HDR screen',
    },
    summaryEn: 'Lowest-cost RAW body in the catalog; best for short films and student-budget commercials.',
    summaryAr: 'أقل تكلفة للتصوير بصيغة RAW، مناسب للأفلام القصيرة والميزانيات المحدودة.',
    lighting: [Complexity.LOW],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL],
    tiers: [LOW],
    dayNight: DayNightSuitability.DAY,
    dayRate: 300,
  },

  // ---------------------------------------------------------------- lenses
  {
    category: 'lens',
    brand: 'ARRI',
    model: 'Signature Prime set (5 lenses)',
    specs: {
      coverage: 'Large format, LPL mount',
      aperture: 'T1.8',
      focalLengths: '25, 35, 47, 75, 125 mm',
      character: 'Gentle falloff, smooth skin rendition',
    },
    summaryEn: 'Large-format primes with soft falloff — matched to ALEXA LF bodies for premium drama and commercials.',
    summaryAr: 'عدسات ثابتة للمستشعر الكبير بتلاشٍ ناعم، متوافقة مع كاميرات أليكسا LF.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 3400,
    isCore: true,
  },
  {
    category: 'lens',
    brand: 'Cooke',
    model: 'S4/i Prime set (6 lenses)',
    specs: {
      coverage: 'Super 35, PL mount',
      aperture: 'T2.0',
      focalLengths: '18, 25, 32, 50, 75, 100 mm',
      character: 'Cooke Look — warm, rounded rendition',
    },
    summaryEn: 'The classic warm cinematic prime set; the default answer to "warm tones, classic cinematic".',
    summaryAr: 'مجموعة عدسات كلاسيكية بألوان دافئة، الخيار الأول للمظهر السينمائي التقليدي.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 2600,
  },
  {
    category: 'lens',
    brand: 'ZEISS',
    model: 'Supreme Prime set (5 lenses)',
    specs: {
      coverage: 'Full frame / VV, PL mount',
      aperture: 'T1.5',
      focalLengths: '25, 29, 35, 50, 85 mm',
      character: 'Clean, neutral, high contrast',
    },
    summaryEn: 'Fast full-frame primes — T1.5 buys a stop of headroom on night interiors.',
    summaryAr: 'عدسات سريعة للمستشعر الكامل، فتحة T1.5 تمنح مرونة إضافية في التصوير الليلي.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.NIGHT,
    dayRate: 2200,
  },
  {
    category: 'lens',
    brand: 'Atlas Lens Co.',
    model: 'Orion Anamorphic 2x set (4 lenses)',
    specs: {
      coverage: 'Super 35, PL mount',
      squeeze: '2x anamorphic',
      aperture: 'T2.0',
      focalLengths: '40, 50, 65, 80 mm',
      character: 'Blue horizontal flares, oval bokeh',
    },
    summaryEn: 'Anamorphic character at a rental price a mid-budget feature can carry.',
    summaryAr: 'مظهر أنامورفيك بسعر إيجار يناسب الأفلام ذات الميزانية المتوسطة.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: [STATIC, CRANE_DOLLY, STEADICAM_GIMBAL],
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['anamorphic'],
    dayRate: 1800,
  },
  {
    category: 'lens',
    brand: 'Sigma',
    model: 'Cine FF High Speed Prime set (5 lenses)',
    specs: {
      coverage: 'Full frame, PL / E mount',
      aperture: 'T1.5',
      focalLengths: '24, 35, 50, 85, 105 mm',
      character: 'Neutral, modern, high resolving',
    },
    summaryEn: 'Fast, affordable full-frame primes — the value low-light set.',
    summaryAr: 'عدسات سريعة واقتصادية للمستشعر الكامل، الخيار الأفضل سعراً للإضاءة المنخفضة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: ALL_MOVES,
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.NIGHT,
    dayRate: 700,
    isCore: true,
  },
  {
    category: 'lens',
    brand: 'Fujinon',
    model: 'MK 18-55 T2.9 zoom',
    specs: {
      coverage: 'Super 35, E-mount',
      aperture: 'T2.9 constant',
      focalRange: '18-55 mm',
      weight: '0.98 kg',
    },
    summaryEn: 'Light parfocal zoom for documentary and fast commercial coverage.',
    summaryAr: 'عدسة زووم خفيفة مناسبة للأفلام الوثائقية والتغطية الإعلانية السريعة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD, STEADICAM_GIMBAL],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.DAY,
    capabilities: ['documentary'],
    dayRate: 320,
  },

  // ---------------------------------------------------------------- lighting
  {
    category: 'lighting',
    brand: 'ARRI',
    model: 'SkyPanel S60-C',
    nameAr: 'أري سكاي بانل S60-C',
    specs: {
      type: 'LED soft panel, RGB+W',
      power: '450 W',
      colour: '2800-10000 K, full colour control',
      output: 'Approx. 1350 lux at 3 m (open face, 5600 K)',
    },
    summaryEn: 'Soft key/fill standard for interiors; colour control removes the need for gel inventory.',
    summaryAr: 'الخيار القياسي للإضاءة الناعمة في الأماكن الداخلية مع تحكم كامل بالألوان.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 900,
    isCore: true,
  },
  {
    category: 'lighting',
    brand: 'ARRI',
    model: 'M18 HMI',
    specs: {
      type: 'HMI with MAX reflector',
      power: '1800 W',
      colour: 'Daylight, 6000 K',
      use: 'Window punch, day exterior fill, day-for-night',
    },
    summaryEn: 'Daylight punch for window sources and large exterior fill; the answer to high-complexity day work.',
    summaryAr: 'إضاءة نهارية قوية للنوافذ والتعبئة الخارجية الكبيرة.',
    lighting: [Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.DAY,
    capabilities: ['day-for-night', 'window light'],
    dayRate: 1200,
  },
  {
    category: 'lighting',
    brand: 'Aputure',
    model: 'LS 600d Pro',
    specs: {
      type: 'LED COB point source',
      power: '600 W',
      colour: 'Daylight 5600 K',
      output: 'Approx. 19,000 lux at 3 m with reflector',
    },
    summaryEn: 'Hard daylight source at a fraction of HMI cost, and it runs off battery for remote locations.',
    summaryAr: 'مصدر نهاري قوي بتكلفة أقل من HMI ويعمل بالبطارية في المواقع النائية.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['battery powered', 'remote location'],
    dayRate: 420,
    isCore: true,
  },
  {
    category: 'lighting',
    brand: 'Aputure',
    model: 'amaran 200x bi-colour',
    specs: {
      type: 'LED COB',
      power: '200 W',
      colour: '2700-6500 K bi-colour',
      use: 'Practical augmentation, small interiors',
    },
    summaryEn: 'Budget key/practical augment for low-complexity interiors.',
    summaryAr: 'إضاءة اقتصادية لتعزيز المصادر الموجودة في الأماكن الداخلية البسيطة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: ALL_MOVES,
    tiers: [LOW],
    dayNight: DayNightSuitability.NIGHT,
    dayRate: 120,
    isCore: true,
  },
  {
    category: 'lighting',
    brand: 'Astera',
    model: 'Titan Tube set (8 tubes)',
    specs: {
      type: 'Battery RGB+mint LED tubes',
      runtime: 'Up to 20 h at 25% (manufacturer stated)',
      colour: 'Full RGB + mint, 1750-20000 K',
      use: 'Practicals, car interiors, hidden sources',
    },
    summaryEn: 'Wireless tubes for night interiors, vehicles and any position with no power run.',
    summaryAr: 'أنابيب إضاءة لاسلكية للمشاهد الليلية الداخلية والمركبات دون الحاجة لتمديد كهرباء.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.NIGHT,
    capabilities: ['vehicle mount', 'battery powered', 'practical source'],
    dayRate: 750,
  },
  {
    category: 'lighting',
    brand: 'Nanlux',
    model: 'Evoke 1200B',
    specs: {
      type: 'LED spot, bi-colour',
      power: '1200 W',
      colour: '2700-6500 K',
      use: 'Long-throw key, large sets',
    },
    summaryEn: 'High-output LED alternative to HMI for large sets and long throws.',
    summaryAr: 'بديل LED عالي الإخراج للـ HMI في المواقع الكبيرة والمسافات البعيدة.',
    lighting: [Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 800,
  },
  {
    category: 'lighting',
    brand: 'Kino Flo',
    model: 'Diva-Lite 20 LED kit (2 heads)',
    specs: {
      type: 'LED soft panel',
      colour: '2700-6500 K',
      use: 'Interview key/fill, beauty soft light',
    },
    summaryEn: 'Fast, soft interview package — low power draw for location interiors.',
    summaryAr: 'حزمة إضاءة ناعمة وسريعة التجهيز للمقابلات بسحب كهربائي منخفض.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [STATIC, HANDHELD],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    capabilities: ['interview'],
    dayRate: 260,
  },

  // ---------------------------------------------------------------- grip
  {
    category: 'grip',
    brand: 'Matthews',
    model: 'Standard grip package (stands, flags, clamps)',
    specs: {
      contents: '8x C-stands, flags, cutters, apple boxes, clamps, sandbags',
      transport: 'Fits a single 3-ton truck load',
    },
    summaryEn: 'Baseline grip kit — required on any set with controlled light.',
    summaryAr: 'حزمة تثبيت أساسية مطلوبة في أي موقع يعتمد على إضاءة موجهة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: ALL_TIERS,
    dayNight: DayNightSuitability.BOTH,
    dayRate: 350,
    isCore: true,
  },
  {
    category: 'grip',
    brand: 'Matthews',
    model: '12x12 butterfly kit (diffusion + solid)',
    specs: {
      contents: '12x12 frame, silk, grid cloth, solid, ratchet stands',
      use: 'Exterior diffusion, sun control',
    },
    summaryEn: 'Sun control for desert exteriors — the difference between usable and blown-out midday light.',
    summaryAr: 'التحكم بأشعة الشمس في التصوير الصحراوي الخارجي وضبط إضاءة الظهيرة.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.DAY,
    capabilities: ['desert exterior', 'sun control'],
    dayRate: 480,
  },

  // ---------------------------------------------------------------- support
  {
    category: 'support',
    brand: 'DJI',
    model: 'RS 4 Pro gimbal',
    specs: {
      payload: '4.5 kg tested payload',
      features: 'Bluetooth shutter, second release plate, LiDAR focus option',
    },
    summaryEn: 'Single-operator stabiliser for handheld-to-gimbal coverage on compact bodies.',
    summaryAr: 'مثبت لمشغل واحد للانتقال بين التصوير المحمول والجيمبال مع الكاميرات المدمجة.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: [STEADICAM_GIMBAL, HANDHELD],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 280,
    isCore: true,
  },
  {
    category: 'support',
    brand: 'Tiffen',
    model: 'Steadicam M-2 with operator vest',
    specs: {
      payload: 'Up to 18 kg',
      use: 'Long continuous takes, stair and corridor work',
    },
    summaryEn: 'Full-size stabiliser for long unbroken takes with a cinema body and prime.',
    summaryAr: 'مثبت كامل الحجم للمشاهد الطويلة المتصلة مع كاميرا سينمائية.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: [STEADICAM_GIMBAL],
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 1400,
  },
  {
    category: 'support',
    brand: 'Dana Dolly',
    model: 'Dana Dolly kit with track',
    specs: {
      contents: 'Dolly, 2x 4ft speed rail, universal end caps',
      use: 'Short precise dolly moves without a dolly grip crew',
    },
    summaryEn: 'Compact dolly moves for tight interiors and product tables.',
    summaryAr: 'حركات دوللي قصيرة ودقيقة للأماكن الضيقة وتصوير المنتجات.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: [CRANE_DOLLY, STATIC],
    tiers: [LOW, MEDIUM],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 320,
  },
  {
    category: 'support',
    brand: 'DJI',
    model: 'Inspire 3 aerial platform',
    specs: {
      camera: 'X9-8K Air full-frame gimbal camera',
      recording: 'CinemaDNG / ProRes RAW',
      features: 'RTK positioning, dual operator control',
      note: 'Aerial work requires GACA permits in Saudi Arabia',
    },
    summaryEn: 'Cinema drone platform for aerial establishers; budget permit lead time separately.',
    summaryAr: 'منصة تصوير جوي سينمائي للمشاهد التأسيسية، مع مراعاة وقت تصاريح الطيران.',
    lighting: [Complexity.LOW, Complexity.MEDIUM],
    movement: [DRONE],
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.DAY,
    capabilities: ['drone', 'aerial'],
    dayRate: 2400,
  },
  {
    category: 'support',
    brand: 'Easyrig',
    model: 'Vario 5 with Flowcine Serene arm',
    specs: {
      payload: '5-17 kg',
      use: 'All-day handheld without operator fatigue',
    },
    summaryEn: 'Body support for handheld-heavy schedules; pays for itself on long documentary days.',
    summaryAr: 'دعامة جسم للتصوير المحمول الطويل، مفيدة في أيام التصوير الوثائقي.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: [HANDHELD],
    tiers: [LOW, MEDIUM, HIGH],
    dayNight: DayNightSuitability.BOTH,
    dayRate: 180,
  },

  // ---------------------------------------------------------------- sound
  {
    category: 'sound',
    brand: 'Sound Devices',
    model: 'MixPre-10 II recorder',
    specs: {
      channels: '10-track recording, 8 inputs',
      features: '32-bit float, timecode',
    },
    summaryEn: 'Location sound recorder with timecode for multi-camera sync.',
    summaryAr: 'مسجل صوت ميداني مع كود زمني للمزامنة بين عدة كاميرات.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: ALL_TIERS,
    dayNight: DayNightSuitability.BOTH,
    dayRate: 300,
    isCore: true,
  },
  {
    category: 'sound',
    brand: 'Sennheiser',
    model: 'MKH 8060 shotgun + boom kit',
    specs: {
      pattern: 'Super-cardioid',
      contents: 'Mic, blimp, softie, boom pole, cable',
    },
    summaryEn: 'Standard dialogue boom package for interior and controlled exterior dialogue.',
    summaryAr: 'حزمة ميكروفون حوار قياسية للتصوير الداخلي والخارجي المضبوط.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: ALL_TIERS,
    dayNight: DayNightSuitability.BOTH,
    dayRate: 220,
    isCore: true,
  },

  // ---------------------------------------------------------------- power
  {
    category: 'power',
    brand: 'Anton/Bauer',
    model: 'Gold Mount battery package (6 batteries + chargers)',
    specs: {
      contents: '6x 150Wh batteries, 2x quad charger, plates',
      use: 'Camera and monitor power for a full shoot day',
    },
    summaryEn: 'Camera power for a full day without mains access.',
    summaryAr: 'طاقة الكاميرا ليوم تصوير كامل دون الحاجة لمصدر كهربائي.',
    lighting: [Complexity.LOW, Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: ALL_TIERS,
    dayNight: DayNightSuitability.BOTH,
    dayRate: 200,
    isCore: true,
  },
  {
    category: 'power',
    brand: 'Honda',
    model: 'EU70is generator (7 kVA, silenced)',
    specs: {
      output: '7 kVA',
      noise: 'Approx. 58 dB at rated load (manufacturer stated)',
      use: 'Night exteriors and remote locations',
    },
    summaryEn: 'Quiet generator for night exteriors where HMI or high-output LED needs mains.',
    summaryAr: 'مولد هادئ للتصوير الليلي الخارجي عند الحاجة لإضاءة قوية.',
    lighting: [Complexity.MEDIUM, Complexity.HIGH],
    movement: ALL_MOVES,
    tiers: [MEDIUM, HIGH],
    dayNight: DayNightSuitability.NIGHT,
    capabilities: ['remote location', 'night exterior'],
    dayRate: 550,
  },
];

const STYLE_TAGS = [
  ['warm-tones', 'Warm tones', 'ألوان دافئة'],
  ['cool-desaturated', 'Cool & desaturated', 'ألوان باردة وباهتة'],
  ['night-cinematography', 'Night cinematography', 'تصوير ليلي'],
  ['natural-light', 'Natural light', 'إضاءة طبيعية'],
  ['high-contrast-noir', 'High-contrast noir', 'تباين عالٍ نوار'],
  ['classic-cinematic', 'Classic cinematic', 'سينمائي كلاسيكي'],
  ['anamorphic-widescreen', 'Anamorphic widescreen', 'أنامورفيك عريض'],
  ['fast-paced-commercial', 'Fast-paced commercial', 'إعلاني سريع الإيقاع'],
  ['documentary-verite', 'Documentary vérité', 'وثائقي واقعي'],
  ['desert-landscape', 'Desert landscape', 'مناظر صحراوية'],
  ['luxury-product', 'Luxury product', 'منتجات فاخرة'],
  ['handheld-intimate', 'Handheld & intimate', 'محمول وحميمي'],
  ['soft-pastel', 'Soft pastel', 'باستيل ناعم'],
  ['high-key-bright', 'High-key & bright', 'إضاءة عالية ومشرقة'],
  ['moody-low-key', 'Moody low-key', 'إضاءة منخفضة وكثيفة'],
];

const CREW_RATES: Array<[string, string, string, number, number, number, number]> = [
  // slug, labelEn, labelAr, headcount, LOW, MEDIUM, HIGH
  ['dop', 'Director of Photography', 'مدير التصوير', 1, 2500, 5000, 9000],
  ['camera-operator', 'Camera Operator', 'مشغل كاميرا', 1, 1200, 2200, 3500],
  ['focus-puller', '1st AC / Focus Puller', 'مساعد كاميرا أول', 1, 900, 1600, 2600],
  ['second-ac', '2nd AC', 'مساعد كاميرا ثانٍ', 1, 600, 1000, 1600],
  ['dit', 'DIT', 'فني بيانات', 1, 800, 1500, 2400],
  ['gaffer', 'Gaffer', 'مسؤول إضاءة', 1, 1000, 1900, 3200],
  ['best-boy-electric', 'Best Boy Electric', 'مساعد إضاءة أول', 1, 700, 1200, 1900],
  ['electrician', 'Electrician', 'كهربائي', 2, 500, 800, 1200],
  ['key-grip', 'Key Grip', 'رئيس التثبيت', 1, 900, 1600, 2600],
  ['grip', 'Grip', 'فني تثبيت', 2, 500, 800, 1200],
  ['sound-mixer', 'Sound Mixer', 'مهندس صوت', 1, 1000, 1800, 2800],
  ['boom-operator', 'Boom Operator', 'مشغل بوم', 1, 600, 1000, 1500],
  ['gimbal-operator', 'Gimbal / Steadicam Operator', 'مشغل مثبت', 1, 1200, 2200, 3600],
  ['drone-pilot', 'Drone Pilot (licensed)', 'مشغل طائرة مسيرة', 1, 1500, 2500, 4000],
  ['production-assistant', 'Production Assistant', 'مساعد إنتاج', 2, 350, 550, 800],
];

async function main() {
  console.log('→ categories');
  for (const category of CATEGORIES) {
    await prisma.equipmentCategory.upsert({
      where: { slug: category.slug },
      create: category,
      update: category,
    });
  }
  const categoryIds = new Map(
    (await prisma.equipmentCategory.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  );

  console.log('→ equipment catalog');
  for (const item of EQUIPMENT) {
    const categoryId = categoryIds.get(item.category);
    if (!categoryId) throw new Error(`Unknown category ${item.category}`);
    const data = {
      categoryId,
      brand: item.brand,
      model: item.model,
      nameAr: item.nameAr ?? null,
      specs: item.specs,
      summaryEn: item.summaryEn,
      summaryAr: item.summaryAr,
      suitableLightingComplexity: item.lighting,
      suitableMovementTypes: item.movement,
      budgetTier: item.tiers,
      dayNightSuitability: item.dayNight,
      specialCapabilities: item.capabilities ?? [],
      indicativeDayRate: item.dayRate,
      isCore: item.isCore ?? false,
      active: true,
    };
    await prisma.equipment.upsert({
      where: { brand_model: { brand: item.brand, model: item.model } },
      create: data,
      update: data,
    });
  }

  console.log('→ style tags');
  for (const [index, [slug, labelEn, labelAr]] of STYLE_TAGS.entries()) {
    await prisma.styleTag.upsert({
      where: { slug },
      create: { slug, labelEn, labelAr, sortOrder: index },
      update: { labelEn, labelAr, sortOrder: index },
    });
  }

  console.log('→ crew rates + budget tiers + settings');
  for (const [roleSlug, labelEn, labelAr, headcount, low, medium, high] of CREW_RATES) {
    for (const [tier, dayRate] of [
      [BudgetTier.LOW, low],
      [BudgetTier.MEDIUM, medium],
      [BudgetTier.HIGH, high],
    ] as Array<[BudgetTier, number]>) {
      await prisma.crewRate.upsert({
        where: { roleSlug_budgetTier: { roleSlug, budgetTier: tier } },
        create: { roleSlug, labelEn, labelAr, budgetTier: tier, dayRate, headcount },
        update: { labelEn, labelAr, dayRate, headcount },
      });
    }
  }

  for (const tier of [BudgetTier.LOW, BudgetTier.MEDIUM, BudgetTier.HIGH]) {
    const config = DEFAULT_BUDGET_TIERS[tier];
    await prisma.budgetTierConfig.upsert({
      where: { tier },
      create: { tier, ...config },
      update: config,
    });
  }

  await prisma.setting.upsert({
    where: { key: 'platform' },
    create: { key: 'platform', value: DEFAULT_SETTINGS },
    update: {},
  });

  // ---------------------------------------------------------------- accounts
  console.log('→ accounts');
  const credentials = seedPassword();
  const password = await hash(credentials.value, 12);

  const admin = await prisma.user.upsert({
    where: { email: seedEmail('admin') },
    create: {
      email: seedEmail('admin'),
      name: 'Platform Admin',
      passwordHash: password,
      role: Role.ADMIN,
      locale: 'ar',
    },
    update: { role: Role.ADMIN },
  });

  await prisma.user.upsert({
    where: { email: seedEmail('producer') },
    create: {
      email: seedEmail('producer'),
      name: 'Demo Producer',
      passwordHash: password,
      role: Role.PRODUCER,
      locale: 'ar',
    },
    update: {},
  });

  // ---- launch-partner vendors
  const vendorSeeds = [
    {
      email: seedEmail('vendor-riyadh'),
      contact: 'Riyadh Rentals Manager',
      company: {
        name: 'استوديوهات نجد للتأجير',
        nameEn: 'Najd Studios Rentals',
        crNumber: '1010000001',
        city: 'Riyadh',
        phone: '+966500000001',
        website: 'https://example.com/najd',
        verified: true,
      },
      // brand/model → [dailyRate, quantity]
      stock: {
        'ARRI|ALEXA 35': [5400, 2],
        'ARRI|ALEXA Mini': [3400, 3],
        'Sony|FX6': [700, 4],
        'ARRI|Signature Prime set (5 lenses)': [3600, 1],
        'ZEISS|Supreme Prime set (5 lenses)': [2400, 2],
        'Sigma|Cine FF High Speed Prime set (5 lenses)': [750, 3],
        'ARRI|SkyPanel S60-C': [950, 6],
        'Aputure|LS 600d Pro': [450, 5],
        'Astera|Titan Tube set (8 tubes)': [800, 2],
        'Matthews|Standard grip package (stands, flags, clamps)': [380, 3],
        'DJI|RS 4 Pro gimbal': [300, 3],
        'Sound Devices|MixPre-10 II recorder': [320, 2],
        'Anton/Bauer|Gold Mount battery package (6 batteries + chargers)': [220, 4],
      } as Record<string, [number, number]>,
    },
    {
      email: seedEmail('vendor-jeddah'),
      contact: 'Jeddah Rentals Manager',
      company: {
        name: 'البحر الأحمر للإنتاج',
        nameEn: 'Red Sea Production Services',
        crNumber: '4030000002',
        city: 'Jeddah',
        phone: '+966500000002',
        website: 'https://example.com/redsea',
        verified: true,
      },
      stock: {
        'RED|KOMODO 6K': [1450, 2],
        'Sony|FX6': [620, 3],
        'Canon|EOS C70': [520, 3],
        'Blackmagic Design|Pocket Cinema Camera 6K Pro': [280, 4],
        'Atlas Lens Co.|Orion Anamorphic 2x set (4 lenses)': [1900, 1],
        'Sigma|Cine FF High Speed Prime set (5 lenses)': [680, 2],
        'Fujinon|MK 18-55 T2.9 zoom': [300, 3],
        'Aputure|LS 600d Pro': [400, 6],
        'Aputure|amaran 200x bi-colour': [110, 8],
        'Kino Flo|Diva-Lite 20 LED kit (2 heads)': [240, 3],
        'Matthews|Standard grip package (stands, flags, clamps)': [330, 2],
        'Matthews|12x12 butterfly kit (diffusion + solid)': [500, 2],
        'DJI|Inspire 3 aerial platform': [2500, 1],
        'Honda|EU70is generator (7 kVA, silenced)': [580, 2],
        'Sennheiser|MKH 8060 shotgun + boom kit': [230, 2],
      } as Record<string, [number, number]>,
    },
  ];

  const equipmentByKey = new Map(
    (await prisma.equipment.findMany({ select: { id: true, brand: true, model: true } })).map((e) => [
      `${e.brand}|${e.model}`,
      e.id,
    ]),
  );

  for (const seed of vendorSeeds) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      create: {
        email: seed.email,
        name: seed.contact,
        passwordHash: password,
        role: Role.VENDOR,
        locale: 'ar',
        phone: seed.company.phone,
      },
      update: { role: Role.VENDOR },
    });

    const company = await prisma.company.upsert({
      where: { crNumber: seed.company.crNumber },
      create: seed.company,
      update: seed.company,
    });

    const vendor = await prisma.vendor.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        companyId: company.id,
        status: 'APPROVED',
        verified: true,
        approvedAt: new Date(),
      },
      update: { status: 'APPROVED', verified: true },
    });

    for (const [key, [dailyRate, quantity]] of Object.entries(seed.stock)) {
      const equipmentId = equipmentByKey.get(key);
      if (!equipmentId) {
        console.warn(`  ! no catalog entry for ${key}`);
        continue;
      }
      const data = {
        dailyRate,
        weeklyRate: Math.round(dailyRate * 7 * 0.8),
        monthlyRate: Math.round(dailyRate * 30 * 0.6),
        quantityTotal: quantity,
        quantityAvailable: quantity,
        city: seed.company.city,
        active: true,
      };
      await prisma.vendorInventoryItem.upsert({
        where: { vendorId_equipmentId: { vendorId: vendor.id, equipmentId } },
        create: { vendorId: vendor.id, equipmentId, ...data },
        update: data,
      });
    }
  }

  // ---- launch-partner cinematographers
  const dopSeeds = [
    {
      email: seedEmail('dop-faisal'),
      name: 'Faisal Al-Harbi',
      nameAr: 'فيصل الحربي',
      city: 'Riyadh',
      dayRate: 6500,
      years: 12,
      styleTags: ['night-cinematography', 'high-contrast-noir', 'anamorphic-widescreen', 'moody-low-key'],
      bio: 'Feature and long-form drama cinematographer. Works almost entirely at night and in low-key interiors, favouring anamorphic glass, hard single sources and deep shadow with very little fill. Ten features and limited series across the Gulf.',
      links: ['https://vimeo.com/example/faisal-reel', 'https://www.imdb.com/name/nm0000001/'],
    },
    {
      email: seedEmail('dop-noura'),
      name: 'Noura Al-Qahtani',
      nameAr: 'نورة القحطاني',
      city: 'Riyadh',
      dayRate: 5200,
      years: 9,
      styleTags: ['warm-tones', 'classic-cinematic', 'soft-pastel', 'luxury-product'],
      bio: 'Commercial cinematographer specialising in warm, soft, classically composed brand films. Large-format primes, heavy diffusion, motivated practicals and controlled golden-hour exteriors. Regular collaborator on luxury retail and hospitality campaigns.',
      links: ['https://vimeo.com/example/noura-reel', 'https://www.youtube.com/@example-noura'],
    },
    {
      email: seedEmail('dop-omar'),
      name: 'Omar Haddad',
      nameAr: 'عمر حداد',
      city: 'Jeddah',
      dayRate: 3800,
      years: 7,
      styleTags: ['documentary-verite', 'natural-light', 'handheld-intimate'],
      bio: 'Documentary and branded-documentary cinematographer. Available-light shooter, long handheld days on a body rig, minimal crew, fast with interviews and observational coverage in uncontrolled locations.',
      links: ['https://vimeo.com/example/omar-reel'],
    },
    {
      email: seedEmail('dop-layla'),
      name: 'Layla Mansour',
      nameAr: 'ليلى منصور',
      city: 'AlUla',
      dayRate: 4400,
      years: 10,
      styleTags: ['desert-landscape', 'high-key-bright', 'natural-light', 'fast-paced-commercial'],
      bio: 'Exterior and landscape specialist working across AlUla and the Empty Quarter. Big daylight exteriors, large diffusion frames, aerial integration and high-key desert light for tourism and automotive campaigns.',
      links: ['https://vimeo.com/example/layla-reel', 'https://www.imdb.com/name/nm0000004/'],
    },
    {
      email: seedEmail('dop-tariq'),
      name: 'Tariq Bin Saleh',
      nameAr: 'طارق بن صالح',
      city: 'Riyadh',
      dayRate: 3000,
      years: 6,
      styleTags: ['fast-paced-commercial', 'high-key-bright', 'luxury-product'],
      bio: 'Fast-turnaround commercial and social-first cinematographer. Table-top and product work, gimbal-driven coverage, high shot counts per day, comfortable with compact bodies and small lighting packages.',
      links: ['https://www.youtube.com/@example-tariq'],
    },
  ];

  // Embeddings are optional: without them the profiles exist but cannot be
  // matched until the admin re-embed job runs. So a failing API (no key, no
  // credit, rate limited) skips the rest of the embeddings instead of leaving
  // the seed half-done.
  let canEmbed = Boolean(process.env.OPENAI_API_KEY);
  let embedFailure: string | null = null;
  for (const seed of dopSeeds) {
    const user = await prisma.user.upsert({
      where: { email: seed.email },
      create: {
        email: seed.email,
        name: seed.name,
        passwordHash: password,
        role: Role.DOP,
        locale: 'ar',
      },
      update: { role: Role.DOP },
    });

    const dop = await prisma.dop.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        displayName: seed.name,
        displayNameAr: seed.nameAr,
        bio: seed.bio,
        city: seed.city,
        dayRate: seed.dayRate,
        yearsExperience: seed.years,
        portfolioLinks: seed.links,
        styleTags: seed.styleTags,
        status: 'APPROVED',
        approvedAt: new Date(),
      },
      update: {
        bio: seed.bio,
        styleTags: seed.styleTags,
        portfolioLinks: seed.links,
        status: 'APPROVED',
      },
    });

    if (canEmbed) {
      const text = buildDopEmbeddingText({
        displayName: dop.displayName,
        bio: dop.bio,
        styleTags: dop.styleTags,
        city: dop.city,
        yearsExperience: dop.yearsExperience,
      });
      try {
        const vector = await embedText(text);
        await writeDopEmbedding(dop.id, text, vector);
        console.log(`  embedded ${dop.displayName}`);
      } catch (error) {
        canEmbed = false;
        embedFailure = error instanceof Error ? error.message : String(error);
      }
    }
  }

  if (embedFailure) {
    console.warn(
      `  ! OpenAI refused the embedding request, so the remaining profiles were saved without one:\n    ${embedFailure.slice(0, 200)}\n    Fix the key or its credit, then run \`npm run db:seed\` again or use the admin re-embed job.`,
    );
  } else if (!process.env.OPENAI_API_KEY) {
    console.warn(
      '  ! OPENAI_API_KEY not set — DOP embeddings were skipped. Run `npm run db:seed` again with the key, or use the admin re-embed job.',
    );
  }

  console.log(`
Seed complete. Accounts (every address delivers to ${SEED_GMAIL}):
  ${seedEmail('admin').padEnd(40)} ADMIN
  ${seedEmail('producer').padEnd(40)} PRODUCER
  ${seedEmail('vendor-riyadh').padEnd(40)} VENDOR (approved)
  ${seedEmail('vendor-jeddah').padEnd(40)} VENDOR (approved)
  ${seedEmail('dop-faisal').padEnd(40)} DOP (approved, 5 profiles seeded)

Password: ${credentials.value}${
    credentials.generated
      ? '  <- generated for this run. Save it now, or set SEED_PASSWORD to choose your own.'
      : '  (from SEED_PASSWORD)'
  }
Admin id: ${admin.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
