/**
 * 「试试以下任务」示例卡片网格。
 *
 * 用途：对话开始前展示一组示例提示词，点击把文案填入输入框（半真功能）。
 * 文案为静态预设，呼应火山方舟的任务卡片区。
 */

import { Card } from '@map/ui';
import { useTranslation } from 'react-i18next';

interface TaskCardsProps {
  /** 点击卡片：把示例文案填入输入框 */
  onPick: (prompt: string) => void;
}

/**
 * 渲染示例卡片网格。
 * @param onPick 选中回调
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
