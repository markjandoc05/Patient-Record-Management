# Security Specification: Consultation Module

## 1. Data Invariants
- A Consultation record must belong to a valid Patient.
- Consultation records are only accessible to authorized users based on role (Doctor/Admin: CRUD; Staff/Manager: Read).
- Consultation date must not be in the future (for recorded history).

## 2. The "Dirty Dozen" Payloads
(Representative samples for security testing)
1.  **Spoofed Doctor ID**: `{"patientId": "p1", "doctorId": "attacker_uid", ...}`
2.  **Future Consultation Date**: `{"consultationDate": "2099-01-01T00:00:00Z", ...}`
3.  **Invalid Visit Type**: `{"visitType": "Brain Surgery", ...}`
4.  **No Patient ID**: `{"visitType": "Assessment", ...}`
5.  **Ghost Field Injection**: `{..., "isAdmin": true}`
6.  **String in ID field**: `{"patientId": 1234567890 (large int), ...}`
7.  **Unauthorized Update**: Staff changing recommendations.
8.  **Orphaned Consultation**: Patient ID does not exist.
9.  **Terminal State Violation**: Updating a completed consultation.
10. **Type Poisoning**: `findings: {"object": "not_string"}`
11. **Size Violation**: `mainConcern: (1MB string)`
12. **Role Escalation**: Setting `doctorId` to own UID while logged as Staff.

## 3. The Test Runner
(This is a conceptual mapping to `firestore.rules.test.ts` logic)
- `test("Staff cannot create consultation", ...)`
- `test("Doctor can create consultation", ...)`
- `test("Doctor cannot update Patient ID", ...)`
...
