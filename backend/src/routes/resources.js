import { q } from '../db.js';
import { requireRole } from '../auth.js';
import { asyncRouter } from '../asyncify.js';

const r = asyncRouter();

// ---------- 医生与排班 ----------
r.get('/doctors', async (_req, res) => {
  res.json((await q(`SELECT id, display_name, title, phone FROM users WHERE role='doctor' AND active=TRUE ORDER BY id`)).rows);
});

r.get('/schedules', async (req, res) => {
  const { rows } = await q(
    `SELECT s.*, u.display_name AS doctor_name FROM doctor_schedules s
     JOIN users u ON u.id=s.doctor_id
     WHERE ($1::date IS NULL OR s.work_date>=$1)
     ORDER BY s.work_date, s.start_time`, [req.query.from || null]);
  res.json(rows);
});

r.post('/schedules', requireRole('admin', 'reception'), async (req, res) => {
  const b = req.body;
  const { rows } = await q(
    `INSERT INTO doctor_schedules (doctor_id,work_date,start_time,end_time,slot_minutes)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *`,
    [b.doctorId, b.workDate, b.startTime, b.endTime, b.slotMinutes || 30]);
  res.json(rows[0] || { ok: true, skipped: true });
});

// ---------- 诊室 ----------
r.get('/rooms', async (_req, res) => {
  res.json((await q('SELECT * FROM rooms WHERE active=TRUE ORDER BY id')).rows);
});

// ---------- 住院笼位 ----------
r.get('/cages', async (_req, res) => {
  const { rows } = await q(
    `SELECT c.*, p.name AS pet_name FROM cages c LEFT JOIN pets p ON p.id=c.current_pet_id ORDER BY c.code`);
  res.json(rows);
});

r.post('/cages/:id/release', requireRole('nurse', 'doctor', 'admin'), async (req, res) => {
  await q(`UPDATE cages SET status='free', current_pet_id=NULL WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// ---------- 疫苗产品 / 批号 / 冷链 ----------
r.get('/vaccine-products', async (_req, res) => {
  res.json((await q('SELECT * FROM vaccine_products WHERE active=TRUE ORDER BY id')).rows);
});

r.get('/vaccine-batches', async (_req, res) => {
  const { rows } = await q(
    `SELECT b.*, p.name AS product_name, p.species,
            (b.qty_in - b.qty_used) AS qty_available
     FROM vaccine_batches b JOIN vaccine_products p ON p.id=b.product_id
     ORDER BY b.expire_on`);
  res.json(rows);
});

r.post('/vaccine-batches', requireRole('pharmacy', 'admin'), async (req, res) => {
  const b = req.body;
  const { rows } = await q(
    `INSERT INTO vaccine_batches (product_id,batch_no,expire_on,qty_in,status,storage_temp_lo,storage_temp_hi,cold_chain_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [b.productId, b.batchNo, b.expireOn, b.qtyIn || 0, b.status || 'normal',
     b.tempLo ?? 2, b.tempHi ?? 8, b.coldChainNote || null]);
  res.json(rows[0]);
});

// 冷链异常上报 / 缺货标记
r.post('/vaccine-batches/:id/flag', requireRole('pharmacy', 'admin'), async (req, res) => {
  const { status, note } = req.body || {};
  if (!['shortage', 'cold_chain_break', 'recall', 'normal', 'expired'].includes(status))
    return res.status(400).json({ error: '状态不合法' });
  const { rows } = await q(
    `UPDATE vaccine_batches SET status=$2, cold_chain_note=COALESCE($3,cold_chain_note)
     WHERE id=$1 RETURNING *`, [req.params.id, status, note || null]);
  res.json(rows[0]);
});

// ---------- 角色化看板 ----------
r.get('/dashboard', async (req, res) => {
  const role = req.user.role;
  const stats = {};
  if (role === 'owner') {
    stats.myPets = (await q('SELECT count(*)::int n FROM pets WHERE owner_id=$1', [req.user.id])).rows[0].n;
    stats.myCases = (await q(`SELECT count(*)::int n FROM cases WHERE owner_id=$1 AND status NOT IN ('completed','cancelled','closed')`, [req.user.id])).rows[0].n;
    stats.reminders = (await q(
      `SELECT r.* FROM reminders r JOIN pets p ON p.id=r.pet_id
       WHERE p.owner_id=$1 AND r.status IN ('pending','sent') ORDER BY r.due_on LIMIT 20`, [req.user.id])).rows;
  }
  if (role === 'reception') {
    stats.todayArrivals = (await q(`SELECT count(*)::int n FROM cases WHERE check_in_at::date=CURRENT_DATE`)).rows[0].n;
    stats.bookedToday = (await q(`SELECT count(*)::int n FROM cases WHERE appointment_at::date=CURRENT_DATE`)).rows[0].n;
    stats.openComplaints = (await q(`SELECT count(*)::int n FROM complaints WHERE status IN ('open','handling')`)).rows[0].n;
  }
  if (role === 'doctor') {
    stats.myToday = (await q(`SELECT count(*)::int n FROM cases WHERE doctor_id=$1 AND appointment_at::date=CURRENT_DATE
                             AND status IN ('planned','arrived','triaged','in_progress')`, [req.user.id])).rows[0].n;
    stats.awaitTriage = (await q(`SELECT count(*)::int n FROM cases WHERE status='arrived'`)).rows[0].n;
    stats.onlineWaiting = (await q(
      `SELECT count(DISTINCT c.id)::int n FROM cases c
       WHERE c.channel='online' AND c.status IN ('booked','in_progress')
       AND EXISTS (SELECT 1 FROM consultations m WHERE m.case_id=c.id AND m.sender_role='owner')`)).rows[0].n;
  }
  if (role === 'nurse') {
    stats.awaitTriage = (await q(`SELECT count(*)::int n FROM cases WHERE status='arrived'`)).rows[0].n;
    stats.hospitalized = (await q(`SELECT count(*)::int n FROM hospitalizations WHERE status='admitted'`)).rows[0].n;
    stats.followupsDue = (await q(`SELECT count(*)::int n FROM followups WHERE due_on<=CURRENT_DATE+1 AND result IS NULL`)).rows[0].n;
  }
  if (role === 'pharmacy') {
    stats.pendingMeds = (await q(`SELECT count(*)::int n FROM medications WHERE status='prescribed'`)).rows[0].n;
    stats.coopIssues = (await q(`SELECT count(*)::int n FROM medications WHERE compliance<>'normal' AND status='dispensed'`)).rows[0].n;
    stats.shortage = (await q(`SELECT count(*)::int n FROM vaccine_batches WHERE status IN ('shortage','cold_chain_break','recall','expired')`)).rows[0].n;
  }
  if (role === 'admin') {
    stats.totalPets = (await q('SELECT count(*)::int n FROM pets')).rows[0].n;
    stats.openComplaints = (await q(`SELECT count(*)::int n FROM complaints WHERE status IN ('open','handling')`)).rows[0].n;
    stats.hospitalized = (await q(`SELECT count(*)::int n FROM hospitalizations WHERE status='admitted'`)).rows[0].n;
    stats.coldChainAlerts = (await q(`SELECT count(*)::int n FROM vaccine_batches WHERE status IN ('cold_chain_break','recall','expired','shortage')`)).rows[0].n;
  }
  res.json(stats);
});

export default r;
