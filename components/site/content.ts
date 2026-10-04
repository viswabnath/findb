/**
 * The website's content: features, questions and the roadmap, in plain language.
 * Kept as data so the home page, the features pages, the sitemap and the tests share one source.
 *
 * Status says honestly where each feature stands:
 *   available: in the app today;
 *   building:  in the phases before the public launch (v2 plan, Phases 1 to 5);
 *   planned:   in the later phases (Phase 6 onwards).
 */

export type FeatureStatus = 'available' | 'building' | 'planned';

export type FeatureIconName =
    | 'wallet' | 'receipt' | 'upload' | 'chart' | 'calendar' | 'people' | 'loan' | 'card'
    | 'gold' | 'home' | 'piggy' | 'umbrella' | 'gauge' | 'family';

export interface Term {
    term: string;
    meaning: string;
}

/** The five groups features are shown in, in the menu and on the features page */
export type FeatureGroup = 'track' | 'borrow' | 'grow' | 'protect' | 'family';

export const GROUPS: { id: FeatureGroup; name: string; text: string }[] = [
    { id: 'track', name: 'Track', text: 'Accounts, spending and where the money goes' },
    { id: 'borrow', name: 'Borrow and lend', text: 'Loans, chits, cards and money with people' },
    { id: 'grow', name: 'Save and grow', text: 'Gold, investments, deposits and property' },
    { id: 'protect', name: 'Protect', text: 'Insurance, tax and your money health' },
    { id: 'family', name: 'Family', text: 'Your household, together' },
];

export interface Feature {
    slug: string;
    name: string;
    group: FeatureGroup;
    icon: FeatureIconName;
    status: FeatureStatus;
    /** One line for cards and lists */
    short: string;
    /** Two or three sentences for the feature page */
    summary: string;
    /** What the user can do (for available features: what works today) */
    points: string[];
    /** For available features: what is coming next */
    next?: string[];
    /** A real-life example with Indian amounts */
    example: { title: string; lines: string[]; result: string };
    /** Words that may be new to a reader, explained simply */
    terms?: Term[];
}

export const STATUS_LABELS: Record<FeatureStatus, string> = {
    available: 'Available now',
    building: 'In development',
    planned: 'Planned',
};

