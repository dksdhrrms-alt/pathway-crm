'use client';

import { useState, useEffect, useCallback } from 'react';
import { Comment, getComments, addComment, deleteComment } from '@/lib/comments';

export function useComments(parentType: 'activity' | 'task' | 'opportunity', parentId: string) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!parentId) return;
    setLoading(true);
    const data = await getComments(parentType, parentId);
    setComments(data);
    setLoading(false);
  }, [parentType, parentId]);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (comment: Omit<Comment, 'createdAt'>) => {
    const result = await addComment(comment);
    if (result) setComments((prev) => [...prev, result]);
    return result;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteComment(id);
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { comments, loading, add, remove, reload: load };
}
