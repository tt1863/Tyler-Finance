/** Starting category setups. Group name -> category names. */
export interface Template {
  id: string;
  name: string;
  description: string;
  groups: Record<string, string[]>;
}

export const TEMPLATES: Template[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'A general setup that works for most people.',
    groups: {
      Bills: ['Rent/Mortgage', 'Electric', 'Water', 'Internet', 'Phone', 'Insurance'],
      Needs: ['Groceries', 'Transportation', 'Medical'],
      Wants: ['Dining Out', 'Entertainment', 'Shopping', 'Vacation'],
      Savings: ['Emergency Fund', 'Car Replacement'],
    },
  },
  {
    id: 'single',
    name: 'Living solo',
    description: 'One person, one paycheck, simple bills.',
    groups: {
      'Monthly Bills': ['Rent', 'Utilities', 'Phone', 'Internet', 'Subscriptions', "Renter's Insurance"],
      'Everyday Spending': ['Groceries', 'Gas & Transit', 'Personal Care', 'Household Supplies'],
      'True Expenses': ['Car Maintenance', 'Medical', 'Clothing', 'Gifts', 'Annual Subscriptions'],
      'Quality of Life': ['Dining Out', 'Fun Money', 'Hobbies', 'Travel', 'Fitness'],
      Goals: ['Emergency Fund', 'Retirement', 'Next Car'],
    },
  },
  {
    id: 'family',
    name: 'Family',
    description: 'Kids, childcare, school and bigger household costs.',
    groups: {
      'Monthly Bills': ['Mortgage/Rent', 'Electric', 'Water & Trash', 'Internet', 'Phones', 'Insurance', 'Childcare'],
      'Everyday Spending': ['Groceries', 'Gas', 'Household Supplies', 'Diapers & Baby', 'Eating Out'],
      Kids: ['School Supplies & Fees', 'Activities & Sports', 'Kids Clothing', 'Allowance', 'Birthday Parties'],
      'True Expenses': ['Home Maintenance', 'Car Maintenance', 'Medical & Dental', 'Holidays & Gifts', 'Car Registration'],
      'Quality of Life': ['Family Fun', 'Date Night', 'Vacation', 'Fun Money'],
      Goals: ['Emergency Fund', 'College Savings', 'Retirement'],
    },
  },
  {
    id: 'student',
    name: 'Student',
    description: 'Tuition, textbooks and a tight budget.',
    groups: {
      School: ['Tuition', 'Textbooks', 'Supplies', 'Fees'],
      Housing: ['Rent', 'Utilities', 'Internet', 'Phone'],
      'Everyday Spending': ['Groceries', 'Transit', 'Coffee & Snacks', 'Personal Care'],
      'Fun & Social': ['Eating Out', 'Entertainment', 'Trips Home'],
      Goals: ['Emergency Fund', 'Student Loan Payoff'],
    },
  },
  {
    id: 'freelancer',
    name: 'Freelancer',
    description: 'Irregular income, taxes and business costs.',
    groups: {
      'Taxes & Business': ['Quarterly Taxes', 'Business Software', 'Equipment', 'Professional Fees', 'Health Insurance'],
      'Monthly Bills': ['Rent/Mortgage', 'Utilities', 'Internet', 'Phone'],
      'Everyday Spending': ['Groceries', 'Transportation', 'Household'],
      'True Expenses': ['Medical', 'Car Maintenance', 'Gifts', 'Clothing'],
      'Quality of Life': ['Dining Out', 'Entertainment', 'Travel'],
      Goals: ['Income Buffer', 'Emergency Fund', 'Retirement (SEP/Solo 401k)'],
    },
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
