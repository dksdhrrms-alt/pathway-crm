// Types
export type Industry =
  | 'Poultry'
  | 'Swine'
  | 'Beef'
  | 'Dairy'
  | 'Feed Mill'
  | 'Veterinary Hospital'
  | 'Veterinary Clinic'
  | 'Distributor';
export type Stage = 'Prospecting' | 'Qualification' | 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost';
export type ActivityType = 'Call' | 'Meeting' | 'Email' | 'Note';
export type Priority = 'High' | 'Medium' | 'Low';
export type TaskStatus = 'Open' | 'Completed';

export interface Account {
  id: string;
  name: string;
  industry: Industry | string;
  location: string;
  annualRevenue: number;
  ownerId: string;
  ownerName?: string;
  website: string;
  contactIds: string[];
  opportunityIds: string[];
  country?: string;
  phone?: string;
  employee?: number | null;
  category?: string;
  companyType?: string;
  state?: string;
  notes?: string;
  createdAt?: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  species?: string;
  accountId: string;
  accountName?: string;
  country?: string;
  ownerName?: string;
  ownerId: string;
  position?: string;
  isKeyMan?: boolean;
  phone: string;
  tel?: string;
  email: string;
  linkedIn?: string;
  birthday?: string;
  anniversary?: string;
  state?: string;
  notes?: string;
  createdAt?: string;
  status?: string;
}

export const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' }, { code: 'PR', name: 'Puerto Rico' },
];

export interface Opportunity {
  id: string;
  name: string;
  accountId: string;
  stage: Stage;
  amount: number;
  closeDate: string;
  probability: number;
  ownerId: string;
  ownerName?: string;
  nextStep?: string;
  leadSource?: string;
  competitor?: string;
  createdDate: string;
  contactIds: string[];
}

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  description: string;
  date: string;
  ownerId: string;
  accountId: string;
  contactId?: string;
}

export interface Task {
  id: string;
  subject: string;
  dueDate: string;
  priority: Priority;
  status: TaskStatus;
  ownerId: string;
  relatedAccountId?: string;
  relatedContactId?: string;
  relatedOpportunityId?: string;
  description?: string;
}

export interface AccountBudget {
  id: string;
  accountName: string;
  year: number;
  month: number;
  budgetAmount: number;
  category: string;
}

export const initialAccounts: Account[] = [
  {
    id: 'acc-001',

    name: 'Tyson Foods',
    industry: 'Poultry',
    location: 'Springdale, AR',
    annualRevenue: 53000000000,
    ownerId: 'user-003',
    website: 'https://www.tysonfoods.com',
    contactIds: ['con-001', 'con-002'],
    opportunityIds: ['opp-001', 'opp-002'],
  },
  {
    id: 'acc-002',

    name: 'Smithfield Foods',
    industry: 'Swine',
    location: 'Smithfield, VA',
    annualRevenue: 15000000000,
    ownerId: 'user-003',
    website: 'https://www.smithfieldfoods.com',
    contactIds: ['con-003'],
    opportunityIds: ['opp-003'],
  },
  {
    id: 'acc-003',

    name: 'JBS USA',
    industry: 'Beef',
    location: 'Greeley, CO',
    annualRevenue: 18000000000,
    ownerId: 'user-004',
    website: 'https://www.jbssa.com',
    contactIds: ['con-004', 'con-005'],
    opportunityIds: ['opp-004'],
  },
  {
    id: 'acc-004',

    name: "Land O'Lakes",
    industry: 'Dairy',
    location: 'Arden Hills, MN',
    annualRevenue: 16000000000,
    ownerId: 'user-003',
    website: 'https://www.landolakesinc.com',
    contactIds: ['con-006'],
    opportunityIds: ['opp-005', 'opp-006'],
  },
  {
    id: 'acc-005',

    name: 'Cargill Animal Nutrition',
    industry: 'Feed Mill',
    location: 'Wayzata, MN',
    annualRevenue: 22000000000,
    ownerId: 'user-003',
    website: 'https://www.cargill.com',
    contactIds: ['con-007', 'con-008'],
    opportunityIds: ['opp-007', 'opp-008'],
  },
  {
    id: 'acc-006',

    name: 'Perdue Farms',
    industry: 'Poultry',
    location: 'Salisbury, MD',
    annualRevenue: 8000000000,
    ownerId: 'user-004',
    website: 'https://www.perduefarms.com',
    contactIds: ['con-009'],
    opportunityIds: ['opp-009'],
  },
  {
    id: 'acc-007',

    name: 'Mountaire Farms',
    industry: 'Poultry',
    location: 'Millsboro, DE',
    annualRevenue: 2500000000,
    ownerId: 'user-004',
    website: 'https://www.mountaire.com',
    contactIds: ['con-010'],
    opportunityIds: ['opp-010'],
  },
  {
    id: 'acc-008',

    name: 'Wayne Farms',
    industry: 'Poultry',
    location: 'Oakwood, GA',
    annualRevenue: 1800000000,
    ownerId: 'user-004',
    website: 'https://www.waynefarms.com',
    contactIds: ['con-011'],
    opportunityIds: ['opp-011'],
  },
  {
    id: 'acc-009',

    name: 'Iowa Select Farms',
    industry: 'Swine',
    location: 'Iowa Falls, IA',
    annualRevenue: 900000000,
    ownerId: 'user-003',
    website: 'https://www.iowaselect.com',
    contactIds: ['con-012', 'con-013'],
    opportunityIds: ['opp-012'],
  },
  {
    id: 'acc-010',

    name: 'Select Milk Producers',
    industry: 'Dairy',
    location: 'Artesia, NM',
    annualRevenue: 1200000000,
    ownerId: 'user-004',
    website: 'https://www.selectmilk.com',
    contactIds: ['con-014', 'con-015'],
    opportunityIds: [],
  },
  {
    id: 'acc-b01',

    name: 'BluePearl Veterinary Partners',
    industry: 'Veterinary Hospital',
    location: 'Tampa, FL',
    annualRevenue: 520000000,
    ownerId: 'user-006',
    website: 'https://www.bluepearlvet.com',
    contactIds: ['con-b01'],
    opportunityIds: ['opp-b01'],
  },
  {
    id: 'acc-b02',

    name: 'VCA Animal Hospitals',
    industry: 'Veterinary Clinic',
    location: 'Los Angeles, CA',
    annualRevenue: 1800000000,
    ownerId: 'user-006',
    website: 'https://www.vcahospitals.com',
    contactIds: ['con-b02'],
    opportunityIds: ['opp-b02'],
  },
  {
    id: 'acc-b03',

    name: 'National Veterinary Associates',
    industry: 'Veterinary Clinic',
    location: 'Poway, CA',
    annualRevenue: 850000000,
    ownerId: 'user-006',
    website: 'https://www.nva.com',
    contactIds: ['con-b03'],
    opportunityIds: ['opp-b03'],
  },
  {
    id: 'acc-b04',

    name: 'Patterson Veterinary Supply',
    industry: 'Distributor',
    location: 'Mendota Heights, MN',
    annualRevenue: 3200000000,
    ownerId: 'user-006',
    website: 'https://www.pattersonvet.com',
    contactIds: ['con-b04'],
    opportunityIds: ['opp-b04'],
  },
  {
    id: 'acc-b05',

    name: 'Henry Schein Animal Health',
    industry: 'Distributor',
    location: 'Dublin, OH',
    annualRevenue: 4100000000,
    ownerId: 'user-006',
    website: 'https://www.henryschein.com',
    contactIds: ['con-b05'],
    opportunityIds: ['opp-b05'],
  },
  {
    id: 'acc-b06',

    name: 'Midwest Veterinary Supply',
    industry: 'Distributor',
    location: 'Lakeville, MN',
    annualRevenue: 180000000,
    ownerId: 'user-006',
    website: 'https://www.midwestvet.net',
    contactIds: ['con-b06'],
    opportunityIds: [],
  },
  {
    id: 'acc-b07',

    name: 'Banfield Pet Hospital',
    industry: 'Veterinary Clinic',
    location: 'Portland, OR',
    annualRevenue: 2100000000,
    ownerId: 'user-006',
    website: 'https://www.banfield.com',
    contactIds: ['con-b07'],
    opportunityIds: ['opp-b06'],
  },
  {
    id: 'acc-b08',

    name: 'AmeriVet Veterinary Partners',
    industry: 'Veterinary Hospital',
    location: 'San Antonio, TX',
    annualRevenue: 420000000,
    ownerId: 'user-006',
    website: 'https://www.amerivet.com',
    contactIds: ['con-b08'],
    opportunityIds: [],
  },
];

