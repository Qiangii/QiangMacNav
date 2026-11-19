import type { Key, ReactNode } from 'react';
import { MacScrollArea } from './MacScrollArea';
import './mac-table.css';

export interface MacTableColumn<Row> {
  heading: string;
  width?: string;
  cell: (row: Row) => ReactNode;
}

interface MacTableProps<Row> {
  label: string;
  columns: MacTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => Key;
  loading: boolean;
  error: string;
  emptyText: string;
  minWidth: number;
  footer?: ReactNode;
}

export function MacTable<Row>({ label, columns, rows, rowKey, loading, error, emptyText, minWidth, footer }: MacTableProps<Row>) {
  const showRows = !loading && !error && rows.length > 0;
  return <div className="mac-table-frame">
    <MacScrollArea className="mac-table-scroll" role="region" aria-label={`${label}表格区域`} tabIndex={0}>
      <table className="mac-table" aria-label={label} aria-busy={loading} style={{ minWidth }}>
        <colgroup>{columns.map(column => <col key={column.heading} style={{ width: column.width }} />)}</colgroup>
        <thead><tr>{columns.map(column => <th key={column.heading} scope="col">{column.heading}</th>)}</tr></thead>
        <tbody>{showRows && rows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.heading}>{column.cell(row)}</td>)}</tr>)}</tbody>
      </table>
    </MacScrollArea>
    {!showRows && <p className="mac-table-message" role={error ? 'alert' : 'status'}>{loading ? '正在加载…' : error || emptyText}</p>}
    {footer && <div className="mac-table-footer">{footer}</div>}
  </div>;
}
