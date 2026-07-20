/**
 * Fetches provider AI/agent or model catalogs for the health-check profile form.
 */

import { useEffect, useMemo, useState } from 'react';
import * as api from '../../services/api';
import type { LlmModel } from '../../types/api';
import { buildAiOptions, buildModelOptions, type ProviderAi } from '../../lib/health-check-profiles';

export function useProviderCatalogOptions(
  providerId: string,
  profileType: 'agent' | 'model',
  isModelOnlyProvider: boolean,
) {
  const [availableAis, setAvailableAis] = useState<ProviderAi[]>([]);
  const [availableModels, setAvailableModels] = useState<LlmModel[]>([]);
  const [fetchingAis, setFetchingAis] = useState(false);

  useEffect(() => {
    if (!providerId) {
      setAvailableAis([]);
      setAvailableModels([]);
      return;
    }

    let cancelled = false;
    setFetchingAis(true);

    const effectiveType = isModelOnlyProvider ? 'model' : profileType;

    if (effectiveType === 'agent') {
      setAvailableModels([]);
      api
        .listProviderAis(providerId)
        .then((ais) => {
          if (!cancelled) {
            const isList = Array.isArray(ais);
            console.log(
              '[HC Profiles] Provider AI response:',
              `isArray=${isList}`,
              `type=${typeof ais}`,
              isList ? `count=${ais.length}` : `keys=${Object.keys(ais as object)}`,
            );
            if (isList) {
              console.table(
                ais.map((a) => {
                  const raw = a as unknown as Record<string, unknown>;
                  return { id: raw.id, aiId: raw.aiId, name: raw.name };
                }),
              );
            }
            setAvailableAis(isList ? ais : []);
          }
        })
        .catch((err) => {
          console.error('[HC Profiles] Failed to fetch AIs:', err);
          if (!cancelled) setAvailableAis([]);
        })
        .finally(() => {
          if (!cancelled) setFetchingAis(false);
        });
    } else {
      setAvailableAis([]);
      api
        .listProviderModels(providerId)
        .then((models) => {
          if (!cancelled) setAvailableModels(Array.isArray(models) ? models : []);
        })
        .catch(() => {
          if (!cancelled) setAvailableModels([]);
        })
        .finally(() => {
          if (!cancelled) setFetchingAis(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [providerId, profileType, isModelOnlyProvider]);

  const aiOptions = useMemo(() => buildAiOptions(availableAis), [availableAis]);
  const modelOptions = useMemo(() => buildModelOptions(availableModels), [availableModels]);

  function resetCatalog() {
    setAvailableAis([]);
    setAvailableModels([]);
  }

  return {
    availableAis,
    availableModels,
    fetchingAis,
    aiOptions,
    modelOptions,
    resetCatalog,
  };
}
