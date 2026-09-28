# A working guide to Japanese tax for a foreign freelancer

Written for someone on a spouse visa, self-employed, invoicing foreign clients,
and filing their own blue return. It covers what the app calculates and why, in
the order the questions actually come up.

None of this is professional tax advice. Statutes are cited throughout so you can
check the reasoning or take a specific question to a 税理士.

---

## 1. Is your income foreign-source? Almost certainly not.

This is the question everything else depends on, and the intuitive answer is
wrong.

**Business income is sourced where the business is carried on**, not where the
client is. If you perform the work while physically in Japan, you have a permanent
establishment in Japan, the income is attributable to it, and it is
**国内源泉所得 — Japan-source income** under 所得税法 161条1項1号.

None of the following changes that:

- the client is a foreign company
- you invoiced in dollars
- the money was paid to a foreign bank
- you have never set foot in the client's country
- the contract is governed by foreign law

What *would* make it foreign-source is performing the work outside Japan, through
a business carried on outside Japan. Physically being elsewhere while working. If
part of an engagement was done abroad, that part is foreign-source and the income
must be apportioned — keep day-by-day records and your boarding passes, because
partial performance abroad is a standard audit trigger.

### Why people get this wrong

The non-permanent resident rules sound like they should shelter foreign-client
income, and plenty of forum advice says they do. They shelter foreign-*source*
income, which is a different thing. The rules are real and valuable; they just do
not apply to work you do at your desk in Japan.

---

## 2. What non-permanent resident status actually gets you

You are a **非永住者** if you are not a Japanese national and have had a 住所 or
居所 in Japan for five years or less within the previous ten (所得税法 2条1項4号).
The count is in elapsed time, not calendar years.

While that holds, you are taxed on:

- **all Japan-source income**, wherever in the world it was paid; plus
- **foreign-source income paid in Japan**, in full; plus
- **foreign-source income paid abroad**, only to the extent you remit money to
  Japan.

So the shelter covers foreign-source income that is both paid abroad and left
abroad. In practice that means:

| Genuinely shelterable | Not shelterable |
|---|---|
| Rent from property outside Japan | Freelance work done from Japan |
| Dividends from foreign companies | Employment performed in Japan |
| Interest on foreign accounts | Crypto gains (sourced at your residence) |
| **Capital gains on foreign securities** | Anything paid into a Japanese account |

### The one that matters most

**Capital gains on foreign securities.** While you are a 非永住者, selling
appreciated foreign stock and leaving the proceeds abroad is outside Japanese tax
entirely. After you cross five years, the same sale is fully taxable here —
including gains that accrued before you ever arrived in Japan.

If you hold anything appreciated abroad, the window before your crossover is the
single largest tax decision available to you. The app shows your crossover date
and warns as it approaches.

---

## 3. Money paid into a Japanese account

Foreign-source income paid directly into a Japanese bank account is **国内払い —
paid in Japan** — and taxable in full, immediately. There is no remittance analysis
because nothing needs to be remitted; it already arrived.

This matters if you have genuinely foreign-source income. Have it paid to a foreign
account and remit only what you need to live on. Income you leave abroad stays
outside the net.

For Japan-source freelance income it makes no difference at all. Taxable either
way.

---

## 4. What counts as a remittance

Wider than people expect (所得税法施行令 17条):

- bank transfers into Japan, including between your own accounts
- **spending in Japan on a card settled from a foreign account** — paying the bill
  from abroad does not help; the benefit arrived in Japan
- withdrawing yen in Japan from a foreign account
- carrying cash in
- a foreign party paying a Japanese bill on your behalf
- moving crypto to a Japanese exchange and selling it there

### The ordering rule

Remittances are deemed to consist **first** of Japan-source income that was paid
abroad, and only the remainder brings in foreign-source income. Since Japan-source
income is already fully taxable, that part of a remittance adds no new tax.

Worked example. In one year you have ¥1,000,000 of Japan-source income paid to a
foreign account, ¥5,000,000 of foreign-source income paid abroad, and you remit
¥3,000,000:

- ¥1,000,000 of the remittance is absorbed by the Japan-source income — already
  taxable, no change
- the remaining ¥2,000,000 brings ¥2,000,000 of foreign-source income into tax
- total taxable: ¥3,000,000
- still sheltered: ¥3,000,000

The app implements this exactly and shows the working.

---

## 5. The blue return is worth about ¥215,000 a year

Four filing postures, on roughly ¥9,000,000 of revenue:

| | Deduction | Requires |
|---|---|---|
| 白色申告 | ¥0 | almost nothing |
| 青色申告 simple | ¥100,000 | single-entry cash book |
| 青色申告 double entry, paper | ¥550,000 | double-entry books + balance sheet |
| **青色申告 double entry, e-Tax** | **¥650,000** | the above, filed electronically |

The last ¥100,000 is free: same books, you just file through e-Tax instead of on
paper.

Blue status also gives you:

