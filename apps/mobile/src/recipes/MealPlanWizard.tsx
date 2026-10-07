/** Spørgsmålene første gang man åbner Opskrifter (web: static/js/madplan.js). */
import React, { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import type { Recipe } from '../api/recipes';
import {
  BUDGET,
  DAYS,
  DAYS_MIN,
  DIETS,
  KITCHEN,
  MAX_PEOPLE,
  MOODS,
  POPULAR,
  allIngredientNames,
  krRound,
  switchPeriod,
  type BudgetPeriod,
  type Choice,
  type MealPrefs,
} from './mealPlan';

const STEPS = ['people', 'budget', 'moods', 'diets', 'blocked', 'kitchen'] as const;

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

  const titles: Record<(typeof STEPS)[number], [string, string]> = {
    people: ['Hvem laver du mad til?', 'Så passer mængder og priser til jer.'],
    budget: ['Hvad er dit madbudget?', 'Træk til det beløb du gerne vil bruge.'],
    moods: ['Hvad har du lyst til?', 'Vælg op til 3.'],
    diets: ['Har du særlige kostbehov?', 'Spring over, hvis du spiser alt.'],
    blocked: [
      'Er der noget du vil undgå?',
      'Søg efter ingredienser, der ikke skal med i dine madplaner. Fjern en igen for at tillade den.',
    ],
    kitchen: ['Hvad har du i køkkenet?', 'Vælg det udstyr du har.'],
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.top}>
        <Pressable
          onPress={() => go(-1)}
          disabled={step === 0 && !onCancel}
          accessibilityRole="button"
          accessibilityLabel="Tilbage"
          style={[
            styles.back,
            { backgroundColor: colors.surface, opacity: step === 0 && !onCancel ? 0 : 1 },
          ]}
        >
          <Text style={[styles.backText, { color: colors.text }]}>‹</Text>
        </Pressable>
        <View
          style={[styles.progress, { backgroundColor: colors.border }]}
          accessibilityRole="progressbar"
          accessibilityLabel={`Spørgsmål ${step + 1} af ${STEPS.length}`}
        >
          <View
            style={{
              width: `${((step + 1) / STEPS.length) * 100}%`,
              height: '100%',
              backgroundColor: colors.primary,
              borderRadius: 99,
            }}
          />
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>
          {step + 1}/{STEPS.length}
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingTop: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {titles[name][0]}
        </Text>
        <Text style={[styles.sub, { color: colors.textMuted }]}>{titles[name][1]}</Text>

        {name === 'people' && (
          <>
            <Counter
              icon="👥"
              label="Personer"
              unit={p.people === 1 ? 'person' : 'personer'}
              value={p.people}
              min={1}
              max={MAX_PEOPLE}
              onChange={(people) => update({ people })}
            />
            <Counter
              icon="📅"
              label="Aftener om ugen"
              unit="aftensmåltider"
              value={p.days}
              min={DAYS_MIN}
              max={DAYS.length}
              onChange={(days) => update({ days })}
            />
          </>
        )}

        {name === 'budget' && (
          <>
            <Segment
              value={p.budgetPeriod}
              onChange={(period) => setP((prev) => switchPeriod(prev, period))}
            />
            <View style={{ alignItems: 'center', marginVertical: 28 }}>
              <Text style={[styles.big, { color: colors.text }]}>{krRound(p.budget)}</Text>
              <Text style={{ color: colors.textMuted }}>{BUDGET[p.budgetPeriod].label}</Text>
            </View>
            <BudgetSlider
              key={p.budgetPeriod}
              period={p.budgetPeriod}
              value={p.budget}
              onChange={(budget) => update({ budget })}
            />
            <View style={styles.rangeLabels}>
              <Text style={{ color: colors.textMuted }}>{krRound(BUDGET[p.budgetPeriod].min)}</Text>
              <Text style={{ color: colors.textMuted }}>{krRound(BUDGET[p.budgetPeriod].max)}</Text>
            </View>
          </>
        )}

        {name === 'moods' && (
          <CardGrid
            items={MOODS}
            selected={p.moods}
            onToggle={(k) => update({ moods: toggle(p.moods, k, 3) })}
          />
        )}

        {name === 'diets' && (
          <CardGrid
            items={DIETS}
            selected={p.diets}
            onToggle={(k) => update({ diets: toggle(p.diets, k) })}
          />
        )}

        {name === 'blocked' && (
          <BlockedStep
            recipes={recipes}
            blocked={p.blocked}
            onChange={(blocked) => update({ blocked })}
          />
        )}

        {name === 'kitchen' && (
          <View style={styles.chips}>
            {KITCHEN.map((k) => (
              <Chip
                key={k.key}
                label={`${k.icon} ${k.label}`}
                a11y={k.label}
                selected={p.kitchen.includes(k.key)}
                onPress={() => update({ kitchen: toggle(p.kitchen, k.key) })}
                big
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={() => go(1)}
          disabled={name === 'kitchen' && !p.kitchen.length}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.next,
            {
              backgroundColor: pressed ? colors.primaryDark : colors.primarySolid,
              opacity: name === 'kitchen' && !p.kitchen.length ? 0.45 : 1,
            },
          ]}
        >
          <Text style={styles.nextText}>{last ? 'Lav min madplan' : 'Næste'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Ugentligt / månedligt budget. */
function Segment({ value, onChange }: { value: BudgetPeriod; onChange: (v: BudgetPeriod) => void }) {
  const { colors } = useTheme();
  const opts: [BudgetPeriod, string][] = [
    ['uge', 'Om ugen'],
    ['maaned', 'Om måneden'],
  ];
  return (
    <View style={[styles.seg, { backgroundColor: colors.border }]} accessibilityRole="radiogroup">
      {opts.map(([key, label]) => {
        const on = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.segBtn, on && { backgroundColor: colors.surface }]}
          >
            <Text style={{ color: on ? colors.primaryDark : colors.textMuted, fontWeight: '700' }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Ikon, tekst og plus/minus på én række (personer, aftener). */
function Counter({
  icon,
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  icon: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.counter, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.counterIcon, { backgroundColor: colors.primaryMuted }]}>
        <Text style={{ fontSize: 24 }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{label}</Text>
        <Text style={{ color: colors.textMuted }}>
          {value} {unit}
        </Text>
      </View>
      <RoundButton
        label="−"
        a11y={`Færre ${label.toLowerCase()}`}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        small
      />
      <Text
        style={[styles.counterVal, { color: colors.text }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${value} ${unit}`}
      >
        {value}
      </Text>
      <RoundButton
        label="+"
        a11y={`Flere ${label.toLowerCase()}`}
        solid
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        small
      />
    </View>
  );
}

function RoundButton({
  label,
  a11y,
  onPress,
  disabled,
  solid,
  small,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  disabled?: boolean;
  solid?: boolean;
  small?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => onPress()}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[
        styles.round,
        small && { width: 38, height: 38, borderRadius: 19 },
        {
          backgroundColor: solid ? colors.primarySolid : colors.surface,
          borderColor: colors.border,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text style={{ fontSize: 26, color: solid ? '#fff' : colors.text }}>{label}</Text>
    </Pressable>
  );
}

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
              { backgroundColor: colors.surface, borderColor: on ? colors.primary : colors.border },
            ]}
          >
            {on && (
              <View style={[styles.check, { backgroundColor: colors.primary }]}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>
              </View>
            )}
            <Text style={{ fontSize: 38 }}>{it.icon}</Text>
            <Text style={[styles.cardLabel, { color: colors.text }]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Chip({
  label,
  a11y,
  selected,
  onPress,
  big,
}: {
  label: string;
  a11y?: string;
  selected: boolean;
  onPress: () => void;
  big?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => onPress()}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={a11y || label}
      style={[
        styles.chip,
        big && { paddingVertical: 12, paddingHorizontal: 16 },
        {
          backgroundColor: selected ? colors.primarySolid : colors.surface,
          borderColor: selected ? colors.primarySolid : colors.border,
        },
      ]}
    >
      <Text style={{ color: selected ? '#fff' : colors.text, fontSize: big ? 15 : 14 }}>{label}</Text>
    </Pressable>
  );
}

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

  return (
    <View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Søg ingredienser…"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="Søg ingredienser"
        returnKeyType="done"
        onSubmitEditing={() => {
          if (q.trim() && !isOn(q.trim())) toggle(q.trim());
          setQ('');
        }}
        style={[
          styles.input,
          { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border },
        ]}
      />
      {hits.length > 0 && (
        <View style={[styles.chips, { marginTop: 8 }]}>
          {hits.map((h) => (
            <Chip
              key={h}
              label={h}
              selected={isOn(h)}
              onPress={() => {
                toggle(h);
                setQ('');
              }}
            />
          ))}
        </View>
      )}
      {blocked.length > 0 && (
        <View style={[styles.chips, { marginTop: 12 }]}>
          {blocked.map((b) => (
            <Chip key={b} label={`${b}  ×`} a11y={`Fjern ${b}`} selected onPress={() => toggle(b)} />
          ))}
        </View>
      )}
      <Text style={[styles.subHead, { color: colors.text }]}>Populære</Text>
      <View style={styles.pop}>
        {POPULAR.map(([n, icon]) => {
          const on = isOn(n);
          return (
            <Pressable
              key={n}
              onPress={() => toggle(n)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={n}
              style={[
                styles.popItem,
                {
                  borderColor: on ? colors.primary : 'transparent',
                  backgroundColor: on ? colors.primaryMuted : 'transparent',
                },
              ]}
            >
              <Text style={{ fontSize: 28 }}>{icon}</Text>
              <Text
                style={{ color: on ? colors.primaryDark : colors.text, fontSize: 12, textAlign: 'center' }}
                numberOfLines={2}
              >
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  const { min: BUDGET_MIN, max: BUDGET_MAX, step: BUDGET_STEP } = BUDGET[period];
  const { colors } = useTheme();
  const width = useRef(1);
  const startX = useRef(0);
  const ratio = (value - BUDGET_MIN) / (BUDGET_MAX - BUDGET_MIN);
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
      accessibilityLabel="Budget om ugen"
      accessibilityValue={{ text: krRound(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const d = e.nativeEvent.actionName === 'increment' ? BUDGET_STEP : -BUDGET_STEP;
        onChange(Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, value + d)));
      }}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: colors.primary, borderRadius: 99 }} />
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          { left: `${ratio * 100}%`, backgroundColor: colors.primarySolid, borderColor: colors.surface },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 26, lineHeight: 28, marginTop: -2 },
  progress: { flex: 1, height: 6, borderRadius: 99, overflow: 'hidden' },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 6 },
  sub: { fontSize: 15, marginBottom: 20 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 12 },
  counterIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  counterVal: { fontSize: 22, fontWeight: '800', minWidth: 26, textAlign: 'center' },
  seg: { flexDirection: 'row', borderRadius: 999, padding: 4, alignSelf: 'center', width: 300 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999 },
  big: { fontSize: 48, fontWeight: '800', minWidth: 70, textAlign: 'center' },
  round: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rangeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  sliderHit: { height: 44, justifyContent: 'center' },
  track: { height: 6, borderRadius: 99, overflow: 'hidden' },
  thumb: { position: 'absolute', width: 28, height: 28, borderRadius: 14, marginLeft: -14, borderWidth: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: {
    width: '48.5%',
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
  },
  check: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  input: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16 },
  subHead: { fontSize: 16, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  pop: { flexDirection: 'row', flexWrap: 'wrap' },
  popItem: { width: '25%', alignItems: 'center', gap: 4, paddingVertical: 8, borderWidth: 2, borderRadius: 12 },
  footer: { paddingHorizontal: 20, paddingVertical: 12 },
  next: { borderRadius: 999, paddingVertical: 16, alignItems: 'center' },
  nextText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