export const FEATURES: Feature[] = [
    {
        slug: 'accounts',
        group: 'track',
        name: 'Accounts and balances',
        icon: 'wallet',
        status: 'available',
        short: 'Every bank account, card, wallet and rupee of cash in one place, always up to date.',
        summary:
            'Add your bank accounts, credit cards and cash once, with the balance they have today. From then on, every entry you add updates the right balance automatically, so you always know how much money is where.',
        points: [
            'Bank accounts with their starting balance',
            'Credit cards with their limit and how much is used',
            'Cash in hand',
            'Every balance changes the moment you add, edit or delete an entry',
        ],
        next: [
            'Meal cards such as Pluxee (formerly Sodexo) and UPI or prepaid wallets',
            'Moving money between your own accounts, such as an ATM withdrawal or a card bill payment, without counting it as spending',
            'Checking a balance against your bank statement, with the difference explained entry by entry',
        ],
        example: {
            title: 'Withdrawing cash from an ATM',
            lines: [
                'You take ₹5,000 out of your HDFC account at an ATM.',
                'FinDB moves ₹5,000 from HDFC to Cash.',
            ],
            result: 'Your spending this month does not change. You only spend the money when you actually buy something with it.',
        },
        terms: [
            { term: 'Balance', meaning: 'How much money is in an account right now.' },
            { term: 'Reconcile', meaning: 'Comparing FinDB\'s balance with your bank statement to make sure they match.' },
        ],
    },
    {
        slug: 'spending',
        group: 'track',
        name: 'Spending and income',
        icon: 'receipt',
        status: 'available',
        short: 'Record what comes in and what goes out, and see every month at a glance.',
        summary:
            'Add your salary and other income, and every expense paid by cash, bank or card. The monthly summary shows what you earned, what you spent, what you saved, and where each account stood at the end of the month.',
        points: [
            'Income into a bank account or cash',
            'Expenses paid by cash, bank or credit card',
            'A monthly summary: income, spending, savings and total wealth',
            'An activity log of every change, with the old and new values, and a CSV export',
        ],
        next: [
            'Categories such as Groceries, Fuel and Restaurants, suggested from the title ("Swiggy" means Restaurants)',
            'Repeating entries for rent, EMIs, SIPs and subscriptions, confirmed with one tap',
            'Reimbursements: money your office or insurer will pay back is not counted as your spending',
            'Marking spending as essential or optional, to see what you really need each month',
        ],
        example: {
            title: 'A normal month',
            lines: [
                'Salary of ₹85,000 arrives in your SBI account.',
                'Rent ₹22,000, groceries ₹9,400, fuel ₹4,200 and eating out ₹6,800 go out.',
            ],
            result: 'The monthly summary shows ₹85,000 in, ₹42,400 out, and ₹42,600 saved.',
        },
    },
    {
        slug: 'import',
        group: 'track',
        name: 'Statement import',
        icon: 'upload',
        status: 'building',
        short: 'Upload a bank or card statement instead of typing every entry.',
        summary:
            'Typing every entry is the main reason people give up on money apps. Upload the statement your bank already gives you, check the entries on one screen, and save them all at once.',
        points: [
            'CSV and Excel statements from HDFC, ICICI, SBI, Axis and Kotak first, then other banks',
            'PDF statements, including password-protected ones (the password is never stored)',
            'A review screen before anything is saved: duplicates are flagged and categories suggested',
            'Transfers between your own accounts are recognised and paired',
            'Import from other money apps and spreadsheets, so you keep your history',
            'Photos of receipts and UPI payment screenshots are read and turned into entries for you to confirm',
        ],
        example: {
            title: 'Three months in five minutes',
            lines: [
                'You download your last three months from net banking and upload the file.',
                'FinDB finds 214 entries, flags 3 you already typed, and suggests a category for each.',
            ],
            result: 'You check the list, press Save, and immediately see where the money went.',
        },
        terms: [
            { term: 'CSV', meaning: 'A simple spreadsheet file that most banks let you download.' },
            { term: 'Duplicate', meaning: 'The same entry appearing twice, for example once typed by you and once imported.' },
        ],
    },
    {
        slug: 'insights',
        group: 'track',
        name: 'Insights and budgets',
        icon: 'chart',
        status: 'building',
        short: 'See where the money really goes, and set limits that warn you in time.',
        summary:
            'FinDB looks at your spending over months and tells you, in plain sentences, what is normal for you, what is growing and what is unusual.',
        points: [
            'Averages per category: "Restaurants: ₹6,800 a month over 6 months, up 22%"',
            'A subscription finder: every repeating charge, its yearly cost, and price increases',
            'Monthly budgets per category, with alerts at 80% and 100%',
            'Unusual spending flags: "Fuel this month is twice your average"',
            'Charts of your top categories and month-on-month changes',
        ],
        example: {
            title: 'Forgotten subscriptions',
            lines: [
                'FinDB finds six repeating charges: two streaming apps, music, cloud storage, a gym and a news app.',
                'Together they cost ₹2,140 a month.',
            ],
            result: 'That is ₹25,680 a year. You cancel the two you no longer use.',
        },
    },
    {
        slug: 'events',
        group: 'track',
        name: 'Events, trips and projects',
        icon: 'calendar',
        status: 'building',
        short: 'Track a wedding, a housewarming, a trip or a house construction as one project.',
        summary:
            'Big life events are paid for over months, from many accounts. Give any entry a purpose, and FinDB adds it all up for you, without disturbing your regular monthly picture.',
        points: [
            'Any expense, income, loan or purchase can belong to an event',
            'Each event shows what was spent by category, what was received, and the net cost',
            'An optional budget, compared with what was actually spent',
            'One-off events can be left out of your monthly averages, so a wedding does not make every month look expensive',
        ],
        example: {
            title: 'Your sister\'s wedding',
            lines: [
                'Over five months you pay ₹1,80,000 for catering, ₹2,40,000 for jewellery and ₹2,50,000 for the hall and other costs.',
                'Relatives give ₹65,000 in gifts.',
            ],
            result: 'FinDB shows the wedding cost you ₹6,05,000, and your regular spending still reads ₹48,000 a month.',
        },
    },
    {
        slug: 'people',
        group: 'borrow',
        name: 'Money with friends and family',
        icon: 'people',
        status: 'building',
        short: 'Money lent, money borrowed, and costs shared on trips or with flatmates.',
        summary:
            'Lend ₹20,000 to a friend, share a Goa trip with four people, or split rent with flatmates. FinDB remembers who owes whom, so nobody has to keep it in their head.',
        points: [
            'Money lent or borrowed, with or without interest, with reminders',
            'Interest shown both as % a year and as rupees per ₹100 a month, the way it is often agreed between people',
            'Groups for trips and flatmates: who paid and who shares each cost',
            'Split equally, by exact amounts, by percentage or by shares',
            'Settle up with the fewest payments possible',
            'Your trip cost shows only your own share, not what you paid for everyone',
        ],
        example: {
            title: 'A Goa trip with three friends',
            lines: [
                'You book the train tickets for all four: ₹12,000.',
                'Your friends pay for the hotel (₹24,000) and food (₹8,000).',
            ],
            result: 'The trip cost ₹44,000, so your share is ₹11,000. You paid ₹12,000, and FinDB shows who owes you the ₹1,000 back.',
        },
    },
    {
        slug: 'loans',
        group: 'borrow',
        name: 'Loans and chit funds',
        icon: 'loan',
        status: 'building',
        short: 'Every loan and chit in one place, with the dangerous ones flagged first.',
        summary:
            'Home, car, personal, education and gold loans, and the chit funds many Indian families run. FinDB shows how much of each EMI is interest, which debt hurts most, and how to clear it faster.',
        points: [
            'Each EMI split into interest and the amount that reduces your loan',
            'Every rate shown as % a year and as rupees per ₹100 a month',
            'Gold loans and loans against FDs, insurance or property',
            'Chit funds: monthly contribution, dividend, auction bids and the money you receive',
            'Debts ranked from most to least dangerous, with the reason',
            'A payoff planner: see how an extra ₹5,000 a month changes the finish date',
        ],
        example: {
            title: 'Which loan first?',
            lines: [
                'You have a credit card balance at 42% a year (₹3.50 per ₹100 a month), a personal loan at 14% (₹1.17), and a home loan at 8.5% (₹0.71).',
                'You can spare ₹10,000 extra a month.',
            ],
            result: 'FinDB shows that clearing the card first saves the most interest, and by how much.',
        },
        terms: [
            { term: 'EMI', meaning: 'Equated monthly instalment: the fixed amount you pay every month on a loan.' },
            { term: 'Chit fund', meaning: 'A group that saves a fixed amount every month; each month one member takes the pool, usually through an auction.' },
            { term: 'Principal', meaning: 'The part of a loan you actually borrowed, as opposed to the interest on it.' },
        ],
    },
    {
        slug: 'credit-cards',
        group: 'borrow',
        name: 'Credit cards, cashback and rewards',
        icon: 'card',
        status: 'building',
        short: 'Bills, due dates, cashback and reward points, without surprises.',
        summary:
            'Know what each card owes, when it is due, and what it has earned you. FinDB warns you before a due date and when you are paying only the minimum.',
        points: [
            'Statements with the amount due, the minimum due and the due date',
            'Cards that share one credit limit',
            'Cashback recorded as income, per card and per year',
            'Reward points with their value and expiry reminders',
            'The real cashback rate of each card, so you know which one to use',
            'A calendar of everything due this month: card bills, EMIs, rent and more',
        ],
        example: {
            title: 'Paying only the minimum',
            lines: [
                'Your card bill is ₹48,000 and the minimum due is ₹2,400.',
                'You pay ₹2,400.',
            ],
            result: 'FinDB warns that the remaining ₹45,600 now attracts interest of about ₹3.50 per ₹100 a month, which is about 42% a year.',
        },
    },
    {
        slug: 'investments',
        group: 'grow',
        name: 'Gold and investments',
        icon: 'gold',
        status: 'planned',
        short: 'Gold by weight, mutual funds, stocks and more, valued every day.',
        summary:
            'Record the gold you own by weight and purity, and your mutual funds, stocks, bonds and other investments. FinDB values them with daily prices from free public sources.',
        points: [
            'Physical gold piece by piece: weight, purity (22K, 24K), who owns it, and how it was bought or received',
            'Digital gold, daily or monthly gold SIPs, gold ETFs and Sovereign Gold Bonds',
            'Mutual funds, stocks, ETFs, bonds, REITs, crypto, ESOPs and RSUs',
            'SIPs, dividends, and profit or loss on each holding',
            'Prices updated once a day; you can always enter a price yourself',
        ],
        example: {
            title: 'Your gold, valued today',
            lines: [
                'You record a 20 g chain and two 11 g bangles, all 22K.',
                'Today\'s 22K rate is ₹7,100 a gram.',
            ],
            result: 'FinDB values your gold at ₹2,98,200, and updates it every day.',
        },
        terms: [
            { term: 'SIP', meaning: 'Systematic investment plan: investing a fixed amount every day, week or month.' },
            { term: 'NAV', meaning: 'Net asset value: the price of one unit of a mutual fund on a given day.' },
        ],
    },
    {
        slug: 'property',
        group: 'grow',
        name: 'Property, rent and valuables',
        icon: 'home',
        status: 'planned',
        short: 'Land, homes, rent received, vehicles and valuables, at today\'s value.',
        summary:
            'Your home, a plot in your village, a shop you rent out, your car and your gadgets. FinDB records what they cost, what they are worth now, and the rent they earn.',
        points: [
            'Land and property with your ownership share and estimated value',
            'House construction tracked stage by stage, added to the property\'s cost',
            'Tenants, rent received and security deposits',
            'Vehicles and gadgets that lose value each year (depreciation)',
            'Valuables received as gifts or inheritance: jewellery, watches, cameras',
        ],
        example: {
            title: 'A flat you rent out',
            lines: [
                'You bought a flat for ₹42,00,000 and rent it for ₹18,000 a month.',
                'The tenant paid a deposit of ₹50,000.',
            ],
            result: 'FinDB counts ₹2,16,000 rent a year as income, and the deposit as money you owe back, not as income.',
        },
        terms: [
            { term: 'Depreciation', meaning: 'The value something loses as it gets older, like a car or a phone.' },
        ],
    },
    {
        slug: 'savings',
        group: 'grow',
        name: 'Deposits, retirement and goals',
        icon: 'piggy',
        status: 'planned',
        short: 'FDs, RDs, post office schemes, PF, NPS and the goals you are saving for.',
        summary:
            'All the safe savings Indian families rely on, with interest and maturity dates, and goals that show whether you are on track for a dream bike, a child\'s education or retirement.',
        points: [
            'Fixed and recurring deposits with interest and maturity reminders',
            'Post office schemes: PPF, Sukanya Samriddhi, NSC, KVP, SCSS and MIS',
            'EPF, VPF and NPS, including what your employer adds',
            'Pensions, with a reminder for the yearly life certificate',
            'One payslip entry a month fills in salary, PF, NPS, tax and meal benefit',
            'Goals with a target and a date: "Royal Enfield, ₹2,40,000 by March 2028"',
        ],
        example: {
            title: 'Saving for a bike',
            lines: [
                'You want ₹2,40,000 in 24 months and start an RD of ₹9,500 a month.',
                'The RD earns about 7% a year, which is about ₹0.58 per ₹100 a month.',
            ],
            result: 'FinDB shows you will reach about ₹2,44,000, slightly ahead of your goal.',
        },
        terms: [
            { term: 'RD', meaning: 'Recurring deposit: saving a fixed amount every month at a fixed interest rate.' },
            { term: 'EPF', meaning: 'Employees\' Provident Fund: retirement savings taken from your salary, with a matching amount from your employer.' },
        ],
    },
    {
        slug: 'insurance-tax',
        group: 'protect',
        name: 'Insurance and tax',
        icon: 'umbrella',
        status: 'planned',
        short: 'Policies, renewals and a clear yearly tax picture.',
        summary:
            'Keep every policy with its renewal date, check whether your cover is enough, and see your tax year in one place: deductions, TDS and the forms your employer and the tax department send.',
        points: [
            'Term, health, life and vehicle insurance, with renewal reminders',
            'A cover check against simple rules of thumb (information, not advice)',
            'Deductions such as 80C, 80D and home loan interest, added up for you',
            'TDS from Form 16, Form 26AS and AIS compared with your own records',
            'Capital gains from selling investments, and rent paid for HRA',
        ],
        example: {
            title: 'Before filing your return',
            lines: [
                'Your Form 16 shows TDS of ₹62,400.',
                'Your own records add up to ₹60,000.',
            ],
            result: 'FinDB points out the ₹2,400 difference so you can find it before you file.',
        },
        terms: [
            { term: 'TDS', meaning: 'Tax deducted at source: tax taken out before money reaches you, for example from your salary.' },
            { term: '80C', meaning: 'A section of the Income Tax Act that lets you reduce taxable income by investing in things like PPF and ELSS.' },
        ],
    },
    {
        slug: 'health-check',
        group: 'protect',
        name: 'Net worth and money health check',
        icon: 'gauge',
        status: 'planned',
        short: 'One number for everything you own minus everything you owe, and whether you are doing okay.',
        summary:
            'FinDB adds up everything you own and subtracts everything you owe. Then it answers the real question in plain words: are your savings beating inflation, is your debt healthy, and how long would your emergency fund last?',
        points: [
            'Net worth and how it has changed month by month',
            'Returns compared with inflation and the market',
            'An emergency fund check based on your essential spending',
            'Debt and insurance health in simple words, with the rules used shown',
            'Information to help you decide, never personal investment advice',
        ],
        example: {
            title: 'Money sitting idle',
            lines: [
                'You keep ₹4,00,000 in a savings account earning 2.7% a year (about ₹0.23 per ₹100 a month).',
                'Inflation is around 5%.',
            ],
            result: 'FinDB explains that this money is losing about ₹9,000 of value a year, and what keeps money safe while earning more.',
        },
        terms: [
            { term: 'Net worth', meaning: 'Everything you own minus everything you owe.' },
            { term: 'Inflation', meaning: 'Prices going up over time, so the same money buys less.' },
        ],
    },
    {
        slug: 'family',
        group: 'family',
        name: 'Family and estate',
        icon: 'family',
        status: 'planned',
        short: 'Your household\'s money together, with nominees and a simple mode for parents.',
        summary:
            'Money in Indian families is shared. FinDB lets you see the household together, record who owns what and who the nominees are, and keep things simple for parents who only need the basics.',
        points: [
            'Share your household\'s finances with your spouse or family',
            'Joint ownership of property and accounts',
            'Nominees for every account, policy and investment',
            'An estate summary your family can find when it matters',
            'A simple mode with larger text and only the basics, for parents and older users',
        ],
        example: {
            title: 'Helping your parents',
            lines: [
                'Your father has an SCSS deposit, a pension and two FDs.',
                'You set up simple mode for him and share the household view.',
            ],
            result: 'He sees his money clearly in large text, and you both get the same maturity reminders.',
        },
    },
];

