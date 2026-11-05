import type { TaskFilter } from '../types';

const FILTERS: Array<{ id: TaskFilter; label: string; title: string }> = [
  { id: 'all', label: 'All', title: 'All active and completed tasks' },
  { id: 'pending', label: 'Pending', title: 'Active tasks that are not overdue' },
  { id: 'overdue', label: 'Overdue', title: 'Active tasks past their deadline' },
  { id: 'completed', label: 'Completed', title: 'Finished tasks with full details' },
];

interface FilterTabsProps {
  value: TaskFilter;
  counts: Record<TaskFilter, number>;
  onChange: (filter: TaskFilter) => void;
}

export default function FilterTabs({ value, counts, onChange }: FilterTabsProps) {
  return (
    <div className="filter-tabs" role="group" aria-label="Filter tasks">
      {FILTERS.map(({ id, label, title }) => (
        <button
          key={id}
          type="button"
          className={`filter-tab${id === 'overdue' && counts.overdue > 0 ? ' has-overdue' : ''}`}
          aria-pressed={value === id}
          title={title}
          onClick={() => onChange(id)}
        >
          {label}
          <span className="filter-count">{counts[id]}</span>
        </button>
      ))}
    </div>
  );
}
