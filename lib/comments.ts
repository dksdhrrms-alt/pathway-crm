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
  try {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('entity_type', parentType)
      .eq('entity_id', parentId)
      .order('created_at', { ascending: true });
    if (error) { console.error('[COMMENTS] fetch error:', error.message, error.code, error.details); return []; }
    return (data || []).map((r) => ({
      id: r.id,
      parentType: r.entity_type,
      parentId: r.entity_id,
      body: r.body,
      authorId: r.author_id || '',
      authorName: r.author_name || 'Unknown',
      createdAt: r.created_at,
    }));
  } catch (err) {
    console.error('[COMMENTS] fetch exception:', err);
    return [];
  }
}

export async function addComment(comment: Omit<Comment, 'createdAt'>): Promise<Comment | null> {
  if (!supabaseEnabled) {
    console.warn('[COMMENTS] Supabase not enabled, saving locally');
    return { ...comment, createdAt: new Date().toISOString() };
  }

  const row = {
    id: comment.id,
    entity_type: comment.parentType,
    entity_id: comment.parentId,
    body: comment.body,
    author_id: comment.authorId || 'anonymous',
    author_name: comment.authorName || 'Unknown',
  };

  console.log('[COMMENTS] inserting:', row);

  try {
    const { data, error } = await supabase
      .from('comments')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error('[COMMENTS] insert error:', error.message, error.code, error.details, error.hint);
      // Return local version so UI still shows the comment
      return { ...comment, createdAt: new Date().toISOString() };
    }

    console.log('[COMMENTS] insert success:', data.id);
    return {
      id: data.id,
      parentType: data.entity_type,
      parentId: data.entity_id,
      body: data.body,
      authorId: data.author_id || '',
      authorName: data.author_name || 'Unknown',
      createdAt: data.created_at,
    };
  } catch (err) {
    console.error('[COMMENTS] insert exception:', err);
    return { ...comment, createdAt: new Date().toISOString() };
  }
}

export async function deleteComment(id: string): Promise<boolean> {
  if (!supabaseEnabled) return true;
  try {
    const { error } = await supabase.from('comments').delete().eq('id', id);
    if (error) { console.error('[COMMENTS] delete error:', error.message); return false; }
    return true;
  } catch (err) {
    console.error('[COMMENTS] delete exception:', err);
    return false;
  }
}
