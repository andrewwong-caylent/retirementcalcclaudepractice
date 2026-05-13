// =========================================
// CANADIAN RETIREMENT CALCULATOR - app.js
//
// This file contains all the logic that
// makes the calculator actually work.
// =========================================

// --- CONSTANTS ---
// These are the 2024 government benefit amounts.
// We define them as constants at the top so they're
// easy to find and update each year.

const CPP_MAX_MONTHLY_AT_65 = 1364;   // Maximum CPP at age 65 (2024)
const OAS_MAX_MONTHLY       = 713;    // Maximum OAS at age 65 (2024)
const OAS_FULL_YEARS        = 40;     // Years in Canada needed for full OAS


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
// document.getElementById("some-id") finds the element on the page.
// parseFloat() converts the text inside it to a decimal number.
function getInput(id) {
  return parseFloat(document.getElementById(id).value) || 0;
}


// --- CPP CALCULATION ---
// CPP is based on how many years you contributed and what age you start.
//
// The formula: estimate a "base" amount from your years of contributions,
// then apply the early/late adjustment for your chosen start age.

function calculateCPP(yearsContributed, startAge) {
  // Max contribution period is 47 years (age 18 to 65).
  // Your fraction of that determines your base amount.
  const MAX_CONTRIBUTION_YEARS = 47;
  const fraction = Math.min(yearsContributed / MAX_CONTRIBUTION_YEARS, 1);
  const baseAmount = CPP_MAX_MONTHLY_AT_65 * fraction;

  // Government rules for adjusting based on start age:
  //   Start at 60: reduced by 0.6% per month before 65 = 36% total reduction
  //   Start at 65: no adjustment
  //   Start at 70: increased by 0.7% per month after 65 = 42% total increase
  let adjustment = 1.0;
  if (startAge === 60) {
    adjustment = 1 - 0.006 * (65 - 60) * 12;  // 0.6% × 60 months
  } else if (startAge === 70) {
    adjustment = 1 + 0.007 * (70 - 65) * 12;  // 0.7% × 60 months
  }

  return baseAmount * adjustment;
}


// --- OAS CALCULATION ---
// OAS is simpler: it's based purely on years you lived in Canada after age 18.
// 40+ years = full amount. Fewer years = proportional amount.

function calculateOAS(yearsInCanada) {
  const fraction = Math.min(yearsInCanada / OAS_FULL_YEARS, 1);
  return OAS_MAX_MONTHLY * fraction;
}


// --- SAVINGS GROWTH CALCULATION ---
// This uses "compound interest" - your money grows, and then the growth
// also grows. It's one of the most important concepts in personal finance.
//
// Formula for future value with regular contributions:
//   FV = P(1+r)^n + C × [((1+r)^n - 1) / r]
//
// Where:
//   P = starting balance (principal)
//   r = monthly interest rate
//   n = number of months
//   C = monthly contribution

function calculateSavingsAtRetirement(currentSavings, monthlyContribution, annualReturnRate, yearsToRetirement) {
  if (yearsToRetirement <= 0) return currentSavings;

  const monthlyRate = annualReturnRate / 100 / 12;  // e.g. 5% → 0.05 → 0.004167
  const months = yearsToRetirement * 12;

  // If return rate is 0, no compounding - just add up contributions
  if (monthlyRate === 0) {
    return currentSavings + monthlyContribution * months;
  }

  const growthFactor = Math.pow(1 + monthlyRate, months);  // (1+r)^n

  // Current savings grow with compounding
  const grownSavings = currentSavings * growthFactor;

  // Future value of the ongoing contributions
  const contributionGrowth = monthlyContribution * ((growthFactor - 1) / monthlyRate);

  return grownSavings + contributionGrowth;
}


// --- MONTHLY WITHDRAWAL FROM SAVINGS ---
// Once retired, how much can you withdraw each month so the money
// lasts exactly "withdrawalYears" years?
//
// This is the "present value of an annuity" formula, solved for payment:
//   PMT = PV × r / (1 - (1+r)^-n)

function calculateMonthlyWithdrawal(totalSavings, annualReturnRate, withdrawalYears) {
  const monthlyRate = annualReturnRate / 100 / 12;
  const months = withdrawalYears * 12;

  if (monthlyRate === 0) {
    return totalSavings / months;
  }

  return totalSavings * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
}


