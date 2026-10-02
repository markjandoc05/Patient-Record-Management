import { administrativeRoles } from '../rbac';
import {
  collection,
  Database,
  onSnapshot,
  query,
  QueryConstraint,
  where,
} from '../dataClient';

export interface BranchAccessProfile {
  role?: string | null;
  assignedBranches?: unknown;
}

const GLOBAL_BRANCH_ROLES = new Set<string>(administrativeRoles);
const BRANCH_QUERY_CHUNK_SIZE = 30;

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

/**
 * Subscribes to a shared clinical collection. Patient identity and longitudinal
 * history are intentionally shared across clinics; branch selection is a
 * workspace filter, not a second copy of the data.
 */
export function subscribeToSharedCollection(
  db: Database,
  collectionName: string,
  onData: (documents: any[]) => void,
  onError?: (error: Error) => void,
  constraints: QueryConstraint[] = [],
  includeArchived = false,
): () => void {
  const sharedQuery = query(collection(db, collectionName), ...constraints);
  return onSnapshot(
    sharedQuery,
    snapshot => onData(snapshot.docs
      .map(document => ({ id: document.id, ...document.data() }) as Record<string, any> & { id: string })
      .filter(document => includeArchived || document.isArchived !== true)),
    error => onError?.(error),
  );
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Subscribes to a collection while making the PostgreSQL query match branch rules.
 * Admin and support users read the full collection. Other roles receive only
 * records whose branch field is in their assignedBranches profile field.
 */
export function subscribeToBranchScopedCollection(
  db: Database,
  collectionName: string,
  branchField: 'homeBranchId' | 'branchId',
  profile: BranchAccessProfile | null | undefined,
  onData: (documents: any[]) => void,
  onError?: (error: Error) => void,
  constraints: QueryConstraint[] = [],
  includeArchived = false,
): () => void {
  if (hasGlobalBranchAccess(profile)) {
    const scopedQuery = query(collection(db, collectionName), ...constraints);
    return onSnapshot(
      scopedQuery,
      snapshot => onData(snapshot.docs
        .map(document => ({ id: document.id, ...document.data() }) as Record<string, any> & { id: string })
        .filter(document => includeArchived || document.isArchived !== true)),
      error => onError?.(error),
    );
  }

  const assignedBranchIds = getAssignedBranchIds(profile);
  if (assignedBranchIds.length === 0) {
    onData([]);
    return () => undefined;
  }

  const branchChunks = chunk(assignedBranchIds, BRANCH_QUERY_CHUNK_SIZE);
  let active = true;
  let resetGeneration = -1;
  const snapshotsByChunk = branchChunks.map(() => new Map<string, any>());

  const emitMergedDocuments = () => {
    if (!active) return;
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
        if (!active) return;
        if (snapshot.invalidated) {
          if (resetGeneration !== snapshot.invalidationGeneration) {
            resetGeneration = snapshot.invalidationGeneration;
            snapshotsByChunk.forEach(documents => documents.clear());
            onData([]);
          }
          return;
        }
        snapshotsByChunk[index] = new Map(
          snapshot.docs
            .map(document => [
              document.id,
              { id: document.id, ...document.data() } as Record<string, any> & { id: string },
            ] as const)
            .filter(([, document]) => includeArchived || document.isArchived !== true),
        );
        emitMergedDocuments();
      },
      error => {
        if (!active) return;
        onError?.(error);
      },
    );
  });

  return () => { active = false; unsubscribers.forEach(unsubscribe => unsubscribe()); };
}