export const initialContacts: Contact[] = [
{ id: 'con-001', firstName: 'James', lastName: 'Henderson', title: 'Director of Procurement', accountId: 'acc-001', phone: '(479) 555-0101', email: 'j.henderson@tysonfoods.com', linkedIn: 'https://linkedin.com/in/jameshenderson' , ownerId: 'user-003' },
  { id: 'con-002', firstName: 'Sarah', lastName: 'Mitchell', title: 'Poultry Nutritionist', accountId: 'acc-001', phone: '(479) 555-0102', email: 's.mitchell@tysonfoods.com' , ownerId: 'user-003' },
  { id: 'con-003', firstName: 'Robert', lastName: 'Daniels', title: 'VP of Operations', accountId: 'acc-002', phone: '(757) 555-0201', email: 'r.daniels@smithfieldfoods.com', linkedIn: 'https://linkedin.com/in/robertdaniels' , ownerId: 'user-003' },
  { id: 'con-004', firstName: 'Maria', lastName: 'Gonzalez', title: 'Director of Procurement', accountId: 'acc-003', phone: '(970) 555-0301', email: 'm.gonzalez@jbssa.com' , ownerId: 'user-004' },
  { id: 'con-005', firstName: 'Kevin', lastName: 'Thornton', title: 'Beef Nutritionist', accountId: 'acc-003', phone: '(970) 555-0302', email: 'k.thornton@jbssa.com', linkedIn: 'https://linkedin.com/in/kevinthornton' , ownerId: 'user-004' },
  { id: 'con-006', firstName: 'Patricia', lastName: 'Olson', title: 'VP of Supply Chain', accountId: 'acc-004', phone: '(651) 555-0401', email: 'p.olson@landolakes.com', linkedIn: 'https://linkedin.com/in/patriciaolson' , ownerId: 'user-003' },
  { id: 'con-007', firstName: 'Brian', lastName: 'Carlson', title: 'Feed Mill Manager', accountId: 'acc-005', phone: '(952) 555-0501', email: 'b.carlson@cargill.com' , ownerId: 'user-003' },
  { id: 'con-008', firstName: 'Linda', lastName: 'Nguyen', title: 'Senior Nutritionist', accountId: 'acc-005', phone: '(952) 555-0502', email: 'l.nguyen@cargill.com', linkedIn: 'https://linkedin.com/in/lindanguyen' , ownerId: 'user-003' },
  { id: 'con-009', firstName: 'Thomas', lastName: 'Perkins', title: 'Director of Live Production', accountId: 'acc-006', phone: '(410) 555-0601', email: 't.perkins@perduefarms.com' , ownerId: 'user-004' },
  { id: 'con-010', firstName: 'Angela', lastName: 'Brooks', title: 'Procurement Specialist', accountId: 'acc-007', phone: '(302) 555-0701', email: 'a.brooks@mountaire.com', linkedIn: 'https://linkedin.com/in/angelabrooks' , ownerId: 'user-004' },
  { id: 'con-011', firstName: 'Michael', lastName: 'Warren', title: 'VP of Operations', accountId: 'acc-008', phone: '(770) 555-0801', email: 'm.warren@waynefarms.com' , ownerId: 'user-004' },
  { id: 'con-012', firstName: 'Donna', lastName: 'Peterson', title: 'Swine Nutritionist', accountId: 'acc-009', phone: '(641) 555-0901', email: 'd.peterson@iowaselect.com', linkedIn: 'https://linkedin.com/in/donnapeterson' , ownerId: 'user-003' },
  { id: 'con-013', firstName: 'Craig', lastName: 'Fuller', title: 'Director of Procurement', accountId: 'acc-009', phone: '(641) 555-0902', email: 'c.fuller@iowaselect.com' , ownerId: 'user-003' },
  { id: 'con-014', firstName: 'Susan', lastName: 'Hartman', title: 'Dairy Nutrition Manager', accountId: 'acc-010', phone: '(575) 555-1001', email: 's.hartman@selectmilk.com', linkedIn: 'https://linkedin.com/in/susanhartman' , ownerId: 'user-004' },
  { id: 'con-015', firstName: 'David', lastName: 'Castro', title: 'VP of Procurement', accountId: 'acc-010', phone: '(575) 555-1002', email: 'd.castro@selectmilk.com' , ownerId: 'user-004' },
  // ── Tenant 002: AgroVet Solutions ────────────────────────────────────────
  { id: 'con-b01', firstName: 'Jennifer', lastName: 'Walsh', title: 'Chief Medical Officer', accountId: 'acc-b01', phone: '(813) 555-2101', email: 'j.walsh@bluepearlvet.com', linkedIn: 'https://linkedin.com/in/jenniferwalshDVM' , ownerId: 'user-006' },
  { id: 'con-b02', firstName: 'Mark', lastName: 'Sullivan', title: 'VP of Procurement', accountId: 'acc-b02', phone: '(310) 555-2201', email: 'm.sullivan@vcahospitals.com' , ownerId: 'user-006' },
  { id: 'con-b03', firstName: 'Christina', lastName: 'Park', title: 'Regional Medical Director', accountId: 'acc-b03', phone: '(858) 555-2301', email: 'c.park@nva.com', linkedIn: 'https://linkedin.com/in/christinaparkDVM' , ownerId: 'user-006' },
  { id: 'con-b04', firstName: 'Steve', lastName: 'Harrison', title: 'Regional Sales Manager', accountId: 'acc-b04', phone: '(651) 555-2401', email: 's.harrison@pattersonvet.com' , ownerId: 'user-006' },
  { id: 'con-b05', firstName: 'Amanda', lastName: 'Foster', title: 'Category Manager', accountId: 'acc-b05', phone: '(614) 555-2501', email: 'a.foster@henryschein.com', linkedIn: 'https://linkedin.com/in/amandafoster' , ownerId: 'user-006' },
  { id: 'con-b06', firstName: 'Tom', lastName: 'Reeves', title: 'Owner & Director', accountId: 'acc-b06', phone: '(952) 555-2601', email: 't.reeves@midwestvet.net' , ownerId: 'user-006' },
  { id: 'con-b07', firstName: 'Karen', lastName: 'Liu', title: 'Senior Veterinarian', accountId: 'acc-b07', phone: '(503) 555-2701', email: 'k.liu@banfield.com', linkedIn: 'https://linkedin.com/in/karenliu' , ownerId: 'user-006' },
  { id: 'con-b08', firstName: 'Robert', lastName: 'Kim', title: 'Director of Operations', accountId: 'acc-b08', phone: '(210) 555-2801', email: 'r.kim@amerivet.com' , ownerId: 'user-006' },
];

