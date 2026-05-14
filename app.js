// =========================================
// CANADIAN RETIREMENT CALCULATOR - app.js
// =========================================

// --- CONSTANTS ---

const CPP_MAX_MONTHLY_AT_65 = 1364;   // Maximum CPP at age 65 (2024)
const OAS_MAX_MONTHLY       = 713;    // Maximum OAS at age 65 (2024)
const OAS_FULL_YEARS        = 40;     // Years in Canada needed for full OAS

// Lifestyle presets for the Retirement Goals section.
// Each preset pre-fills the monthly goal input and shows context from Stats Canada.
const LIFESTYLE_PRESETS = {
  low:         { monthly: 3000, hint: "Low: ~$3,000/month — Statistics Canada median retiree individual spend (~$36K/year)" },
  comfortable: { monthly: 5000, hint: "Comfortable: ~$5,000/month — common financial planner target (~$60K/year)" },
  high:        { monthly: 8000, hint: "High: ~$8,000/month — upper-quartile lifestyle (~$96K/year)" },
};

// --- SHARED STATE ---
// All tabs read/write here. The Dashboard reads from this object — never
// directly from the DOM — so it stays consistent regardless of which tab is active.
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
  },
  hasRetirementData: false,
  hasBudgetData: false,
};


// --- HELPER FUNCTIONS ---

// Formats a number as Canadian dollars: 1234.5 → "$1,235"
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Reads the value of an HTML input field and converts it to a number.
function getInput(id) {
  return parseFloat(document.getElementById(id).value) || 0;
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

// Future value with regular contributions: FV = P(1+r)^n + C × [((1+r)^n - 1) / r]
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

// Annuity withdrawal: PMT = PV × r / (1 - (1+r)^-n)
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

// Core math shared between calculate() and syncRetirementState().
// Returns an object with all computed values in nominal dollars.
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

  const rrspBalance  = getInput("rrsp-balance");
  const rrspContrib  = getInput("rrsp-contribution");
  const rrspReturn   = getInput("rrsp-return");
  const tfsaBalance  = getInput("tfsa-balance");
  const tfsaContrib  = getInput("tfsa-contribution");
  const tfsaReturn   = getInput("tfsa-return");
  const nonregBalance = getInput("nonreg-balance");
  const nonregContrib = getInput("nonreg-contribution");
  const nonregReturn  = getInput("nonreg-return");
  const cashBalance  = getInput("cash-balance");
  const cashContrib  = getInput("cash-contribution");
  const cashReturn   = getInput("cash-return");

  if (retirementAge <= currentAge) return null;

  const yearsToRetirement = retirementAge - currentAge;

  // CPP uses years contributed so far + remaining working years
  const effectiveCppYears = Math.min(cppYears + yearsToRetirement, 47);

  const rrspAt   = calculateSavingsAtRetirement(rrspBalance,   rrspContrib,   rrspReturn,   yearsToRetirement);
  const tfsaAt   = calculateSavingsAtRetirement(tfsaBalance,   tfsaContrib,   tfsaReturn,   yearsToRetirement);
  const nonregAt = calculateSavingsAtRetirement(nonregBalance, nonregContrib, nonregReturn, yearsToRetirement);
  const cashAt   = calculateSavingsAtRetirement(cashBalance,   cashContrib,   cashReturn,   yearsToRetirement);

  const projectedSavings = rrspAt + tfsaAt + nonregAt + cashAt;

  // Weighted average return rate across all accounts at retirement
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
    // Per-account inputs for chart
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
}

function syncBudgetState() {
  const CATEGORY_IDS = ["housing", "food", "transport", "health", "personal", "entertainment", "family", "other"];
  let monthlyTotal = 0;
  CATEGORY_IDS.forEach(cat => {
    monthlyTotal += getInput(`budget-total-${cat}`);
  });
  appState.budget = {
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
  };
  appState.hasBudgetData = monthlyTotal > 0;
}


// --- MAIN CALCULATE FUNCTION ---
// Runs when the user clicks "Calculate My Retirement".
// Uses computeRetirement() for the math, then writes all results to the DOM
// and renders the chart.