export function featureBySlug(slug: string): Feature | undefined {
    return FEATURES.find(feature => feature.slug === slug);
}

export type ToolIconName = 'emi' | 'payoff' | 'fd' | 'rd' | 'sip' | 'gold' | 'chit' | 'inflation';

export interface Tool {
    slug: string;
    name: string;
    icon: ToolIconName;
    /** One line for cards */
    short: string;
    /** The question the tool answers, used as the page heading */
    question: string;
}

/** The free calculators at /tools; each one runs entirely in the browser */
export const TOOLS: Tool[] = [
    { slug: 'emi-calculator', name: 'EMI calculator', icon: 'emi', short: 'Your monthly EMI, and how much of it is interest, year by year.', question: 'How much will my loan cost every month?' },
    { slug: 'loan-payoff', name: 'Which loan first?', icon: 'payoff', short: 'Have extra money each month? See which loan to clear first, and what you save.', question: 'Which loan should I close first?' },
    { slug: 'fd-calculator', name: 'FD calculator', icon: 'fd', short: 'What your fixed deposit will be worth when it matures.', question: 'What will my fixed deposit be worth?' },
    { slug: 'rd-calculator', name: 'RD calculator', icon: 'rd', short: 'How a monthly recurring deposit adds up, for a bike, a trip or a fee.', question: 'How much will my recurring deposit grow to?' },
    { slug: 'sip-calculator', name: 'SIP calculator', icon: 'sip', short: 'What a monthly SIP could grow to over the years.', question: 'What could my SIP grow to?' },
    { slug: 'gold-value', name: 'Gold value', icon: 'gold', short: 'What your jewellery or coins are worth, by weight and purity.', question: 'How much is my gold worth today?' },
    { slug: 'chit-fund', name: 'Chit fund return', icon: 'chit', short: 'Is your chit saving you money or costing you? See the real yearly rate.', question: 'Is my chit fund a good deal?' },
    { slug: 'inflation', name: 'Inflation', icon: 'inflation', short: 'What today\'s money will buy in the future, and what things will cost.', question: 'What will inflation do to my money?' },
];

