import { db, pool } from '../backend/database';
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/vine_development' || url.username !== 'vine_dev') throw Error('Seed requires the isolated development database');
try {
  await db.runTransaction(async tx => {
    for (const [collection, id, data] of [
      ['branches', 'demo-branch', {branchName: 'Demo Clinic — Development', status: 'Active'}],
      ['patients', 'demo-patient-001', {name:'Demo Patient One',email:'patient1@example.invalid',gender:'Female',birthday:'1990-01-01',homeBranchId:'demo-branch',status:'Active',mainConcern:'Synthetic training record'}],
      ['patients', 'demo-patient-002', {name:'Demo Patient Two',email:'patient2@example.invalid',gender:'Male',birthday:'1985-06-15',homeBranchId:'demo-branch',status:'Active',mainConcern:'Synthetic training record'}],
    ] as const) {
      const ref = db.collection(collection).doc(id);
      if (!(await tx.get(ref)).exists) tx.create(ref, data);
    }
  });
  console.log('Synthetic development branch and patients ready; existing records preserved.');
} finally { await pool.end(); }
