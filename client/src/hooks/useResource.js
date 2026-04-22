import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api';

/**
 * React Query hooks wrapping the generic CRUD endpoints.
 * Keying by [resource] — mutations invalidate the list so the UI re-fetches.
 */

export function useResourceList(resource, { enabled = true } = {}) {
  return useQuery({
    queryKey: [resource, 'list'],
    queryFn: () => api.getAll(resource),
    enabled,
  });
}

export function useResourceItem(resource, id, { enabled = true } = {}) {
  return useQuery({
    queryKey: [resource, 'item', id],
    queryFn: () => api.getOne(resource, id),
    enabled: enabled && id != null,
  });
}

export function useCreateResource(resource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.create(resource, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
  });
}

export function useUpdateResource(resource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.update(resource, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
  });
}

export function useDeleteResource(resource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.remove(resource, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [resource] }),
  });
}

export function useAnalyzeItem(resource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.analyzeItem(resource, id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: [resource, 'item', id] });
      qc.invalidateQueries({ queryKey: [resource, 'list'] });
    },
  });
}
