/** "Ugens madplan" øverst i Opskrift-fanen (web: static/js/madplan.js). */
import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import type { Recipe } from '../api/recipes';
import { DAYS, MAX_PEOPLE, MOODS, krRound, krText, makePlan, weeklyBudget, type MealPrefs } from './mealPlan';

type Props = {
  recipes: Recipe[];
  prefs: MealPrefs;
  onChange: (p: MealPrefs) => void;
  onEdit: () => void;
  onOpen: (r: Recipe) => void;
};

const GREEN = '#059669';
const GREEN_DARK = '#047857';
const OVER = '#FCD34D';
// Opskrifter uden billede får en farvet flade med en ret-emoji. Farve og
// emoji følger id'et, så de ikke skifter (samme som web).
const PLACEHOLDER = ['🍲', '🥘', '🍝', '🥗', '🌮', '🍛'];
const PH_BG = ['#BFEFD3', '#FDE68A', '#FECDD3', '#BFDBFE'];

export function MealPlanView({ recipes, prefs: p, onChange, onEdit, onOpen }: Props) {
  const { colors } = useTheme();
  const plan = useMemo(() => makePlan(recipes, p), [recipes, p]);
  const week = weeklyBudget(p);
  const pct = Math.min(100, Math.round((plan.total / week) * 100));
  const over = plan.total > week;
  const n = plan.meals.length;

  let note = '';
  if (!n) {
    note = plan.eligible
      ? 'Ingen retter passer inden for budgettet. Prøv at sætte budgettet op.'
      : 'Ingen af vores opskrifter passer til dine svar endnu. Der kommer flere opskrifter løbende.';
  } else if (n < DAYS.length) {
    note = `Vi fandt ${n} ${n === 1 ? 'ret' : 'retter'} der passer til dine svar og dit budget. Der kommer flere opskrifter løbende.`;
  }

  const togglePin = (id: number) =>
    onChange({
      ...p,
      pinned: p.pinned.includes(id) ? p.pinned.filter((x) => x !== id) : [...p.pinned, id],
    });

  return (
    <View style={{ padding: 12, paddingBottom: 4 }}>
      <View style={styles.hero}>
        <View style={styles.heroBlob} />
        <View style={styles.heroTop}>
          <Text style={styles.kicker} accessibilityRole="header">
            UGENS MADPLAN
          </Text>
          <Pressable onPress={onEdit} accessibilityRole="button" hitSlop={8} style={styles.heroEdit}>
            <Text style={styles.heroEditText}>✏️ Ret svar</Text>
          </Pressable>
        </View>

        <View
          style={styles.heroMain}
          accessible
          accessibilityLabel={`Cirka ${krRound(plan.total)} for ${n} retter. ${pct} procent af budgettet på ${krRound(week)} om ugen`}
        >
          <BudgetRing pct={pct} over={over} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heroPrice}>{krRound(plan.total)}</Text>
            <Text style={styles.heroSub}>
              for {n} {n === 1 ? 'ret' : 'retter'} · budget {krRound(week)}
            </Text>
            {p.budgetPeriod === 'maaned' ? (
              <Text style={styles.heroSub}>Ugens del af {krRound(p.budget)} om måneden</Text>
            ) : null}
            {n > 0 ? (
              <View style={styles.leftPill}>
                <Text style={[styles.leftText, over && { color: '#B45309' }]}>
                  {over ? `⚠️ ${krRound(plan.total - week)} over budget` : `🎉 ${krRound(week - plan.total)} tilbage`}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.heroFoot}>
          {/* Antal personer kan skrues direkte her (fx ved gæster) uden at svare
              på alle spørgsmålene igen. Det nye antal bliver standarden. */}
          <View style={styles.guests}>
            <MiniButton
              label="−"
              a11y="Færre personer"
              disabled={p.people <= 1}
              onPress={() => onChange({ ...p, people: Math.max(1, p.people - 1) })}
            />
            <Text style={styles.guestText} accessibilityLiveRegion="polite">
              👥 <Text style={{ fontWeight: '800' }}>{p.people}</Text> {p.people === 1 ? 'person' : 'personer'}
            </Text>
            <MiniButton
              label="+"
              a11y="Flere personer"
              disabled={p.people >= MAX_PEOPLE}
              onPress={() => onChange({ ...p, people: Math.min(MAX_PEOPLE, p.people + 1) })}
            />
          </View>
          <View style={styles.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {DAYS.map((d, i) => (
              <View key={d} style={[styles.dot, i < n && styles.dotOn]}>
                <Text style={[styles.dotText, i < n && { color: GREEN_DARK }]}>{d.charAt(0)}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {note ? (
        <View style={[styles.note, { backgroundColor: colors.primaryMuted }]}>
          <Text style={{ color: colors.primaryDark }}>{note}</Text>
        </View>
      ) : null}
      {n > 0 && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Tryk 🔓 på de retter du vil beholde, og bland resten.
        </Text>
      )}

      {plan.meals.map(({ recipe: r, price }, i) => {
        const pinned = p.pinned.includes(r.id);
        const tags = MOODS.filter((m) => p.moods.includes(m.key) && r.plan?.moods.includes(m.key)).slice(0, 2);
        return (
          <View
            key={r.id}
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: pinned ? GREEN : colors.border },
              pinned && styles.cardPinned,
            ]}
          >
            <Pressable
              onPress={() => onOpen(r)}
              accessibilityRole="button"
              accessibilityLabel={`${DAYS[i]}: ${r.title}, cirka ${krText(price)}`}
              accessibilityHint="Åbner opskriften"
            >
              <View style={styles.imgWrap}>
                {r.image_url ? (
                  <Image source={{ uri: r.image_url }} style={styles.img} />
                ) : (
                  <View style={[styles.img, styles.ph, { backgroundColor: PH_BG[r.id % PH_BG.length] }]}>
                    <Text style={{ fontSize: 48 }}>{PLACEHOLDER[r.id % PLACEHOLDER.length]}</Text>
                  </View>
                )}
                <View style={[styles.dayPill, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.dayText, { color: colors.text }]}>{DAYS[i]}</Text>
                </View>
                <View style={styles.pricePill}>
                  <Text style={styles.priceText}>ca. {krRound(price)}</Text>
                </View>
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.mealTitle, { color: colors.text }]} numberOfLines={2}>
                  {r.title}
                </Text>
                {tags.length > 0 && (
                  <View style={styles.tags}>
                    {tags.map((m) => (
                      <Tag key={m.key} text={`${m.icon} ${m.label}`} />
                    ))}
                  </View>
                )}
              </View>
            </Pressable>
            <Pressable
              onPress={() => togglePin(r.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: pinned }}
              accessibilityLabel={pinned ? `Lås op: ${r.title}` : `Lås: ${r.title}`}
              hitSlop={8}
              style={[styles.pin, { backgroundColor: pinned ? GREEN : colors.surface }]}
            >
              <Text style={{ fontSize: 16 }}>{pinned ? '🔒' : '🔓'}</Text>
            </Pressable>
          </View>
        );
      })}

      <Pressable
        onPress={() => onChange({ ...p, seed: (p.seed || 1) + 1 })}
        accessibilityRole="button"
        style={[styles.shuffle, { backgroundColor: colors.primaryMuted }]}
      >
        <Text style={{ color: colors.primaryDark, fontWeight: '700', fontSize: 16 }}>🎲 Bland ugen</Text>
      </Pressable>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Prisen er for hele pakker i den billigste butik. Har du noget i forvejen, bliver det billigere.
      </Text>

      <Text style={[styles.listTitle, { color: colors.text }]} accessibilityRole="header">
        Alle opskrifter
      </Text>
    </View>
  );
}

