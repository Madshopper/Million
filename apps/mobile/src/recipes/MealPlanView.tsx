/** Fanen "Min madplan" i Opskrift-fanen (web: static/js/madplan.js). C2 31-10-2026. */
import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, cardShadow } from '../theme/Typography';
import { useTheme } from '../theme/ThemeContext';
import type { Recipe } from '../api/recipes';
import { DAYS, MAX_PEOPLE, krRound, krText, makePlan, weeklyBudget, type MealPrefs } from './mealPlan';

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
  const n = plan.meals.length;

  let note = '';
  if (!n) {
    note = plan.eligible
      ? 'Ingen retter passer inden for budgettet. Prøv at sætte budgettet op.'
      : 'Ingen af vores opskrifter passer til dine svar endnu. Der kommer flere opskrifter løbende.';
  } else if (n < DAYS.length) {
    note = `Vi fandt ${n} ${n === 1 ? 'ret' : 'retter'}, der passer til dine svar og dit budget. Der kommer flere opskrifter løbende.`;
  }

  const togglePin = (id: number) =>
    onChange({
      ...p,
      pinned: p.pinned.includes(id) ? p.pinned.filter((x) => x !== id) : [...p.pinned, id],
    });

  const setPeople = (people: number) =>
    onChange({ ...p, people: Math.min(MAX_PEOPLE, Math.max(1, people)) });

  return (
    <View style={{ paddingHorizontal: 16 }}>
      <View style={[styles.banner, { backgroundColor: colors.bannerBg }, cardShadow(colors.shadow)]}>
        <View style={styles.bannerTop}>
          <Text style={[styles.kicker, { color: colors.bannerSoft }]} accessibilityRole="header">
            UGENS MADPLAN · {n} {n === 1 ? 'RET' : 'RETTER'}
          </Text>
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel="Ret svar"
            hitSlop={8}
            style={[styles.editPill, { backgroundColor: colors.onPrimarySoft }]}
          >
            <Ionicons name="pencil" size={13} color={colors.onPrimary} />
            <Text style={[styles.editText, { color: colors.onPrimary }]}>Ret svar</Text>
          </Pressable>
        </View>

        <View
          style={styles.amountRow}
          accessible
          accessibilityLabel={`Cirka ${krRound(plan.total)} for ${n} retter, af ${krRound(week)} om ugen`}
        >
          <Text style={[styles.amount, { color: colors.onPrimary }]}>{krRound(plan.total)}</Text>
          <Text style={[styles.amountOf, { color: colors.bannerSoft }]}>af {krRound(week)} om ugen</Text>
        </View>
        {p.budgetPeriod === 'maaned' ? (
          <Text style={[styles.amountOf, { color: colors.bannerSoft, marginTop: 2 }]}>
            Ugens del af {krRound(p.budget)} om måneden
          </Text>
        ) : null}

        <View
          style={[styles.bar, { backgroundColor: colors.onPrimarySoft }]}
          accessibilityRole="progressbar"
          accessibilityLabel={`${pct} procent af budgettet brugt`}
        >
          <View
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: over ? colors.deal : colors.bannerSoft,
            }}
          />
        </View>

        <View style={styles.bannerFoot}>
          {n > 0 ? (
            <View
              style={[styles.leftPill, { backgroundColor: over ? colors.deal : colors.bannerSoft }]}
              accessibilityLiveRegion="polite"
            >
              <Text style={[styles.leftText, { color: over ? colors.dealText : colors.bannerBg }]}>
                {over ? `${krRound(plan.total - week)} over budget` : `${krRound(week - plan.total)} tilbage`}
              </Text>
            </View>
          ) : (
            <View />
          )}
          {/* Antal personer kan skrues direkte her (fx ved gæster) uden at svare
              på alle spørgsmålene igen. Det nye antal bliver standarden. */}
          <View
            style={[styles.people, { backgroundColor: colors.onPrimarySoft }]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Antal personer"
            accessibilityValue={{ text: `${p.people} ${p.people === 1 ? 'person' : 'personer'}` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) =>
              setPeople(p.people + (e.nativeEvent.actionName === 'increment' ? 1 : -1))
            }
          >
            <StepBtn label="−" disabled={p.people <= 1} onPress={() => setPeople(p.people - 1)} />
            <Text style={[styles.peopleText, { color: colors.onPrimary }]}>
              {p.people} {p.people === 1 ? 'person' : 'personer'}
            </Text>
            <StepBtn label="+" disabled={p.people >= MAX_PEOPLE} onPress={() => setPeople(p.people + 1)} />
          </View>
        </View>
      </View>

      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: colors.text }]} accessibilityRole="header">
          Denne uge
        </Text>
        {n > 0 ? (
          <Text style={{ fontSize: 13, color: colors.textMuted }}>Lås dem, du vil beholde</Text>
        ) : null}
      </View>
      {note ? <Text style={[styles.note, { color: colors.textMuted }]}>{note}</Text> : null}

      {n > 0 ? (
        <View style={[styles.list, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}>
          {plan.meals.map(({ recipe: r, price }, i) => {
            const pinned = p.pinned.includes(r.id);
            const time = r.total_time_minutes ? ` · ${r.total_time_minutes} min` : '';
            return (
              <View
                key={r.id}
                style={[
                  styles.row,
                  i < n - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
              >
                <Pressable
                  onPress={() => onOpen(r)}
                  accessibilityRole="button"
                  accessibilityLabel={`${DAYS[i]}: ${r.title}, cirka ${krText(price)}${r.total_time_minutes ? `, ${r.total_time_minutes} minutter` : ''}`}
                  accessibilityHint="Åbner opskriften"
                  style={styles.rowMain}
                >
                  {r.image_url ? (
                    <Image source={{ uri: r.image_url }} style={styles.img} resizeMode="cover" />
                  ) : (
                    <View style={[styles.img, styles.ph, { backgroundColor: colors.primaryMuted }]}>
                      <Ionicons name="restaurant-outline" size={30} color={colors.primaryDark} />
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.day, { color: colors.primaryDark }]}>{DAYS[i].toUpperCase()}</Text>
                    <Text style={[styles.mealTitle, { color: colors.text }]} numberOfLines={2}>
                      {r.title}
                    </Text>
                    <Text style={{ fontSize: 13, color: colors.textMuted }}>
                      ca. {krRound(price)}
                      {time}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => togglePin(r.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: pinned }}
                  accessibilityLabel={pinned ? `Lås op: ${r.title}` : `Lås: ${r.title}`}
                  hitSlop={4}
                  style={[styles.pin, { backgroundColor: pinned ? colors.primary : colors.stepperBg }]}
                >
                  <Ionicons
                    name={pinned ? 'lock-closed' : 'lock-open-outline'}
                    size={18}
                    color={pinned ? colors.onPrimary : colors.textMuted}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      <Pressable
        onPress={() => onChange({ ...p, seed: (p.seed || 1) + 1 })}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.shuffle,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="shuffle" size={20} color={colors.primaryDark} />
        <Text style={{ color: colors.primaryDark, fontWeight: '700', fontSize: 16 }}>Bland ugen</Text>
      </Pressable>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Prisen er for hele pakker i den billigste butik. Har du noget i forvejen, bliver det billigere.
      </Text>
    </View>
  );
}

function StepBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      importantForAccessibility="no"
      accessibilityElementsHidden
      hitSlop={4}
      style={[styles.stepBtn, { opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={{ color: colors.onPrimary, fontSize: 20, fontWeight: '700', lineHeight: 22 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 24, padding: 18, marginTop: 14 },
  bannerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9 },
  editPill: {
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editText: { fontSize: 13, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 10 },
  amount: { fontSize: 34, fontWeight: '900', letterSpacing: -1, lineHeight: 38 },
  amountOf: { fontSize: 13 },
  bar: { height: 8, borderRadius: 999, overflow: 'hidden', marginTop: 12 },
  bannerFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  leftPill: { height: 32, borderRadius: 999, paddingHorizontal: 12, justifyContent: 'center' },
  leftText: { fontSize: 13, fontWeight: '800' },
  people: { height: 36, borderRadius: 999, flexDirection: 'row', alignItems: 'center' },
  peopleText: { fontSize: 14, fontWeight: '700' },
  stepBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  note: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  list: { borderRadius: 24, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  img: { width: 76, height: 76, borderRadius: 16 },
  ph: { alignItems: 'center', justifyContent: 'center' },
  day: { fontSize: 11, fontWeight: '700', letterSpacing: 0.9 },
  mealTitle: { fontSize: 15, fontWeight: '700', lineHeight: 19 },
  pin: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  shuffle: {
    height: 50,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  hint: { textAlign: 'center', fontSize: 12, marginTop: 10, lineHeight: 17 },
});