// --- INFLATION ADJUSTMENT ---
// Inflation erodes purchasing power over time.
// "$4,000/month at retirement" sounds good, but if that's 30 years away,
// it only buys what ~$2,000 buys today (at 2.5% inflation).
//
// "Nominal" = the actual dollar number at that future date
// "Real"    = what that money is worth in today's dollars
//
// Formula: Real Value = Nominal Value / (1 + inflationRate)^years
//
// We use this to convert future amounts back to today's dollars.

function toRealDollars(nominalAmount, annualInflationRate, years) {
  if (annualInflationRate === 0 || years === 0) return nominalAmount;
  const inflationFactor = Math.pow(1 + annualInflationRate / 100, years);
  return nominalAmount / inflationFactor;
}


// --- MAIN CALCULATE FUNCTION ---
// This runs when the user clicks "Calculate My Retirement".
// It reads all the inputs, runs the calculations, and displays the results.

function calculate() {
  // 1. Read all the input values from the form
  const currentAge         = getInput("current-age");
  const retirementAge      = getInput("retirement-age");
  const annualIncome       = getInput("annual-income");
  const cppYears           = getInput("cpp-years");
  const cppStartAge        = parseInt(document.getElementById("cpp-start-age").value);
  const oasYears           = getInput("oas-years");
  const currentSavings     = getInput("current-savings");
  const monthlyContrib     = getInput("monthly-contribution");
  const returnRate         = getInput("return-rate");
  const withdrawalYears    = getInput("withdrawal-years");
  const inflationRate      = getInput("inflation-rate");
  // .checked reads whether a checkbox is ticked (true/false)
  const showRealDollars    = document.getElementById("show-real").checked;

  // 2. Basic validation
  if (retirementAge <= currentAge) {
    alert("Retirement age must be greater than your current age.");
    return;
  }

  const yearsToRetirement = retirementAge - currentAge;

  // 3. Run the calculations (all in nominal/future dollars first)
  const cppMonthly          = calculateCPP(cppYears, cppStartAge);
  const oasMonthly          = calculateOAS(oasYears);
  const savingsAtRetirement = calculateSavingsAtRetirement(
    currentSavings, monthlyContrib, returnRate, yearsToRetirement
  );
  const savingsMonthly      = calculateMonthlyWithdrawal(savingsAtRetirement, returnRate, withdrawalYears);
  const totalMonthly        = cppMonthly + oasMonthly + savingsMonthly;
  const totalAnnual         = totalMonthly * 12;

  // 4. Apply inflation adjustment if the toggle is on
  // We show the user either real (today's purchasing power) or nominal amounts.
  let displayCpp     = cppMonthly;
  let displayOas     = oasMonthly;
  let displaySavings = savingsAtRetirement;
  let displaySavingsMonthly = savingsMonthly;
  let displayTotal   = totalMonthly;
  let displayAnnual  = totalAnnual;

  if (showRealDollars && inflationRate > 0) {
    // Convert each amount from "future dollars" to "today's dollars"
    displayCpp            = toRealDollars(cppMonthly, inflationRate, yearsToRetirement);
    displayOas            = toRealDollars(oasMonthly, inflationRate, yearsToRetirement);
    displaySavings        = toRealDollars(savingsAtRetirement, inflationRate, yearsToRetirement);
    displaySavingsMonthly = toRealDollars(savingsMonthly, inflationRate, yearsToRetirement);
    displayTotal          = toRealDollars(totalMonthly, inflationRate, yearsToRetirement);
    displayAnnual         = toRealDollars(totalAnnual, inflationRate, yearsToRetirement);
  }

  // 5. Display the results
  document.getElementById("cpp-result").textContent              = formatCurrency(displayCpp);
  document.getElementById("oas-result").textContent              = formatCurrency(displayOas);
  document.getElementById("savings-result").textContent          = formatCurrency(displaySavings);
  document.getElementById("savings-monthly-result").textContent  = formatCurrency(displaySavingsMonthly);
  document.getElementById("total-result").textContent            = formatCurrency(displayTotal);
  document.getElementById("annual-result").textContent           = formatCurrency(displayAnnual);

  // 6. Show a context line so the user knows what mode they're in
  const contextEl = document.getElementById("results-context");
  if (showRealDollars && inflationRate > 0) {
    contextEl.textContent = `Showing in today's dollars (adjusted for ${inflationRate}% annual inflation over ${yearsToRetirement} years).`;
  } else {
    contextEl.textContent = `Showing in future (nominal) dollars at retirement age ${retirementAge}.`;
  }

  // 7. Show the "nominal vs real" comparison note when in real-dollars mode
  const inflationNote = document.getElementById("inflation-note");
  if (showRealDollars && inflationRate > 0) {
    document.getElementById("nominal-total-result").textContent = formatCurrency(totalMonthly);
    inflationNote.classList.remove("hidden");
  } else {
    inflationNote.classList.add("hidden");
  }

  // 8. Show the results section
  const resultsDiv = document.getElementById("results");
  resultsDiv.classList.remove("hidden");
  resultsDiv.scrollIntoView({ behavior: "smooth", block: "start" });

  // 9. Render the savings growth chart
  renderChart(currentAge, currentSavings, monthlyContrib, returnRate, yearsToRetirement, inflationRate, showRealDollars);
}


