// =========================================
// CANADIAN RETIREMENT CALCULATOR - app.js
// =========================================

// --- CONSTANTS ---

const CPP_MAX_MONTHLY_AT_65 = 1364;   // Maximum CPP at age 65 (2024)
const OAS_MAX_MONTHLY       = 713;    // Maximum OAS at age 65 (2024)
const OAS_FULL_YEARS        = 40;     // Years in Canada needed for full OAS

// Lifestyle presets for the Retirement Goals section.
const LIFESTYLE_PRESETS = {
  low:         { monthly: 3000, hint: "Low: ~$3,000/month — Statistics Canada median retiree individual spend (~$36K/year)" },
  comfortable: { monthly: 5000, hint: "Comfortable: ~$5,000/month — common financial planner target (~$60K/year)" },
  high:        { monthly: 8000, hint: "High: ~$8,000/month — upper-quartile lifestyle (~$96K/year)" },
};

// Budget category metadata: order, label, and color (must match HTML dots)
const BUDGET_CATEGORIES = [
  { id: "housing",       label: "Housing",       color: "#3b82f6" },
  { id: "food",          label: "Food",           color: "#22c55e" },
  { id: "transport",     label: "Transport",      color: "#f97316" },
  { id: "health",        label: "Health",         color: "#06b6d4" },
  { id: "personal",      label: "Personal",       color: "#8b5cf6" },
  { id: "entertainment", label: "Entertainment",  color: "#ec4899" },
  { id: "family",        label: "Family",         color: "#eab308" },
  { id: "other",         label: "Other",          color: "#94a3b8" },
];

// Default values for all calculator inputs (used for reset + initial load)
const DEFAULTS = {
  "current-age":       "35",
  "retirement-age":    "65",
  "withdrawal-years":  "25",
  "annual-income":     "75000",
  "monthly-goal":      "5000",
  "cpp-years":         "10",
  "cpp-start-age":     "65",
  "oas-years":         "40",
  "inflation-rate":    "2.5",
  "show-real":         true,
  "rrsp-balance":      "50000",
  "rrsp-contribution": "500",
  "rrsp-return":       "5",
  "tfsa-balance":      "0",
  "tfsa-contribution": "0",
  "tfsa-return":       "5",
  "nonreg-balance":    "0",
  "nonreg-contribution": "0",
  "nonreg-return":     "5",
  "cash-balance":      "0",
  "cash-contribution": "0",
  "cash-return":       "2",
};

// localStorage key
const STORAGE_KEY = "retirement-calc-state";

// --- BC + FEDERAL TAX ESTIMATE (2024) ---

function calculateBCAfterTaxAnnual(grossIncome) {
  const FEDERAL_BPA = 15705;
  const BC_BPA      = 11981;

  const FEDERAL_BRACKETS = [
    { limit:  55867,   rate: 0.15   },
    { limit: 111733,   rate: 0.205  },
    { limit: 154906,   rate: 0.26   },
    { limit: 220000,   rate: 0.29   },
    { limit: Infinity, rate: 0.33   },
  ];
  const BC_BRACKETS = [
    { limit:  45654,   rate: 0.0506 },
    { limit:  91310,   rate: 0.077  },
    { limit: 104835,   rate: 0.105  },
    { limit: 127299,   rate: 0.1229 },
    { limit: 172602,   rate: 0.147  },
    { limit: 240716,   rate: 0.168  },
    { limit: Infinity, rate: 0.205  },
  ];

  function applyBrackets(taxable, brackets) {
    if (taxable <= 0) return 0;
    let tax = 0, prev = 0;
    for (const b of brackets) {
      if (taxable <= prev) break;
      tax += (Math.min(taxable, b.limit) - prev) * b.rate;
      prev = b.limit;
    }
    return tax;
  }

  const fedTax = applyBrackets(Math.max(0, grossIncome - FEDERAL_BPA), FEDERAL_BRACKETS);
  const bcTax  = applyBrackets(Math.max(0, grossIncome - BC_BPA),      BC_BRACKETS);
  return Math.max(0, grossIncome - fedTax - bcTax);
}

function calculateAfterTaxMonthly(grossAnnual) {
  return calculateBCAfterTaxAnnual(grossAnnual) / 12;
}

function updateAfterTaxIncomeHint() {
  const el = document.getElementById("after-tax-income-hint");
  if (!el) return;
  const gross = getInput("annual-income");
  if (gross <= 0) {
    el.textContent = "Enter your gross income to see estimated after-tax monthly income.";
    return;
  }
  const monthly = Math.round(calculateAfterTaxMonthly(gross));
  el.textContent =
    `Estimated after-tax monthly income: ${formatCurrency(monthly)} ` +
    `(BC resident, 2024 federal + provincial rates, basic personal amounts only — estimate)`;
}

// --- SHARED STATE ---
const appState = {
  retirement: {
    currentAge: 35,
    retirementAge: 65,
    yearsToRetirement: 30,
    withdrawalYears: 25,
    annualIncome: 75000,
    monthlyGoal: 5000,
    cppMonthly: 0,
    oasMonthly: 0,
    savingsMonthly: 0,
    totalMonthly: 0,
    totalSavingsToday: 0,
    projectedSavings: 0,
    monthlyContributions: 0,
  },
  budget: {
    monthlyTotal: 0,
    annualTotal: 0,
    categories: {},   // { housing: 0, food: 0, ... }
  },
  hasRetirementData: false,
  hasBudgetData: false,
};


// --- HELPER FUNCTIONS ---

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Read a text-based formula input as a number
function getInput(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  return evaluateFormulaInput(el.value);
}

// Safe formula evaluator: only allows digits, spaces, . + - * / ( )
function evaluateFormulaInput(raw) {
  if (raw === "" || raw == null) return 0;
  const sanitized = String(raw).replace(/[^0-9\s\.\+\-\*\/\(\)]/g, "");
  if (sanitized.trim() === "") return 0;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + sanitized + ')')();
    if (typeof result === "number" && isFinite(result)) return result;
    return 0;
  } catch {
    return 0;
  }
}


// --- FORMULA INPUT BEHAVIOUR ---

