import type { Task, TaskComment } from '../types';
import { ListIcon } from './icons';
import TaskItem from './TaskItem';

interface TaskListProps {
  tasks: Task[];
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onAddComment: (taskId: string, text: string, progress: number) => Promise<boolean>;
  onDeleteComment: (taskId: string, commentId: string) => void;
  canCompleteTask?: (task: Task) => boolean;
  canDeleteTask?: (task: Task) => boolean;
  canDeleteComment?: (task: Task, comment: TaskComment) => boolean;
  emptyTitle?: string;
  emptyMessage?: string;
}

export default function TaskList({
  tasks,
  onComplete,
  onDelete,
  onAddComment,
  onDeleteComment,
  canCompleteTask,
  canDeleteTask,
  canDeleteComment,
  emptyTitle = 'All clear',
  emptyMessage = 'Add your first task above.',
}: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="empty">
        <ListIcon />
        <p>{emptyTitle}</p>
        <span>{emptyMessage}</span>
      </div>
    );
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          onComplete={onComplete}
          onDelete={onDelete}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          canComplete={canCompleteTask ? canCompleteTask(task) : true}
          canDelete={canDeleteTask ? canDeleteTask(task) : true}
          canDeleteComment={
            canDeleteComment ? (comment) => canDeleteComment(task, comment) : undefined
          }
        />
      ))}
    </ul>
  );
}
