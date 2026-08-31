import { useQuery } from '@tanstack/react-query';
import { getProgressPhotoPair } from '../api.ts';
import { queryKeys } from './keys.ts';

/** `photo_pair` — the earliest and latest progress photos (opt-in; omission when off or empty). */
export function useProgressPhotoPair() {
  return useQuery({ queryKey: queryKeys.progressPhotos.pair, queryFn: getProgressPhotoPair });
}
