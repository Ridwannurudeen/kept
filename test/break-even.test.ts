import { readFileSync } from 'node:fs';
import { breakEven, fromCents } from '../src/policy.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function clientFunction(): (disputedCents: number, offerCents: number, tier: 'standard' | 'high_volume') => { percent: number; loseCost: number; winCost: number } {
  const start = app.indexOf('function breakEvenPercent(');
  if (start < 0) throw new Error('breakEvenPercent not found');
  const open = app.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}' && --depth === 0) {
      return new Function(`return (${app.slice(start, index + 1)});`)() as ReturnType<typeof clientFunction>;
    }
  }
  throw new Error('breakEvenPercent body is incomplete');
}

test('client break-even math matches policy across amounts, offers and fee tiers', () => {
  const calculate = clientFunction();
  const amounts = new Set<number>();
  for (let amount = 1; amount <= 20000; amount += 1000) amounts.add(amount);
  for (const amount of [2999, 3000, 3001, 20000]) amounts.add(amount);
  for (const tier of ['standard', 'high_volume'] as const) {
    for (const disputedCents of amounts) {
      for (let offerCents = 1; offerCents <= disputedCents + 100; offerCents += 1) {
        const client = calculate(disputedCents, offerCents, tier);
        const server = breakEven(fromCents(disputedCents), fromCents(offerCents), tier);
        expect(client).toEqual({ percent: server!.percent, loseCost: Number(server!.loseCost.replace('.', '')), winCost: Number(server!.winCost.replace('.', '')) });
      }
    }
  }
}, 60000);

test('client copy includes honest threshold, USD gate and Seller Protection wording', () => {
  expect(app).toContain('unless you would win at least ${percent}% of the time');
  expect(app).toContain('costs less than fighting only if you would lose.');
  expect(app).toContain("Kept computes break-even from PayPal's USD fee table only; this dispute is in ${currency}.");
  expect(app).toContain('This assumes PayPal does not find Seller Protection met. If it does, you may keep the full purchase amount');
});