// On blur: evaluate the expression and replace the raw text with the result
function initFormulaInputs() {
  document.querySelectorAll(".formula-input").forEach(input => {
    input.addEventListener("blur", () => {
      const val = evaluateFormulaInput(input.value);
      if (input.value.trim() !== "" && input.value !== String(val)) {
        input.value = val > 0 ? String(val) : "";
      }
    });
  });
}


// --- CALCULATION FUNCTIONS ---

function calculateCPP(yearsContributed, startAge) {
  const MAX_CONTRIBUTION_YEARS = 47;
  const fraction = Math.min(yearsContributed / MAX_CONTRIBUTION_YEARS, 1);
  const baseAmount = CPP_MAX_MONTHLY_AT_65 * fraction;

  let adjustment = 1.0;
  if (startAge === 60) {
    adjustment = 1 - 0.006 * (65 - 60) * 12;  // -36%
  } else if (startAge === 70) {
    adjustment = 1 + 0.007 * (70 - 65) * 12;  // +42%
  }

  return baseAmount * adjustment;
}

function calculateOAS(yearsInCanada) {
  const fraction = Math.min(yearsInCanada / OAS_FULL_YEARS, 1);
  return OAS_MAX_MONTHLY * fraction;
}

// FV = P(1+r)^n + C × [((1+r)^n - 1) / r]
function calculateSavingsAtRetirement(currentSavings, monthlyContribution, annualReturnRate, yearsToRetirement) {
  if (yearsToRetirement <= 0) return currentSavings;

  const monthlyRate = annualReturnRate / 100 / 12;
  const months = yearsToRetirement * 12;

  if (monthlyRate === 0) {
    return currentSavings + monthlyContribution * months;
  }

  const growthFactor = Math.pow(1 + monthlyRate, months);
  return currentSavings * growthFactor + monthlyContribution * ((growthFactor - 1) / monthlyRate);
}

// PMT = PV × r / (1 - (1+r)^-n)
function calculateMonthlyWithdrawal(totalSavings, annualReturnRate, withdrawalYears) {
  const monthlyRate = annualReturnRate / 100 / 12;
  const months = withdrawalYears * 12;

  if (monthlyRate === 0 || months === 0) {
    return months > 0 ? totalSavings / months : 0;
  }

  return totalSavings * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
}

// Real Value = Nominal Value / (1 + inflationRate)^years
function toRealDollars(nominalAmount, annualInflationRate, years) {
  if (annualInflationRate === 0 || years === 0) return nominalAmount;
  return nominalAmount / Math.pow(1 + annualInflationRate / 100, years);
}

// Core math — shared between calculate() and syncRetirementState()
function computeRetirement() {
  const currentAge      = getInput("current-age");
  const retirementAge   = getInput("retirement-age");
  const withdrawalYears = getInput("withdrawal-years");
  const annualIncome    = getInput("annual-income");
  const monthlyGoal     = getInput("monthly-goal");
  const cppYears        = getInput("cpp-years");
  const cppStartAge     = parseInt(document.getElementById("cpp-start-age").value);
  const oasYears        = getInput("oas-years");
  const inflationRate   = getInput("inflation-rate");
  const showRealDollars = document.getElementById("show-real").checked;

  const rrspBalance   = getInput("rrsp-balance");
  const rrspContrib   = getInput("rrsp-contribution");
  const rrspReturn    = getInput("rrsp-return");
  const tfsaBalance   = getInput("tfsa-balance");
  const tfsaContrib   = getInput("tfsa-contribution");
  const tfsaReturn    = getInput("tfsa-return");
  const nonregBalance = getInput("nonreg-balance");
  const nonregContrib = getInput("nonreg-contribution");
  const nonregReturn  = getInput("nonreg-return");
  const cashBalance   = getInput("cash-balance");
  const cashContrib   = getInput("cash-contribution");
  const cashReturn    = getInput("cash-return");

  if (retirementAge <= currentAge) return null;

  const yearsToRetirement = retirementAge - currentAge;

  // CPP uses years contributed so far + remaining working years
  const effectiveCppYears = Math.min(cppYears + yearsToRetirement, 47);

  const rrspAt   = calculateSavingsAtRetirement(rrspBalance,   rrspContrib,   rrspReturn,   yearsToRetirement);
  const tfsaAt   = calculateSavingsAtRetirement(tfsaBalance,   tfsaContrib,   tfsaReturn,   yearsToRetirement);
  const nonregAt = calculateSavingsAtRetirement(nonregBalance, nonregContrib, nonregReturn, yearsToRetirement);
  const cashAt   = calculateSavingsAtRetirement(cashBalance,   cashContrib,   cashReturn,   yearsToRetirement);

  const projectedSavings = rrspAt + tfsaAt + nonregAt + cashAt;

  let weightedRate = 0;
  if (projectedSavings > 0) {
    weightedRate = (rrspAt * rrspReturn + tfsaAt * tfsaReturn + nonregAt * nonregReturn + cashAt * cashReturn) / projectedSavings;
  }

  const cppMonthly     = calculateCPP(effectiveCppYears, cppStartAge);
  const oasMonthly     = calculateOAS(oasYears);
  const savingsMonthly = calculateMonthlyWithdrawal(projectedSavings, weightedRate, withdrawalYears);
  const totalMonthly   = cppMonthly + oasMonthly + savingsMonthly;
  const totalAnnual    = totalMonthly * 12;
  const totalSavingsToday = rrspBalance + tfsaBalance + nonregBalance + cashBalance;
  const monthlyContributions = rrspContrib + tfsaContrib + nonregContrib + cashContrib;

  return {
    currentAge, retirementAge, yearsToRetirement, withdrawalYears,
    annualIncome, monthlyGoal, inflationRate, showRealDollars,
    rrspAt, tfsaAt, nonregAt, cashAt,
    projectedSavings, weightedRate,
    cppMonthly, oasMonthly, savingsMonthly, totalMonthly, totalAnnual,
    totalSavingsToday, monthlyContributions,
    rrsp:   { balance: rrspBalance,   contrib: rrspContrib,   rate: rrspReturn   },
    tfsa:   { balance: tfsaBalance,   contrib: tfsaContrib,   rate: tfsaReturn   },
    nonreg: { balance: nonregBalance, contrib: nonregContrib, rate: nonregReturn },
    cash:   { balance: cashBalance,   contrib: cashContrib,   rate: cashReturn   },
  };
}