function calculate() {
  const r = computeRetirement();

  if (!r) {
    alert("Retirement age must be greater than your current age.");
    return;
  }

  const adj = (v) => r.showRealDollars && r.inflationRate > 0
    ? toRealDollars(v, r.inflationRate, r.yearsToRetirement) : v;

  // Per-account breakdown
  document.getElementById("rrsp-result").textContent   = formatCurrency(adj(r.rrspAt));
  document.getElementById("tfsa-result").textContent   = formatCurrency(adj(r.tfsaAt));
  document.getElementById("nonreg-result").textContent = formatCurrency(adj(r.nonregAt));
  document.getElementById("cash-result").textContent   = formatCurrency(adj(r.cashAt));

  // Combined results
  document.getElementById("cpp-result").textContent             = formatCurrency(adj(r.cppMonthly));
  document.getElementById("oas-result").textContent             = formatCurrency(adj(r.oasMonthly));
  document.getElementById("savings-result").textContent         = formatCurrency(adj(r.projectedSavings));
  document.getElementById("savings-monthly-result").textContent = formatCurrency(adj(r.savingsMonthly));
  document.getElementById("total-result").textContent           = formatCurrency(adj(r.totalMonthly));
  document.getElementById("annual-result").textContent          = formatCurrency(adj(r.totalAnnual));

  // Context line
  const contextEl = document.getElementById("results-context");
  if (r.showRealDollars && r.inflationRate > 0) {
    contextEl.textContent = `Showing in today's dollars (adjusted for ${r.inflationRate}% annual inflation over ${r.yearsToRetirement} years).`;
  } else {
    contextEl.textContent = `Showing in future (nominal) dollars at retirement age ${r.retirementAge}.`;
  }

  // Inflation comparison note
  const inflationNote = document.getElementById("inflation-note");
  if (r.showRealDollars && r.inflationRate > 0) {
    document.getElementById("nominal-total-result").textContent = formatCurrency(r.totalMonthly);
    inflationNote.classList.remove("hidden");
  } else {
    inflationNote.classList.add("hidden");
  }

  // Show results and scroll to them
  const resultsDiv = document.getElementById("results");
  resultsDiv.classList.remove("hidden");
  resultsDiv.scrollIntoView({ behavior: "smooth", block: "start" });

  // Chart
  renderChart(r.currentAge, r.yearsToRetirement, r.inflationRate, r.showRealDollars,
    r.rrsp, r.tfsa, r.nonreg, r.cash);

  // Keep shared state in sync
  syncRetirementState();
  renderDashboard();
}


// --- CHART ---

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

  // --- Readiness ---
  const ratio = r.monthlyGoal > 0 ? r.totalMonthly / r.monthlyGoal : 1;
  const gap   = r.totalMonthly - r.monthlyGoal;

  let readinessText, readinessClass;
  if (ratio >= 1.0) {
    readinessText  = "On Track";
    readinessClass = "readiness-dot--green";
  } else if (ratio >= 0.75) {
    readinessText  = "Close";
    readinessClass = "readiness-dot--yellow";
  } else {
    readinessText  = "Needs Attention";
    readinessClass = "readiness-dot--red";
  }

  const dot = document.getElementById("readiness-dot");
  dot.className = `readiness-dot ${readinessClass}`;
  document.getElementById("readiness-label").textContent = readinessText;

  // --- Gap / Surplus ---
  const gapEl = document.getElementById("dash-gap-surplus");
  gapEl.textContent = (gap >= 0 ? "+" : "") + formatCurrency(gap);
  gapEl.style.color = gap >= 0 ? "#38a169" : "#e53e3e";
  document.getElementById("dash-gap-hint").textContent =
    `Goal: ${formatCurrency(r.monthlyGoal)}/month · Projected: ${formatCurrency(r.totalMonthly)}/month`;

  // --- Income tiles ---
  document.getElementById("dash-cpp").textContent            = formatCurrency(r.cppMonthly);
  document.getElementById("dash-oas").textContent            = formatCurrency(r.oasMonthly);
  document.getElementById("dash-savings-monthly").textContent = formatCurrency(r.savingsMonthly);
  document.getElementById("dash-total-monthly").textContent  = formatCurrency(r.totalMonthly);

  // --- Budget spend ---
  if (appState.hasBudgetData) {
    document.getElementById("dash-budget-spend").textContent = formatCurrency(b.monthlyTotal);
    document.getElementById("dash-budget-hint").textContent =
      `${formatCurrency(b.annualTotal)}/year · Retirement goal: ${formatCurrency(r.monthlyGoal)}/month`;
  } else {
    document.getElementById("dash-budget-spend").textContent = "—";
    document.getElementById("dash-budget-hint").textContent  = "Enter your budget in the Budget tab";
  }

  // --- Savings Rate ---
  const monthlyIncome = r.annualIncome / 12;
  const savingsRate = monthlyIncome > 0
    ? Math.round((r.monthlyContributions / monthlyIncome) * 100)
    : 0;
  document.getElementById("dash-savings-rate").textContent = `${savingsRate}%`;

  // --- Key Facts ---
  document.getElementById("key-facts-list").innerHTML = `
    <li><span>Years to Retirement</span>                  <strong>${r.yearsToRetirement}</strong></li>
    <li><span>Total Savings Today</span>                   <strong>${formatCurrency(r.totalSavingsToday)}</strong></li>
    <li><span>Projected Savings at Retirement</span>       <strong>${formatCurrency(r.projectedSavings)}</strong></li>
    <li><span>Monthly Retirement Goal</span>               <strong>${formatCurrency(r.monthlyGoal)}</strong></li>
    <li><span>Projected Monthly Income</span>              <strong>${formatCurrency(r.totalMonthly)}</strong></li>
    <li><span>Monthly Savings Contributions</span>         <strong>${formatCurrency(r.monthlyContributions)}</strong></li>
  `;
}


