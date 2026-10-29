import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** After a save or delete, invalidate only that record and its attachment aliases; other details keep a short cache. */
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
