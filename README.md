# MyFinance

MyFinance is a mobile personal finance app built with React Native (Expo) and SQLite.

## App Features

- Manual expense tracking with:
  - Product name
  - Quantity
  - Amount
  - Category
  - Account used
- Receipt upload and OCR text analysis to extract:
  - Item names (when available)
  - Item amounts
  - Receipt total
- Fallback receipt support:
  - If item detail is missing, saves total as `Receipt without name`
- Transfer workflows:
  - `Received transfer` (adds to selected account)
  - `Sent transfer` (subtracts from selected account)
- Account management:
  - Create custom accounts
  - Set custom account color
  - Add or subtract balance
  - Delete accounts
- Budget by category:
  - Set budget limit per category
  - Increase/decrease budget
  - Remaining budget auto-calculation based on expenses
  - Threshold alerts (50%, 25%, 10%, 0%, overspent)
- Home dashboard:
  - Monthly spending structure (pie chart)
  - Monthly total insights (including category highlights)
  - Product history grouped by month/year
- Transactions view:
  - Month/year filters
  - Product search with predictions from stored history
  - Delete entries from table and database
- Settings:
  - Language switch (Spanish/English)
  - Theme switch (dark/light)
  - Number/thousand separator format options
  - Contact button for bug reports by email
- Data persistence:
  - Local SQLite storage
  - Existing user data preserved across app updates (same package + signing key)
