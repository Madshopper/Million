/** "Din madplan er klar" øverst i Opskrift-fanen (web: static/js/madplan.js). */
import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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

export function MealPlanView({ recipes, prefs: p, onChange, onEdit, onOpen }: Props) {
  const { colors } = useTheme();
  const plan = useMemo(() => makePlan(recipes, p), [recipes, p]);
  const week = weeklyBudget(p);
  const pct = Math.min(100, Math.round((plan.total / week) * 100));
  const over = plan.total > week;

  let note = '';
  if (!plan.meals.length) {
    note = plan.eligible
      ? 'Ingen retter passer inden for budgettet. Prøv at sætte budgettet op.'
      : 'Ingen af vores opskrifter passer til dine svar endnu. Der kommer flere opskrifter løbende.';
  } else if (plan.meals.length < p.days) {
    note = `Vi fandt ${plan.meals.length} ${plan.meals.length === 1 ? 'ret' : 'retter'} der passer. Der kommer flere opskrifter løbende.`;
  }

  const togglePin = (id: number) =>
    onChange({
      ...p,
      pinned: p.pinned.includes(id) ? p.pinned.filter((x) => x !== id) : [...p.pinned, id],
    });

  return (
    <View style={{ padding: 12, paddingBottom: 4 }}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Din madplan er klar
        </Text>
        <Pressable onPress={onEdit} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: colors.primaryDark, fontWeight: '700' }}>Ret mine svar</Text>
        </Pressable>
      </View>

      <View style={styles.summary}>
        <View
          style={[styles.sumCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={`Cirka pris ${krText(plan.total)} af et budget på ${krRound(week)} om ugen`}
        >
          <Text style={[styles.label, { color: colors.textMuted }]}>CA. PRIS</Text>
          <Text>
            <Text style={[styles.sumPrice, { color: over ? colors.warning : colors.primaryDark }]}>
              {krText(plan.total)}
            </Text>
            <Text style={{ color: colors.textMuted }}> / {krRound(week)}</Text>
          </Text>
          {p.budgetPeriod === 'maaned' ? (
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
              Ugens del af {krRound(p.budget)} om måneden
            </Text>
          ) : null}
          <View style={[styles.bar, { backgroundColor: colors.border }]}>
            <View style={{ width: `${pct}%`, height: '100%', backgroundColor: colors.primary }} />
          </View>
        </View>
        {/* Antal personer kan skrues direkte her (fx ved gæster) uden at svare
            på alle spørgsmålene igen. Det nye antal bliver standarden. */}
        <View style={[styles.sumCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.textMuted }]}>PERSONER</Text>
          <View style={styles.people}>
            <MiniButton
              label="−"
              a11y="Færre personer"
              disabled={p.people <= 1}
              onPress={() => onChange({ ...p, people: Math.max(1, p.people - 1) })}
            />
            <Text
              style={[styles.sumPrice, { color: colors.primaryDark }]}
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${p.people} ${p.people === 1 ? 'person' : 'personer'}`}
            >
              {p.people}
            </Text>
            <MiniButton
              label="+"
              a11y="Flere personer"
              disabled={p.people >= MAX_PEOPLE}
              onPress={() => onChange({ ...p, people: Math.min(MAX_PEOPLE, p.people + 1) })}
            />
          </View>
          <Text style={{ color: colors.textMuted }}>
            {plan.meals.length} {plan.meals.length === 1 ? 'ret' : 'retter'}
          </Text>
        </View>
      </View>

      {note ? (
        <View style={[styles.note, { backgroundColor: colors.primaryMuted }]}>
          <Text style={{ color: colors.primaryDark }}>{note}</Text>
        </View>
      ) : null}
      {plan.meals.length > 0 && (
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Lås de retter du kan lide, og lav resten om.
        </Text>
      )}

      {plan.meals.map(({ recipe: r, price }, i) => {
        const pinned = p.pinned.includes(r.id);
        const tags = MOODS.filter((m) => p.moods.includes(m.key) && r.plan?.moods.includes(m.key)).slice(0, 2);
        return (
          <View key={r.id}>
            <Text style={[styles.day, { color: colors.text }]}>{DAYS[i]}</Text>
            <View style={[styles.meal, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                style={styles.mealLink}
                onPress={() => onOpen(r)}
                accessibilityRole="button"
                accessibilityLabel={`${DAYS[i]}: ${r.title}, cirka ${krText(price)}`}
                accessibilityHint="Åbner opskriften"
              >
                {r.image_url ? (
                  <Image source={{ uri: r.image_url }} style={styles.img} />
                ) : (
                  <View style={[styles.img, { backgroundColor: colors.border }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.mealTitle, { color: colors.text }]} numberOfLines={2}>
                    {r.title}
                  </Text>
                  <View style={styles.tags}>
                    <Tag text="🍽️ Aftensmad" />
                    {tags.map((m) => (
                      <Tag key={m.key} text={`${m.icon} ${m.label}`} />
                    ))}
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                    👤 {p.people} · ca. {krText(price)}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => togglePin(r.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: pinned }}
                accessibilityLabel={pinned ? `Lås op: ${r.title}` : `Lås: ${r.title}`}
                hitSlop={8}
                style={[styles.pin, pinned && { backgroundColor: colors.primaryMuted }]}
              >
                <Text style={{ fontSize: 18, opacity: pinned ? 1 : 0.55 }}>{pinned ? '🔒' : '🔓'}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Prisen er for hele pakker i den billigste butik. Har du noget i forvejen, bliver det billigere.
      </Text>
      <Pressable
        onPress={() => onChange({ ...p, seed: (p.seed || 1) + 1 })}
        accessibilityRole="button"
        style={[styles.secondary, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>↻ Lav ny plan</Text>
      </Pressable>

      <Text style={[styles.listTitle, { color: colors.text }]} accessibilityRole="header">
        Alle opskrifter
      </Text>
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
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      style={[styles.mini, { borderColor: colors.border, backgroundColor: colors.bg, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={{ color: colors.text, fontSize: 18, lineHeight: 20 }}>{label}</Text>
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

const styles = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  summary: { flexDirection: 'row', gap: 10 },
  sumCard: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 12 },
  label: { fontSize: 11, letterSpacing: 0.8, marginBottom: 2 },
  sumPrice: { fontSize: 20, fontWeight: '800' },
  people: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 2 },
  mini: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 5, borderRadius: 99, marginTop: 8, overflow: 'hidden' },
  note: { borderRadius: 12, padding: 12, marginTop: 12 },
  hint: { textAlign: 'center', fontSize: 13, marginTop: 14, marginBottom: 2 },
  day: { textAlign: 'center', fontWeight: '700', fontSize: 16, marginTop: 16, marginBottom: 8 },
  meal: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, padding: 10, gap: 6 },
  mealLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  img: { width: 80, height: 80, borderRadius: 12 },
  mealTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  tag: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 },
  pin: { padding: 8, borderRadius: 20 },
  secondary: { borderWidth: 1, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  listTitle: { fontSize: 18, fontWeight: '700', marginTop: 24 },
});
