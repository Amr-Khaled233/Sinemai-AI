import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';

/**
 * PDF export built with @react-pdf/renderer — no headless browser, so it fits
 * inside a Vercel function without blowing up bundle size or cold starts.
 *
 * The PDF is intentionally English/Latin: @react-pdf does not shape Arabic
 * script without an embedded Arabic font with ligature support, and a silently
 * mis-rendered Arabic sheet is worse than an English one. Register an Arabic
 * font here (Font.register) if you add one to the repo.
 */

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: '#1a1d24', fontFamily: 'Helvetica' },
  kicker: { fontSize: 7, letterSpacing: 1.6, color: '#9a7a2e', textTransform: 'uppercase' },
  h1: { fontSize: 18, marginTop: 6, fontFamily: 'Helvetica-Bold' },
  meta: { fontSize: 8, color: '#6b7280', marginTop: 4 },
  section: { marginTop: 18 },
  h2: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    borderBottomWidth: 1,
    borderBottomColor: '#d8c79a',
    paddingBottom: 3,
    marginBottom: 6,
  },
  body: { lineHeight: 1.5, color: '#374151' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 3 },
  th: { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 4, fontFamily: 'Helvetica-Bold' },
  cell: { paddingHorizontal: 3 },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  stat: { flexGrow: 1, borderWidth: 0.5, borderColor: '#e5e7eb', padding: 6 },
  statLabel: { fontSize: 6.5, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  note: { fontSize: 7.5, color: '#6b7280', marginTop: 10, lineHeight: 1.4 },
  badge: { fontSize: 7, color: '#92400e' },
  footer: { position: 'absolute', bottom: 22, left: 36, right: 36, fontSize: 7, color: '#9ca3af' },
});

export type SheetPdfData = {
  projectName: string;
  projectType: string;
  budgetTier: string;
  city: string;
  generatedAt: string;
  currency: string;
  styleTags: string[];
  summaryText: string;
  sceneSummary: SceneSummary | null;
  scenes: Array<{
    order: number;
    heading: string;
    intExt: string | null;
    timeOfDay: string | null;
    lightingComplexity: string | null;
    cameraMovement: string | null;
    estimatedHours: number | null;
  }>;
  equipment: PackageItem[];
  equipmentRationale: string;
  dops: DopMatch[];
  vendors: VendorMatch[];
  budget: BudgetBreakdown | null;
  low: number;
  mid: number;
  high: number;
  criticNotes: string[];
};

