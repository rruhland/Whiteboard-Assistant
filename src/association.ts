export type WorkObject = {
  id: string;
  label: string;
  strokeIds: string[];
  createdAt: number;
  lastAssociatedAt: number;
  status: 'active' | 'superseded';
  parentIds: string[];
};

export type AssociationEventKind = 'auto-create' | 'auto-append' | 'manual-assign' | 'manual-merge' | 'manual-split';

export type ObjectChange = {
  before: WorkObject | null;
  after: WorkObject | null;
};

export type AssociationEvent = {
  id: string;
  time: number;
  actor: 'system' | 'user';
  kind: AssociationEventKind;
  reason: string;
  changes: ObjectChange[];
};