// --- BUDGET FUNCTIONS ---

function updateBudgetTotalsDisplay() {
  const CATEGORY_IDS = ["housing", "food", "transport", "health", "personal", "entertainment", "family", "other"];
  let monthly = 0;
  CATEGORY_IDS.forEach(cat => { monthly += getInput(`budget-total-${cat}`); });
  document.getElementById("budget-monthly-total").textContent = formatCurrency(monthly);
  document.getElementById("budget-annual-total").textContent  = formatCurrency(monthly * 12);
}

function initBudgetExpandToggles() {
  document.querySelectorAll(".budget-expand-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const row    = btn.closest(".budget-row");
      const cat    = row.dataset.category;
      const panel  = document.getElementById(`budget-sub-${cat}`);
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", !isOpen);
      panel.hidden = isOpen;
    });
  });
}

function initBudgetSubitemSync() {
  // When sub-items change, sum them into the category total input
  document.querySelectorAll(".budget-subitems").forEach(panel => {
    panel.addEventListener("input", () => {
      const row        = panel.closest(".budget-row");
      const cat        = row.dataset.category;
      const totalInput = document.getElementById(`budget-total-${cat}`);
      let sum = 0;
      panel.querySelectorAll("input[type='number']").forEach(inp => {
        sum += parseFloat(inp.value) || 0;
      });
      totalInput.value = sum > 0 ? sum : 0;
      updateBudgetTotalsDisplay();
      syncBudgetState();
      renderDashboard();
    });
  });
}

function initBudgetCategoryInputs() {
  // When a category total changes directly, update the footer and state
  document.querySelectorAll(".budget-cat-input").forEach(inp => {
    inp.addEventListener("input", () => {
      updateBudgetTotalsDisplay();
      syncBudgetState();
      renderDashboard();
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
    });
  });
}


// --- LIVE UPDATES ---
// Attach input/change listeners to the calculator form so the Dashboard
// updates as the user types — no Calculate button required for the Dashboard.

function initLiveUpdates() {
  // Event delegation: one listener on the form catches all child inputs
  document.getElementById("calculator-form").addEventListener("input", () => {
    syncRetirementState();
    renderDashboard();
  });

  // Selects and checkboxes fire "change", not "input"
  document.getElementById("cpp-start-age").addEventListener("change", () => {
    syncRetirementState();
    renderDashboard();
  });
  document.getElementById("show-real").addEventListener("change", () => {
    syncRetirementState();
    renderDashboard();
  });
}


// --- BOOTSTRAP ---

document.addEventListener("DOMContentLoaded", () => {
  initTabSwitching();
  initLifestylePills();
  initBudgetExpandToggles();
  initBudgetCategoryInputs();
  initBudgetSubitemSync();
  initLiveUpdates();

  document.getElementById("calculate-btn").addEventListener("click", calculate);

  // Run an initial sync so the Dashboard shows the default form values immediately
  syncRetirementState();
  renderDashboard();
});
