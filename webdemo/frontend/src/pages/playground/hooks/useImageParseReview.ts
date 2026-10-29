import { useState } from 'react';

/**
 * The top bar and the review list share filtering and paging; changing the result resets immediately, and switching tabs keeps the current progress.
 * @param resultKey current parse-result id
 * @returns the filter, the number of rows shown, and the matching actions
 */
export function useImageParseReview(resultKey: string) {
  const [state, setState] = useState({ resultKey, all: false, limit: 40 });
  // Reset together with the result identity, so a new document does not briefly use the old filter, and returning to an old document does not restore an expired page.
  if (state.resultKey !== resultKey) {
    setState({ resultKey, all: false, limit: 40 });
  }
  return {
    all: state.all,
    limit: state.limit,
    toggleAll: () => setState((current) => ({ ...current, all: !current.all, limit: 40 })),
    loadMore: () => setState((current) => ({ ...current, limit: current.limit + 40 })),
  };
}