export function toolBySlug(slug: string): Tool | undefined {
    return TOOLS.find(tool => tool.slug === slug);
}

export interface Question {
    q: string;
    a: string;
}

export const FAQ: Question[] = [
    {
        q: 'Is FinDB really free?',
        a: 'Yes. FinDB is free for everyone, with no paid plans, no ads and no "premium" features held back. It runs on free hosting services and is built to stay that way. If it ever needs support, it will ask for optional donations, which will never unlock features.',
    },
    {
        q: 'How does FinDB make money, then?',
        a: 'It does not. FinDB is built to cost almost nothing to run, so it does not need your money or your data. It will never show ads, sell or share your data, or earn commissions by pushing loans, cards, insurance or funds.',
    },
    {
        q: 'Does FinDB connect to my bank?',
        a: 'No. FinDB never connects to your bank on its own and never asks for your net banking password, card PIN or OTP. You add entries yourself or upload a statement you downloaded. FinDB never moves money.',
    },
    {
        q: 'Is my data safe?',
        a: 'Your data travels encrypted over HTTPS, passwords are stored as one-way hashes, every request is limited to your own records, and the database blocks one user from reading another user\'s rows. Two-step login with an authenticator app, and encryption of sensitive details such as PAN and account numbers, are being added next.',
    },
    {
        q: 'Do I have to type everything by hand?',
        a: 'Today, yes. Statement import is being built: you will upload the statement from your bank, check the entries on one screen and save them all at once. Repeating entries such as rent and EMIs will be added for you to confirm with one tap.',
    },
    {
        q: 'Can I use FinDB on my phone?',
        a: 'Yes. FinDB works in any modern browser on phones, tablets and computers, and you can add it to your home screen so it opens like an app. Apps for iPhone and Android are planned for later.',
    },
    {
        q: 'Is FinDB financial advice?',
        a: 'No. FinDB shows information and simple rule-based calculations, and always shows the rules it used. It does not tell you what to buy or sell. For personal advice, speak to a SEBI-registered investment adviser.',
    },
    {
        q: 'Can I take my data out, or delete it?',
        a: 'You can export your activity as CSV today, and a full export of everything, plus deleting your account, are part of the public launch. Your data is yours.',
    },
    {
        q: 'What does "double-entry" mean, and why should I care?',
        a: 'Every rupee that leaves one place arrives somewhere else. Withdrawing cash moves money from your bank to your wallet; it is not spending. FinDB records money this way, the same way accountants do, so totals never double-count and balances never drift.',
    },
    {
        q: 'Will FinDB be available in my language?',
        a: 'Yes, that is the plan. FinDB is being built so that every screen can be translated. Hindi and Telugu come first, followed by Tamil, Kannada, Marathi and Bengali.',
    },
    {
        q: 'Which features can I use today?',
        a: 'Bank accounts, credit cards, cash, income, expenses, the monthly summary and the activity log. Every feature page on this site says whether it is available now, in development or planned.',
    },
];