// --- SHARED STATE SYNC ---

function syncRetirementState() {
  const r = computeRetirement();
  if (!r) return;

  const adj = (v) => r.showRealDollars && r.inflationRate > 0
    ? toRealDollars(v, r.inflationRate, r.yearsToRetirement) : v;

  appState.retirement = {
    currentAge:           r.currentAge,
    retirementAge:        r.retirementAge,
    yearsToRetirement:    r.yearsToRetirement,
    withdrawalYears:      r.withdrawalYears,
    annualIncome:         r.annualIncome,
    monthlyGoal:          r.monthlyGoal,
    cppMonthly:           adj(r.cppMonthly),
    oasMonthly:           adj(r.oasMonthly),
    savingsMonthly:       adj(r.savingsMonthly),
    totalMonthly:         adj(r.totalMonthly),
    totalSavingsToday:    r.totalSavingsToday,
    projectedSavings:     adj(r.projectedSavings),
    monthlyContributions: r.monthlyContributions,
  };
  appState.hasRetirementData = true;

  // Keep budget savings row in sync
  updateBudgetSavingsDisplay();
}

function syncBudgetState() {
  let monthlyTotal = 0;
  const categories = {};
  BUDGET_CATEGORIES.forEach(cat => {
    const val = getInput(`budget-total-${cat.id}`);
    categories[cat.id] = val;
    monthlyTotal += val;
  });
  appState.budget = {
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    categories,
  };
  appState.hasBudgetData = monthlyTotal > 0;
}

// Update the read-only savings display row in the Budget tab
function updateBudgetSavingsDisplay() {
  const el = document.getElementById("budget-savings-display");
  if (!el) return;
  const contrib = appState.retirement.monthlyContributions || 0;
  el.textContent = formatCurrency(contrib);
}


// --- MAIN CALCULATE FUNCTION ---

function calculate() {
  const r = computeRetirement();

  if (!r) {
    alert("Retirement age must be greater than your current age.");
    return;
  }

  const adj = (v) => r.showRealDollars && r.inflationRate > 0
    ? toRealDollars(v, r.inflationRate, r.yearsToRetirement) : v;

  document.getElementById("rrsp-result").textContent   = formatCurrency(adj(r.rrspAt));
  document.getElementById("tfsa-result").textContent   = formatCurrency(adj(r.tfsaAt));
  document.getElementById("nonreg-result").textContent = formatCurrency(adj(r.nonregAt));
  document.getElementById("cash-result").textContent   = formatCurrency(adj(r.cashAt));

  document.getElementById("cpp-result").textContent             = formatCurrency(adj(r.cppMonthly));
  document.getElementById("oas-result").textContent             = formatCurrency(adj(r.oasMonthly));
  document.getElementById("savings-result").textContent         = formatCurrency(adj(r.projectedSavings));
  document.getElementById("savings-monthly-result").textContent = formatCurrency(adj(r.savingsMonthly));
  document.getElementById("total-result").textContent           = formatCurrency(adj(r.totalMonthly));
  document.getElementById("annual-result").textContent          = formatCurrency(adj(r.totalAnnual));

  const contextEl = document.getElementById("results-context");
  if (r.showRealDollars && r.inflationRate > 0) {
    contextEl.textContent = `Showing in today's dollars (adjusted for ${r.inflationRate}% annual inflation over ${r.yearsToRetirement} years).`;
  } else {
    contextEl.textContent = `Showing in future (nominal) dollars at retirement age ${r.retirementAge}.`;
  }

  const inflationNote = document.getElementById("inflation-note");
  if (r.showRealDollars && r.inflationRate > 0) {
    document.getElementById("nominal-total-result").textContent = formatCurrency(r.totalMonthly);
    inflationNote.classList.remove("hidden");
  } else {
    inflationNote.classList.add("hidden");
  }

  const resultsDiv = document.getElementById("results");
  resultsDiv.classList.remove("hidden");
  resultsDiv.scrollIntoView({ behavior: "smooth", block: "start" });

  renderChart(r.currentAge, r.yearsToRetirement, r.inflationRate, r.showRealDollars,
    r.rrsp, r.tfsa, r.nonreg, r.cash);

  syncRetirementState();
  renderDashboard();
}


// --- SAVINGS GROWTH CHART ---

let savingsChartInstance = null;

function buildChartData(currentAge, yearsToRetirement, inflationRate, showRealDollars, rrsp, tfsa, nonreg, cash) {
  const labels      = [];
  const balanceData = [];
  const contribData = [];

  let rrspBal   = rrsp.balance;
  let tfsaBal   = tfsa.balance;
  let nonregBal = nonreg.balance;
  let cashBal   = cash.balance;
  let totalContributed = rrsp.balance + tfsa.balance + nonreg.balance + cash.balance;

  const rrspRate   = rrsp.rate   / 100 / 12;
  const tfsaRate   = tfsa.rate   / 100 / 12;
  const nonregRate = nonreg.rate / 100 / 12;
  const cashRate   = cash.rate   / 100 / 12;

  function growOneYear(balance, contrib, monthlyRate) {
    if (monthlyRate === 0) return balance + contrib * 12;
    const gf = Math.pow(1 + monthlyRate, 12);
    return balance * gf + contrib * ((gf - 1) / monthlyRate);
  }

  for (let year = 0; year <= yearsToRetirement; year++) {
    labels.push(`Age ${currentAge + year}`);

    const combined = rrspBal + tfsaBal + nonregBal + cashBal;
    const displayBalance = showRealDollars && inflationRate > 0
      ? toRealDollars(combined, inflationRate, year) : combined;
    const displayContrib = showRealDollars && inflationRate > 0
      ? toRealDollars(totalContributed, inflationRate, year) : totalContributed;

    balanceData.push(Math.round(displayBalance));
    contribData.push(Math.round(displayContrib));

    rrspBal   = growOneYear(rrspBal,   rrsp.contrib,   rrspRate);
    tfsaBal   = growOneYear(tfsaBal,   tfsa.contrib,   tfsaRate);
    nonregBal = growOneYear(nonregBal, nonreg.contrib, nonregRate);
    cashBal   = growOneYear(cashBal,   cash.contrib,   cashRate);
    totalContributed += (rrsp.contrib + tfsa.contrib + nonreg.contrib + cash.contrib) * 12;
  }

  return { labels, balanceData, contribData };
}

