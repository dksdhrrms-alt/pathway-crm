import { supabase, supabaseEnabled } from './supabase';

export interface Comment {
  id: string;
  parentType: 'activity' | 'task' | 'opportunity';
  parentId: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export async function getComments(parentType: string, parentId: string): Promise<Comment[]> {
  if (!supabaseEnabled) return [];
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true });
  if (error) { console.error('[COMMENTS] fetch error:', error.message); return []; }
  return (data || []).map((r) => ({
    id: r.id,
    parentType: r.parent_type,
    parentId: r.parent_id,
    body: r.body,
    authorId: r.author_id,
    authorName: r.author_name,
    createdAt: r.created_at,
  }));
}

export async function addComment(comment: Omit<Comment, 'createdAt'>): Promise<Comment | null> {
  if (!supabaseEnabled) return null;
  const { data, error } = await supabase
    .from('comments')
    .insert({
      id: comment.id,
      parent_type: comment.parentType,
      parent_id: comment.parentId,
      body: comment.body,
      author_id: comment.authorId,
      author_name: comment.authorName,
    })
    .select()
    .single();
  if (error) { console.error('[COMMENTS] insert error:', error.message); return null; }
  return {
    id: data.id,
    parentType: data.parent_type,
    parentId: data.parent_id,
    body: data.body,
    authorId: data.author_id,
    authorName: data.author_name,
    createdAt: data.created_at,
  };
}

export async function deleteComment(id: string): Promise<void> {
  if (!supabaseEnabled) return;
  await supabase.from('comments').delete().eq('id', id);
}
