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

  // 2. Basic validation
  if (retirementAge <= currentAge) {
    alert("Retirement age must be greater than your current age.");
    return;
  }

  const yearsToRetirement = retirementAge - currentAge;

  // 3. Run the calculations
  const cppMonthly         = calculateCPP(cppYears, cppStartAge);
  const oasMonthly         = calculateOAS(oasYears);
  const savingsAtRetirement = calculateSavingsAtRetirement(
    currentSavings, monthlyContrib, returnRate, yearsToRetirement
  );
  const savingsMonthly     = calculateMonthlyWithdrawal(savingsAtRetirement, returnRate, withdrawalYears);
  const totalMonthly       = cppMonthly + oasMonthly + savingsMonthly;
  const totalAnnual        = totalMonthly * 12;

  // 4. Display the results
  // We find each result element by its ID and set its text content.
  document.getElementById("cpp-result").textContent           = formatCurrency(cppMonthly);
  document.getElementById("oas-result").textContent           = formatCurrency(oasMonthly);
  document.getElementById("savings-result").textContent       = formatCurrency(savingsAtRetirement);
  document.getElementById("savings-monthly-result").textContent = formatCurrency(savingsMonthly);
  document.getElementById("total-result").textContent         = formatCurrency(totalMonthly);
  document.getElementById("annual-result").textContent        = formatCurrency(totalAnnual);

  // 5. Show the results section (it starts hidden)
  // We remove the "hidden" CSS class to make it visible.
  const resultsDiv = document.getElementById("results");
  resultsDiv.classList.remove("hidden");

  // Smoothly scroll down to the results so the user sees them
  resultsDiv.scrollIntoView({ behavior: "smooth", block: "start" });
}


// --- EVENT LISTENER ---
// This connects the button in the HTML to the calculate() function above.
// "addEventListener" means: when the button is clicked, run calculate().

document.getElementById("calculate-btn").addEventListener("click", calculate);