export const initialOpportunities: Opportunity[] = [
{ id: 'opp-001', name: 'Tyson – Broiler Performance Package Q2', accountId: 'acc-001', stage: 'Proposal', amount: 185000, closeDate: '2026-04-15', probability: 60, ownerId: 'user-003', nextStep: 'Send updated pricing proposal with volume discount', leadSource: 'Trade Show', createdDate: '2026-01-10', contactIds: ['con-001', 'con-002'] },
  { id: 'opp-002', name: 'Tyson – Mycotoxin Binder Trial', accountId: 'acc-001', stage: 'Qualification', amount: 45000, closeDate: '2026-05-30', probability: 30, ownerId: 'user-003', nextStep: 'Schedule technical presentation with nutritionist team', leadSource: 'Referral', createdDate: '2026-02-01', contactIds: ['con-002'] },
  { id: 'opp-003', name: 'Smithfield – Swine Growth Promoter Program', accountId: 'acc-002', stage: 'Negotiation', amount: 280000, closeDate: '2026-03-31', probability: 80, ownerId: 'user-003', nextStep: 'Final contract review with legal team', leadSource: 'Cold Call', createdDate: '2025-11-15', contactIds: ['con-003'] },
  { id: 'opp-004', name: 'JBS USA – Beef Feed Efficiency Additive', accountId: 'acc-003', stage: 'Closed Won', amount: 220000, closeDate: '2026-02-28', probability: 100, ownerId: 'user-004', nextStep: '', leadSource: 'Trade Show', createdDate: '2025-10-01', contactIds: ['con-004', 'con-005'] },
  { id: 'opp-005', name: "Land O'Lakes – Dairy Rumen Buffer", accountId: 'acc-004', stage: 'Prospecting', amount: 95000, closeDate: '2026-06-30', probability: 10, ownerId: 'user-003', nextStep: 'Identify key decision maker and schedule intro call', leadSource: 'LinkedIn', createdDate: '2026-03-01', contactIds: ['con-006'] },
  { id: 'opp-006', name: "Land O'Lakes – Dairy Transition Cow Supplement", accountId: 'acc-004', stage: 'Proposal', amount: 138000, closeDate: '2026-04-30', probability: 55, ownerId: 'user-003', nextStep: 'Deliver technical data package and ROI analysis', leadSource: 'Referral', createdDate: '2026-01-20', contactIds: ['con-006'] },
  { id: 'opp-007', name: 'Cargill – Enzyme Blend Annual Contract', accountId: 'acc-005', stage: 'Closed Won', amount: 175000, closeDate: '2026-01-31', probability: 100, ownerId: 'user-003', nextStep: '', leadSource: 'Trade Show', createdDate: '2025-09-15', contactIds: ['con-007', 'con-008'] },
  { id: 'opp-008', name: 'Cargill – Organic Acid Blend Pilot', accountId: 'acc-005', stage: 'Qualification', amount: 62000, closeDate: '2026-05-15', probability: 25, ownerId: 'user-003', nextStep: 'Send product samples and efficacy data', leadSource: 'Email Campaign', createdDate: '2026-02-10', contactIds: ['con-008'] },
  { id: 'opp-009', name: 'Perdue Farms – Poultry Probiotic Program', accountId: 'acc-006', stage: 'Negotiation', amount: 155000, closeDate: '2026-03-28', probability: 75, ownerId: 'user-004', nextStep: 'Agree on pricing tiers for volume commitments', leadSource: 'Referral', createdDate: '2025-12-01', contactIds: ['con-009'] },
  { id: 'opp-010', name: 'Mountaire – Antibiotic-Free Program Support', accountId: 'acc-007', stage: 'Proposal', amount: 78000, closeDate: '2026-04-10', probability: 50, ownerId: 'user-004', nextStep: 'Present alternative-to-antibiotic product portfolio', leadSource: 'Cold Call', createdDate: '2026-01-25', contactIds: ['con-010'] },
  { id: 'opp-011', name: 'Wayne Farms – Intestinal Health Package', accountId: 'acc-008', stage: 'Closed Lost', amount: 95000, closeDate: '2026-02-15', probability: 0, ownerId: 'user-004', nextStep: '', leadSource: 'Trade Show', createdDate: '2025-11-01', contactIds: ['con-011'] },
  { id: 'opp-012', name: 'Iowa Select – Swine Amino Acid Optimization', accountId: 'acc-009', stage: 'Qualification', amount: 15000, closeDate: '2026-06-15', probability: 20, ownerId: 'user-003', nextStep: 'Send formulation recommendations and sample kit', leadSource: 'LinkedIn', createdDate: '2026-03-10', contactIds: ['con-012', 'con-013'] },
{ id: 'opp-b01', name: 'BluePearl – Emergency Care Pharmaceutical Bundle', accountId: 'acc-b01', stage: 'Proposal', amount: 145000, closeDate: '2026-04-20', probability: 55, ownerId: 'user-006', nextStep: 'Present expanded formulary and negotiate tier pricing', leadSource: 'Trade Show', createdDate: '2026-01-15', contactIds: ['con-b01'] },
  { id: 'opp-b02', name: 'VCA – National Vaccine Distribution Contract', accountId: 'acc-b02', stage: 'Negotiation', amount: 620000, closeDate: '2026-04-01', probability: 75, ownerId: 'user-006', nextStep: 'Finalize cold-chain logistics agreement', leadSource: 'Referral', createdDate: '2025-11-01', contactIds: ['con-b02'] },
  { id: 'opp-b03', name: 'NVA – Antiparasitic Portfolio Distribution', accountId: 'acc-b03', stage: 'Qualification', amount: 88000, closeDate: '2026-05-30', probability: 30, ownerId: 'user-006', nextStep: 'Send samples and efficacy comparisons vs. current supplier', leadSource: 'Cold Call', createdDate: '2026-02-01', contactIds: ['con-b03'] },
  { id: 'opp-b04', name: 'Patterson – Surgical Supplies Distribution Agreement', accountId: 'acc-b04', stage: 'Closed Won', amount: 390000, closeDate: '2026-02-15', probability: 100, ownerId: 'user-006', nextStep: '', leadSource: 'Trade Show', createdDate: '2025-10-10', contactIds: ['con-b04'] },
  { id: 'opp-b05', name: 'Henry Schein – Preventive Care Supplement Line', accountId: 'acc-b05', stage: 'Prospecting', amount: 210000, closeDate: '2026-07-31', probability: 10, ownerId: 'user-006', nextStep: 'Schedule discovery call with category manager', leadSource: 'LinkedIn', createdDate: '2026-03-05', contactIds: ['con-b05'] },
  { id: 'opp-b06', name: 'Banfield – Orthopedic & Recovery Product Introduction', accountId: 'acc-b07', stage: 'Qualification', amount: 175000, closeDate: '2026-06-15', probability: 25, ownerId: 'user-006', nextStep: 'Arrange pilot with 5 Banfield locations in Pacific Northwest', leadSource: 'Email Campaign', createdDate: '2026-02-20', contactIds: ['con-b07'] },
];

