import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** 保存或删除后仅失效该记录及其附件别名，其他详情保留短缓存。 */
export async function invalidateImageParseHistoryRecord(
  client: QueryClient,
  queryKey: QueryKey,
  id: string,
  attachmentId?: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: [...queryKey, 'entry'],
    predicate: ({ queryKey: key }) =>
      (key[5] === false && key[6] === id) || (key[5] === true && key[6] === attachmentId),
  });
  await client.invalidateQueries({ queryKey, exact: true });
}
