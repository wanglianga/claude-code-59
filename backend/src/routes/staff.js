import { q, tx } from '../db.js';
import { requireRole } from '../auth.js';
import { addEvent } from '../helpers.js';
import { asyncRouter } from '../asyncify.js';

const r = asyncRouter();

// 投诉队列 / 处理回复
r.get('/complaints', requireRole('reception', 'admin', 'doctor'), async (req, res) => {
  const { rows } = await q(
    `SELECT cp.*, u.display_name AS owner_name, c.case_no, p.name AS pet_name
     FROM complaints cp
     JOIN users u ON u.id=cp.owner_id
     LEFT JOIN cases c ON c.id=cp.case_id
     LEFT JOIN pets p ON p.id=c.pet_id
     ORDER BY CASE cp.status WHEN 'open' THEN 0 WHEN 'handling' THEN 1 ELSE 2 END, cp.id DESC`);
  res.json(rows);
});

r.post('/complaints/:id/handle', requireRole('reception', 'admin'), async (req, res) => {
  const { status = 'handling', reply } = req.body;
  await tx(async (c) => {
    const cp = (await c.query('SELECT * FROM complaints WHERE id=$1', [req.params.id])).rows[0];
    if (!cp) throw new Error('投诉不存在');
    await c.query(`UPDATE complaints SET status=$2, handler_id=$3, reply=$4 WHERE id=$1`,
      [cp.id, status, req.user.id, reply || null]);
    if (cp.case_id) {
      const pc = await c.query('SELECT pet_id FROM cases WHERE id=$1', [cp.case_id]);
      await addEvent(c, { caseId: cp.case_id, petId: pc.rows[0].pet_id, type: 'complaint', authorId: req.user.id,
        authorRole: req.user.role, title: status === 'resolved' ? '投诉已处理并回复主人' : '投诉受理中',
        content: reply || '已安排专人与主人核对收费明细' });
    }
  });
  res.json({ ok: true });
});

// 回访工作清单（护士台）
r.get('/worklist/followups', requireRole('nurse', 'doctor', 'admin'), async (_req, res) => {
  const { rows } = await q(
    `SELECT f.*, p.name AS pet_name, c.case_no
     FROM followups f JOIN pets p ON p.id=f.pet_id JOIN cases c ON c.id=f.case_id
     WHERE f.result IS NULL OR f.result='unreachable'
     ORDER BY f.due_on`);
  res.json(rows);
});

// 待办提醒总览（下一针/复诊/回访异常）
r.get('/reminders', async (req, res) => {
  if (req.user.role === 'owner') {
    const { rows } = await q(
      `SELECT rm.*, p.name AS pet_name FROM reminders rm JOIN pets p ON p.id=rm.pet_id
       WHERE p.owner_id=$1 ORDER BY rm.due_on`, [req.user.id]);
    return res.json(rows);
  }
  const { rows } = await q(
    `SELECT rm.*, p.name AS pet_name, u.display_name AS owner_name
     FROM reminders rm JOIN pets p ON p.id=rm.pet_id JOIN users u ON u.id=p.owner_id
     WHERE rm.status IN ('pending','sent','snoozed') ORDER BY rm.due_on LIMIT 100`);
  res.json(rows);
});

r.post('/reminders/:id/status', async (req, res) => {
  const { status } = req.body;
  await q('UPDATE reminders SET status=$2 WHERE id=$1', [req.params.id, status]);
  res.json({ ok: true });
});

// 质量复盘（院方）：异常事件汇总——发热/检查异常/伤口/投诉/冷链/用药不配合/回访异常
r.get('/quality-review', requireRole('admin', 'doctor', 'nurse'), async (_req, res) => {
  const [feverTriages, wound, complaints, coop, cold, abnormalFU, adverse] = await Promise.all([
    q(`SELECT t.*, c.case_no, p.name pet_name FROM triages t
       JOIN cases c ON c.id=t.case_id JOIN pets p ON p.id=c.pet_id
       WHERE t.decision='hold_fever' OR t.suitable=FALSE ORDER BY t.id DESC LIMIT 50`),
    q(`SELECT s.*, c.case_no, p.name pet_name FROM surgeries s
       JOIN cases c ON c.id=s.case_id JOIN pets p ON p.id=c.pet_id
       WHERE s.wound_status<>'ok' ORDER BY s.id DESC LIMIT 50`),
    q(`SELECT * FROM complaints ORDER BY id DESC LIMIT 50`),
    q(`SELECT m.*, c.case_no, p.name pet_name FROM medications m
       JOIN cases c ON c.id=m.case_id JOIN pets p ON p.id=c.pet_id
       WHERE m.compliance<>'normal' ORDER BY m.id DESC LIMIT 50`),
    q(`SELECT * FROM vaccine_batches WHERE status<>'normal' ORDER BY id`),
    q(`SELECT f.*, p.name pet_name, c.case_no FROM followups f
       JOIN pets p ON p.id=f.pet_id JOIN cases c ON c.id=f.case_id
       WHERE f.result='abnormal' ORDER BY f.id DESC LIMIT 50`),
    q(`SELECT v.*, c.case_no, p.name pet_name FROM vaccinations v
       JOIN cases c ON c.id=v.case_id JOIN pets p ON p.id=c.pet_id
       WHERE v.adverse IS NOT NULL AND v.adverse<>'' ORDER BY v.id DESC LIMIT 50`),
  ]);
  res.json({
    feverTriages: feverTriages.rows, woundIssues: wound.rows, complaints: complaints.rows,
    cooperationIssues: coop.rows, coldChainAlerts: cold.rows,
    abnormalFollowups: abnormalFU.rows, adverseReactions: adverse.rows,
  });
});

// 传染病排查：同疫苗/同批次近期接种宠物（冷链或不良反应触发时）
r.get('/infection-trace', requireRole('admin', 'doctor', 'pharmacy'), async (req, res) => {
  const batchId = req.query.batchId;
  if (!batchId) {
    // 默认列出有风险的批号及其接种宠物数
    const { rows } = await q(
      `SELECT b.id, b.batch_no, p.name AS product_name, b.status,
              (SELECT count(*) FROM vaccinations v WHERE v.batch_id=b.id) AS used_count
       FROM vaccine_batches b JOIN vaccine_products p ON p.id=b.product_id
       WHERE b.status IN ('cold_chain_break','recall','expired')`);
    return res.json(rows);
  }
  const { rows } = await q(
    `SELECT v.vaccine_name, v.given_at, v.adverse, p.name AS pet_name, p.species,
            u.display_name AS owner_name, u.phone AS owner_phone, c.id AS case_id, c.case_no
     FROM vaccinations v
     JOIN pets p ON p.id=v.pet_id JOIN users u ON u.id=p.owner_id JOIN cases c ON c.id=v.case_id
     WHERE v.batch_id=$1 ORDER BY v.given_at DESC`, [batchId]);
  res.json(rows);
});

export default r;
