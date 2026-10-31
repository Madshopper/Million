/** Spørgsmålene første gang man åbner Opskrifter (web: static/js/madplan.js).
 * Udseende i C2 (31-10-2026): fremgangsbjælke med 6 streger, store kort og
 * ingen emoji. Samme 6 trin og samme data som før. */
import React, { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput, cardShadow } from '../theme/Typography';
import { useTheme } from '../theme/ThemeContext';
import type { Recipe } from '../api/recipes';
import {
  BUDGET,
  DIETS,
  KITCHEN,
  MAX_PEOPLE,
  MOODS,
  POPULAR,
  allIngredientNames,
  clampBudget,
  krRound,
  switchPeriod,
  weeklyBudget,
  type BudgetPeriod,
  type Choice,
  type MealPrefs,
} from './mealPlan';

const STEPS = ['people', 'budget', 'moods', 'diets', 'blocked', 'kitchen'] as const;
type StepName = (typeof STEPS)[number];
/** Trin man kan springe over ("Spring over" øverst til højre). */
const OPTIONAL: StepName[] = ['diets', 'blocked'];
const MAX_MOODS = 3;

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: string) => name as IconName;

/** Hurtigvalg under budget-kortet, inden for BUDGET-grænserne. */
const QUICK_BUDGET: Record<BudgetPeriod, number[]> = {
  uge: [300, 500, 750, 1000],
  maaned: [1500, 2000, 3000, 4000],
};

type Props = {
  recipes: Recipe[];
  initial: MealPrefs;
  /** Kun når man retter sine svar: tilbage fra første spørgsmål = fortryd. */
  onCancel?: () => void;
  onDone: (prefs: MealPrefs) => void;
};

