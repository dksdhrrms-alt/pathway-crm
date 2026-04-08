export const TEAMS = [
  { id: 'monogastrics', label: 'Monogastrics', color: '#185FA5', bg: '#E6F1FB' },
  { id: 'swine', label: 'Swine', color: '#185FA5', bg: '#E6F1FB', parentTeam: 'monogastrics' },
  { id: 'ruminants', label: 'Ruminants', color: '#0F6E56', bg: '#E1F5EE' },
  { id: 'latam', label: 'LATAM', color: '#854F0B', bg: '#FAEEDA' },
  { id: 'familyb2b', label: 'Family / B2B', color: '#534AB7', bg: '#EEEDFE' },
  { id: 'marketing', label: 'Marketing', color: '#993556', bg: '#FBEAF0' },
  { id: 'management', label: 'Management', color: '#5F5E5A', bg: '#F1EFE8' },
] as const;

export type TeamId = (typeof TEAMS)[number]['id'] | '';

export const MONOGASTRICS_GROUP = ['monogastrics', 'swine'];

export function getTeam(id: string) {
  return TEAMS.find((t) => t.id === id);
}

export function getDashboardTeam(teamId: string): string {
  if (teamId === 'swine') return 'monogastrics';
  return teamId;
}