- **loss carry-forward** for three years
- **family salary** (青色事業専従者給与) deductible with no statutory cap
- **immediate write-off of assets under ¥300,000**, up to ¥3,000,000 a year
- a bad-debt reserve (貸倒引当金)

### Two forms, one hard deadline

- **開業届** — within one month of starting business
- **青色申告承認申請書** — by **March 15** of the year you want it to apply to, or
  within two months of starting

Miss the second and you file white for the entire year. There is no late filing and
no exception. This is the single most expensive deadline in Japanese
self-employment and it is missed constantly.

---

## 6. Every levy you will face

### 所得税 — national income tax
Progressive, 5% to 45%. Plus **復興特別所得税** at 2.1% of the income tax,
running through 2037.

### 住民税 — resident tax
A flat 10% (4% prefectural + 6% municipal) plus about ¥5,000 per capita. Billed
from **June of the following year**, on the previous year's income, in four
instalments.

This is the levy that hurts. A strong year is followed by twelve months of bills
calculated on it, whether or not the following year is any good.

### 個人事業税 — enterprise tax
5% for most categories, after a **¥2,900,000 allowance** — so many small
freelancers owe nothing. Two traps:

1. **The blue-return deduction does not apply here.** The base is your income
   *before* it.
2. **Whole professions are outside its scope.** Only the 70 categories listed in
   地方税法 72条の2 are taxed. Writing (文筆業), painting and composing are absent
   and pay nothing. Programming is usually treated as 請負業 and taxed — but the
   classification follows what your contracts describe. Worth a phone call to your
   prefectural tax office; it is 5% of your profit.

### 消費税 — consumption tax
Exempt while taxable sales **two years ago** were ¥10,000,000 or less. The two-year
lag catches people: you cross the line in a good year and the bill arrives in a
year that may be much leaner.

For foreign clients there is an important wrinkle. Services consumed outside Japan
are **輸出免税 — export-exempt**, meaning *zero-rated*, not exempt. They count
toward the ¥10,000,000 threshold but carry no output tax, and you can still reclaim
the consumption tax on your Japanese costs. If most of your revenue is export-exempt
and you register, you may end up in **refund** position.

If that applies, choose 一般課税. Simplified filing (簡易課税) cannot produce a
refund.

### 国民健康保険 — national health insurance
Income-based, uncapped until it hits municipal ceilings, and usually the largest
single line for a mid-income freelancer. Rates differ in every municipality and
change each April.

**Check whether you qualify for 文芸美術国民健康保険組合.** It charges a flat
premium of roughly ¥21,100 a month regardless of income — against an income-based
municipal premium that can exceed ¥900,000 a year. Eligibility runs through
membership of an affiliated professional association, covering design,
illustration, writing, photography, translation and several adjacent creative
trades. For an eligible freelancer it is often the largest single saving available.

### 国民年金 — national pension
Flat, ¥17,510 a month for FY2025. Fully deductible.

Add **付加年金**: ¥400 a month buys ¥200 × months of extra annual pension, for
life. Forty years costs ¥192,000 and returns ¥96,000 every year forever — it breaks
even after two years of collecting. There is no better-value option open to you.

---

## 7. The two biggest voluntary deductions

Both fall under 小規模企業共済等掛金控除, both fully deductible, and they have
**separate ceilings** so you can use both.

**小規模企業共済** — up to ¥840,000 a year. Use this first. The money remains
yours and comes back as a lump sum when you close the business or retire, taxed
then under the far gentler 退職所得 rules. You can pause contributions if cash gets
tight, and prepay up to twelve months in December to pull a deduction into the
current year.

**iDeCo** — up to ¥816,000 a year as a 第1号被保険者. Same deduction, but locked
until you are 60 with no hardship access. Note the ¥68,000 monthly ceiling is
shared with 国民年金基金 and 付加年金.

Together: up to ¥1,656,000 a year of deductible contributions. At a 35% marginal
rate that is about ¥580,000 of tax, against money you still own.

---

## 8. 家事按分 — claiming part of your home

If you work from home, a proportion of your household costs is deductible: rent,
electricity, gas, water, internet, phone.

Apportion each cost on a defensible basis and **write the basis down once**:

- **rent** — by floor area. "Work room 12m² of 48m² total" is 25%.
- **utilities** — by working hours, or the same basis as rent
- **internet and phone** — by usage; 50–80% is normal for someone working from
  home

Typical claims: 20–30% of rent, 30–50% of utilities, 50–80% of communications.

The app posts the private share to **事業主貸** rather than discarding it, so your
bank balance still reconciles and an auditor can see exactly what you did.

---

## 9. Equipment: the timing decision

| Cost | Options |
|---|---|
| under ¥100,000 | expense immediately as 消耗品費 |
| ¥100,000–¥199,999 | 一括償却資産: one third a year for three years, **purchase month ignored** |
| under ¥300,000 | blue filers: expense the whole cost now (少額減価償却資産の特例), up to ¥3,000,000 a year |
| ¥300,000 and over | depreciate over the statutory life — four years for a laptop |