export function MealPlanWizard({ recipes, initial, onCancel, onDone }: Props) {
  const { colors } = useTheme();
  const [p, setP] = useState<MealPrefs>(initial);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const name = STEPS[step];
  const last = step === STEPS.length - 1;
  const canBack = step > 0 || !!onCancel;

  const update = (patch: Partial<MealPrefs>) => setP((prev) => ({ ...prev, ...patch }));
  const toggle = (list: string[], key: string, max?: number) => {
    if (list.includes(key)) return list.filter((k) => k !== key);
    if (max && list.length >= max) return list;
    return [...list, key];
  };

  const go = (delta: number) => {
    if (step + delta < 0) return onCancel?.();
    if (step + delta >= STEPS.length) return onDone({ ...p, done: true });
    setStep(step + delta);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const titles: Record<StepName, [string, string]> = {
    people: ['Hvem laver du mad til?', 'Så passer mængder og priser til jer.'],
    budget: ['Hvad er dit madbudget?', 'Træk til det beløb, du gerne vil bruge.'],
    moods: ['Hvad har du lyst til?', 'Vælg op til 3. Vi blander retterne efter det.'],
    diets: ['Har du særlige kostbehov?', 'Spring over, hvis du spiser alt.'],
    blocked: [
      'Er der noget, du vil undgå?',
      'Vi bruger dem ikke i dine madplaner. Fjern en igen for at tillade den.',
    ],
    kitchen: ['Hvad har du i køkkenet?', 'Vælg det udstyr, du har. Så foreslår vi kun retter, du kan lave.'],
  };

  const nextDisabled = name === 'kitchen' && !p.kitchen.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.top}>
        <View style={styles.topSide}>
          {canBack ? (
            <Pressable
              onPress={() => go(-1)}
              accessibilityRole="button"
              accessibilityLabel="Tilbage"
              hitSlop={4}
              style={[styles.back, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityLabel={`Trin ${step + 1} af ${STEPS.length}`}
        >
          {STEPS.map((s, i) => (
            <View
              key={s}
              style={[styles.progressBar, { backgroundColor: i <= step ? colors.primary : colors.border }]}
            />
          ))}
        </View>
        <View style={[styles.topSide, { alignItems: 'flex-end' }]}>
          {OPTIONAL.includes(name) ? (
            <Pressable onPress={() => go(1)} accessibilityRole="button" hitSlop={10}>
              <Text style={[styles.skip, { color: colors.primaryDark }]} numberOfLines={1}>
                Spring over
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.stepLabel, { color: colors.primaryDark }]}>
          Trin {step + 1} af {STEPS.length}
        </Text>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {titles[name][0]}
        </Text>
        <Text style={[styles.sub, { color: colors.textMuted }]}>{titles[name][1]}</Text>

        {name === 'people' && <PeopleStep value={p.people} onChange={(people) => update({ people })} />}

        {name === 'budget' && (
          <BudgetStep prefs={p} onPeriod={(period) => setP((prev) => switchPeriod(prev, period))} onBudget={(budget) => update({ budget })} />
        )}

        {name === 'moods' && (
          <>
            <CardGrid
              items={MOODS}
              selected={p.moods}
              onToggle={(k) => update({ moods: toggle(p.moods, k, MAX_MOODS) })}
            />
            <Text style={[styles.note, { color: colors.textMuted }]} accessibilityLiveRegion="polite">
              {p.moods.length} af {MAX_MOODS} valgt
            </Text>
          </>
        )}

        {name === 'diets' && (
          <CardGrid items={DIETS} selected={p.diets} onToggle={(k) => update({ diets: toggle(p.diets, k) })} />
        )}

        {name === 'blocked' && (
          <BlockedStep recipes={recipes} blocked={p.blocked} onChange={(blocked) => update({ blocked })} />
        )}

        {name === 'kitchen' && (
          <KitchenGrid selected={p.kitchen} onToggle={(k) => update({ kitchen: toggle(p.kitchen, k) })} />
        )}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.bg }]}>
        <Pressable
          onPress={() => go(1)}
          disabled={nextDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: nextDisabled }}
          style={({ pressed }) => [
            styles.next,
            { backgroundColor: colors.primary, opacity: nextDisabled ? 0.45 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.nextText, { color: colors.onPrimary }]}>{last ? 'Lav min madplan' : 'Næste'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Trin 1: stort kort med tallet, runde knapper og hurtigvalg. */
function PeopleStep({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { colors } = useTheme();
  const unit = value === 1 ? 'person' : 'personer';
  const quick = [1, 2, 3, 4, 5];
  return (
    <>
      <View style={[styles.bigCard, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}>
        <Ionicons name="people-outline" size={34} color={colors.primary} />
        <View
          style={styles.counterRow}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Antal personer"
          accessibilityValue={{ text: `${value} ${unit}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) =>
            onChange(
              Math.min(MAX_PEOPLE, Math.max(1, value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))),
            )
          }
        >
          <Pressable
            onPress={() => onChange(Math.max(1, value - 1))}
            disabled={value <= 1}
            style={[styles.round, { backgroundColor: colors.stepperBg, opacity: value <= 1 ? 0.4 : 1 }]}
          >
            <Ionicons name="remove" size={28} color={colors.primaryDark} />
          </Pressable>
          <View style={{ alignItems: 'center', minWidth: 90 }}>
            <Text style={[styles.hugeNumber, { color: colors.text }]}>{value}</Text>
            <Text style={{ fontSize: 15, color: colors.textMuted, marginTop: 4 }}>{unit}</Text>
          </View>
          <Pressable
            onPress={() => onChange(Math.min(MAX_PEOPLE, value + 1))}
            disabled={value >= MAX_PEOPLE}
            style={[styles.round, { backgroundColor: colors.primary, opacity: value >= MAX_PEOPLE ? 0.4 : 1 }]}
          >
            <Ionicons name="add" size={28} color={colors.onPrimary} />
          </Pressable>
        </View>
      </View>
      <Text style={[styles.smallHead, { color: colors.textMuted }]}>Hurtigt valg</Text>
      <View style={styles.quickRow}>
        {quick.map((n) => {
          const on = n === 5 ? value >= 5 : value === n;
          return (
            <QuickPill
              key={n}
              label={n === 5 ? '5+' : String(n)}
              a11y={n === 5 ? '5 eller flere personer' : `${n} ${n === 1 ? 'person' : 'personer'}`}
              selected={on}
              height={48}
              onPress={() => onChange(n)}
            />
          );
        })}
      </View>
      <Text style={[styles.note, { color: colors.textMuted }]}>
        Du kan altid ændre antallet i madplanen, fx når I får gæster.
      </Text>
    </>
  );
}

function QuickPill({
  label,
  a11y,
  selected,
  height,
  onPress,
}: {
  label: string;
  a11y?: string;
  selected: boolean;
  height: number;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={a11y || label}
      style={[
        styles.quick,
        { height },
        selected
          ? { backgroundColor: colors.primaryMuted, borderColor: colors.primary, borderWidth: 2 }
          : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
      ]}
    >
      <Text style={{ fontSize: 15, fontWeight: '700', color: selected ? colors.primaryDark : colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Trin 2: uge/måned, stort beløb på det mørkegrønne kort og en skyder. */
function BudgetStep({
  prefs,
  onPeriod,
  onBudget,
}: {
  prefs: MealPrefs;
  onPeriod: (p: BudgetPeriod) => void;
  onBudget: (v: number) => void;
}) {
  const { colors } = useTheme();
  const b = BUDGET[prefs.budgetPeriod];
  const perDay = Math.round(weeklyBudget(prefs) / Math.max(1, prefs.people) / 7);
  return (
    <>
      <Segment value={prefs.budgetPeriod} onChange={onPeriod} />
      <View style={[styles.budgetCard, { backgroundColor: colors.bannerBg }, cardShadow(colors.shadow)]}>
        <View style={styles.budgetAmount}>
          <Text style={[styles.hugeNumber, { color: colors.onPrimary }]}>
            {krRound(prefs.budget).replace(' kr', '')}
          </Text>
          <Text style={{ color: colors.onPrimary, fontSize: 22, fontWeight: '800', marginLeft: 6 }}>kr</Text>
        </View>
        <Text style={[styles.budgetSub, { color: colors.bannerSoft }]}>
          {b.label} · ca. {perDay} kr pr. person pr. dag
        </Text>
        <BudgetSlider
          key={prefs.budgetPeriod}
          period={prefs.budgetPeriod}
          value={prefs.budget}
          onChange={onBudget}
        />
        <View style={styles.rangeLabels}>
          <Text style={{ fontSize: 12, color: colors.bannerSoft }}>{krRound(b.min)}</Text>
          <Text style={{ fontSize: 12, color: colors.bannerSoft }}>{krRound(b.max)}</Text>
        </View>
      </View>
      <View style={[styles.quickRow, { marginTop: 18 }]}>
        {QUICK_BUDGET[prefs.budgetPeriod].map((v) => {
          const value = clampBudget(v, prefs.budgetPeriod);
          return (
            <QuickPill
              key={v}
              label={krRound(value)}
              selected={prefs.budget === value}
              height={44}
              onPress={() => onBudget(value)}
            />
          );
        })}
      </View>
    </>
  );
}

/** Ugentligt / månedligt budget (samme segment som fanerne i Opskrifter). */
function Segment({ value, onChange }: { value: BudgetPeriod; onChange: (v: BudgetPeriod) => void }) {
  const { colors } = useTheme();
  const opts: [BudgetPeriod, string][] = [
    ['uge', 'Om ugen'],
    ['maaned', 'Om måneden'],
  ];
  return (
    <View style={[styles.seg, { backgroundColor: colors.segmentBg }]} accessibilityRole="radiogroup">
      {opts.map(([key, label]) => {
        const on = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.segBtn, on && { backgroundColor: colors.surface }, on && cardShadow(colors.shadow)]}
          >
            <Text style={{ fontSize: 14, color: on ? colors.text : colors.textMuted, fontWeight: on ? '700' : '500' }}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Trin 3 og 4: felter i 2 kolonner med ikon i en cirkel. */
function CardGrid({
  items,
  selected,
  onToggle,
}: {
  items: Choice[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {items.map((it) => {
        const on = selected.includes(it.key);
        return (
          <Pressable
            key={it.key}
            onPress={() => onToggle(it.key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={it.label}
            style={[
              styles.card,
              { backgroundColor: colors.surface },
              on
                ? [{ borderColor: colors.primary, borderWidth: 2 }, greenShadow(colors.primary)]
                : { borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            <View style={[styles.cardIcon, { backgroundColor: on ? colors.primaryMuted : colors.stepperBg }]}>
              <Ionicons name={icon(it.icon)} size={22} color={colors.primaryDark} />
            </View>
            <Text style={[styles.cardLabel, { color: colors.text }]}>{it.label}</Text>
            {on ? <SmallCheck size={22} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Trin 6: felter i 3 kolonner. */
function KitchenGrid({ selected, onToggle }: { selected: string[]; onToggle: (key: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.kitchen}>
      {KITCHEN.map((k) => {
        const on = selected.includes(k.key);
        return (
          <Pressable
            key={k.key}
            onPress={() => onToggle(k.key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={k.label}
            style={[
              styles.kitchenCell,
              { backgroundColor: colors.surface },
              on ? { borderColor: colors.primary, borderWidth: 2 } : { borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            <Ionicons name={icon(k.icon)} size={30} color={on ? colors.primaryDark : colors.textMuted} />
            <Text
              style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: colors.text, textAlign: 'center' }}
              numberOfLines={2}
            >
              {k.short || k.label}
            </Text>
            {on ? <SmallCheck size={18} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function SmallCheck({ size }: { size: number }) {
  const { colors } = useTheme();
  const inset = size > 20 ? 10 : 6;
  return (
    <View
      style={{
        position: 'absolute',
        top: inset,
        right: inset,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="checkmark" size={size - 8} color={colors.onPrimary} />
    </View>
  );
}

function greenShadow(color: string) {
  return {
    shadowColor: color,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  } as const;
}

/** Trin 5: søg ingredienser, de valgte som mørke piller, populære som hvide. */
function BlockedStep({
  recipes,
  blocked,
  onChange,
}: {
  recipes: Recipe[];
  blocked: string[];
  onChange: (b: string[]) => void;
}) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const names = useMemo(() => allIngredientNames(recipes), [recipes]);
  const fold = (s: string) => s.toLowerCase().trim();
  const isOn = (n: string) => blocked.some((b) => fold(b) === fold(n));
  const toggle = (n: string) =>
    onChange(isOn(n) ? blocked.filter((b) => fold(b) !== fold(n)) : [...blocked, n]);

  const query = fold(q);
  const hits = query ? names.filter((n) => fold(n).includes(query)).slice(0, 6) : [];
  if (query && !hits.some((h) => fold(h) === query)) hits.unshift(q.trim());
  const popular = POPULAR.filter((n) => !isOn(n));

  return (
    <View>
      <View style={[styles.search, { backgroundColor: colors.surface }, cardShadow(colors.shadow)]}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Søg efter en ingrediens"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Søg efter en ingrediens"
          returnKeyType="done"
          onSubmitEditing={() => {
            if (q.trim() && !isOn(q.trim())) toggle(q.trim());
            setQ('');
          }}
          style={[styles.searchInput, { color: colors.text }]}
        />
      </View>
      {hits.length > 0 && (
        <View style={[styles.chips, { marginTop: 10 }]}>
          {hits.map((h) => (
            <AddPill
              key={h}
              label={h}
              on={isOn(h)}
              onPress={() => {
                toggle(h);
                setQ('');
              }}
            />
          ))}
        </View>
      )}
      {blocked.length > 0 && (
        <>
          <Text style={[styles.smallHead, { color: colors.textMuted }]}>Undgår du ({blocked.length})</Text>
          <View style={styles.chips}>
            {blocked.map((b) => (
              <Pressable
                key={b}
                onPress={() => toggle(b)}
                accessibilityRole="button"
                accessibilityLabel={`Fjern ${b}`}
                style={[styles.darkPill, { backgroundColor: colors.text }]}
              >
                <Text style={{ color: colors.bg, fontSize: 14, fontWeight: '600' }}>{b}</Text>
                <View style={[styles.pillX, { backgroundColor: colors.textMuted }]}>
                  <Ionicons name="close" size={14} color={colors.bg} />
                </View>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <Text style={[styles.smallHead, { color: colors.textMuted }]}>Populære</Text>
      <View style={styles.chips}>
        {popular.map((n) => (
          <AddPill key={n} label={n} on={false} onPress={() => toggle(n)} />
        ))}
      </View>
    </View>
  );
}

function AddPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={on ? `Fjern ${label}` : `Undgå ${label}`}
      style={[
        styles.addPill,
        on
          ? { backgroundColor: colors.primaryMuted, borderColor: colors.primary }
          : { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Ionicons name={on ? 'checkmark' : 'add'} size={16} color={on ? colors.primaryDark : colors.textMuted} />
      <Text style={{ fontSize: 14, fontWeight: '500', color: on ? colors.primaryDark : colors.text }}>{label}</Text>
    </Pressable>
  );
}

/** Egen lille skyder (ingen ekstra pakke): træk eller tryk på sporet. */
function BudgetSlider({
  value,
  period,
  onChange,
}: {
  value: number;
  period: BudgetPeriod;
  onChange: (v: number) => void;
}) {
  const { min: BUDGET_MIN, max: BUDGET_MAX, step: BUDGET_STEP, label } = BUDGET[period];
  const { colors } = useTheme();
  const width = useRef(1);
  const startX = useRef(0);
  const ratio = Math.min(1, Math.max(0, (value - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN)));
  const valueRef = useRef(value);
  valueRef.current = value;

  const toValue = (x: number) => {
    const r = Math.min(1, Math.max(0, x / width.current));
    const raw = BUDGET_MIN + r * (BUDGET_MAX - BUDGET_MIN);
    return Math.round(raw / BUDGET_STEP) * BUDGET_STEP;
  };
  const set = (v: number) => {
    if (v !== valueRef.current) onChange(v);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          startX.current = e.nativeEvent.locationX;
          set(toValue(startX.current));
        },
        onPanResponderMove: (_e, g) => set(toValue(startX.current + g.dx)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <View
      {...responder.panHandlers}
      onLayout={(e: LayoutChangeEvent) => {
        width.current = Math.max(1, e.nativeEvent.layout.width);
      }}
      style={styles.sliderHit}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Budget ${label}`}
      accessibilityValue={{ text: krRound(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const d = e.nativeEvent.actionName === 'increment' ? BUDGET_STEP : -BUDGET_STEP;
        onChange(Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, value + d)));
      }}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: colors.onPrimarySoft }]}>
        <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: colors.bannerSoft, borderRadius: 999 }} />
      </View>
      <View
        pointerEvents="none"
        style={[styles.thumb, { left: `${ratio * 100}%`, backgroundColor: colors.onPrimary }, cardShadow(colors.shadow)]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  topSide: { width: 96 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: { flex: 1, flexDirection: 'row', gap: 4 },
  progressBar: { flex: 1, height: 6, borderRadius: 999 },
  skip: { fontSize: 15, fontWeight: '600' },
  stepLabel: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6, lineHeight: 32, marginTop: 6 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 8, marginBottom: 22 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 16 },
  smallHead: { fontSize: 13, fontWeight: '700', marginTop: 22, marginBottom: 10 },
  bigCard: { borderRadius: 28, paddingVertical: 26, paddingHorizontal: 20, alignItems: 'center', gap: 18, marginTop: 12 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 26 },
  round: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  hugeNumber: { fontSize: 64, fontWeight: '900', letterSpacing: -2, lineHeight: 68 },
  quickRow: { flexDirection: 'row', gap: 8 },
  quick: { flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', borderRadius: 999, padding: 4, gap: 4 },
  segBtn: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  budgetCard: { borderRadius: 28, paddingTop: 26, paddingBottom: 22, paddingHorizontal: 20, marginTop: 22 },
  budgetAmount: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  budgetSub: { fontSize: 14, textAlign: 'center', marginTop: 6 },
  rangeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  sliderHit: { height: 44, justifyContent: 'center', marginTop: 14, marginHorizontal: 4 },
  track: { height: 8, borderRadius: 999, overflow: 'hidden' },
  thumb: { position: 'absolute', width: 30, height: 30, borderRadius: 15, marginLeft: -15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: {
    width: '48.4%',
    minHeight: 112,
    borderRadius: 20,
    padding: 14,
    justifyContent: 'space-between',
    gap: 10,
  },
  cardIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: 15, fontWeight: '700', lineHeight: 18 },
  kitchen: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  kitchenCell: {
    width: '31.8%',
    height: 96,
    borderRadius: 18,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  search: {
    height: 48,
    borderRadius: 999,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, height: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  darkPill: {
    height: 38,
    borderRadius: 999,
    paddingLeft: 14,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillX: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  addPill: {
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  next: { height: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  nextText: { fontSize: 17, fontWeight: '800' },
});
