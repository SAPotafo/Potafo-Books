/* Potafo Accounts - Module 1: Cash Book
   One book per cash or bank ledger from Tally Ledgers (anything under Cash-in-Hand or Bank Accounts).
   The screen itself lives in js/book.js; this file only says how the Cash Book is named and worded. */
Potafo.createBook({
  id: 'cashbook',
  title: 'Cash Book',
  icon: '&#8377;',
  key: 'cashbook',                       // where the data is saved
  prefix: 'CB-',                         // voucher numbers: CB-0001
  kinds: ['cash', 'bank'],
  defaultAccount: 'Cash',
  accountLabel: 'Cash / Bank account',
  inWord: 'Receipt', outWord: 'Payment',
  inWords: 'Receipts', outWords: 'Payments',
  refLabel: 'Reference / Bill no.',
  balance: 'drcr',
  emptyNoun: 'cash or bank ledger',
  emptyText: 'The Cash Book lists the ledgers that are under <b>Cash-in-Hand</b> or <b>Bank Accounts</b> in Tally Ledgers.',
  openingNote: 'Cash or bank balance before your first entry.'
});
