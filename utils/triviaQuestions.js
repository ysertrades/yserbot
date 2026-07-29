'use strict';

// Question bank for /trivia. Trading questions are deliberately factual/
// definitional (what a term means) rather than strategy ("when should you
// buy") — the bot isn't in the business of giving trading advice. Politics
// questions are the same idea: historical/civics facts (who, how many, how
// long), never current-events opinion or policy takes.
//
// Each entry: { q, choices: [4], correct: index of the right choice }.

const QUESTIONS = {
  trading: [
    { q: "What does 'IPO' stand for?", choices: ['Initial Public Offering', 'Internal Profit Order', 'Investment Portfolio Option', 'Interbank Payment Order'], correct: 0 },
    { q: "What is a 'bull market'?", choices: ['A market with high volatility', 'A market where prices are generally rising', 'A market only for commodities', 'A market closed for trading'], correct: 1 },
    { q: "What is a 'bear market'?", choices: ['A market where prices are generally falling', 'A market with no volume', 'A market for bonds only', 'A market open 24/7'], correct: 0 },
    { q: "What does 'liquidity' refer to in trading?", choices: ['How profitable an asset is', 'How easily an asset can be bought or sold without affecting its price', 'The tax rate on an asset', "An asset's dividend yield"], correct: 1 },
    { q: 'What is a dividend?', choices: ['A fee charged by brokers', 'A portion of a company\'s profit paid to shareholders', 'A type of stock exchange', 'A government bond'], correct: 1 },
    { q: "What does 'ETF' stand for?", choices: ['Exchange Traded Fund', 'Equity Transfer Form', 'Electronic Trading Facility', 'External Trade Function'], correct: 0 },
    { q: 'What is short selling?', choices: ['Buying a stock for a short time only', 'Selling a borrowed asset hoping to buy it back cheaper later', 'Selling a stock below its opening price', 'A same-day-only trade'], correct: 1 },
    { q: "What does 'P/E ratio' stand for?", choices: ['Profit/Earnings ratio', 'Price/Earnings ratio', 'Position/Equity ratio', 'Payout/Expense ratio'], correct: 1 },
    { q: "What is a 'blue chip' stock?", choices: ['A newly listed penny stock', 'A stock of a large, financially stable, well-established company', 'A stock that only trades on weekends', 'A stock with no dividend history'], correct: 1 },
    { q: "What does 'NYSE' stand for?", choices: ['New York Stock Exchange', 'National Yield Securities Exchange', 'New York Securities Entity', 'North Yield Stock Exchange'], correct: 0 },
    { q: "What is a 'stop-loss' order?", choices: ['An order that cancels all your other orders', 'An order that automatically sells a position once it hits a set price', 'An order only usable once per day', 'A type of dividend reinvestment'], correct: 1 },
    { q: 'What does market capitalization measure?', choices: ["A company's total debt", "A company's total revenue", "The total market value of a company's outstanding shares", "A company's annual profit"], correct: 2 },
    { q: 'What is a stock split?', choices: ["A company dividing its shares into multiple shares to lower the price per share", 'When a company goes bankrupt', 'A merger between two companies', "A type of dividend paid in cash"], correct: 0 },
    { q: "What does 'volatility' measure in markets?", choices: ["A company's headcount", "How much and how quickly a price moves", "The number of shares outstanding", "The interest rate on a bond"], correct: 1 },
    { q: 'What is a limit order?', choices: ['An order executed immediately at any price', 'An order that can only be placed once per day', 'An order to buy or sell at a specific price or better', 'An order that expires after one minute'], correct: 2 },
    { q: "What does 'NASDAQ' primarily list?", choices: ['Only government bonds', 'Mostly technology and growth companies', 'Only commodities', 'Only foreign currencies'], correct: 1 },
    { q: 'What is a mutual fund?', choices: ['A loan between two companies', 'A pooled investment managed by a professional fund manager', 'A type of savings account', 'A government-issued bond'], correct: 1 },
    { q: "What does 'bid-ask spread' refer to?", choices: ["A company's profit margin", 'The difference between the highest buy offer and lowest sell offer', "A stock's dividend history", "A trader's win rate"], correct: 1 },
    { q: 'What is a futures contract?', choices: ['A stock that pays no dividend', 'An agreement to buy or sell an asset at a set price on a future date', 'A type of savings bond', 'A loan with no interest'], correct: 1 },
    { q: "What does 'ticker symbol' mean?", choices: ["A company's tax ID", 'The abbreviation used to identify a publicly traded stock', "A stock's exchange rate", "A broker's license number"], correct: 1 },
    { q: 'What is an index fund?', choices: ['A fund that tracks a market index like the S&P 500', 'A fund that only holds one stock', 'A fund exclusive to banks', 'A type of insurance product'], correct: 0 },
    { q: "What does 'going long' on a stock mean?", choices: ['Buying it expecting the price to rise', 'Selling it expecting the price to fall', 'Holding it for exactly one year', 'Buying it with borrowed money only'], correct: 0 },
  ],

  economics: [
    { q: "What does 'GDP' stand for?", choices: ['Gross Domestic Product', 'General Debt Payment', 'Government Development Plan', 'Global Direct Pricing'], correct: 0 },
    { q: 'What does inflation mean?', choices: ['A general decrease in prices over time', 'A general increase in prices over time', 'A fixed exchange rate', "A country's total exports"], correct: 1 },
    { q: 'What is the primary role of a central bank?', choices: ['Running the stock exchange', "Managing a country's monetary policy and currency", 'Collecting income taxes', 'Regulating food safety'], correct: 1 },
    { q: 'What is typically used to define a recession?', choices: ['One quarter of rising unemployment', 'Two consecutive quarters of negative GDP growth', 'A single day of stock market decline', 'Any year with inflation above 5%'], correct: 1 },
    { q: "What does 'supply and demand' describe?", choices: ['A type of tax policy', 'The relationship between availability of a product and desire for it, which affects price', "A country's export/import ratio", 'A banking regulation'], correct: 1 },
    { q: 'What is fiscal policy?', choices: ["A central bank's interest rate decisions", "Government use of spending and taxation to influence the economy", 'A company\'s annual budget', 'An exchange rate agreement between countries'], correct: 1 },
    { q: 'What is monetary policy?', choices: ["A government's spending plan", "A central bank's actions to manage money supply and interest rates", 'A company\'s pricing strategy', 'An international trade agreement'], correct: 1 },
    { q: 'What does the unemployment rate measure?', choices: ['Total population of a country', 'The percentage of the labor force that is jobless and looking for work', "A country's GDP growth", 'The average wage in a country'], correct: 1 },
    { q: "What does 'CPI' stand for?", choices: ['Consumer Price Index', 'Corporate Profit Indicator', 'Central Payment Instrument', 'Currency Parity Index'], correct: 0 },
    { q: 'Which US institution sets the federal funds rate?', choices: ['The US Treasury', 'The Federal Reserve', 'The New York Stock Exchange', 'Congress'], correct: 1 },
    { q: 'What is a trade deficit?', choices: ['When a country exports more than it imports', 'When a country imports more than it exports', "A company's annual loss", 'A tax on foreign goods'], correct: 1 },
    { q: 'What does GDP per capita measure?', choices: ['Total government debt', 'Average economic output per person in a country', "A country's total population", 'The exchange rate of a currency'], correct: 1 },
    { q: 'What is deflation?', choices: ['A general increase in prices over time', 'A general decrease in prices over time', 'A fixed currency exchange rate', 'A rise in interest rates only'], correct: 1 },
    { q: "What does 'stagflation' describe?", choices: ['High growth with low inflation', 'Stagnant growth combined with high inflation', 'Zero unemployment', 'A currency pegged to gold'], correct: 1 },
    { q: 'What is a tariff?', choices: ['A tax imposed on imported goods', 'A subsidy for domestic farmers', 'A type of interest rate', "A country's credit rating"], correct: 0 },
    { q: "What does 'per capita income' mean?", choices: ['Total national income', 'Average income per person in a population', "A company's total revenue", 'The minimum wage in a country'], correct: 1 },
    { q: 'What is a subsidy?', choices: ['A tax on exports', 'Financial support given by a government to a business or sector', 'A type of loan between banks', 'A fine for pollution'], correct: 1 },
    { q: "What does the term 'labor force' refer to?", choices: ['Only unemployed people', 'People who are employed or actively seeking work', 'Only government employees', 'People under 18'], correct: 1 },
    { q: 'What is currency devaluation?', choices: ["A deliberate downward adjustment of a country's currency value relative to others", 'An increase in a currency\'s value', 'A ban on foreign currency trading', "A country's total debt level"], correct: 0 },
    { q: 'What is a budget deficit?', choices: ['When government spending exceeds its revenue', 'When government revenue exceeds its spending', "A company's annual loss", 'A trade imbalance between countries'], correct: 0 },
  ],

  politics: [
    { q: 'Who was the first President of the United States?', choices: ['Thomas Jefferson', 'John Adams', 'George Washington', 'Benjamin Franklin'], correct: 2 },
    { q: 'How many justices currently sit on the US Supreme Court?', choices: ['7', '9', '11', '13'], correct: 1 },
    { q: 'How long is a US Senate term?', choices: ['2 years', '4 years', '6 years', '8 years'], correct: 2 },
    { q: 'How long is a term for a member of the US House of Representatives?', choices: ['2 years', '4 years', '6 years', '10 years'], correct: 0 },
    { q: 'What document begins with the words "We the People"?', choices: ['The Declaration of Independence', 'The US Constitution', 'The Bill of Rights', 'The Federalist Papers'], correct: 1 },
    { q: 'How many amendments are in the US Bill of Rights?', choices: ['5', '8', '10', '12'], correct: 2 },
    { q: 'What is the maximum number of terms a US President can serve?', choices: ['1', '2', '3', 'Unlimited'], correct: 1 },
    { q: 'In what year did the United States declare independence?', choices: ['1774', '1776', '1783', '1789'], correct: 1 },
    { q: 'How many states make up the United States?', choices: ['48', '49', '50', '52'], correct: 2 },
    { q: "What is the name of the US Congress's lower chamber?", choices: ['The Senate', 'The House of Representatives', 'The Cabinet', 'The Assembly'], correct: 1 },
    { q: 'Which US President served the longest in office?', choices: ['Abraham Lincoln', 'Franklin D. Roosevelt', 'Theodore Roosevelt', 'Woodrow Wilson'], correct: 1 },
    { q: 'What city is the capital of the United States?', choices: ['New York City', 'Philadelphia', 'Washington, D.C.', 'Boston'], correct: 2 },
    { q: 'Who is generally credited as the primary author of the Declaration of Independence?', choices: ['George Washington', 'Thomas Jefferson', 'John Hancock', 'James Madison'], correct: 1 },
    { q: 'What is the term length of a UK Prime Minister fixed at, by law?', choices: ['There is no fixed term — elections can be called earlier', '4 years exactly', '6 years exactly', '10 years exactly'], correct: 0 },
    { q: 'How many members does the United Nations Security Council have permanently (with veto power)?', choices: ['3', '5', '7', '10'], correct: 1 },
    { q: 'What is the minimum age to serve as US President?', choices: ['30', '35', '40', '21'], correct: 1 },
    { q: 'Which branch of the US government is the Supreme Court part of?', choices: ['Legislative', 'Executive', 'Judicial', 'Administrative'], correct: 2 },
    { q: 'How many electoral votes does a US presidential candidate need to win, out of 538?', choices: ['218', '270', '300', '400'], correct: 1 },
    { q: 'What war ended with the Treaty of Paris in 1783?', choices: ['The Civil War', 'The American Revolutionary War', 'World War I', 'The War of 1812'], correct: 1 },
    { q: 'Who was the President of the United States during the Civil War?', choices: ['Andrew Jackson', 'Abraham Lincoln', 'Ulysses S. Grant', 'James Buchanan'], correct: 1 },
  ],

  sports: [
    { q: 'How many players are on a basketball court per team during play?', choices: ['4', '5', '6', '7'], correct: 1 },
    { q: 'How many minutes are in a regulation soccer match (excluding stoppage time)?', choices: ['60', '80', '90', '120'], correct: 2 },
    { q: 'What sport is played at Wimbledon?', choices: ['Golf', 'Tennis', 'Cricket', 'Rugby'], correct: 1 },
    { q: 'How many rings are on the Olympic flag?', choices: ['4', '5', '6', '7'], correct: 1 },
    { q: 'How many holes are played in a standard round of golf?', choices: ['9', '16', '18', '21'], correct: 2 },
    { q: "What is a 'hat-trick' in soccer or hockey?", choices: ['Winning three games in a row', 'Scoring three goals in a single game', 'A three-minute penalty', 'A team\'s third championship'], correct: 1 },
    { q: 'How many points is a touchdown worth in American football (before the extra point)?', choices: ['3', '6', '7', '2'], correct: 1 },
    { q: 'Which country has won the most FIFA World Cups?', choices: ['Germany', 'Argentina', 'Brazil', 'Italy'], correct: 2 },
    { q: 'How many players are on a standard soccer team on the field (including goalkeeper)?', choices: ['9', '10', '11', '12'], correct: 2 },
    { q: 'What is the maximum possible score in a single game of ten-pin bowling?', choices: ['200', '250', '300', '350'], correct: 2 },
    { q: 'How often are the Summer Olympic Games held?', choices: ['Every 2 years', 'Every 4 years', 'Every 5 years', 'Every 6 years'], correct: 1 },
    { q: 'In tennis, what is a score of zero called?', choices: ['Nil', 'Love', 'Deuce', 'Ace'], correct: 1 },
    { q: 'How many players are on a baseball team on the field defensively?', choices: ['8', '9', '10', '11'], correct: 1 },
    { q: 'What is the term for a score of one under par on a single golf hole?', choices: ['Bogey', 'Eagle', 'Birdie', 'Albatross'], correct: 2 },
    { q: 'How long does a standard boxing round last?', choices: ['1 minute', '2 minutes', '3 minutes', '5 minutes'], correct: 2 },
    { q: 'In which sport would you perform a "slam dunk"?', choices: ['Volleyball', 'Basketball', 'Handball', 'Badminton'], correct: 1 },
    { q: 'How many periods are in a standard game of ice hockey?', choices: ['2', '3', '4', '5'], correct: 1 },
    { q: 'What is the diameter concept of a "full court press" associated with?', choices: ['Basketball', 'Baseball', 'Swimming', 'Golf'], correct: 0 },
    { q: 'How many Grand Slam tennis tournaments are there per year?', choices: ['2', '3', '4', '5'], correct: 2 },
    { q: 'What color card signals a player ejection in soccer?', choices: ['Yellow', 'Red', 'Blue', 'Black'], correct: 1 },
  ],
};

const CATEGORIES = Object.keys(QUESTIONS);

module.exports = { QUESTIONS, CATEGORIES };