function renderChart(currentAge, yearsToRetirement, inflationRate, showRealDollars, rrsp, tfsa, nonreg, cash) {
  const { labels, balanceData, contribData } = buildChartData(
    currentAge, yearsToRetirement, inflationRate, showRealDollars, rrsp, tfsa, nonreg, cash
  );

  if (savingsChartInstance) savingsChartInstance.destroy();

  const ctx = document.getElementById("savings-chart").getContext("2d");

  savingsChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: showRealDollars ? "Total Balance (today's $)" : "Total Balance",
          data: balanceData,
          borderColor: "#c8102e",
          backgroundColor: "rgba(200, 16, 46, 0.08)",
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: "Contributions Only (no growth)",
          data: contribData,
          borderColor: "#a0aec0",
          backgroundColor: "transparent",
          fill: false,
          tension: 0.3,
          borderDash: [5, 5],
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.parsed.y;
              return ` ${context.dataset.label}: ${new Intl.NumberFormat("en-CA", {
                style: "currency", currency: "CAD", maximumFractionDigits: 0
              }).format(value)}`;
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => {
              if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
              if (value >= 1_000)    return `$${(value / 1_000).toFixed(0)}K`;
              return `$${value}`;
            },
          },
        },
      },
    },
  });
}


// --- DASHBOARD CHARTS ---

let retirementIncomeChartInstance = null;
let dashboardSpendingChartInstance = null;

function renderRetirementIncomeChart(cppMonthly, oasMonthly, savingsMonthly) {
  const ctx = document.getElementById("retirement-income-chart").getContext("2d");

  if (retirementIncomeChartInstance) retirementIncomeChartInstance.destroy();

  retirementIncomeChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["CPP", "OAS", "Savings"],
      datasets: [{
        label: "Monthly Income",
        data: [
          Math.round(cppMonthly),
          Math.round(oasMonthly),
          Math.round(savingsMonthly),
        ],
        backgroundColor: ["#3b82f6", "#22c55e", "#7c3aed"],
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatCurrency(ctx.parsed.y)}/month`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => formatCurrency(v),
          },
        },
      },
    },
  });
}

function renderDashboardSpendingChart(categories) {
  // Filter out zero categories
  const nonZero = BUDGET_CATEGORIES.filter(c => (categories[c.id] || 0) > 0);
  if (nonZero.length === 0) return;

  const canvas  = document.getElementById("dashboard-spending-chart");
  const emptyEl = document.getElementById("dashboard-spending-empty");

  canvas.style.display = "block";
  emptyEl.style.display = "none";

  if (dashboardSpendingChartInstance) dashboardSpendingChartInstance.destroy();

  const ctx = canvas.getContext("2d");

  dashboardSpendingChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: nonZero.map(c => c.label),
      datasets: [{
        data:            nonZero.map(c => categories[c.id] || 0),
        backgroundColor: nonZero.map(c => c.color),
        borderWidth: 2,
        borderColor: "#fff",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 }, padding: 10 } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`,
          },
        },
      },
    },
  });
}


// --- DASHBOARD INSIGHTS ---

