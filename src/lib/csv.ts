import type { Expense, Settlement } from '../types';
import { SPLIT_MODE_LABELS } from './audit';
import { todayISO } from './dates';

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\n\r;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatCsvAmount(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

export function generateGroupCsv(params: {
  groupName: string;
  baseCurrency: string;
  expenses: Expense[];
  settlements: Settlement[];
  nameOf: (userId: string) => string;
}): string {
  const { baseCurrency, expenses, settlements, nameOf } = params;

  const headers = [
    'Data',
    'Tipo',
    'Descrizione',
    'Categoria',
    'Pagato da',
    'Partecipanti / Destinatario',
    'Importo originale',
    'Valuta',
    'Tasso di cambio',
    'Tipo cambio',
    `Importo in ${baseCurrency}`,
    'Modalità divisione',
    'Dettaglio quote',
    'Ricorrente',
    'Nota',
  ];

  type Row = { sortDate: string; sortCreated: string; cells: string[] };
  const rows: Row[] = [];

  for (const exp of expenses) {
    const participants = exp.splits.map((s) => nameOf(s.userId)).join(', ');
    const splitDetails = exp.splits
      .map((s) => {
        const basePart =
          exp.currency === baseCurrency
            ? `${formatCsvAmount(s.amount)} ${exp.currency}`
            : `${formatCsvAmount(s.amount)} ${exp.currency} (${formatCsvAmount(s.baseAmount)} ${baseCurrency})`;
        const pct =
          exp.splitMode === 'percentage' && s.percentage !== null
            ? ` [${s.percentage.toFixed(2)}%]`
            : '';
        return `${nameOf(s.userId)}: ${basePart}${pct}`;
      })
      .join(' | ');

    rows.push({
      sortDate: exp.expenseDate,
      sortCreated: exp.createdAt,
      cells: [
        exp.expenseDate,
        'Spesa',
        exp.description,
        exp.categoryLabel,
        nameOf(exp.paidBy),
        participants,
        formatCsvAmount(exp.amount),
        exp.currency,
        exp.currency === baseCurrency ? '1' : String(exp.exchangeRate),
        exp.currency === baseCurrency
          ? 'Valuta base'
          : exp.rateIsManual
            ? 'Manuale'
            : `Automatico (${exp.rateDate})`,
        formatCsvAmount(exp.baseAmount),
        SPLIT_MODE_LABELS[exp.splitMode],
        splitDetails,
        exp.recurringId ? 'Sì' : 'No',
        exp.note,
      ],
    });
  }

  for (const st of settlements) {
    const isTransferIn = st.kind === 'transfer_in';
    const isTransferOut = st.kind === 'transfer_out';

    // Per transfer_in: fromUser è il creditore, toUser è il debitore
    const tipo = isTransferIn
      ? 'Saldo riportato (entrata)'
      : isTransferOut
        ? 'Saldo trasferito (uscita)'
        : 'Rimborso';
    const desc = isTransferIn
      ? `Saldo riportato da "${st.linkedGroupName ?? 'altro gruppo'}": ${nameOf(st.toUser)} deve a ${nameOf(st.fromUser)}`
      : isTransferOut
        ? `Saldo spostato in "${st.linkedGroupName ?? 'altro gruppo'}": ${nameOf(st.fromUser)} verso ${nameOf(st.toUser)}`
        : `Rimborso da ${nameOf(st.fromUser)} a ${nameOf(st.toUser)}`;
    const detail = isTransferIn
      ? `${nameOf(st.toUser)} deve a ${nameOf(st.fromUser)}: ${formatCsvAmount(st.baseAmount)} ${baseCurrency}`
      : `${nameOf(st.fromUser)} -> ${nameOf(st.toUser)}: ${formatCsvAmount(st.baseAmount)} ${baseCurrency}`;

    rows.push({
      sortDate: st.settlementDate,
      sortCreated: st.createdAt,
      cells: [
        st.settlementDate,
        tipo,
        desc,
        tipo,
        isTransferIn ? nameOf(st.toUser) : nameOf(st.fromUser),
        isTransferIn ? nameOf(st.fromUser) : nameOf(st.toUser),
        formatCsvAmount(st.amount),
        st.currency,
        st.currency === baseCurrency ? '1' : String(st.exchangeRate),
        st.currency === baseCurrency
          ? 'Valuta base'
          : st.rateIsManual
            ? 'Manuale'
            : `Automatico (${st.rateDate})`,
        formatCsvAmount(st.baseAmount),
        '—',
        detail,
        'No',
        st.note,
      ],
    });
  }

  rows.sort(
    (a, b) => b.sortDate.localeCompare(a.sortDate) || b.sortCreated.localeCompare(a.sortCreated)
  );

  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.cells.map(escapeCsvCell).join(',')),
  ];

  // Prefisso UTF-8 BOM per compatibilità immediata con Excel, Numbers e Google Fogli
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function downloadCsvFile(csvContent: string, groupName: string): void {
  const safeSlug =
    groupName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'gruppo';
  const filename = `conti-insieme-${safeSlug}-${todayISO()}.csv`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
