import {
  collection,
  Firestore,
  onSnapshot,
  query,
  QueryConstraint,
  where,
} from 'firebase/firestore';

export interface BranchAccessProfile {
  role?: string | null;
  assignedBranches?: unknown;
}

const GLOBAL_BRANCH_ROLES = new Set(['admin', 'support_developer']);
const FIRESTORE_IN_LIMIT = 30;

export function hasGlobalBranchAccess(profile: BranchAccessProfile | null | undefined) {
  return GLOBAL_BRANCH_ROLES.has(profile?.role || '');
}

export function getAssignedBranchIds(profile: BranchAccessProfile | null | undefined): string[] {
  if (!Array.isArray(profile?.assignedBranches)) return [];

  return [...new Set(
    profile.assignedBranches.filter(
      (branchId): branchId is string => typeof branchId === 'string' && branchId.length > 0,
    ),
  )];
}

export function getAccessibleBranches<T extends { id: string }>(
  branches: T[],
  profile: BranchAccessProfile | null | undefined,
): T[] {
  if (hasGlobalBranchAccess(profile)) return branches;
  const assignedBranchIds = new Set(getAssignedBranchIds(profile));
  return branches.filter(branch => assignedBranchIds.has(branch.id));
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Subscribes to a collection while making the Firestore query match branch rules.
 * Admin and support users read the full collection. Other roles receive only
 * records whose branch field is in their assignedBranches profile field.
 */
export function subscribeToBranchScopedCollection(
  db: Firestore,
  collectionName: string,
  branchField: 'homeBranchId' | 'branchId',
  profile: BranchAccessProfile | null | undefined,
  onData: (documents: any[]) => void,
  onError?: (error: Error) => void,
  constraints: QueryConstraint[] = [],
): () => void {
  if (hasGlobalBranchAccess(profile)) {
    const scopedQuery = query(collection(db, collectionName), ...constraints);
    return onSnapshot(
      scopedQuery,
      snapshot => onData(snapshot.docs.map(document => ({ id: document.id, ...document.data() }))),
      error => onError?.(error),
    );
  }

  const assignedBranchIds = getAssignedBranchIds(profile);
  if (assignedBranchIds.length === 0) {
    onData([]);
    return () => undefined;
  }

  const branchChunks = chunk(assignedBranchIds, FIRESTORE_IN_LIMIT);
  const snapshotsByChunk = branchChunks.map(() => new Map<string, any>());

  const emitMergedDocuments = () => {
    const mergedDocuments = new Map<string, any>();
    snapshotsByChunk.forEach(documents => {
      documents.forEach((document, id) => mergedDocuments.set(id, document));
    });
    onData([...mergedDocuments.values()]);
  };

  const unsubscribers = branchChunks.map((branchIds, index) => {
    const scopedQuery = query(
      collection(db, collectionName),
      where(branchField, 'in', branchIds),
      ...constraints,
    );

    return onSnapshot(
      scopedQuery,
      snapshot => {
        snapshotsByChunk[index] = new Map(
          snapshot.docs.map(document => [document.id, { id: document.id, ...document.data() }]),
        );
        emitMergedDocuments();
      },
      error => onError?.(error),
    );
  });

  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}
