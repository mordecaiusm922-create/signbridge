// Recognition evaluation: pure functions shared by the browser (Evaluate tab)
// and the test suite. A trial is one recorded attempt:
//   { target: 'YES' | ... | NOT_A_SIGN, predicted: gloss | null,
//     confirmGloss: gloss | null, best: { gloss, distance, margin } }

export const NOT_A_SIGN = '(not a sign)';
export const REJECTED = '(rejected)';
const AFFIRM = new Set(['YES', 'CONFIRM']);

const rate = (n, d) => (d ? n / d : null);
const round = (x, k = 3) => (x === null || x === undefined ? null : Number(x.toFixed(k)));

export function summarize(trials) {
  const signs = trials.filter((t) => t.target !== NOT_A_SIGN);
  const nonAffirm = trials.filter((t) => !AFFIRM.has(t.target));
  const correct = signs.filter((t) => t.predicted === t.target).length;
  const rejected = signs.filter((t) => !t.predicted).length;
  const confused = signs.length - correct - rejected;

  const labels = [...new Set(trials.map((t) => t.target))].sort((a, b) => (a === NOT_A_SIGN) - (b === NOT_A_SIGN) || a.localeCompare(b));
  const columns = [...new Set([...labels.filter((l) => l !== NOT_A_SIGN), ...trials.map((t) => t.predicted).filter(Boolean)])].sort();
  columns.push(REJECTED);
  const confusion = Object.fromEntries(labels.map((l) => [l, Object.fromEntries(columns.map((c) => [c, 0]))]));
  for (const t of trials) confusion[t.target][t.predicted ?? REJECTED] = (confusion[t.target][t.predicted ?? REJECTED] ?? 0) + 1;

  // Genuine = best template is the sign actually made; impostor = anything else
  // (wrong sign, or a gesture that is not a sign at all).
  const genuine = trials.filter((t) => t.target !== NOT_A_SIGN && t.best.gloss === t.target).map((t) => t.best.distance);
  const impostor = trials.filter((t) => t.best.gloss !== t.target).map((t) => t.best.distance);
  const maxGenuine = genuine.length ? Math.max(...genuine) : null;
  const minImpostor = impostor.length ? Math.min(...impostor) : null;
  let threshold = null;
  if (maxGenuine !== null && minImpostor !== null) {
    const separable = maxGenuine < minImpostor;
    const value = separable ? (maxGenuine + minImpostor) / 2 : minImpostor * 0.95;
    threshold = { separable, value: round(value, 2), keepsGenuine: round(rate(genuine.filter((d) => d <= value).length, genuine.length)) };
  }

  return {
    trials: trials.length,
    signTrials: signs.length,
    accuracy: round(rate(correct, signs.length)),
    rejectionRate: round(rate(rejected, signs.length)),
    confusionRate: round(rate(confused, signs.length)),
    // Safety metric: attempts that were NOT a YES but would have executed.
    falseYes: nonAffirm.filter((t) => AFFIRM.has(t.confirmGloss)).length,
    nonYesTrials: nonAffirm.length,
    confusion, columns,
    distances: { genuine: { min: round(genuine.length ? Math.min(...genuine) : null), max: round(maxGenuine) }, impostor: { min: round(minImpostor), max: round(impostor.length ? Math.max(...impostor) : null) } },
    threshold
  };
}

export function toCSV(trials) {
  const rows = [['target', 'predicted', 'confirm_gloss', 'best_gloss', 'distance', 'margin', 'at']];
  for (const t of trials) rows.push([t.target, t.predicted ?? '', t.confirmGloss ?? '', t.best.gloss, t.best.distance, t.best.margin, t.at ?? '']);
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}
