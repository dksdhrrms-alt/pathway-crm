'use client';

/**
 * OrgMap — company-structure visualization for one Account.
 *
 * Renders every contact belonging to the account as a ReactFlow node,
 * draws edges from each contact to their `reportsToContactId` manager,
 * and lets reps tag who's the Champion / Decision Maker / Blocker and
 * assign a 1-5 influence score. Node color encodes role, size encodes
 * influence.
 *
 * Data model: data-migration/41-contact-org-map.sql. Edit flow uses
 * dbUpdateContact so changes land in the same `contacts` table the
 * rest of the CRM reads.
 *
 * Install: @xyflow/react (added to package.json).
 */

import { useMemo, useState, useCallback } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, Position,
  type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCRM } from '@/lib/CRMContext';
import type { Contact, ContactRoleInDeal } from '@/lib/data';

interface Props {
  accountId: string;
}

const ROLE_META: Record<ContactRoleInDeal, { label: string; bg: string; border: string; icon: string }> = {
  decision_maker: { label: 'Decision Maker', bg: '#1e40af',  border: '#1e3a8a', icon: '👑' },
  champion:       { label: 'Champion',       bg: '#047857',  border: '#065f46', icon: '🎯' },
  influencer:     { label: 'Influencer',     bg: '#7c3aed',  border: '#6d28d9', icon: '⭐' },
  user:           { label: 'End User',       bg: '#64748b',  border: '#475569', icon: '👤' },
  blocker:        { label: 'Blocker',        bg: '#b91c1c',  border: '#991b1b', icon: '🛑' },
  unknown:        { label: 'Unknown',        bg: '#9ca3af',  border: '#6b7280', icon: '❔' },
};

