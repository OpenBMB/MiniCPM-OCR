/**
 * "Try these tasks" example-card grid.
 *
 * Purpose: before a conversation starts, show a set of example prompts; clicking fills the copy into the input (a half-real feature). The copy is a static preset, echoing Volcano Ark's task-card area.
 */

import { Card } from '@map/ui';
import { useTranslation } from 'react-i18next';

interface TaskCardsProps {
  /** Click a card: fill the example copy into the input */
  onPick: (prompt: string) => void;
}

/**
 * Renders the example-card grid.
 * @param onPick Selection callback
 */
export function TaskCards({ onPick }: TaskCardsProps) {
  const { t } = useTranslation('playground');
  const tasks = [
    { title: t('taskWriteCopy'), prompt: t('taskWriteCopyPrompt') },
    { title: t('taskExplainConcept'), prompt: t('taskExplainConceptPrompt') },
    { title: t('taskCodeExample'), prompt: t('taskCodeExamplePrompt') },
    { title: t('taskSummarize'), prompt: t('taskSummarizePrompt') },
    { title: t('taskBrainstorm'), prompt: t('taskBrainstormPrompt') },
  ];
  return (
    <div className="w-full">
      <p className="mb-3 text-center text-xs text-muted-foreground">{t('taskSuggestions')}</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {tasks.map((task) => (
          <Card
            key={task.title}
            role="button"
            tabIndex={0}
            onClick={() => onPick(task.prompt)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick(task.prompt);
              }
            }}
            className="cursor-pointer p-3 transition-shadow hover:shadow-md"
          >
            <p className="text-sm font-medium text-foreground">{task.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {task.prompt}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