// --- CHART ---
// We store the Chart.js instance here so we can destroy it before redrawing.
// If we didn't destroy it first, clicking Calculate multiple times would
// stack charts on top of each other and cause visual glitches.
let savingsChartInstance = null;

// Builds the year-by-year data for the chart.
// Returns two arrays:
//   labels        - ["Age 35", "Age 36", ...]
//   balanceData   - [52500, 55200, ...] (savings balance each year)
function buildChartData(currentAge, currentSavings, monthlyContrib, returnRate, yearsToRetirement, inflationRate, showRealDollars) {
  const labels  = [];
  const balanceData = [];
  const contribData = [];  // Cumulative contributions (no growth) - for comparison

  const monthlyRate = returnRate / 100 / 12;
  let balance = currentSavings;
  let totalContributed = currentSavings;  // Seed contributions with starting balance

  for (let year = 0; year <= yearsToRetirement; year++) {
    const age = currentAge + year;
    labels.push(`Age ${age}`);

    // Optionally convert to today's dollars for the chart too
    const displayBalance = showRealDollars && inflationRate > 0
      ? toRealDollars(balance, inflationRate, year)
      : balance;

    const displayContrib = showRealDollars && inflationRate > 0
      ? toRealDollars(totalContributed, inflationRate, year)
      : totalContributed;

    balanceData.push(Math.round(displayBalance));
    contribData.push(Math.round(displayContrib));

    // Grow balance by one year of compounding + contributions
    // (we do this after recording the current year's value)
    if (monthlyRate === 0) {
      balance += monthlyContrib * 12;
    } else {
      // Compound for 12 months
      const growthFactor = Math.pow(1 + monthlyRate, 12);
      balance = balance * growthFactor + monthlyContrib * ((growthFactor - 1) / monthlyRate);
    }
    totalContributed += monthlyContrib * 12;
  }

  return { labels, balanceData, contribData };
}

function renderChart(currentAge, currentSavings, monthlyContrib, returnRate, yearsToRetirement, inflationRate, showRealDollars) {
  const { labels, balanceData, contribData } = buildChartData(
    currentAge, currentSavings, monthlyContrib, returnRate, yearsToRetirement, inflationRate, showRealDollars
  );

  // Destroy the old chart if one exists, so we start fresh
  if (savingsChartInstance) {
    savingsChartInstance.destroy();
  }

  // Get the canvas element where the chart will be drawn
  const ctx = document.getElementById("savings-chart").getContext("2d");

  // Create the chart using Chart.js
  // Chart.js takes a config object that describes the type, data, and appearance.
  savingsChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          // Total balance including investment growth
          label: showRealDollars ? "Total Balance (today's $)" : "Total Balance",
          data: balanceData,
          borderColor: "#c8102e",
          backgroundColor: "rgba(200, 16, 46, 0.08)",
          fill: true,
          tension: 0.3,      // Makes the line slightly curved
          pointRadius: 2,
        },
        {
          // Just contributions with no growth - shows how much compounding adds
          label: "Contributions Only (no growth)",
          data: contribData,
          borderColor: "#a0aec0",
          backgroundColor: "transparent",
          fill: false,
          tension: 0.3,
          borderDash: [5, 5],  // Dashed line
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: "index",       // Show both datasets' values when hovering
        intersect: false,
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: { font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            // Format tooltip values as currency
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
            // Format Y axis labels as abbreviated dollar amounts: $500K, $1M
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


// --- EVENT LISTENER ---
// This connects the button in the HTML to the calculate() function above.
// "addEventListener" means: when the button is clicked, run calculate().

document.getElementById("calculate-btn").addEventListener("click", calculate);