function generateRetirementInsights(r, b) {
  const insights = [];

  const ratio = r.monthlyGoal > 0 ? r.totalMonthly / r.monthlyGoal : 1;
  const gap   = r.totalMonthly - r.monthlyGoal;
  const afterTaxMonthly = r.annualIncome > 0 ? calculateAfterTaxMonthly(r.annualIncome) : 0;
  const savingsRate = afterTaxMonthly > 0
    ? Math.round((r.monthlyContributions / afterTaxMonthly) * 100)
    : 0;

  // --- Readiness ---
  if (ratio >= 1.0) {
    const surplusAnnual = gap * 12;
    insights.push({
      level: "green",
      icon: "&#10003;",
      title: "You're on track for retirement",
      body: `Your projected income of ${formatCurrency(r.totalMonthly)}/month exceeds your ${formatCurrency(r.monthlyGoal)}/month goal by ${formatCurrency(gap)}/month (${formatCurrency(surplusAnnual)}/year). Keep it up.`,
    });
  } else if (ratio >= 0.75) {
    const shortfall = Math.abs(gap);
    insights.push({
      level: "yellow",
      icon: "&#9888;",
      title: "Close — but a gap remains",
      body: `You're projected to reach ${Math.round(ratio * 100)}% of your ${formatCurrency(r.monthlyGoal)}/month goal. Closing the ${formatCurrency(shortfall)}/month gap would need roughly ${formatCurrency(shortfall * r.withdrawalYears * 12)} more saved by retirement.`,
    });
  } else {
    const shortfall = Math.abs(gap);
    insights.push({
      level: "red",
      icon: "&#9888;",
      title: "Retirement gap needs attention",
      body: `Your projected ${formatCurrency(r.totalMonthly)}/month covers only ${Math.round(ratio * 100)}% of your ${formatCurrency(r.monthlyGoal)}/month goal. You have ${r.yearsToRetirement} years to close a ${formatCurrency(shortfall)}/month shortfall — increasing contributions now has the most impact.`,
    });
  }

  // --- Savings rate ---
  if (savingsRate < 5 && r.monthlyContributions > 0) {
    insights.push({
      level: "red",
      icon: "&#128200;",
      title: "Low savings rate",
      body: `You're saving ${savingsRate}% of your income. Financial planners typically recommend 10–15%. Increasing contributions by even $200/month over ${r.yearsToRetirement} years can meaningfully change your outcome.`,
    });
  } else if (savingsRate >= 5 && savingsRate < 10) {
    insights.push({
      level: "yellow",
      icon: "&#128200;",
      title: "Room to boost your savings rate",
      body: `Your ${savingsRate}% savings rate is a good start. Pushing toward 10–15% would significantly improve your projected income at retirement.`,
    });
  } else if (savingsRate >= 15) {
    insights.push({
      level: "green",
      icon: "&#128200;",
      title: "Strong savings rate",
      body: `Saving ${savingsRate}% of your income puts you well ahead of most Canadians. Maintaining this discipline over ${r.yearsToRetirement} years will compound meaningfully.`,
    });
  } else if (r.monthlyContributions === 0) {
    insights.push({
      level: "red",
      icon: "&#128200;",
      title: "No active savings contributions",
      body: `You haven't entered any monthly contributions. Even a small amount invested regularly will compound significantly over ${r.yearsToRetirement} years. Consider setting up automatic contributions to your RRSP or TFSA.`,
    });
  }

  // --- CPP timing ---
  const cppStartAge = parseInt(document.getElementById("cpp-start-age").value);
  if (cppStartAge === 60 && r.yearsToRetirement > 15) {
    insights.push({
      level: "yellow",
      icon: "&#128197;",
      title: "Consider delaying CPP",
      body: `Taking CPP at 60 reduces your benefit by 36%. With ${r.yearsToRetirement} years to retirement, you have time to build savings that bridge the gap to age 65 or 70, where CPP is 42% higher.`,
    });
  } else if (cppStartAge === 70) {
    insights.push({
      level: "green",
      icon: "&#128197;",
      title: "Maximizing CPP by waiting until 70",
      body: `Deferring to 70 gives you a 42% boost over the standard age-65 amount. This is often the best strategy if you expect to live into your 80s.`,
    });
  }

  // --- Total savings today ---
  if (r.totalSavingsToday === 0) {
    insights.push({
      level: "yellow",
      icon: "&#128181;",
      title: "No savings entered yet",
      body: `You haven't entered any existing savings balances. If you have money in an RRSP, TFSA, or other account, add it in the Retirement Calculator tab — it will meaningfully change your projections.`,
    });
  } else if (r.totalSavingsToday > 0 && r.projectedSavings < r.monthlyGoal * 12 * r.withdrawalYears * 0.3) {
    insights.push({
      level: "yellow",
      icon: "&#128181;",
      title: "Savings may not fully close the gap",
      body: `Your current ${formatCurrency(r.totalSavingsToday)} in savings is projected to grow to ${formatCurrency(r.projectedSavings)} — but your savings-based monthly income will only be ${formatCurrency(r.savingsMonthly)}. Government benefits (CPP + OAS) will need to cover most of your goal.`,
    });
  }

  // --- Budget vs goal (only if budget data is present) ---
  if (b.monthlyTotal > 0 && r.monthlyGoal > 0) {
    const spendRatio = b.monthlyTotal / r.monthlyGoal;
    if (spendRatio > 1.2) {
      insights.push({
        level: "red",
        icon: "&#128663;",
        title: "Your spending exceeds your retirement goal",
        body: `You currently spend ${formatCurrency(b.monthlyTotal)}/month — ${Math.round((spendRatio - 1) * 100)}% more than your ${formatCurrency(r.monthlyGoal)}/month retirement goal. You'll need to reduce spending before retiring or revise your goal upward.`,
      });
    } else if (spendRatio > 0.9) {
      insights.push({
        level: "yellow",
        icon: "&#128663;",
        title: "Current spend is close to your retirement goal",
        body: `Your monthly spend of ${formatCurrency(b.monthlyTotal)} is just below your ${formatCurrency(r.monthlyGoal)}/month retirement goal. That's realistic — most people spend slightly less after retiring — but leaves little buffer.`,
      });
    }
  }

  return insights;
}