export const initialActivities: Activity[] = [
{ id: 'act-001', type: 'Call', subject: 'Discussed Q2 pricing for broiler performance package', description: 'Spoke with James Henderson regarding volume-based pricing. He indicated Tyson is looking for a 3-year commitment with annual price escalation cap of 5%. Will send updated proposal by end of week.', date: '2026-03-20', ownerId: 'user-003', accountId: 'acc-001', contactId: 'con-001' },
  { id: 'act-002', type: 'Meeting', subject: 'Technical presentation – mycotoxin binder efficacy', description: 'In-person meeting at Tyson HQ in Springdale. Presented trial data from Kansas State University study. Sarah Mitchell expressed interest in running a 90-day broiler trial at their pilot house.', date: '2026-03-15', ownerId: 'user-003', accountId: 'acc-001', contactId: 'con-002' },
  { id: 'act-003', type: 'Email', subject: 'Sent contract redlines for swine growth promoter deal', description: 'Emailed revised contract to Robert Daniels and Smithfield legal team. Key points: net 30 payment terms, 12-month price lock, 10% volume discount at 50,000 lb threshold.', date: '2026-03-22', ownerId: 'user-003', accountId: 'acc-002', contactId: 'con-003' },
  { id: 'act-004', type: 'Call', subject: 'Follow-up on contract review timeline', description: 'Robert indicated legal review will complete by March 29. He is confident both parties can execute by March 31 deadline. No objections to current terms.', date: '2026-03-24', ownerId: 'user-003', accountId: 'acc-002', contactId: 'con-003' },
  { id: 'act-005', type: 'Note', subject: 'JBS deal closed – follow up for implementation', description: 'Deal officially closed on 2/28. Need to coordinate with ops team for first delivery schedule. Kevin Thornton will be the day-to-day contact during implementation phase.', date: '2026-03-01', ownerId: 'user-004', accountId: 'acc-003', contactId: 'con-005' },
  { id: 'act-006', type: 'Email', subject: "Introduction email – Dairy Rumen Buffer opportunity", description: "Sent introductory email to Patricia Olson at Land O'Lakes outlining Pathway's rumen buffer product line. Highlighted case study from similar cooperative in Wisconsin showing 8% improvement in milk fat percentage.", date: '2026-03-05', ownerId: 'user-003', accountId: 'acc-004', contactId: 'con-006' },
  { id: 'act-007', type: 'Call', subject: "Discovery call – Land O'Lakes transition cow program", description: "Patricia Olson confirmed they are actively evaluating transition cow supplements for their Minnesota dairy network. Currently using a competitor product but open to alternatives. Decision expected by end of Q2.", date: '2026-03-12', ownerId: 'user-003', accountId: 'acc-004', contactId: 'con-006' },
  { id: 'act-008', type: 'Meeting', subject: 'Annual contract renewal meeting – Cargill', description: 'Met with Brian Carlson and Linda Nguyen at Cargill Wayzata office. Reviewed performance metrics for enzyme blend: 4.2% FCR improvement across 6 mill sites. Both parties agreed to renew with 15% volume increase.', date: '2026-01-15', ownerId: 'user-003', accountId: 'acc-005', contactId: 'con-007' },
  { id: 'act-009', type: 'Email', subject: 'Organic acid blend sample shipment confirmation', description: 'Confirmed shipment of 25 lb sample lot of OA-300 organic acid blend to Cargill Wayzata research facility. Linda Nguyen to conduct in-vitro testing over 30 days before recommending pilot program.', date: '2026-02-20', ownerId: 'user-003', accountId: 'acc-005', contactId: 'con-008' },
  { id: 'act-010', type: 'Call', subject: 'Perdue probiotic program – pricing negotiation update', description: "Thomas Perkins indicated Perdue's CFO approved budget for the probiotic program contingent on 8% price reduction from our proposal. Discussed volume commitment structure to make economics work for both sides.", date: '2026-03-18', ownerId: 'user-004', accountId: 'acc-006', contactId: 'con-009' },
  { id: 'act-011', type: 'Meeting', subject: 'Mountaire – ABF program technical review', description: 'Presented full antibiotic-free alternative protocol to Angela Brooks and her production team. Proposed stack: oregano oil-based product + Bacillus probiotic + organic acids. They requested a cost-per-bird analysis.', date: '2026-03-10', ownerId: 'user-004', accountId: 'acc-007', contactId: 'con-010' },
  { id: 'act-012', type: 'Note', subject: "Wayne Farms – lost to competitor Novus", description: "Confirmed loss after 3-month evaluation. Wayne Farms selected Novus International's Alimet product based on existing relationship. Will maintain relationship with Michael Warren for future opportunities.", date: '2026-02-16', ownerId: 'user-004', accountId: 'acc-008', contactId: 'con-011' },
  { id: 'act-013', type: 'Email', subject: 'Iowa Select – swine amino acid formulation recommendations', description: 'Sent customized SID lysine and digestible amino acid formulation recommendations based on their current corn-soybean meal diet structure. Included sensitivity analysis for 3 market weight targets (280, 300, 320 lb).', date: '2026-03-14', ownerId: 'user-003', accountId: 'acc-009', contactId: 'con-012' },
  { id: 'act-014', type: 'Call', subject: 'Iowa Select – initial discovery with Craig Fuller', description: 'Craig Fuller confirmed Iowa Select processes 4M hogs annually across 8 finishing sites. Looking for supplier that can provide technical support and consistent quality. Requested sample kit and pricing.', date: '2026-03-17', ownerId: 'user-003', accountId: 'acc-009', contactId: 'con-013' },
  { id: 'act-015', type: 'Meeting', subject: 'IPPE trade show – multiple prospect meetings', description: 'Attended International Production & Processing Expo in Atlanta. Met with reps from Mountaire, Wayne Farms, and two new prospects. Collected 8 business cards, 4 strong leads for follow-up.', date: '2026-01-28', ownerId: 'user-004', accountId: 'acc-007' },
  { id: 'act-016', type: 'Call', subject: 'JBS – first delivery logistics coordination', description: 'Called Kevin Thornton to align on first delivery of beef feed efficiency additive. Confirmed delivery to Greeley CO facility on April 3. 20,000 lb initial shipment of FE-500 product.', date: '2026-03-08', ownerId: 'user-004', accountId: 'acc-003', contactId: 'con-005' },
  { id: 'act-017', type: 'Email', subject: 'Tyson – sent broiler trial protocol draft', description: 'Emailed 90-day broiler trial protocol to Sarah Mitchell. Protocol includes control and treatment groups at 3 flock density levels. Requesting Tyson research team approval before May 1 start date.', date: '2026-03-23', ownerId: 'user-003', accountId: 'acc-001', contactId: 'con-002' },
  { id: 'act-018', type: 'Call', subject: 'Smithfield – legal team preliminary approval', description: 'Brief check-in with Robert Daniels. Legal team has reviewed and has only minor redlines on indemnification clause. Will have final version back by EOD tomorrow.', date: '2026-03-23', ownerId: 'user-003', accountId: 'acc-002', contactId: 'con-003' },
  { id: 'act-019', type: 'Note', subject: 'Cargill – OA blend initial test results positive', description: 'Linda Nguyen emailed informally that early in-vitro results for OA-300 look promising. Salmonella reduction of ~2 log CFU/g in contaminated feed samples. Formal report expected in 2 weeks.', date: '2026-03-13', ownerId: 'user-003', accountId: 'acc-005', contactId: 'con-008' },
  { id: 'act-020', type: 'Meeting', subject: "Perdue – farm visit at Delmarva complex", description: "On-site visit to Perdue's Delmarva growing complex. Observed current feed management practices. Identified opportunity for phytase enzyme addition to reduce phosphorus excretion. Will include in updated proposal.", date: '2026-02-25', ownerId: 'user-004', accountId: 'acc-006', contactId: 'con-009' },
  { id: 'act-021', type: 'Email', subject: 'Mountaire – cost-per-bird analysis delivered', description: 'Sent detailed cost-per-bird analysis to Angela Brooks. ABF program adds $0.023/bird vs current antibiotic program but projected to reduce mortality 0.8% and improve FCR by 3 points, net positive ROI.', date: '2026-03-19', ownerId: 'user-004', accountId: 'acc-007', contactId: 'con-010' },
  { id: 'act-022', type: 'Call', subject: 'Select Milk Producers – introductory call', description: 'Cold call to David Castro at Select Milk. Brief 10-minute conversation. He mentioned they are in budget freeze until Q3 but willing to receive product information. Will send overview brochure.', date: '2026-02-10', ownerId: 'user-004', accountId: 'acc-010', contactId: 'con-015' },
  { id: 'act-023', type: 'Email', subject: 'Select Milk – product portfolio overview sent', description: 'Sent comprehensive product overview focusing on dairy-specific solutions: rumen buffers, transition cow supplements, and teat dip additives. Included ROI calculator spreadsheet.', date: '2026-02-12', ownerId: 'user-004', accountId: 'acc-010', contactId: 'con-015' },
  { id: 'act-024', type: 'Call', subject: "Land O'Lakes – technical data request", description: 'Patricia Olson requested peer-reviewed publications supporting our transition cow supplement claims. She needs at least 3 published studies before taking to her vet consultant for review.', date: '2026-03-20', ownerId: 'user-003', accountId: 'acc-004', contactId: 'con-006' },
  { id: 'act-025', type: 'Note', subject: 'Perdue – CFO budget approval confirmed', description: 'Thomas Perkins confirmed in text message that CFO approved the probiotic program budget. Now finalizing pricing structure. Key issue: they want quarterly invoicing vs our standard monthly billing.', date: '2026-03-21', ownerId: 'user-004', accountId: 'acc-006', contactId: 'con-009' },
  { id: 'act-026', type: 'Meeting', subject: 'Iowa Select – site visit to finishing complex', description: 'Visited Iowa Select Farms Benton County finishing complex with Donna Peterson. Observed feed delivery system compatibility with our liquid additive products. Identified need for dry formulation alternative.', date: '2026-03-21', ownerId: 'user-003', accountId: 'acc-009', contactId: 'con-012' },
  { id: 'act-027', type: 'Email', subject: 'Tyson – proposal v2 with volume discount tiers', description: 'Sent revised proposal to James Henderson. Added 3-tier volume discount structure: 5% at 10,000 lb, 8% at 20,000 lb, 12% at 35,000 lb annually. Payment terms: net 30 with 2% early pay discount.', date: '2026-03-22', ownerId: 'user-003', accountId: 'acc-001', contactId: 'con-001' },
  { id: 'act-028', type: 'Call', subject: 'Wayne Farms – relationship maintenance call', description: "Follow-up call with Michael Warren post-loss. He appreciated our professionalism throughout evaluation. Asked us to check back in Q4 as Novus contract comes up for renewal. Good opportunity for 2027.", date: '2026-03-05', ownerId: 'user-004', accountId: 'acc-008', contactId: 'con-011' },
  { id: 'act-029', type: 'Note', subject: 'Cargill – pilot program scope discussion', description: 'Informal discussion with Brian Carlson about scope for OA-300 pilot program. Likely 2-3 mill sites initially, ramping to 6 if results confirm in-vitro data. Timeline: pilot start June 1, evaluation period 90 days.', date: '2026-03-16', ownerId: 'user-003', accountId: 'acc-005', contactId: 'con-007' },
  { id: 'act-030', type: 'Email', subject: "Published studies packet sent to Land O'Lakes", description: "Emailed Patricia Olson a packet of 5 peer-reviewed publications covering calcium propionate, sodium bicarbonate buffer blends, and our proprietary TCF-200 transition supplement. Included summary one-pager.", date: '2026-03-24', ownerId: 'user-003', accountId: 'acc-004', contactId: 'con-006' },
{ id: 'act-b01', type: 'Call', subject: 'BluePearl – intro call on emergency formulary expansion', description: 'Dr. Walsh expressed strong interest in expanding their emergency care pharmaceutical formulary. Currently sourcing from 3 suppliers; interested in consolidating to 2. Will schedule formal review with their procurement committee.', date: '2026-03-18', ownerId: 'user-006', accountId: 'acc-b01', contactId: 'con-b01' },
  { id: 'act-b02', type: 'Meeting', subject: 'VCA – contract negotiation kickoff', description: 'Met with Mark Sullivan and VCA legal team. Reviewed proposed national distribution agreement for vaccine line. Key sticking points: minimum order quantities and cold-chain liability. Follow-up in 2 weeks.', date: '2026-03-10', ownerId: 'user-006', accountId: 'acc-b02', contactId: 'con-b02' },
  { id: 'act-b03', type: 'Email', subject: 'NVA – antiparasitic comparison study sent', description: 'Emailed Dr. Park a head-to-head efficacy comparison of our AV-Parasol line vs. Zoetis Revolution Plus. Data shows equivalent efficacy with 12% lower cost per dose. Requested a 30-day trial at 3 NVA clinics.', date: '2026-03-05', ownerId: 'user-006', accountId: 'acc-b03', contactId: 'con-b03' },
  { id: 'act-b04', type: 'Note', subject: 'Patterson – surgical supplies deal closed', description: "Contract signed for 18-month surgical supplies distribution agreement. Patterson will stock our OrthoPro and SurgeSeal lines across their 4 distribution centers. First shipment March 15.", date: '2026-02-15', ownerId: 'user-006', accountId: 'acc-b04', contactId: 'con-b04' },
  { id: 'act-b05', type: 'Email', subject: 'Henry Schein – preventive care category introduction', description: "Sent Amanda Foster a comprehensive overview of AgroVet's preventive care supplement portfolio: dental chews, joint support, and omega-3 lines. Requested a 15-minute category review call.", date: '2026-03-12', ownerId: 'user-006', accountId: 'acc-b05', contactId: 'con-b05' },
  { id: 'act-b06', type: 'Call', subject: 'Midwest Vet Supply – relationship building call', description: "Spoke with Tom Reeves about expanding our product presence in their catalog. He mentioned they're looking to add more specialty pharma lines in Q3. Will follow up with a product portfolio deck.", date: '2026-03-08', ownerId: 'user-006', accountId: 'acc-b06', contactId: 'con-b06' },
  { id: 'act-b07', type: 'Meeting', subject: 'Banfield – orthopedic product pilot proposal', description: "Presented the AgroVet OrthoPro surgical recovery line to Dr. Liu and Banfield's product selection committee. Strong interest in post-operative pain management protocols. Agreed to pilot in 5 Pacific Northwest locations.", date: '2026-03-15', ownerId: 'user-006', accountId: 'acc-b07', contactId: 'con-b07' },
  { id: 'act-b08', type: 'Call', subject: 'AmeriVet – initial discovery call', description: 'First call with Robert Kim. AmeriVet is rapidly expanding via acquisition (12 new hospitals in 2025). Looking for a pharmaceutical partner who can scale with them. Requested a capabilities overview and pricing sheet.', date: '2026-02-28', ownerId: 'user-006', accountId: 'acc-b08', contactId: 'con-b08' },
  { id: 'act-b09', type: 'Email', subject: 'VCA – cold-chain logistics proposal submitted', description: 'Submitted detailed cold-chain logistics proposal to Mark Sullivan including temperature-controlled shipping, real-time tracking, and 99.2% on-time delivery SLA. Waiting for legal review.', date: '2026-03-22', ownerId: 'user-006', accountId: 'acc-b02', contactId: 'con-b02' },
  { id: 'act-b10', type: 'Note', subject: 'BluePearl – procurement committee meeting scheduled', description: "Dr. Walsh confirmed procurement committee review scheduled for April 8. Three competing vendors will present. We're presenting last — typically advantageous. Will prepare comparison matrix.", date: '2026-03-24', ownerId: 'user-006', accountId: 'acc-b01', contactId: 'con-b01' },
];

