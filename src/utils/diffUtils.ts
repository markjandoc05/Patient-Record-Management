/**
 * Helper to identify changed fields between an old and new object.
 */
export interface ChangeDetail {
  field: string;
  oldValue: any;
  newValue: any;
}

export function getChangedFields(oldObj: Record<string, any>, newObj: Record<string, any>): ChangeDetail[] {
  const changedFields: ChangeDetail[] = [];
  
  // Iterate over keys in newObj, as these represent the proposed changes
  for (const key of Object.keys(newObj)) {
    // If the value is different from the old object, it's a change
    if (oldObj[key] !== newObj[key]) {
      changedFields.push({ field: key, oldValue: oldObj[key], newValue: newObj[key] });
    }
  }
  
  return changedFields;
}