/** Budget-ringen: hvor stor en del af ugens budget planen bruger. */
function BudgetRing({ pct, over }: { pct: number; over: boolean }) {
  const r = (RING - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={styles.ring}>
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke="rgba(255,255,255,0.22)" strokeWidth={10} fill={GREEN_DARK} />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={over ? OVER : '#FFFFFF'}
          strokeWidth={10}
          fill="none"
          strokeLinecap={pct > 0 ? 'round' : 'butt'}
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
      <Text style={styles.ringPct}>{pct}%</Text>
      <Text style={styles.ringLabel}>af budget</Text>
    </View>
  );
}

function MiniButton({
  label,
  a11y,
  onPress,
  disabled,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      style={[styles.mini, { opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={{ color: '#fff', fontSize: 18, lineHeight: 20 }}>{label}</Text>
    </Pressable>
  );
}

function Tag({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={{ color: colors.textMuted, fontSize: 11 }}>{text}</Text>
    </View>
  );
}

const RING = 92;
const styles = StyleSheet.create({
  hero: { backgroundColor: GREEN, borderRadius: 22, padding: 16, overflow: 'hidden' },
  heroBlob: {
    position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: '#fff', opacity: 0.85, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  heroEdit: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  heroEditText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 16, marginVertical: 14 },
  heroPrice: { color: '#fff', fontSize: 32, fontWeight: '800' },
  heroSub: { color: '#fff', opacity: 0.9, fontSize: 13, marginTop: 2 },
  leftPill: { alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 },
  leftText: { color: GREEN_DARK, fontWeight: '700', fontSize: 13 },
  heroFoot: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', paddingTop: 12,
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  guests: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  guestText: { color: '#fff', fontSize: 15 },
  mini: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: '#fff' },
  dotText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringPct: { color: '#fff', fontSize: 20, fontWeight: '800' },
  ringLabel: { color: '#fff', opacity: 0.85, fontSize: 10 },
  note: { borderRadius: 12, padding: 12, marginTop: 12 },
  hint: { textAlign: 'center', fontSize: 13, marginTop: 14, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 18, overflow: 'hidden', marginBottom: 12 },
  cardPinned: { borderWidth: 2 },
  imgWrap: { position: 'relative' },
  img: { width: '100%', height: 150 },
  ph: { alignItems: 'center', justifyContent: 'center' },
  dayPill: { position: 'absolute', left: 10, top: 10, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  dayText: { fontSize: 12, fontWeight: '800' },
  pricePill: { position: 'absolute', right: 10, bottom: 10, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: GREEN },
  priceText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cardBody: { padding: 12 },
  mealTitle: { fontSize: 16, fontWeight: '700' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  tag: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  pin: { position: 'absolute', right: 8, top: 8, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  shuffle: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: GREEN, borderRadius: 999,
    paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  listTitle: { fontSize: 18, fontWeight: '700', marginTop: 24 },
});