This is a timing choice, not a total-amount choice. Take the deduction now if this
year's income is high; spread it if you expect better years ahead, since a
deduction is worth more against a higher marginal rate.

The asset must be **in service** by December 31, not merely ordered.

---

## 10. Exchange rates

Every foreign-currency transaction must be booked in yen at the rate prevailing on
the transaction date (所得税基本通達 57の3-2). Strictly: **TTB for income**, TTS for
payments, TTM acceptable if applied consistently for the whole year. Your own
bank's published rates are the intended source.

**But the strongest evidence is what your bank actually credited.** When your bank
converts incoming dollars itself, the yen on your statement *is* the correct
booking amount. Nothing to look up, nothing to argue about. That is what the app
asks for first.

Record the conversion fee separately. It is a deductible 支払手数料, and keeping it
separate stops the fee disguising itself as a worse exchange rate.

**Rubles** need care: Japanese banks generally do not publish a ruble TTB. Derive a
cross rate through the dollar — RUB/USD from the Central Bank of Russia, then
USD/JPY from your bank's TTB for the same date — and record both legs. The app has
a helper for this. Where rubles land in a Japanese account after conversion, always
prefer the actual credited yen instead.

Pick one convention and hold it all year. Mixing TTM and TTB breaks the consistency
condition that makes TTM acceptable at all.

---

## 11. The cash-flow trap

Japanese tax arrives *after* the year that generated it, spread across the
following twelve months:

| When | What |
|---|---|
| March 15 | income tax balance |
| March 31 | consumption tax |
| June | resident tax and health insurance assessed |
| July 31 | first 予定納税 prepayment |
| August 31 | enterprise tax, first half |
| November 30 | second prepayment, and enterprise tax second half |
| June–March | health insurance across roughly ten instalments |

**予定納税** catches nearly every second-year freelancer. If this year's tax
reaches ¥150,000, the tax office bills you one third in July and one third in
November of next year, as a prepayment. Nobody warns you. If next year is clearly
worse, you can apply to reduce it with a 予定納税額の減額申請 by July 15.

The technique that solves all of this: move your monthly set-aside into a separate
account and treat it as gone. Freelancers who do this are never surprised. The app
calculates the figure.

---

## 12. Things you cannot deduct

- income tax and resident tax
- **your own pension and health insurance** — these are personal deductions
  (社会保険料控除) on your return, not business expenses. Claiming both is a common
  and visible error.
- your own life or medical insurance — personal deduction, capped
- your own salary — a sole proprietor has none; money you take out is 事業主貸
- fines and traffic tickets
- everyday clothing, including suits
- meals eaten alone while working
- Japanese language lessons, unless specifically required for the work you are paid
  for
- commuting to your own home office

---

## 13. Records

Seven years for journals, ledgers, invoices and receipts.

Since January 2024, anything received **electronically must be stored
electronically**, with searchable date, amount and counterparty. Printing a PDF
invoice and filing the paper no longer satisfies 電子帳簿保存法.

Name files consistently — `2025-03-15_northwind_742300.pdf` — keep one folder per
year, and keep the app's JSON export alongside them.

---

## 14. Your first year, in order

1. File **開業届** within a month of starting.
2. File **青色申告承認申請書** — within two months of starting, or by March 15.
3. Open a separate bank account for business. Not legally required; it makes
   everything afterwards easier.
4. Set your 家事按分 percentages once and write down the basis.
5. Register for **e-Tax** — it is worth ¥100,000 of deduction.
6. Start **小規模企業共済** as soon as you can afford it.
7. Add **付加年金** at the city hall pension desk.
8. Work out your monthly set-aside and automate the transfer.
9. Check whether **文芸美術国民健康保険組合** covers your trade.
10. Ask your prefectural tax office which enterprise tax category applies.

---

## Statutes referenced

| Topic | Reference |
|---|---|
| Scope of taxation, 非永住者 | 所得税法 7条1項2号 |
| Definition of 非永住者 | 所得税法 2条1項4号 |
| Japan-source income | 所得税法 161条 |
| Foreign-source income | 所得税法 95条4項 |
| Remittance ordering | 所得税法施行令 17条 |
| Income tax rates | 所得税法 89条 |
| Blue return deduction | 租税特別措置法 25条の2 |
| Blue return application | 所得税法 144条 |
| Family salary | 所得税法 57条 |
| Small enterprise mutual aid, iDeCo | 所得税法 75条 |
| Enterprise tax | 地方税法 72条の2 |
| Consumption tax exemption | 消費税法 9条 |
| Export exemption | 消費税法 7条 |
| Simplified consumption tax | 消費税法 37条 |
| Prepayments | 所得税法 104条, 111条 |
| Foreign currency conversion | 所得税基本通達 57の3-2 |
| Small asset write-off | 租税特別措置法 28条の2 |
| Electronic record keeping | 電子帳簿保存法 7条 |

Primary source for everything: **[国税庁 (NTA)](https://www.nta.go.jp/)**. Their
タックスアンサー pages are clear and authoritative, and many have English versions.