export default function OrgMap({ accountId }: Props) {
  const { contacts, updateContact } = useCRM();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const accountContacts = useMemo(
    () => contacts.filter((c) => c.accountId === accountId),
    [contacts, accountId],
  );

  // Build nodes + edges from the contact graph.
  // Layout: naive top-down tree. Managers (no reports_to or whose
  // reports_to isn't in this account) at the top, direct reports fan
  // out below. Enough for 10-30 contacts; above that users should
  // drag nodes themselves (ReactFlow supports it out of the box).
  const { nodes, edges } = useMemo(() => {
    const ids = new Set(accountContacts.map((c) => c.id));
    // Roots: no reports-to OR reports-to is outside this account
    const roots = accountContacts.filter((c) =>
      !c.reportsToContactId || !ids.has(c.reportsToContactId),
    );

    // Build children map
    const childrenOf = new Map<string, Contact[]>();
    for (const c of accountContacts) {
      if (c.reportsToContactId && ids.has(c.reportsToContactId)) {
        const arr = childrenOf.get(c.reportsToContactId) || [];
        arr.push(c);
        childrenOf.set(c.reportsToContactId, arr);
      }
    }

    // DFS layout
    const positions = new Map<string, { x: number; y: number }>();
    let nextRootX = 0;
    const H_GAP = 220;
    const V_GAP = 140;

    const layout = (id: string, depth: number): number => {
      const kids = childrenOf.get(id) || [];
      if (kids.length === 0) {
        const x = nextRootX;
        nextRootX += H_GAP;
        positions.set(id, { x, y: depth * V_GAP });
        return x;
      }
      const kidXs = kids.map((k) => layout(k.id, depth + 1));
      const avgX = (kidXs[0] + kidXs[kidXs.length - 1]) / 2;
      positions.set(id, { x: avgX, y: depth * V_GAP });
      return avgX;
    };
    roots.forEach((r) => layout(r.id, 0));

    // Nodes
    const ns: Node[] = accountContacts.map((c) => {
      const role: ContactRoleInDeal = (c.roleInDeal as ContactRoleInDeal) || 'unknown';
      const meta = ROLE_META[role];
      const score = c.influenceScore ?? 3;
      // Scale node 100-180px by score 1-5
      const width = 100 + score * 16;
      const name = `${c.firstName} ${c.lastName}`.trim() || 'Unnamed';
      return {
        id: c.id,
        position: positions.get(c.id) || { x: 0, y: 0 },
        data: {
          label: (
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <span className="text-base">{meta.icon}</span>
                {c.isKeyMan && <span className="text-amber-300">★</span>}
              </div>
              <div className="font-semibold text-sm leading-tight" style={{ wordBreak: 'break-word' }}>{name}</div>
              {c.title && <div className="text-[10px] opacity-80 leading-tight mt-0.5">{c.title}</div>}
            </div>
          ),
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: {
          width,
          padding: 8,
          borderRadius: 10,
          background: meta.bg,
          border: `2px solid ${selectedId === c.id ? '#fbbf24' : meta.border}`,
          color: 'white',
          boxShadow: selectedId === c.id ? '0 0 0 3px rgba(251, 191, 36, 0.4)' : '0 2px 4px rgba(0,0,0,0.2)',
          fontSize: 12,
        },
      };
    });

    // Edges
    const es: Edge[] = [];
    for (const c of accountContacts) {
      if (c.reportsToContactId && ids.has(c.reportsToContactId)) {
        es.push({
          id: `${c.reportsToContactId}-${c.id}`,
          source: c.reportsToContactId,
          target: c.id,
          type: 'smoothstep',
          style: { stroke: '#94a3b8', strokeWidth: 1.5 },
        });
      }
    }

    return { nodes: ns, edges: es };
  }, [accountContacts, selectedId]);

  const selected = accountContacts.find((c) => c.id === selectedId) || null;

  const handleNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedId((prev) => prev === node.id ? null : node.id);
  }, []);

  if (accountContacts.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-gray-400 italic">
        No contacts for this account yet. Add contacts first, then come back here to map out the org.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
      <div className="rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden" style={{ height: '520px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={handleNodeClick}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} color="#cbd5e1" />
          <Controls />
          <MiniMap zoomable pannable />
        </ReactFlow>
      </div>

      <aside className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        {!selected ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            <p className="font-medium text-gray-700 dark:text-gray-200 mb-2">Click a contact to edit role</p>
            <p className="text-xs">Tag who&apos;s the Champion, Decision Maker, or Blocker. Set manager and seniority to build the org tree.</p>
            <div className="mt-4 space-y-1.5">
              {(Object.keys(ROLE_META) as ContactRoleInDeal[]).map((r) => {
                const m = ROLE_META[r];
                return (
                  <div key={r} className="flex items-center gap-2 text-xs">
                    <span className="inline-block w-3 h-3 rounded" style={{ background: m.bg }} />
                    <span>{m.icon} {m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <ContactInspector
            contact={selected}
            otherContacts={accountContacts.filter((c) => c.id !== selected.id)}
            onChange={(patch) => updateContact(selected.id, patch)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </aside>
    </div>
  );
}

function ContactInspector({
  contact, otherContacts, onChange, onClose,
}: {
  contact: Contact;
  otherContacts: Contact[];
  onChange: (patch: Partial<Contact>) => void;
  onClose: () => void;
}) {
  const name = `${contact.firstName} ${contact.lastName}`.trim();
  const role = (contact.roleInDeal as ContactRoleInDeal) || 'unknown';

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{name}</h3>
          {contact.title && <p className="text-[11px] text-gray-500 truncate">{contact.title}</p>}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">×</button>
      </div>

      <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Role in deal</label>
      <select
        value={role}
        onChange={(e) => onChange({ roleInDeal: e.target.value as ContactRoleInDeal })}
        className="w-full mb-3 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm"
      >
        {(Object.keys(ROLE_META) as ContactRoleInDeal[]).map((r) => (
          <option key={r} value={r}>{ROLE_META[r].icon} {ROLE_META[r].label}</option>
        ))}
      </select>

      <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Influence (1-5)</label>
      <input
        type="range" min={1} max={5} step={1}
        value={contact.influenceScore ?? 3}
        onChange={(e) => onChange({ influenceScore: Number(e.target.value) })}
        className="w-full mb-1"
      />
      <div className="flex justify-between text-[10px] text-gray-400 mb-3">
        <span>1 Low</span><span>3 Mid</span><span>5 Exec</span>
      </div>

      <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Reports to</label>
      <select
        value={contact.reportsToContactId || ''}
        onChange={(e) => onChange({ reportsToContactId: e.target.value || null })}
        className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-md px-2 py-1.5 text-sm"
      >
        <option value="">— (no manager)</option>
        {otherContacts.map((c) => (
          <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
        ))}
      </select>
      <p className="text-[11px] text-gray-400 mt-1">Build the hierarchy by picking each contact&apos;s manager.</p>
    </div>
  );
}