function renderDashboardInsights(insights) {
  const container = document.getElementById("dashboard-insights");
  if (!insights.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = insights.map(ins => `
    <div class="insight-card insight-${ins.level}">
      <span class="insight-icon">${ins.icon}</span>
      <div>
        <strong class="insight-title">${ins.title}</strong>
        <p class="insight-body">${ins.body}</p>
      </div>
    </div>
  `).join("");
}


// --- BUDGET INSIGHTS ---

function generateBudgetInsights(categories, monthlyTotal) {
  if (monthlyTotal === 0) return [];
  const insights = [];

  // Percent of spend helper
  const pct = (cat) => monthlyTotal > 0 ? Math.round((categories[cat] / monthlyTotal) * 100) : 0;

  // Housing rule: should be ≤ 35% of total spend
  const housingPct = pct("housing");
  if (housingPct > 45) {
    insights.push({
      level: "red",
      title: `Housing is ${housingPct}% of your spending`,
      body: `Financial planners recommend keeping housing under 30–35% of take-home pay. At ${housingPct}%, this limits what you can save.`,
    });
  } else if (housingPct > 35) {
    insights.push({
      level: "yellow",
      title: `Housing is ${housingPct}% of your spending`,
      body: `Slightly above the recommended 30–35% threshold. If rent/mortgage is the driver, consider whether it can be reduced over time.`,
    });
  } else if (housingPct > 0) {
    insights.push({
      level: "green",
      title: `Housing is well-managed at ${housingPct}%`,
      body: `You're within the 30–35% guideline. This gives good room for savings and other priorities.`,
    });
  }

  // Dining out: flag if it's a large share of food spend
  const diningOut = getInput("budget-food-dining");
  const foodTotal = categories["food"] || 0;
  if (foodTotal > 0 && diningOut / foodTotal > 0.5) {
    insights.push({
      level: "yellow",
      title: "More than half your food budget is dining out",
      body: `You spend ${formatCurrency(diningOut)}/month dining out vs. ${formatCurrency(foodTotal - diningOut)}/month on groceries. Cooking more at home is one of the highest-return budget changes you can make.`,
    });
  }

  // Transport: high car costs
  const transportPct = pct("transport");
  if (transportPct > 20) {
    insights.push({
      level: "yellow",
      title: `Transport is ${transportPct}% of your spending`,
      body: `Cars are one of the largest expenses Canadians underestimate. ${formatCurrency(categories["transport"])}/month adds up to ${formatCurrency(categories["transport"] * 12)}/year — money that could go toward retirement savings.`,
    });
  }

  // Entertainment check
  const entPct = pct("entertainment");
  if (entPct > 15) {
    insights.push({
      level: "yellow",
      title: `Entertainment is ${entPct}% of your budget`,
      body: `At ${formatCurrency(categories["entertainment"])}/month, entertainment is a significant line item. A 20% trim here frees up ${formatCurrency(categories["entertainment"] * 0.2)}/month — consider redirecting some to savings.`,
    });
  }

  // Savings opportunity: how much could go to retirement
  const r = appState.retirement;
  if (r.monthlyContributions > 0 && monthlyTotal > 0) {
    const savingsRatioOfSpend = r.monthlyContributions / monthlyTotal;
    if (savingsRatioOfSpend < 0.1) {
      insights.push({
        level: "yellow",
        title: "Your savings are a small fraction of your spending",
        body: `You spend ${formatCurrency(monthlyTotal)}/month but only save ${formatCurrency(r.monthlyContributions)}/month (${Math.round(savingsRatioOfSpend * 100)}%). Consider the 50/30/20 rule: 50% needs, 30% wants, 20% savings.`,
      });
    }
  }

  // Largest single category callout
  const largest = BUDGET_CATEGORIES.reduce((best, c) => {
    return (categories[c.id] || 0) > (categories[best.id] || 0) ? c : best;
  }, BUDGET_CATEGORIES[0]);
  if (largest && pct(largest.id) > 40 && largest.id !== "housing") {
    insights.push({
      level: "yellow",
      title: `${largest.label} is your biggest expense at ${pct(largest.id)}%`,
      body: `${formatCurrency(categories[largest.id])}/month on ${largest.label.toLowerCase()} is a large share of total spending. Even a 10% reduction here saves ${formatCurrency(categories[largest.id] * 0.1)}/month.`,
    });
  }

  // Annual view reminder
  insights.push({
    level: "blue",
    title: `Your annual spend is ${formatCurrency(monthlyTotal * 12)}`,
    body: `Looking at spending annually helps spot patterns. If your retirement goal is ${formatCurrency(r.monthlyGoal)}/month, you'd need ${formatCurrency(r.monthlyGoal * 12)}/year — compare that to what you spend today.`,
  });

  return insights;
}

function renderBudgetInsights(insights) {
  const container = document.getElementById("budget-insights-list");
  if (!insights.length) {
    container.innerHTML = "<p class='hint'>Enter your spending to get personalized insights.</p>";
    return;
  }

  container.innerHTML = insights.map(ins => `
    <div class="insight-card insight-${ins.level}">
      <div>
        <strong class="insight-title">${ins.title}</strong>
        <p class="insight-body">${ins.body}</p>
      </div>
    </div>
  `).join("");
}


// --- BUDGET PIE CHART ---

let budgetPieChartInstance = null;

function renderBudgetPieChart(categories) {
  const nonZero = BUDGET_CATEGORIES.filter(c => (categories[c.id] || 0) > 0);
  if (nonZero.length === 0) return;

  if (budgetPieChartInstance) budgetPieChartInstance.destroy();

  const ctx = document.getElementById("budget-pie-chart").getContext("2d");

  budgetPieChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: nonZero.map(c => c.label),
      datasets: [{
        data:            nonZero.map(c => categories[c.id] || 0),
        backgroundColor: nonZero.map(c => c.color),
        borderWidth: 2,
        borderColor: "#fff",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: "right",
          labels: { font: { size: 12 }, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = Math.round((ctx.parsed / total) * 100);
              return ` ${ctx.label}: ${formatCurrency(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}


// --- DASHBOARD RENDER ---

function renderDashboard() {
  const emptyEl   = document.getElementById("dashboard-empty");
  const contentEl = document.getElementById("dashboard-content");

  if (!appState.hasRetirementData) {
    emptyEl.classList.remove("hidden");
    contentEl.classList.add("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  contentEl.classList.remove("hidden");

  const r = appState.retirement;
  const b = appState.budget;

  // --- Insights at top ---
  const insights = generateRetirementInsights(r, b);
  renderDashboardInsights(insights);

  // --- Readiness ---
  const ratio = r.monthlyGoal > 0 ? r.totalMonthly / r.monthlyGoal : 1;
  const gap   = r.totalMonthly - r.monthlyGoal;

  let readinessText, readinessClass, barClass;
  if (ratio >= 1.0) {
    readinessText  = "On Track";
    readinessClass = "readiness-dot--green";
    barClass       = "readiness-bar-fill--green";
  } else if (ratio >= 0.75) {
    readinessText  = "Close";
    readinessClass = "readiness-dot--yellow";
    barClass       = "readiness-bar-fill--yellow";
  } else {
    readinessText  = "Needs Attention";
    readinessClass = "readiness-dot--red";
    barClass       = "readiness-bar-fill--red";
  }

  const dot = document.getElementById("readiness-dot");
  dot.className = `readiness-dot ${readinessClass}`;
  document.getElementById("readiness-label").textContent = readinessText;

  // Progress bar
  const pct = Math.min(Math.round(ratio * 100), 100);
  const barFill = document.getElementById("readiness-bar-fill");
  const barPct  = document.getElementById("readiness-bar-pct");
  barFill.style.width = pct + "%";
  barFill.className   = `readiness-bar-fill ${barClass}`;
  barPct.textContent  = Math.round(ratio * 100) + "%";

  // --- Gap / Surplus ---
  const gapEl = document.getElementById("dash-gap-surplus");
  gapEl.textContent = (gap >= 0 ? "+" : "") + formatCurrency(gap);
  gapEl.className   = "dash-stat-value " + (gap >= 0 ? "dash-green" : "dash-red");
  document.getElementById("dash-gap-hint").textContent =
    `Goal: ${formatCurrency(r.monthlyGoal)}/month · Projected: ${formatCurrency(r.totalMonthly)}/month`;

  // --- Income tiles ---
  document.getElementById("dash-cpp").textContent             = formatCurrency(r.cppMonthly);
  document.getElementById("dash-oas").textContent             = formatCurrency(r.oasMonthly);
  document.getElementById("dash-savings-monthly").textContent = formatCurrency(r.savingsMonthly);
  document.getElementById("dash-total-monthly").textContent   = formatCurrency(r.totalMonthly);

  // --- Income bar chart ---
  renderRetirementIncomeChart(r.cppMonthly, r.oasMonthly, r.savingsMonthly);

  // --- Dashboard spending pie chart ---
  if (appState.hasBudgetData) {
    renderDashboardSpendingChart(b.categories);
    document.getElementById("dash-spending-chart-hint").textContent =
      `Your current ${formatCurrency(b.monthlyTotal)}/month — ${Math.round((b.monthlyTotal / r.monthlyGoal) * 100)}% of your retirement goal.`;
  }

  // --- Budget spend tile ---
  if (appState.hasBudgetData) {
    document.getElementById("dash-budget-spend").textContent = formatCurrency(b.monthlyTotal);
    document.getElementById("dash-budget-hint").textContent =
      `${formatCurrency(b.annualTotal)}/year · Retirement goal: ${formatCurrency(r.monthlyGoal)}/month`;
  } else {
    document.getElementById("dash-budget-spend").textContent = "—";
    document.getElementById("dash-budget-hint").textContent  = "Enter your budget in the Budget tab";
  }

  // --- Savings Rate ---
  const monthlyIncome = r.annualIncome > 0 ? calculateAfterTaxMonthly(r.annualIncome) : 0;
  const savingsRate = monthlyIncome > 0
    ? Math.round((r.monthlyContributions / monthlyIncome) * 100)
    : 0;
  const savingsRateEl = document.getElementById("dash-savings-rate");
  savingsRateEl.textContent = `${savingsRate}%`;
  savingsRateEl.className = "dash-stat-value " + (savingsRate >= 15 ? "dash-green" : savingsRate >= 10 ? "dash-yellow" : savingsRate >= 5 ? "dash-neutral" : "dash-red");

  // --- Key Facts ---
  document.getElementById("key-facts-list").innerHTML = `
    <li><span>Years to Retirement</span>                  <strong>${r.yearsToRetirement}</strong></li>
    <li><span>Total Savings Today</span>                   <strong>${formatCurrency(r.totalSavingsToday)}</strong></li>
    <li><span>Projected Savings at Retirement</span>       <strong>${formatCurrency(r.projectedSavings)}</strong></li>
    <li><span>Monthly Retirement Goal</span>               <strong>${formatCurrency(r.monthlyGoal)}</strong></li>
    <li><span>Projected Monthly Income</span>              <strong class="${ratio >= 1.0 ? "fact-green" : ratio >= 0.75 ? "fact-yellow" : "fact-red"}">${formatCurrency(r.totalMonthly)}</strong></li>
    <li><span>Monthly Savings Contributions</span>         <strong>${formatCurrency(r.monthlyContributions)}</strong></li>
  `;
}


// --- BUDGET FUNCTIONS ---

function updateBudgetTotalsDisplay() {
  let monthly = 0;
  BUDGET_CATEGORIES.forEach(cat => { monthly += getInput(`budget-total-${cat.id}`); });
  document.getElementById("budget-monthly-total").textContent = formatCurrency(monthly);
  document.getElementById("budget-annual-total").textContent  = formatCurrency(monthly * 12);
}

function updateBudgetVisuals() {
  syncBudgetState();
  const b = appState.budget;

  if (b.monthlyTotal > 0) {
    document.getElementById("budget-visuals").classList.remove("hidden");
    renderBudgetPieChart(b.categories);
    const budgetInsights = generateBudgetInsights(b.categories, b.monthlyTotal);
    renderBudgetInsights(budgetInsights);
  } else {
    document.getElementById("budget-visuals").classList.add("hidden");
  }

  renderDashboard();
}

function initBudgetExpandToggles() {
  document.querySelectorAll(".budget-expand-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const row    = btn.closest(".budget-row");
      const cat    = row.dataset.category;
      const panel  = document.getElementById(`budget-sub-${cat}`);
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!isOpen));
      panel.hidden = isOpen;
    });
  });
}

function initBudgetSubitemSync() {
  document.querySelectorAll(".budget-subitems").forEach(panel => {
    const row        = panel.closest(".budget-row");
    const cat        = row.dataset.category;
    const totalInput = document.getElementById(`budget-total-${cat}`);

    panel.querySelectorAll(".formula-input").forEach(subInput => {
      subInput.addEventListener("input", () => {
        let sum = 0;
        panel.querySelectorAll(".formula-input").forEach(inp => {
          sum += evaluateFormulaInput(inp.value);
        });
        totalInput.value = sum > 0 ? String(sum) : "";
        updateBudgetTotalsDisplay();
        updateBudgetVisuals();
        saveState();
      });
    });
  });
}

function reconcileBudgetSubitemTotals() {
  document.querySelectorAll(".budget-subitems").forEach(panel => {
    const row        = panel.closest(".budget-row");
    const cat        = row.dataset.category;
    const totalInput = document.getElementById(`budget-total-${cat}`);
    let sum = 0;
    panel.querySelectorAll(".formula-input").forEach(inp => {
      sum += evaluateFormulaInput(inp.value);
    });
    if (sum > 0) totalInput.value = String(sum);
  });
}

function initBudgetCategoryInputs() {
  document.querySelectorAll(".budget-cat-input").forEach(inp => {
    inp.addEventListener("input", () => {
      updateBudgetTotalsDisplay();
      updateBudgetVisuals();
      saveState();
    });
  });
}


// --- TAB SWITCHING ---

function initTabSwitching() {
  const tabs   = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => {
        t.classList.remove("tab-btn--active");
        t.setAttribute("aria-selected", "false");
      });
      panels.forEach(p => {
        p.hidden = true;
        p.classList.remove("tab-panel--active");
      });

      tab.classList.add("tab-btn--active");
      tab.setAttribute("aria-selected", "true");

      const targetPanel = document.getElementById(`tab-${tab.dataset.tab}`);
      targetPanel.hidden = false;
      targetPanel.classList.add("tab-panel--active");
    });
  });
}


// --- LIFESTYLE PILLS ---

function initLifestylePills() {
  const pills = document.querySelectorAll(".lifestyle-pill");
  pills.forEach(pill => {
    pill.addEventListener("click", () => {
      pills.forEach(p => p.classList.remove("lifestyle-pill--active"));
      pill.classList.add("lifestyle-pill--active");

      const preset = LIFESTYLE_PRESETS[pill.dataset.lifestyle];
      document.getElementById("monthly-goal").value = preset.monthly;
      document.getElementById("lifestyle-hint").textContent = preset.hint;

      syncRetirementState();
      renderDashboard();
      saveState();
    });
  });
}


// --- LIVE UPDATES ---

function initLiveUpdates() {
  document.getElementById("calculator-form").addEventListener("input", () => {
    updateAfterTaxIncomeHint();
    syncRetirementState();
    renderDashboard();
    saveState();
  });

  document.getElementById("cpp-start-age").addEventListener("change", () => {
    syncRetirementState();
    renderDashboard();
    saveState();
  });
  document.getElementById("show-real").addEventListener("change", () => {
    syncRetirementState();
    renderDashboard();
    saveState();
  });
}


// --- LOCALSTORAGE SAVE / LOAD / RESET ---

// All input IDs to persist (text formula inputs + checkbox + select)
const CALC_INPUT_IDS = [
  "current-age", "retirement-age", "withdrawal-years", "annual-income",
  "monthly-goal", "cpp-years", "cpp-start-age", "oas-years", "inflation-rate",
  "rrsp-balance", "rrsp-contribution", "rrsp-return",
  "tfsa-balance", "tfsa-contribution", "tfsa-return",
  "nonreg-balance", "nonreg-contribution", "nonreg-return",
  "cash-balance", "cash-contribution", "cash-return",
];

const BUDGET_INPUT_IDS = [
  "budget-total-housing", "budget-housing-rent", "budget-housing-utilities",
  "budget-housing-insurance", "budget-housing-property-tax", "budget-housing-maintenance",
  "budget-total-food", "budget-food-groceries", "budget-food-dining", "budget-food-coffee",
  "budget-total-transport", "budget-transport-car", "budget-transport-gas",
  "budget-transport-insurance", "budget-transport-transit", "budget-transport-parking",
  "budget-total-health", "budget-health-dental", "budget-health-rx",
  "budget-health-gym", "budget-health-therapy",
  "budget-total-personal", "budget-personal-clothing", "budget-personal-haircuts",
  "budget-personal-care",
  "budget-total-entertainment", "budget-entertainment-streaming", "budget-entertainment-hobbies",
  "budget-entertainment-events", "budget-entertainment-travel",
  "budget-total-family", "budget-family-childcare", "budget-family-pet",
  "budget-family-gifts", "budget-family-donations",
  "budget-total-other", "budget-other-misc", "budget-other-subscriptions",
];

function saveState() {
  const state = {};

  CALC_INPUT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    state[id] = el.value;
  });

  // Checkbox
  const showReal = document.getElementById("show-real");
  if (showReal) state["show-real"] = showReal.checked;

  BUDGET_INPUT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    state[id] = el.value;
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Silently fail if storage is unavailable
  }
}

function loadState() {
  let state;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    state = JSON.parse(raw);
  } catch (e) {
    return false;
  }

  // Restore calculator inputs
  CALC_INPUT_IDS.forEach(id => {
    if (!(id in state)) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = state[id];
  });

  // Restore checkbox
  if ("show-real" in state) {
    const el = document.getElementById("show-real");
    if (el) el.checked = state["show-real"];
  }

  // Restore budget inputs
  BUDGET_INPUT_IDS.forEach(id => {
    if (!(id in state)) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = state[id];
  });

  return true;
}

function _resetLifestylePillsToDefault() {
  document.querySelectorAll(".lifestyle-pill").forEach(p => {
    p.classList.toggle("lifestyle-pill--active", p.dataset.lifestyle === "comfortable");
  });
  document.getElementById("lifestyle-hint").textContent = LIFESTYLE_PRESETS.comfortable.hint;
}

function resetCalculator() {
  if (!confirm("Reset all calculator inputs to defaults?")) return;
  Object.entries(DEFAULTS).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.type === "checkbox" ? (el.checked = val) : (el.value = String(val));
  });
  _resetLifestylePillsToDefault();
  updateAfterTaxIncomeHint();
  document.getElementById("results").classList.add("hidden");
  syncRetirementState();
  renderDashboard();
  saveState();
}

function resetBudget() {
  if (!confirm("Reset all budget inputs to zero?")) return;
  BUDGET_INPUT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  updateBudgetTotalsDisplay();
  updateBudgetVisuals();
  renderDashboard();
  saveState();
}

function resetAll() {
  if (!confirm("Reset ALL inputs (calculator + budget) to defaults? This cannot be undone.")) return;
  Object.entries(DEFAULTS).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.type === "checkbox" ? (el.checked = val) : (el.value = String(val));
  });
  BUDGET_INPUT_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  _resetLifestylePillsToDefault();
  updateAfterTaxIncomeHint();
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  document.getElementById("results").classList.add("hidden");
  syncRetirementState();
  updateBudgetTotalsDisplay();
  updateBudgetVisuals();
  renderDashboard();
}

function initResetButton() {
  document.getElementById("reset-all-btn")        ?.addEventListener("click", resetAll);
  document.getElementById("reset-calculator-btn") ?.addEventListener("click", resetCalculator);
  document.getElementById("reset-budget-btn")     ?.addEventListener("click", resetBudget);
}


// --- BOOTSTRAP ---

document.addEventListener("DOMContentLoaded", () => {
  initTabSwitching();
  initLifestylePills();
  initBudgetExpandToggles();
  initBudgetCategoryInputs();
  initBudgetSubitemSync();
  initLiveUpdates();
  initFormulaInputs();
  initResetButton();

  document.getElementById("calculate-btn").addEventListener("click", calculate);

  // Restore saved state (if any), otherwise leave defaults
  const restored = loadState();

  // After page-restore, re-sum sub-items into category totals
  // (programmatic .value= assignments don't fire input events)
  if (restored) reconcileBudgetSubitemTotals();

  // Update after-tax income hint based on loaded/default value
  updateAfterTaxIncomeHint();

  // After loading, run all the startup syncs
  syncRetirementState();
  updateBudgetTotalsDisplay();
  updateBudgetVisuals();
  renderDashboard();
});