const money = (value: number, currency: string) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value))} ${currency}`;

export function SheetDocument({ data }: { data: SheetPdfData }) {
  return (
    <Document title={`${data.projectName} — Production & Equipment Sheet`} author="Sinemai AI">
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>Sinemai AI — Production &amp; Equipment Sheet</Text>
        <Text style={styles.h1}>{data.projectName}</Text>
        <Text style={styles.meta}>
          {[data.projectType, `${data.budgetTier} budget tier`, data.city, data.generatedAt]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
        {data.styleTags.length > 0 && <Text style={styles.meta}>Visual style: {data.styleTags.join(', ')}</Text>}

        {data.summaryText ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Executive summary</Text>
            <Text style={styles.body}>{data.summaryText}</Text>
          </View>
        ) : null}

        {data.sceneSummary && (
          <View style={styles.section}>
            <Text style={styles.h2}>Scene breakdown</Text>
            <View style={styles.statRow}>
              <Stat label="Scenes" value={String(data.sceneSummary.sceneCount)} />
              <Stat label="Shoot days" value={String(data.sceneSummary.shootDays)} />
              <Stat label="Night / dawn" value={`${data.sceneSummary.nightScenePct}%`} />
              <Stat label="Exteriors" value={`${data.sceneSummary.exteriorScenePct}%`} />
              <Stat label="High complexity" value={`${data.sceneSummary.highComplexityPct}%`} />
            </View>

            <View style={[styles.th, { marginTop: 10 }]}>
              <Text style={[styles.cell, { width: '6%' }]}>#</Text>
              <Text style={[styles.cell, { width: '42%' }]}>Heading</Text>
              <Text style={[styles.cell, { width: '13%' }]}>Env</Text>
              <Text style={[styles.cell, { width: '13%' }]}>Time</Text>
              <Text style={[styles.cell, { width: '13%' }]}>Light</Text>
              <Text style={[styles.cell, { width: '13%' }]}>Move</Text>
            </View>
            {data.scenes.map((scene) => (
              <View key={scene.order} style={styles.row} wrap={false}>
                <Text style={[styles.cell, { width: '6%' }]}>{scene.order}</Text>
                <Text style={[styles.cell, { width: '42%' }]}>{scene.heading.slice(0, 74)}</Text>
                <Text style={[styles.cell, { width: '13%' }]}>{scene.intExt ?? '—'}</Text>
                <Text style={[styles.cell, { width: '13%' }]}>{scene.timeOfDay ?? '—'}</Text>
                <Text style={[styles.cell, { width: '13%' }]}>{scene.lightingComplexity ?? '—'}</Text>
                <Text style={[styles.cell, { width: '13%' }]}>{scene.cameraMovement ?? '—'}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section} break>
          <Text style={styles.h2}>Recommended package</Text>
          <View style={styles.th}>
            <Text style={[styles.cell, { width: '14%' }]}>Category</Text>
            <Text style={[styles.cell, { width: '36%' }]}>Item</Text>
            <Text style={[styles.cell, { width: '7%' }]}>Qty</Text>
            <Text style={[styles.cell, { width: '8%' }]}>Days</Text>
            <Text style={[styles.cell, { width: '35%' }]}>Reason</Text>
          </View>
          {data.equipment.map((item) => (
            <View key={item.equipmentId} style={styles.row} wrap={false}>
              <Text style={[styles.cell, { width: '14%' }]}>{item.categorySlug}</Text>
              <Text style={[styles.cell, { width: '36%' }]}>
                {item.brand} {item.model}
              </Text>
              <Text style={[styles.cell, { width: '7%' }]}>{item.quantity}</Text>
              <Text style={[styles.cell, { width: '8%' }]}>{item.rentalDays}</Text>
              <Text style={[styles.cell, { width: '35%' }]}>{item.reason}</Text>
            </View>
          ))}
          {data.equipmentRationale ? (
            <Text style={[styles.body, { marginTop: 8 }]}>{data.equipmentRationale}</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>Matched cinematographers</Text>
          {data.dops.length === 0 ? (
            <Text style={styles.body}>No cinematographer profiles matched this project.</Text>
          ) : (
            data.dops.map((dop) => (
              <View key={dop.dopId} style={{ marginBottom: 7 }} wrap={false}>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                  {dop.name} — {Math.round(dop.score * 100)}% style match
                  {dop.city ? ` · ${dop.city}` : ''}
                  {dop.dayRate ? ` · ${money(dop.dayRate, data.currency)}/day` : ''}
                </Text>
                <Text style={styles.body}>{dop.reason}</Text>
                {dop.portfolioLinks.length > 0 && (
                  <Text style={[styles.body, { color: '#0f766e' }]}>{dop.portfolioLinks.join('  ·  ')}</Text>
                )}
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>Rental vendors</Text>
          {data.vendors.length === 0 ? (
            <Text style={styles.body}>No approved vendor stocks this package yet.</Text>
          ) : (
            data.vendors.map((vendor) => (
              <View key={vendor.vendorId} style={{ marginBottom: 8 }} wrap={false}>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                  {vendor.companyName} — {vendor.city} · {vendor.coveragePct}% coverage ·{' '}
                  {money(vendor.subtotal, data.currency)}
                </Text>
                {vendor.items.map((line) => (
                  <View key={line.equipmentId} style={styles.row} wrap={false}>
                    <Text style={[styles.cell, { width: '50%' }]}>
                      {line.brand} {line.model}
                    </Text>
                    <Text style={[styles.cell, { width: '12%' }]}>x{line.quantity}</Text>
                    <Text style={[styles.cell, { width: '13%' }]}>{line.rentalDays}d</Text>
                    <Text style={[styles.cell, { width: '25%' }]}>{money(line.lineTotal, data.currency)}</Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </View>

        {data.budget && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.h2}>Estimated budget</Text>
            <View style={styles.statRow}>
              <Stat label="Low" value={money(data.low, data.currency)} />
              <Stat label="Mid" value={money(data.mid, data.currency)} />
              <Stat label="High" value={money(data.high, data.currency)} />
            </View>

            <View style={[styles.th, { marginTop: 10 }]}>
              <Text style={[styles.cell, { width: '46%' }]}>Crew role</Text>
              <Text style={[styles.cell, { width: '12%' }]}>Count</Text>
              <Text style={[styles.cell, { width: '18%' }]}>Day rate</Text>
              <Text style={[styles.cell, { width: '10%' }]}>Days</Text>
              <Text style={[styles.cell, { width: '14%' }]}>Total</Text>
            </View>
            {data.budget.crewBreakdown.map((line) => (
              <View key={line.roleSlug} style={styles.row} wrap={false}>
                <Text style={[styles.cell, { width: '46%' }]}>{line.labelEn}</Text>
                <Text style={[styles.cell, { width: '12%' }]}>{line.headcount}</Text>
                <Text style={[styles.cell, { width: '18%' }]}>{money(line.dayRate, data.currency)}</Text>
                <Text style={[styles.cell, { width: '10%' }]}>{line.days}</Text>
                <Text style={[styles.cell, { width: '14%' }]}>{money(line.total, data.currency)}</Text>
              </View>
            ))}

            <Text style={[styles.body, { marginTop: 8 }]}>
              Equipment rental {money(data.budget.equipmentRental, data.currency)} · Crew{' '}
              {money(data.budget.crewTotal, data.currency)} · Contingency {data.budget.contingencyPct}% ·{' '}
              {data.budget.shootDays} shoot day(s)
            </Text>
          </View>
        )}

        {data.criticNotes.length > 0 && (
          <View style={styles.section} wrap={false}>
            <Text style={styles.h2}>Reviewer notes</Text>
            {data.criticNotes.map((note, index) => (
              <Text key={index} style={styles.badge}>
                • {note}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.note}>
          Every equipment item, rental price, cinematographer and crew rate in this sheet was retrieved from the
          Sinemai AI database by a tool call, not generated by a language model. Estimates are indicative and subject
          to vendor confirmation of availability on your dates.
        </Text>

        <Text style={styles.footer} render={({ pageNumber, totalPages }) => `Sinemai AI · ${pageNumber}/${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}
