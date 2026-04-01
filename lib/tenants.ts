export interface Tenant {
  id: string;
  name: string;
  primaryColor: string;
  industry: string;
  logoInitials: string;
  isActive: boolean;
  createdDate: string;
}

export const tenants: Tenant[] = [
  {
    id: 'tenant_001',
    name: 'Pathway Intermediates USA',
    primaryColor: '#1a4731',
    industry: 'Livestock Feed Additives',
    logoInitials: 'PI',
    isActive: true,
    createdDate: '2024-01-01',
  },
  {
    id: 'tenant_002',
    name: 'AgroVet Solutions',
    primaryColor: '#1a3a5c',
    industry: 'Veterinary Pharmaceuticals',
    logoInitials: 'AV',
    isActive: true,
    createdDate: '2024-06-15',
  },
];

export function getTenantById(id: string): Tenant | undefined {
  return tenants.find((t) => t.id === id);
}
