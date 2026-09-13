import { q, tx } from '../db.js';
import { requireRole, STAFF } from '../auth.js';
import { addEvent } from '../helpers.js';
import { asyncRouter } from '../asyncify.js';

const r = asyncRouter();

// 宠物列表：主人看自己的；员工可看全部（支持按姓名/芯片搜索）
r.get('/pets', async (req, res) => {
  const { keyword } = req.query;
  if (req.user.role === 'owner') {
    const { rows } = await q(
      `SELECT p.*, u.display_name AS owner_name, u.phone AS owner_phone
       FROM pets p JOIN users u ON u.id=p.owner_id
       WHERE p.owner_id=$1 ORDER BY p.id DESC`, [req.user.id]);
    return res.json(rows);
  }
  const { rows } = await q(
    `SELECT p.*, u.display_name AS owner_name, u.phone AS owner_phone
     FROM pets p JOIN users u ON u.id=p.owner_id
     WHERE ($1='' OR p.name ILIKE '%'||$1||'%' OR p.microchip_no ILIKE '%'||$1||'%'
            OR u.display_name ILIKE '%'||$1||'%')
     ORDER BY p.id DESC`, [keyword || '']);
  res.json(rows);
});

r.post('/pets', requireRole('owner'), async (req, res) => {
  const b = req.body;
  const { rows } = await q(
    `INSERT INTO pets (owner_id,name,species,breed,gender,birth_date,age_months,weight_kg,
        neutered,microchip_no,allergies,chronic_diseases,stress_level,temper_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [req.user.id, b.name, b.species, b.breed, b.gender, b.birth_date || null, b.age_months || null,
     b.weight_kg || null, !!b.neutered, b.microchip_no || null, b.allergies || '',
     b.chronic_diseases || '', b.stress_level || 1, b.temper_note || '']);
  res.json(rows[0]);
});

r.put('/pets/:id', async (req, res) => {
  const b = req.body;
  const owned = await q('SELECT owner_id FROM pets WHERE id=$1', [req.params.id]);
  if (!owned.rows[0]) return res.status(404).json({ error: '宠物不存在' });
  if (req.user.role === 'owner' && owned.rows[0].owner_id !== req.user.id)
    return res.status(403).json({ error: '只能修改自己宠物的档案' });
  const { rows } = await q(
    `UPDATE pets SET name=$2,species=$3,breed=$4,gender=$5,birth_date=$6,age_months=$7,
       weight_kg=$8,neutered=$9,microchip_no=$10,allergies=$11,chronic_diseases=$12,
       stress_level=$13,temper_note=$14 WHERE id=$1 RETURNING *`,
    [req.params.id, b.name, b.species, b.breed, b.gender, b.birth_date || null, b.age_months || null,
     b.weight_kg || null, !!b.neutered, b.microchip_no || null, b.allergies || '',
     b.chronic_diseases || '', b.stress_level || 1, b.temper_note || '']);
  res.json(rows[0]);
});

// 长期档案：基础信息 + 既往疫苗/驱虫 + 病例事件流
r.get('/pets/:id/archive', async (req, res) => {
  const pet = (await q(
    `SELECT p.*, u.display_name AS owner_name, u.phone AS owner_phone
     FROM pets p JOIN users u ON u.id=p.owner_id WHERE p.id=$1`, [req.params.id])).rows[0];
  if (!pet) return res.status(404).json({ error: '宠物不存在' });
  if (req.user.role === 'owner' && pet.owner_id !== req.user.id)
    return res.status(403).json({ error: '无权查看' });
  const [vac, dew, events, reminders] = await Promise.all([
    q('SELECT * FROM pet_vaccine_history WHERE pet_id=$1 ORDER BY vaccinated_on DESC', [pet.id]),
    q('SELECT * FROM pet_deworming WHERE pet_id=$1 ORDER BY dewormed_on DESC', [pet.id]),
    q(`SELECT e.*, u.display_name AS author_name FROM case_events e
       LEFT JOIN users u ON u.id=e.author_id
       WHERE e.pet_id=$1 AND (e.visible_to_owner=TRUE OR $2<>$3)
       ORDER BY e.created_at DESC`, [pet.id, 'owner', req.user.role]),
    q('SELECT * FROM reminders WHERE pet_id=$1 ORDER BY due_on', [pet.id]),
  ]);
  res.json({ pet, vaccines: vac.rows, dewormings: dew.rows, events: events.rows, reminders: reminders.rows });
});

// 走失登记 / 找回
r.post('/pets/:id/lost', async (req, res) => {
  const pet = (await q('SELECT * FROM pets WHERE id=$1', [req.params.id])).rows[0];
  if (!pet) return res.status(404).json({ error: '宠物不存在' });
  if (req.user.role === 'owner' && pet.owner_id !== req.user.id)
    return res.status(403).json({ error: '无权操作' });
  const { note } = req.body || {};
  await tx(async (c) => {
    await c.query(`UPDATE pets SET lost_status='missing', lost_note=$2, lost_at=now() WHERE id=$1`, [pet.id, note || '主人登记走失']);
    // 走失信息写入相关进行中病例（如有住院则联动）
    const cs = await c.query(`SELECT id FROM cases WHERE pet_id=$1 AND status IN ('hospitalized','in_progress')`, [pet.id]);
    for (const x of cs.rows) {
      await addEvent(c, { caseId: x.id, petId: pet.id, type: 'lost', authorId: req.user.id,
        authorRole: req.user.role, title: '宠物走失预警', content: note || '主人报告宠物走失，全院协助留意' });
    }
  });
  res.json({ ok: true });
});

r.post('/pets/:id/found', async (req, res) => {
  await q(`UPDATE pets SET lost_status='found', found_at=now() WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

// 主人代办授权
r.post('/authorizations', requireRole('owner'), async (req, res) => {
  const b = req.body;
  const code = 'A' + String(Math.floor(100000 + Math.random() * 900000));
  const { rows } = await q(
    `INSERT INTO owner_authorizations (owner_id,pet_id,agent_name,agent_phone,auth_code,scope,valid_until)
     VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 ||' days')::interval) RETURNING *`,
    [req.user.id, b.petId || null, b.agentName, b.agentPhone, code,
     b.scope || '陪同就诊、签署知情同意、缴费取药', b.days || 7]);
  res.json(rows[0]);
});

r.get('/authorizations', async (req, res) => {
  const { rows } = req.user.role === 'owner'
    ? await q('SELECT * FROM owner_authorizations WHERE owner_id=$1 ORDER BY id DESC', [req.user.id])
    : await q(`SELECT a.*, u.display_name AS owner_name FROM owner_authorizations a
               JOIN users u ON u.id=a.owner_id WHERE a.revoked=FALSE AND a.valid_until>now() ORDER BY a.id DESC`);
  res.json(rows);
});

r.post('/authorizations/:id/revoke', requireRole('owner'), async (req, res) => {
  await q('UPDATE owner_authorizations SET revoked=TRUE WHERE id=$1 AND owner_id=$2',
    [req.params.id, req.user.id]);
  res.json({ ok: true });
});

export default r;
