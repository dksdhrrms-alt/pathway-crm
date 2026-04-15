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
    // Optimistic: add immediately
    const optimistic: Comment = { ...comment, createdAt: new Date().toISOString() };
    setComments((prev) => [...prev, optimistic]);

    const result = await addComment(comment);
    if (result) {
      // Replace optimistic with server result
      setComments((prev) => prev.map((c) => c.id === comment.id ? result : c));
    }
    // If result is null but addComment returns local fallback, it's already in state
    return result;
  }, []);

  const remove = useCallback(async (id: string) => {
    // Optimistic: remove immediately
    const prev = comments;
    setComments((p) => p.filter((c) => c.id !== id));

    const success = await deleteComment(id);
    if (!success) {
      // Rollback on failure
      setComments(prev);
    }
  }, [comments]);

  return { comments, loading, add, remove, reload: load };
}