export interface RoadmapStage {
    title: string;
    status: FeatureStatus;
    summary: string;
    items: string[];
}

export const ROADMAP: RoadmapStage[] = [
    {
        title: 'Available today',
        status: 'available',
        summary: 'The core: your accounts and your month.',
        items: ['Bank accounts, credit cards and cash', 'Income and expenses', 'Monthly summary', 'Activity log with CSV export'],
    },
    {
        title: 'A stronger foundation',
        status: 'building',
        summary: 'The base every later feature is built on.',
        items: [
            'Accountant-grade records that never double-count',
            'A new design for phones, tablets and computers, in light and dark',
            'Categories, tags, events and repeating entries',
            'Meal cards and wallets',
            'Two-step login with an authenticator app',
            'Choose what you want to track',
        ],
    },
    {
        title: 'Less typing, more insight',
        status: 'building',
        summary: 'Import instead of typing, and learn from your own data.',
        items: ['Statement import from major Indian banks', 'Receipts and UPI screenshots read for you', 'Search across everything', 'Averages, subscriptions and budgets', 'A private document vault'],
    },
    {
        title: 'Debts, people and cards',
        status: 'building',
        summary: 'Everything you owe and everything owed to you.',
        items: ['Loans with EMIs, and gold loans', 'Chit funds', 'Money lent and borrowed', 'Shared costs on trips and with flatmates', 'Credit card bills, cashback and rewards', 'A calendar of everything due'],
    },
    {
        title: 'Public launch',
        status: 'building',
        summary: 'Ready for everyone.',
        items: ['Install on your phone, with entries that work offline', 'Reminders by notification', 'A weekly summary and "Your year in money"', 'Simple mode for parents', 'Hindi and Telugu', 'Full data export and account deletion'],
    },
    {
        title: 'Everything you own',
        status: 'planned',
        summary: 'Your full net worth.',
        items: ['Gold and investments with daily prices', 'Property, rent, vehicles and valuables', 'FDs, RDs, post office schemes, PF, NPS and pensions', 'Goals'],
    },
    {
        title: 'The full picture',
        status: 'planned',
        summary: 'Are you doing okay?',
        items: ['Net worth and its trend', 'Insurance and the tax centre', 'The money health check against inflation and the market', 'Family sharing, nominees and an estate summary'],
    },
    {
        title: 'Later',
        status: 'planned',
        summary: 'Once the core is excellent.',
        items: ['Apps for iPhone and Android', 'Voice entry', 'Accounts in other currencies and US stocks', 'Business and freelance income with GST'],
    },
];
