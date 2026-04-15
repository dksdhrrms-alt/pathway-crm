'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useComments } from '@/hooks/useComments';
import { generateId } from '@/lib/data';

interface Props {
  parentType: 'activity' | 'task' | 'opportunity';
  parentId: string;
}

export default function CommentThread({ parentType, parentId }: Props) {
  const { data: session } = useSession();
  const { comments, loading, add, remove } = useComments(parentType, parentId);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    await add({
      id: generateId(),
      parentType,
      parentId,
      body: text.trim(),
      authorId: session?.user?.id || '',
      authorName: session?.user?.name || 'Unknown',
    });
    setText('');
    setSubmitting(false);
  }

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Comment list */}
      {loading && <div style={{ fontSize: '11px', color: '#aaa', padding: '4px 0' }}>Loading...</div>}
      {comments.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          {comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: '8px', padding: '6px 0', borderBottom: '0.5px solid #f3f4f6' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%', background: '#185FA5',
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '9px', fontWeight: 600, flexShrink: 0, marginTop: '2px',
              }}>
                {c.authorName.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#333' }}>{c.authorName}</span>
                  <span style={{ fontSize: '10px', color: '#aaa' }}>
                    {new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' '}
                    {new Date(c.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  {c.authorId === (session?.user?.id || '') && (
                    <button onClick={() => remove(c.id)}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', fontSize: '12px', padding: '0 2px' }}
                      title="Delete">
                      ×
                    </button>
                  )}
                </div>
                <p style={{ fontSize: '12px', color: '#444', margin: '2px 0 0', lineHeight: 1.5 }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Add a comment..."
          style={{
            flex: 1, padding: '6px 10px', fontSize: '12px',
            border: '1px solid #e5e7eb', borderRadius: '6px',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          style={{
            padding: '6px 12px', borderRadius: '6px', border: 'none',
            background: text.trim() ? '#1a4731' : '#e5e7eb',
            color: text.trim() ? 'white' : '#aaa',
            fontSize: '11px', fontWeight: 500, cursor: text.trim() ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
          }}
        >
          Reply
        </button>
      </div>
    </div>
  );
}