export const initialTasks: Task[] = [
{ id: 'tsk-001', subject: 'Call James Henderson – confirm Tyson proposal receipt', dueDate: '2026-03-25', priority: 'High', status: 'Open', ownerId: 'user-003', relatedAccountId: 'acc-001', relatedContactId: 'con-001', relatedOpportunityId: 'opp-001', description: 'Confirm he received proposal v2 and answer any immediate pricing questions.' },
  { id: 'tsk-002', subject: 'Follow up with Smithfield legal on final contract', dueDate: '2026-03-25', priority: 'High', status: 'Open', ownerId: 'user-003', relatedAccountId: 'acc-002', relatedContactId: 'con-003', relatedOpportunityId: 'opp-003', description: 'Get confirmation that redlined version is being signed today.' },
  { id: 'tsk-003', subject: 'Send Perdue pricing counter-proposal', dueDate: '2026-03-25', priority: 'High', status: 'Open', ownerId: 'user-004', relatedAccountId: 'acc-006', relatedContactId: 'con-009', relatedOpportunityId: 'opp-009', description: 'Prepare tiered pricing structure with 8% discount at 3-year commitment.' },
  { id: 'tsk-004', subject: 'Prepare Mountaire cost-per-bird presentation deck', dueDate: '2026-03-20', priority: 'High', status: 'Completed', ownerId: 'user-004', relatedAccountId: 'acc-007', relatedContactId: 'con-010', relatedOpportunityId: 'opp-010', description: 'Full slide deck including ROI analysis and competitive comparison.' },
  { id: 'tsk-005', subject: 'Send Iowa Select amino acid sample kit', dueDate: '2026-03-22', priority: 'Medium', status: 'Open', ownerId: 'user-003', relatedAccountId: 'acc-009', relatedContactId: 'con-013', relatedOpportunityId: 'opp-012', description: '250g sample of each of: L-Lysine HCl, DL-Methionine, L-Threonine, L-Tryptophan.' },
  { id: 'tsk-006', subject: 'Review Cargill OA-300 in-vitro test protocol', dueDate: '2026-03-18', priority: 'Medium', status: 'Completed', ownerId: 'user-003', relatedAccountId: 'acc-005', relatedContactId: 'con-008', relatedOpportunityId: 'opp-008', description: "Ensure Cargill's testing methodology aligns with our product efficacy claims." },
  { id: 'tsk-007', subject: "Schedule Land O'Lakes vet consultant call", dueDate: '2026-04-01', priority: 'Medium', status: 'Open', ownerId: 'user-003', relatedAccountId: 'acc-004', relatedContactId: 'con-006', relatedOpportunityId: 'opp-006', description: 'Patricia requested a 3-way call with her vet consultant Dr. Weiss to discuss published studies.' },
  { id: 'tsk-008', subject: 'Coordinate JBS first delivery logistics', dueDate: '2026-03-28', priority: 'High', status: 'Open', ownerId: 'user-004', relatedAccountId: 'acc-003', relatedContactId: 'con-005', description: 'Confirm carrier, ETA, and unloading dock schedule for April 3 delivery.' },
  { id: 'tsk-009', subject: 'Prepare Q2 pipeline review presentation', dueDate: '2026-04-05', priority: 'Medium', status: 'Open', ownerId: 'user-002', description: 'Monthly pipeline review for management. Include forecast, weighted pipeline, and top 5 opportunities.' },
  { id: 'tsk-010', subject: 'Send mycotoxin binder trial protocol to Tyson nutritionist', dueDate: '2026-03-15', priority: 'High', status: 'Completed', ownerId: 'user-003', relatedAccountId: 'acc-001', relatedContactId: 'con-002', relatedOpportunityId: 'opp-002', description: 'Draft protocol with control/treatment design for 90-day broiler trial.' },
  { id: 'tsk-011', subject: 'Register for 2026 Swine Industry Forum', dueDate: '2026-04-15', priority: 'Low', status: 'Open', ownerId: 'user-004', description: 'Annual Iowa Swine Industry Forum – good prospect networking opportunity. Booth space deadline April 15.' },
  { id: 'tsk-012', subject: 'Follow up with Select Milk Producers after budget freeze', dueDate: '2026-07-01', priority: 'Low', status: 'Open', ownerId: 'user-004', relatedAccountId: 'acc-010', relatedContactId: 'con-015', description: 'David Castro said budget freeze lifts in Q3. Circle back with updated product info.' },
  { id: 'tsk-013', subject: 'Update Wayne Farms account with competitor intel', dueDate: '2026-03-10', priority: 'Low', status: 'Completed', ownerId: 'user-004', relatedAccountId: 'acc-008', relatedContactId: 'con-011', description: 'Research Novus Alimet contract typical duration and watch for renewal window.' },
  { id: 'tsk-014', subject: 'Complete Mountaire proposal revisions', dueDate: '2026-03-23', priority: 'High', status: 'Open', ownerId: 'user-004', relatedAccountId: 'acc-007', relatedContactId: 'con-010', relatedOpportunityId: 'opp-010', description: 'Revise ABF proposal with phytase enzyme addition and updated cost-per-bird numbers.' },
  { id: 'tsk-015', subject: 'Call Donna Peterson – Iowa Select dry formulation availability', dueDate: '2026-03-26', priority: 'Medium', status: 'Open', ownerId: 'user-003', relatedAccountId: 'acc-009', relatedContactId: 'con-012', relatedOpportunityId: 'opp-012', description: 'Confirm we can provide dry pellet form of amino acid blend compatible with their auger system.' },
{ id: 'tsk-b01', subject: 'Prepare BluePearl procurement committee presentation', dueDate: '2026-04-05', priority: 'High', status: 'Open', ownerId: 'user-006', relatedAccountId: 'acc-b01', relatedContactId: 'con-b01', relatedOpportunityId: 'opp-b01', description: 'Build comparison matrix and ROI model for the April 8 committee meeting.' },
  { id: 'tsk-b02', subject: 'Review VCA cold-chain SLA language with legal', dueDate: '2026-03-27', priority: 'High', status: 'Open', ownerId: 'user-006', relatedAccountId: 'acc-b02', relatedContactId: 'con-b02', relatedOpportunityId: 'opp-b02', description: 'Ensure liability clauses are consistent with our insurance coverage limits.' },
  { id: 'tsk-b03', subject: 'Send NVA pilot program agreement draft', dueDate: '2026-03-28', priority: 'Medium', status: 'Open', ownerId: 'user-006', relatedAccountId: 'acc-b03', relatedContactId: 'con-b03', relatedOpportunityId: 'opp-b03', description: '30-day trial at 3 NVA clinics. Include product quantities and reporting requirements.' },
  { id: 'tsk-b04', subject: 'Confirm Patterson first shipment tracking', dueDate: '2026-03-25', priority: 'Medium', status: 'Completed', ownerId: 'user-006', relatedAccountId: 'acc-b04', relatedContactId: 'con-b04', description: 'Verify OrthoPro and SurgeSeal shipment arrived at all 4 distribution centers.' },
  { id: 'tsk-b05', subject: 'Schedule Henry Schein category review call', dueDate: '2026-03-30', priority: 'Medium', status: 'Open', ownerId: 'user-006', relatedAccountId: 'acc-b05', relatedContactId: 'con-b05', relatedOpportunityId: 'opp-b05', description: 'Amanda Foster requested a 15-minute call before end of month.' },
  { id: 'tsk-b06', subject: 'Send Midwest Vet product portfolio deck', dueDate: '2026-04-10', priority: 'Low', status: 'Open', ownerId: 'user-006', relatedAccountId: 'acc-b06', relatedContactId: 'con-b06', description: 'Tom Reeves requested overview of specialty pharma and supplement lines.' },
  { id: 'tsk-b07', subject: 'Coordinate Banfield 5-site pilot rollout', dueDate: '2026-04-01', priority: 'High', status: 'Open', ownerId: 'user-006', relatedAccountId: 'acc-b07', relatedContactId: 'con-b07', relatedOpportunityId: 'opp-b06', description: 'Arrange product shipment and training schedule for the 5 pilot Banfield locations.' },
  { id: 'tsk-b08', subject: 'Send AmeriVet capabilities overview', dueDate: '2026-03-26', priority: 'Medium', status: 'Open', ownerId: 'user-006', relatedAccountId: 'acc-b08', relatedContactId: 'con-b08', description: 'Robert Kim requested our full capabilities deck and pricing sheet before their next board meeting.' },
];

// ── Mutable State Arrays ────────────────────────────────────────────────────

export let accounts: Account[] = [...initialAccounts];
export let contacts: Contact[] = [...initialContacts];
export let opportunities: Opportunity[] = [...initialOpportunities];
export let activities: Activity[] = [...initialActivities];
export let tasks: Task[] = [...initialTasks];

// ── Helper Functions ────────────────────────────────────────────────────────

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function getAccountById(id: string): Account | undefined {
  return accounts.find((a) => a.id === id);
}

export function getContactById(id: string): Contact | undefined {
  return contacts.find((c) => c.id === id);
}

export function getOpportunityById(id: string): Opportunity | undefined {
  return opportunities.find((o) => o.id === id);
}

export function getActivitiesForAccount(accountId: string): Activity[] {
  return activities
    .filter((a) => a.accountId === accountId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getActivitiesForContact(contactId: string): Activity[] {
  return activities
    .filter((a) => a.contactId === contactId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getLastActivityDate(accountId: string): string | null {
  const acts = getActivitiesForAccount(accountId);
  return acts.length > 0 ? acts[0].date : null;
}
