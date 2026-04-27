'use client';

type ViewType = 'personal' | 'team' | 'company';

interface ViewTabsProps {
  activeView: ViewType;
  onChange: (view: ViewType) => void;
  teamLabel?: string;
  showCompany?: boolean;
  showTeam?: boolean;
}

export default function ViewTabs({ activeView, onChange, teamLabel = 'Team', showCompany = false, showTeam = true }: ViewTabsProps) {
  const tabs: { id: ViewType; label: string; show: boolean }[] = [
    { id: 'personal', label: 'Personal', show: true },
    { id: 'team', label: teamLabel, show: showTeam },
    { id: 'company', label: 'Company-wide', show: showCompany },
  ];
  const visibleTabs = tabs.filter((t) => t.show);

  // If user only has access to a single view, no need to render the toggle.
  if (visibleTabs.length <= 1) return null;

  return (
    <div style={{ display: 'flex', gap: '4px', background: '#f3f4f6', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            padding: '6px 14px',
            borderRadius: '7px',
            border: 'none',
            fontSize: '13px',
            fontWeight: activeView === tab.id ? 500 : 400,
            background: activeView === tab.id ? '#1a4731' : 'transparent',
            color: activeView === tab.id ? 'white' : '#666',
            cursor: 'pointer',
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
