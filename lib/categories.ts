/**
 * Default categories and the keywords that suggest them (v2 plan, Phase 1). Each user gets these
 * as income and expense accounts in the ledger, and can rename them, mark spending essential or
 * not, and add their own. Plain data, shared by the server and the screens.
 */

export interface DefaultCategory {
    key: string;
    name: string;
    /** Spending only: essential (rent, groceries) or discretionary (restaurants, shopping) */
    essential?: boolean;
}

export const EXPENSE_CATEGORIES: readonly DefaultCategory[] = [
    { key: 'rent', name: 'Rent', essential: true },
    { key: 'groceries', name: 'Groceries', essential: true },
    { key: 'restaurants', name: 'Restaurants and food delivery', essential: false },
    { key: 'fuel', name: 'Fuel', essential: true },
    { key: 'transport', name: 'Transport', essential: true },
    { key: 'subscriptions', name: 'Subscriptions', essential: false },
    { key: 'entertainment', name: 'Movies and entertainment', essential: false },
    { key: 'shopping', name: 'Shopping', essential: false },
    { key: 'health', name: 'Health', essential: true },
    { key: 'education', name: 'Education', essential: true },
    { key: 'travel', name: 'Travel', essential: false },
    { key: 'bills', name: 'Bills and utilities', essential: true },
    { key: 'insurance', name: 'Insurance', essential: true },
    { key: 'loan_interest', name: 'Loan interest and fees', essential: true },
    { key: 'taxes', name: 'Taxes', essential: true },
    { key: 'gifts', name: 'Gifts', essential: false },
    { key: 'personal_care', name: 'Personal care', essential: false },
    { key: 'other_expense', name: 'Other', essential: false },
];

export const INCOME_CATEGORIES: readonly DefaultCategory[] = [
    { key: 'salary', name: 'Salary' },
    { key: 'pension', name: 'Pension' },
    { key: 'freelance', name: 'Freelance' },
    { key: 'rental_income', name: 'Rental income' },
    { key: 'interest', name: 'Interest' },
    { key: 'dividends', name: 'Dividends' },
    { key: 'meal_benefit', name: 'Meal benefit' },
    { key: 'cashback', name: 'Cashback and rewards' },
    { key: 'gifts_received', name: 'Gifts received' },
    { key: 'refund', name: 'Refund' },
];

/**
 * Words in a title that suggest a default category, checked in order, whole words only. The
 * user's own past choices come first (lib/services/categories.ts); these fill in until then.
 */
export const CATEGORY_KEYWORDS: ReadonlyArray<{ key: string; words: string[] }> = [
    { key: 'restaurants', words: ['swiggy', 'zomato', 'restaurant', 'cafe', 'coffee', 'dominos', 'pizza', 'mcdonalds', 'kfc', 'starbucks', 'lunch', 'dinner', 'breakfast', 'biryani', 'tea'] },
    { key: 'groceries', words: ['grocery', 'groceries', 'bigbasket', 'blinkit', 'zepto', 'instamart', 'dmart', 'vegetables', 'fruits', 'milk', 'kirana', 'supermarket'] },
    { key: 'fuel', words: ['petrol', 'diesel', 'fuel', 'hp', 'iocl', 'indianoil', 'bpcl', 'cng', 'shell'] },
    { key: 'transport', words: ['uber', 'ola', 'rapido', 'metro', 'bus', 'auto', 'taxi', 'cab', 'parking', 'toll', 'fastag'] },
    { key: 'rent', words: ['rent', 'maintenance', 'society'] },
    { key: 'subscriptions', words: ['netflix', 'hotstar', 'prime', 'spotify', 'youtube', 'subscription', 'jiocinema', 'icloud'] },
    { key: 'entertainment', words: ['movie', 'movies', 'pvr', 'inox', 'bookmyshow', 'concert', 'game'] },
    { key: 'shopping', words: ['amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'meesho', 'shopping', 'clothes', 'shoes'] },
    { key: 'health', words: ['pharmacy', 'medicine', 'medicines', 'doctor', 'hospital', 'apollo', 'pharmeasy', 'netmeds', 'clinic', 'lab', 'dental'] },
    { key: 'education', words: ['school', 'college', 'tuition', 'fees', 'course', 'books', 'udemy', 'coaching'] },
    { key: 'travel', words: ['flight', 'irctc', 'train', 'hotel', 'makemytrip', 'goibibo', 'airbnb', 'trip', 'indigo'] },
    { key: 'bills', words: ['electricity', 'water', 'gas', 'broadband', 'internet', 'wifi', 'mobile', 'recharge', 'airtel', 'jio', 'bsnl', 'bescom', 'dth', 'cylinder'] },
    { key: 'insurance', words: ['insurance', 'premium', 'lic', 'policy'] },
    { key: 'loan_interest', words: ['interest', 'emi', 'loan'] },
    { key: 'taxes', words: ['tax', 'gst', 'tds'] },
    { key: 'gifts', words: ['gift', 'gifts', 'donation', 'wedding'] },
    { key: 'personal_care', words: ['salon', 'haircut', 'spa', 'grooming', 'parlour'] },
    { key: 'salary', words: ['salary', 'payroll', 'wages'] },
    { key: 'freelance', words: ['freelance', 'consulting', 'invoice', 'client'] },
    { key: 'rental_income', words: ['tenant'] },
    { key: 'dividends', words: ['dividend', 'dividends'] },
    { key: 'meal_benefit', words: ['pluxee', 'sodexo', 'meal', 'zeta'] },
    { key: 'cashback', words: ['cashback', 'reward', 'rewards'] },
    { key: 'refund', words: ['refund', 'reversal'] },
    { key: 'pension', words: ['pension'] },
];

const EXPENSE_KEYS = new Set(EXPENSE_CATEGORIES.map(category => category.key));
const INCOME_KEYS = new Set(INCOME_CATEGORIES.map(category => category.key));

/** The words of a title, lower case, without punctuation */
export function titleWords(title: string): string[] {
    return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/** The default category a title suggests, by keyword, for income or spending; null if none fits */
export function suggestByKeyword(title: string, kind: 'income' | 'expense'): string | null {
    const words = new Set(titleWords(title));
    const allowed = kind === 'income' ? INCOME_KEYS : EXPENSE_KEYS;
    for (const { key, words: keywords } of CATEGORY_KEYWORDS) {
        if (allowed.has(key) && keywords.some(word => words.has(word))) return key;
    }
    // "Interest" on its own is income (from a bank) when the entry is income
    if (kind === 'income' && words.has('interest')) return 'interest';
    return null;
}
