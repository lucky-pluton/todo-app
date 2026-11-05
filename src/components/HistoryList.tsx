import type { HistoryEntry } from '../types';
import HistoryItem from './HistoryItem';

interface HistoryListProps {
  entries: HistoryEntry[];
}

export default function HistoryList({ entries }: HistoryListProps) {
  if (entries.length === 0) {
    return (
      <div className="empty small">
        <p>No completed tasks yet</p>
        <span>Check off a task and it will be saved here.</span>
      </div>
    );
  }

  return (
    <ul className="history-list">
      {entries.map((entry) => (
        <HistoryItem key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}
